import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'
import { z } from 'zod'

import { normalizeImage } from '../analysis/media/analysis.image-normalization'
import { TIME_MS, VIDEO_RULES } from '../config/constants'

/** 完成规范化的视频证据帧。 */
export interface ProcessedVideoFrame {
    timestampMs: number
    selectionReason: string
    mediaType: 'image/webp'
    byteSize: number
    width: number
    height: number
    sha256: string
    content: Uint8Array
}

/** FFprobe 读取的视频媒体元数据。 */
export interface VideoMediaMetadata {
    durationMs: number
    width: number
    height: number
    container: string
    videoCodec: string
    hasAudio: boolean
    fileByteSize: number
    pixelCount: number
}

/** 完成探测的视频媒体描述。 */
export type ProbedVideo = VideoMediaMetadata

/** 视频帧被保留的原因。 */
export type VideoFrameSelectionReason =
    | 'first_frame'
    | 'last_frame'
    | 'opening_second'
    | 'time_coverage'
    | 'scene_change'

/** 尚未规范化的视频候选帧。 */
export interface VideoFrameCandidate {
    timestampMs: number
    selectionReason: VideoFrameSelectionReason
    perceptualHash: string
    sourcePath: string
}

const zeroBigInt = 0n
const oneBigInt = 1n
const oneItem = 1
const midpointDivisor = 2
const hexadecimalRadix = 16

/** FFmpeg 生成的视频证据包。 */
export interface ProcessedVideoEvidence {
    originalSha256: string
    ffmpegVersion: string
    media: VideoMediaMetadata
    diagnostics: VideoProcessingDiagnostics
    frames: ProcessedVideoFrame[]
}

/** 视频预处理阶段诊断数据。 */
export interface VideoProcessingDiagnostics {
    temporalCandidateCount: number
    sceneCandidateCount: number
    discardedCandidateCount: number
    selectedFrameCount: number
    stageDurationsMs: {
        probe: number
        originalHash: number
        ffmpegVersion: number
        temporalExtraction: number
        sceneExtraction: number
        selectionAndDeduplication: number
        frameNormalization: number
    }
}

/** 可替换的视频媒体处理边界。 */
export interface VideoMediaProcessor {
    process(inputPath: string, options: VideoMediaProcessOptions): Promise<ProcessedVideoEvidence>
}

/** 视频媒体处理参数。 */
export interface VideoMediaProcessOptions {
    workingDirectory: string
    fileName?: string
    declaredMediaType?: string
    signal?: AbortSignal
    timeoutMs?: number
}

/** 视频媒体处理错误。 */
export class VideoMediaProcessError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly exitCode: number | null = null,
        readonly stderrExcerpt: string | null = null,
    ) {
        super(message)
        this.name = 'VideoMediaProcessError'
    }
}

/** 确定性的素材边界错误；Worker 不应为此自动重试。 */
export class VideoEvidenceValidationError extends Error {
    constructor(
        readonly code: string,
        message: string,
        cause?: unknown,
    ) {
        super(message, { cause })
        this.name = 'VideoEvidenceValidationError'
    }
}

interface VideoProbeDeclaration {
    fileName: string
    declaredMediaType: string
}

function expectedContainer(input: VideoProbeDeclaration) {
    const extension = path.extname(input.fileName).toLocaleLowerCase()
    if (input.declaredMediaType === 'video/mp4' && extension === '.mp4') {
        return 'mp4'
    }
    if (input.declaredMediaType === 'video/quicktime' && extension === '.mov') {
        return 'mov'
    }
    throw new VideoEvidenceValidationError(
        'video_container_mismatch',
        '视频文件名、声明格式与真实容器不一致',
    )
}

/** 根据 ffprobe 与真实文件大小执行确定性媒体边界校验。 */
export function validateVideoProbe(probe: ProbedVideo, input?: VideoProbeDeclaration) {
    if (!['mp4', 'mov'].includes(probe.container)) {
        throw new VideoEvidenceValidationError(
            'unsupported_video_container',
            '仅支持 MP4 或 MOV 容器',
        )
    }
    if (!['h264', 'hevc'].includes(probe.videoCodec)) {
        throw new VideoEvidenceValidationError(
            'unsupported_video_codec',
            '仅支持 H.264 或 H.265 视频编码',
        )
    }
    if (probe.durationMs > VIDEO_RULES.maximumDurationMs) {
        throw new VideoEvidenceValidationError('video_too_long', '视频不能超过 5 分钟')
    }
    if (probe.fileByteSize > VIDEO_RULES.maximumUploadBytes) {
        throw new VideoEvidenceValidationError('video_too_large', '视频不能超过 400 MB')
    }
    if (Math.max(probe.width, probe.height) > VIDEO_RULES.maximumEdgePixels) {
        throw new VideoEvidenceValidationError('video_edge_too_large', '视频最长边不能超过 4096px')
    }
    if (probe.pixelCount > VIDEO_RULES.maximumPixels) {
        throw new VideoEvidenceValidationError('video_pixel_limit', '视频总像素不能超过约 900 万')
    }
    if (input && expectedContainer(input) !== probe.container) {
        throw new VideoEvidenceValidationError(
            'video_container_mismatch',
            '视频文件名、声明格式与真实容器不一致',
        )
    }
}

/** 首尾、开头逐秒与后续每五秒的基本时间覆盖。 */
export function buildTemporalCandidateRequests(durationMs: number) {
    const lastTimestampMs = Math.max(0, Math.floor(durationMs) - 1)
    const lastFrameCoverageStartMs = Math.max(0, lastTimestampMs - TIME_MS.SECOND)
    const byTimestamp = new Map<number, VideoFrameSelectionReason>()
    byTimestamp.set(0, 'first_frame')
    for (let second = 1; second < VIDEO_RULES.openingCoverageSeconds; second += 1) {
        const timestampMs = second * TIME_MS.SECOND
        if (timestampMs < lastFrameCoverageStartMs) {
            byTimestamp.set(timestampMs, 'opening_second')
        }
    }
    const intervalMs = VIDEO_RULES.temporalIntervalSeconds * TIME_MS.SECOND
    for (
        let timestampMs = intervalMs;
        timestampMs < lastFrameCoverageStartMs;
        timestampMs += intervalMs
    ) {
        byTimestamp.set(timestampMs, 'time_coverage')
    }
    byTimestamp.set(lastTimestampMs, 'last_frame')
    return [...byTimestamp]
        .sort(([left], [right]) => left - right)
        .map(([timestampMs, selectionReason]) => ({ timestampMs, selectionReason }))
}

function hammingDistance(left: string, right: string) {
    let difference = BigInt(`0x${left}`) ^ BigInt(`0x${right}`)
    let distance = 0
    while (difference > zeroBigInt) {
        difference &= difference - oneBigInt
        distance += 1
    }
    return distance
}

function takeEvenly<T>(items: T[], count: number) {
    if (count <= 0) {
        return []
    }
    if (items.length <= count) {
        return items
    }
    if (count === oneItem) {
        return [items[Math.floor(items.length / midpointDivisor)]!]
    }
    const indices = new Set<number>()
    for (let index = 0; index < count; index += 1) {
        indices.add(Math.round((index * (items.length - 1)) / (count - 1)))
    }
    return [...indices].map((index) => items[index]!)
}

/** 感知去重后优先保留基本时间覆盖，再用场景变化补满并限制为 50 帧。 */
export function selectVideoFrameCandidates(candidates: VideoFrameCandidate[]) {
    const reasonPriority: Record<VideoFrameSelectionReason, number> = {
        first_frame: 5,
        last_frame: 5,
        opening_second: 4,
        time_coverage: 3,
        scene_change: 2,
    }
    const byTimestamp = new Map<number, VideoFrameCandidate>()
    for (const candidate of [...candidates].sort(
        (left, right) => left.timestampMs - right.timestampMs,
    )) {
        const existing = byTimestamp.get(candidate.timestampMs)
        if (
            !existing ||
            reasonPriority[candidate.selectionReason] > reasonPriority[existing.selectionReason]
        ) {
            byTimestamp.set(candidate.timestampMs, candidate)
        }
    }
    const timestampUnique = [...byTimestamp.values()]
    const endpoints = timestampUnique.filter(
        (candidate) =>
            candidate.selectionReason === 'first_frame' ||
            candidate.selectionReason === 'last_frame',
    )
    const acceptedForDedupe: VideoFrameCandidate[] = [...endpoints]
    const deduplicated = timestampUnique.filter((candidate) => {
        if (endpoints.includes(candidate)) {
            return true
        }
        const duplicate = acceptedForDedupe.some(
            (selected) =>
                hammingDistance(selected.perceptualHash, candidate.perceptualHash) <=
                VIDEO_RULES.perceptualHashMaximumDistance,
        )
        if (!duplicate) {
            acceptedForDedupe.push(candidate)
        }
        return !duplicate
    })
    const selected = new Set(endpoints)
    const availableSlots = Math.max(0, VIDEO_RULES.maximumFrames - selected.size)
    const scenes = deduplicated.filter(
        (candidate) => !selected.has(candidate) && candidate.selectionReason === 'scene_change',
    )
    const sceneSlots =
        scenes.length === 0
            ? 0
            : Math.min(
                  scenes.length,
                  Math.max(
                      oneItem,
                      Math.floor(availableSlots * VIDEO_RULES.sceneFrameSelectionRatio),
                  ),
              )
    const temporal = deduplicated.filter(
        (candidate) => !selected.has(candidate) && candidate.selectionReason !== 'scene_change',
    )
    for (const candidate of takeEvenly(temporal, availableSlots - sceneSlots)) {
        selected.add(candidate)
    }
    for (const candidate of takeEvenly(scenes, sceneSlots)) {
        selected.add(candidate)
    }
    const remainingSlots = Math.max(0, VIDEO_RULES.maximumFrames - selected.size)
    const remaining = deduplicated.filter((candidate) => !selected.has(candidate))
    for (const candidate of takeEvenly(remaining, remainingSlots)) {
        selected.add(candidate)
    }
    return [...selected].sort((left, right) => left.timestampMs - right.timestampMs)
}

const ffprobeOutputSchema = z.object({
    streams: z.array(
        z.object({
            codec_type: z.string().optional(),
            codec_name: z.string().optional(),
            width: z.number().int().positive().optional(),
            height: z.number().int().positive().optional(),
            duration: z.string().optional(),
            avg_frame_rate: z.string().optional(),
        }),
    ),
    format: z.object({
        format_name: z.string(),
        duration: z.string().optional(),
        tags: z.record(z.string()).optional(),
    }),
})

interface CommandResult {
    stdout: string
    stderr: string
    exitCode: number
}

interface VideoMediaExecution {
    deadlineAt: number
    signal?: AbortSignal
}

const minimumCommandTimeoutMs = 1

/** 清理可写入日志的视频诊断片段。 */
export function sanitizeVideoDiagnosticExcerpt(stderr: string) {
    return stderr
        .replace(/\b(?:authorization|apikey|signature|token)(?:=|:\s*)\S+/giu, '[redacted-secret]')
        .replace(/https?:\/\/\S+/giu, '[redacted-url]')
        .replace(/[A-Za-z0-9+/]{128,}={0,2}/gu, '[redacted-base64]')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
        .slice(-VIDEO_RULES.maximumLogExcerptCharacters)
}

function executionError(execution: VideoMediaExecution) {
    if (Date.now() >= execution.deadlineAt) {
        return new VideoMediaProcessError(
            'ffmpeg_timeout',
            `媒体处理超过 ${VIDEO_RULES.processingTimeoutMs}ms`,
        )
    }
    if (execution.signal?.aborted) {
        return new VideoMediaProcessError('ffmpeg_aborted', '媒体处理已中止')
    }
    return null
}

function assertExecutionActive(execution: VideoMediaExecution) {
    const error = executionError(execution)
    if (error) {
        throw error
    }
}

async function runCommand(command: string[], execution: VideoMediaExecution) {
    const [executable, ...arguments_] = command
    if (!executable) {
        throw new VideoMediaProcessError('media_command_invalid', '媒体命令为空')
    }
    assertExecutionActive(execution)
    return new Promise<CommandResult>((resolve, reject) => {
        const subprocess = spawn(executable, arguments_, {
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        })
        const stdout: Buffer[] = []
        const stderr: Buffer[] = []
        let settled = false
        subprocess.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
        subprocess.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
        const finish = (callback: () => void, shouldKill = false) => {
            if (settled) {
                return
            }
            settled = true
            clearTimeout(timeout)
            execution.signal?.removeEventListener('abort', abort)
            if (shouldKill) {
                subprocess.kill()
            }
            callback()
        }
        const capturedStderr = () =>
            sanitizeVideoDiagnosticExcerpt(Buffer.concat(stderr).toString('utf8'))
        const abort = () => {
            finish(
                () =>
                    reject(
                        new VideoMediaProcessError(
                            'ffmpeg_aborted',
                            '媒体处理已中止',
                            null,
                            capturedStderr(),
                        ),
                    ),
                true,
            )
        }
        const remainingMs = Math.max(minimumCommandTimeoutMs, execution.deadlineAt - Date.now())
        const timeout = setTimeout(() => {
            finish(
                () =>
                    reject(
                        new VideoMediaProcessError(
                            'ffmpeg_timeout',
                            `媒体处理超过 ${VIDEO_RULES.processingTimeoutMs}ms`,
                            null,
                            capturedStderr(),
                        ),
                    ),
                true,
            )
        }, remainingMs)
        execution.signal?.addEventListener('abort', abort, { once: true })
        subprocess.once('error', (error) => {
            finish(() =>
                reject(new VideoMediaProcessError('media_command_start_failed', error.message)),
            )
        })
        subprocess.once('close', (exitCode) => {
            finish(() =>
                resolve({
                    stdout: Buffer.concat(stdout).toString('utf8'),
                    stderr: Buffer.concat(stderr).toString('utf8'),
                    exitCode: exitCode ?? -1,
                }),
            )
        })
    })
}

async function runSuccessful(command: string[], errorCode: string, execution: VideoMediaExecution) {
    const result = await runCommand(command, execution)
    if (result.exitCode !== 0) {
        throw new VideoMediaProcessError(
            errorCode,
            `${command[0]} 执行失败`,
            result.exitCode,
            sanitizeVideoDiagnosticExcerpt(result.stderr),
        )
    }
    return result.stdout
}

async function sha256File(filePath: string, execution: VideoMediaExecution) {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(filePath)) {
        assertExecutionActive(execution)
        hash.update(chunk as Buffer)
    }
    return hash.digest('hex')
}

function canonicalContainer(formatName: string, majorBrand: string | undefined) {
    const formats = new Set(formatName.split(','))
    if (formats.has('mov') || formats.has('mp4')) {
        return majorBrand?.trim().toLocaleLowerCase() === 'qt' ? 'mov' : 'mp4'
    }
    return formatName.split(',')[0] ?? formatName
}

/**
 * FFprobe 的流时长包含最后一帧的展示时长；分数帧率视频可能因此比剪辑边界多一帧尾差。
 * 只在刚好落入一个真实帧时长时规范到上限，更长内容仍由业务边界拒绝。
 */
export function normalizeVideoStreamDurationMs(
    durationSeconds: number,
    averageFrameRate: string | undefined,
) {
    const durationMs = Math.round(durationSeconds * TIME_MS.SECOND)
    if (durationMs <= VIDEO_RULES.maximumDurationMs || !averageFrameRate) {
        return durationMs
    }
    const [numeratorText, denominatorText] = averageFrameRate.split('/')
    const numerator = Number(numeratorText)
    const denominator = Number(denominatorText)
    if (
        !Number.isFinite(numerator) ||
        !Number.isFinite(denominator) ||
        numerator <= 0 ||
        denominator <= 0
    ) {
        return durationMs
    }
    const oneFrameMs = Math.ceil((TIME_MS.SECOND * denominator) / numerator)
    return durationMs - VIDEO_RULES.maximumDurationMs <= oneFrameMs
        ? VIDEO_RULES.maximumDurationMs
        : durationMs
}

async function probeVideo(
    inputPath: string,
    execution: VideoMediaExecution,
): Promise<VideoMediaMetadata> {
    let raw: string
    try {
        raw = await runSuccessful(
            [
                'ffprobe',
                '-v',
                'error',
                '-print_format',
                'json',
                '-show_format',
                '-show_streams',
                inputPath,
            ],
            'ffprobe_failed',
            execution,
        )
    } catch (error) {
        if (
            error instanceof VideoMediaProcessError &&
            error.code === 'ffprobe_failed' &&
            error.exitCode !== null
        ) {
            throw new VideoEvidenceValidationError('video_corrupt', '视频文件损坏或不包含有效媒体')
        }
        throw error
    }
    let parsedJson: unknown
    try {
        parsedJson = JSON.parse(raw)
    } catch {
        throw new VideoMediaProcessError('ffprobe_invalid_output', 'ffprobe 输出无效')
    }
    const parsed = ffprobeOutputSchema.safeParse(parsedJson)
    const videoStream = parsed.success
        ? parsed.data.streams.find((stream) => stream.codec_type === 'video')
        : undefined
    if (!parsed.success || !videoStream?.codec_name || !videoStream.width || !videoStream.height) {
        throw new VideoEvidenceValidationError('video_stream_missing', '文件中没有可解码的视频流')
    }
    // 视觉证据以视频流时长为准；容器时长可能因 AAC 编码填充略长，
    // 若用容器时长抽帧会在视频流结束之后请求一个不存在的画面。
    const durationSeconds = Number(videoStream.duration ?? parsed.data.format.duration)
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new VideoEvidenceValidationError('video_duration_invalid', '视频时长无效')
    }
    const file = await stat(inputPath)
    const pixelCount = videoStream.width * videoStream.height
    return {
        durationMs: normalizeVideoStreamDurationMs(durationSeconds, videoStream.avg_frame_rate),
        width: videoStream.width,
        height: videoStream.height,
        container: canonicalContainer(
            parsed.data.format.format_name,
            parsed.data.format.tags?.major_brand,
        ),
        videoCodec: videoStream.codec_name,
        hasAudio: parsed.data.streams.some((stream) => stream.codec_type === 'audio'),
        fileByteSize: file.size,
        pixelCount,
    }
}

async function ffmpegVersion(execution: VideoMediaExecution) {
    const output = await runSuccessful(['ffmpeg', '-version'], 'ffmpeg_unavailable', execution)
    return output.split(/\r?\n/u)[0]?.trim() ?? 'ffmpeg unknown'
}

const perceptualHashWidth = 9
const perceptualHashHeight = 8
const perceptualHashHexLength = 16
const colorChannelHexLength = 2
const rgbChannelCount = 3
const lastFrameScanSeconds = 1
const candidateFilePositionWidth = 3

async function perceptualHash(sourcePath: string) {
    const source = sharp(sourcePath, { failOn: 'warning', sequentialRead: true })
    const [pixels, statistics] = await Promise.all([
        source
            .clone()
            .rotate()
            .resize(perceptualHashWidth, perceptualHashHeight, { fit: 'fill' })
            .grayscale()
            .raw()
            .toBuffer(),
        source.clone().stats(),
    ])
    let hash = zeroBigInt
    for (let row = 0; row < perceptualHashHeight; row += 1) {
        for (let column = 0; column < perceptualHashWidth - 1; column += 1) {
            hash <<= oneBigInt
            const offset = row * perceptualHashWidth + column
            if (pixels[offset]! > pixels[offset + 1]!) {
                hash |= oneBigInt
            }
        }
    }
    const meanColor = statistics.channels
        .slice(0, rgbChannelCount)
        .map((channel) =>
            Math.round(channel.mean)
                .toString(hexadecimalRadix)
                .padStart(colorChannelHexLength, '0'),
        )
        .join('')
    return `${hash.toString(hexadecimalRadix).padStart(perceptualHashHexLength, '0')}${meanColor}`
}

async function extractFrameAt(
    inputPath: string,
    outputPath: string,
    timestampMs: number,
    lastFrame: boolean,
    execution: VideoMediaExecution,
) {
    const command = lastFrame
        ? [
              'ffmpeg',
              '-v',
              'error',
              '-nostdin',
              '-y',
              '-sseof',
              `-${lastFrameScanSeconds}`,
              '-i',
              inputPath,
              '-frames:v',
              '1',
              '-update',
              '1',
              outputPath,
          ]
        : [
              'ffmpeg',
              '-v',
              'error',
              '-nostdin',
              '-y',
              '-ss',
              (timestampMs / TIME_MS.SECOND).toFixed(candidateFilePositionWidth),
              '-i',
              inputPath,
              '-frames:v',
              '1',
              outputPath,
          ]
    try {
        await runSuccessful(command, 'ffmpeg_frame_extraction_failed', execution)
        try {
            await stat(outputPath)
        } catch (missingFrameError) {
            if (lastFrame) {
                const fallbackTimestampMs = Math.max(0, timestampMs - TIME_MS.SECOND)
                await runSuccessful(
                    [
                        'ffmpeg',
                        '-v',
                        'error',
                        '-nostdin',
                        '-y',
                        '-ss',
                        (fallbackTimestampMs / TIME_MS.SECOND).toFixed(candidateFilePositionWidth),
                        '-i',
                        inputPath,
                        '-frames:v',
                        '1',
                        '-update',
                        '1',
                        outputPath,
                    ],
                    'ffmpeg_frame_extraction_failed',
                    execution,
                )
                await stat(outputPath)
                return
            }
            throw new VideoMediaProcessError(
                'ffmpeg_frame_extraction_failed',
                'ffmpeg 未生成请求的视频帧',
                null,
                missingFrameError instanceof Error ? missingFrameError.message : null,
            )
        }
    } catch (error) {
        if (
            error instanceof VideoMediaProcessError &&
            error.code === 'ffmpeg_frame_extraction_failed'
        ) {
            throw new VideoEvidenceValidationError(
                'video_decode_failed',
                '视频帧无法完整解码',
                error,
            )
        }
        throw error
    }
}

async function extractTemporalCandidates(
    inputPath: string,
    workingDirectory: string,
    durationMs: number,
    execution: VideoMediaExecution,
) {
    const requests = buildTemporalCandidateRequests(durationMs)
    const candidates: VideoFrameCandidate[] = []
    for (const [position, request] of requests.entries()) {
        const sourcePath = path.join(
            workingDirectory,
            `temporal-${position.toString().padStart(candidateFilePositionWidth, '0')}.png`,
        )
        await extractFrameAt(
            inputPath,
            sourcePath,
            request.timestampMs,
            request.selectionReason === 'last_frame',
            execution,
        )
        assertExecutionActive(execution)
        candidates.push({
            ...request,
            sourcePath,
            perceptualHash: await perceptualHash(sourcePath),
        })
    }
    return candidates
}

async function extractSceneCandidates(
    inputPath: string,
    workingDirectory: string,
    execution: VideoMediaExecution,
) {
    const outputPattern = path.join(workingDirectory, 'scene-%03d.png')
    const filter = `select=gt(scene\\,${VIDEO_RULES.sceneChangeThreshold}),showinfo`
    const result = await runCommand(
        [
            'ffmpeg',
            '-hide_banner',
            '-v',
            'info',
            '-nostdin',
            '-y',
            '-i',
            inputPath,
            '-vf',
            filter,
            '-fps_mode',
            'vfr',
            '-frames:v',
            String(VIDEO_RULES.maximumSceneCandidates),
            outputPattern,
        ],
        execution,
    )
    if (result.exitCode !== 0) {
        throw new VideoEvidenceValidationError('video_decode_failed', '视频场景变化帧无法完整解码')
    }
    const timestamps = [...result.stderr.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/gu)]
        .map((match) => Math.round(Number(match[1]) * TIME_MS.SECOND))
        .filter((timestampMs) => Number.isSafeInteger(timestampMs) && timestampMs >= 0)
        .slice(0, VIDEO_RULES.maximumSceneCandidates)
    const candidates: VideoFrameCandidate[] = []
    for (const [position, timestampMs] of timestamps.entries()) {
        assertExecutionActive(execution)
        const sourcePath = path.join(
            workingDirectory,
            `scene-${(position + 1).toString().padStart(candidateFilePositionWidth, '0')}.png`,
        )
        try {
            await stat(sourcePath)
        } catch {
            continue
        }
        candidates.push({
            timestampMs,
            selectionReason: 'scene_change',
            sourcePath,
            perceptualHash: await perceptualHash(sourcePath),
        })
    }
    return candidates
}

async function normalizeSelectedFrame(
    candidate: VideoFrameCandidate,
    execution: VideoMediaExecution,
) {
    assertExecutionActive(execution)
    const extracted = new Uint8Array(await readFile(candidate.sourcePath))
    const normalized = await normalizeImage(extracted, {
        inputPixelLimit: VIDEO_RULES.maximumPixels,
        maxEdgePixels: VIDEO_RULES.frameMaximumEdgePixels,
        outputFormat: 'webp',
        lossyQuality: VIDEO_RULES.frameWebpQuality,
    })
    return {
        timestampMs: candidate.timestampMs,
        selectionReason: candidate.selectionReason,
        mediaType: 'image/webp' as const,
        byteSize: normalized.byteSize,
        width: normalized.width,
        height: normalized.height,
        sha256: createHash('sha256').update(normalized.content).digest('hex'),
        content: normalized.content,
    }
}

/** 生成经过真实媒体校验、时间覆盖、场景补充和感知去重的版本化视觉证据。 */
export async function processVideoFile(
    inputPath: string,
    options: VideoMediaProcessOptions,
): Promise<ProcessedVideoEvidence> {
    const timeoutMs = options.timeoutMs ?? VIDEO_RULES.processingTimeoutMs
    const execution: VideoMediaExecution = {
        deadlineAt: Date.now() + Math.max(minimumCommandTimeoutMs, timeoutMs),
        signal: options.signal,
    }
    const stageDurationsMs: VideoProcessingDiagnostics['stageDurationsMs'] = {
        probe: 0,
        originalHash: 0,
        ffmpegVersion: 0,
        temporalExtraction: 0,
        sceneExtraction: 0,
        selectionAndDeduplication: 0,
        frameNormalization: 0,
    }
    const measureStage = async <T>(
        stage: keyof typeof stageDurationsMs,
        operation: () => Promise<T>,
    ) => {
        const startedAt = Date.now()
        try {
            return await operation()
        } finally {
            stageDurationsMs[stage] = Math.max(0, Date.now() - startedAt)
        }
    }
    assertExecutionActive(execution)
    const [media, originalSha256, buildVersion] = await Promise.all([
        measureStage('probe', () => probeVideo(inputPath, execution)),
        measureStage('originalHash', () => sha256File(inputPath, execution)),
        measureStage('ffmpegVersion', () => ffmpegVersion(execution)),
    ])
    validateVideoProbe(
        media,
        options.fileName && options.declaredMediaType
            ? {
                  fileName: options.fileName,
                  declaredMediaType: options.declaredMediaType,
              }
            : undefined,
    )
    const temporal = await measureStage('temporalExtraction', () =>
        extractTemporalCandidates(inputPath, options.workingDirectory, media.durationMs, execution),
    )
    const scenes = await measureStage('sceneExtraction', () =>
        extractSceneCandidates(inputPath, options.workingDirectory, execution),
    )
    const selectionStartedAt = Date.now()
    const selected = selectVideoFrameCandidates([...temporal, ...scenes])
    stageDurationsMs.selectionAndDeduplication = Math.max(0, Date.now() - selectionStartedAt)
    const frames: ProcessedVideoFrame[] = []
    await measureStage('frameNormalization', async () => {
        for (const candidate of selected) {
            frames.push(await normalizeSelectedFrame(candidate, execution))
        }
    })
    return {
        originalSha256,
        ffmpegVersion: buildVersion,
        media,
        diagnostics: {
            temporalCandidateCount: temporal.length,
            sceneCandidateCount: scenes.length,
            discardedCandidateCount: temporal.length + scenes.length - selected.length,
            selectedFrameCount: frames.length,
            stageDurationsMs,
        },
        frames,
    }
}

/** 基于 FFmpeg 的视频媒体处理实现。 */
export const ffmpegVideoMediaProcessor: VideoMediaProcessor = {
    process: processVideoFile,
}
