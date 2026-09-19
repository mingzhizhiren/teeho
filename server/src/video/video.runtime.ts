import { spawn } from 'node:child_process'

/** 媒体运行时命令执行结果。 */
export interface VideoRuntimeCommandResult {
    exitCode: number
    stdout: string
    stderr: string
}

/** 可替换的媒体运行时命令执行边界。 */
export interface VideoRuntimeCommandRunner {
    run(command: string[]): Promise<VideoRuntimeCommandResult>
}

/** 本机 FFmpeg 与 FFprobe 能力描述。 */
export interface VideoRuntimeDescriptor {
    ffmpegVersion: string
    ffprobeVersion: string
    capabilities: {
        h264: true
        hevc: true
    }
}

/** 本机媒体运行时能力不足错误。 */
export class VideoRuntimeCapabilityError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'VideoRuntimeCapabilityError'
    }
}

const runtimeCommandTimeoutMs = 10_000

const systemVideoRuntimeCommandRunner: VideoRuntimeCommandRunner = {
    run(command) {
        return new Promise((resolve, reject) => {
            const [executable, ...arguments_] = command
            if (!executable) {
                reject(new VideoRuntimeCapabilityError('媒体运行时命令为空'))
                return
            }
            const subprocess = spawn(executable, arguments_, {
                shell: false,
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            })
            const stdout: Buffer[] = []
            const stderr: Buffer[] = []
            subprocess.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
            subprocess.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
            const timeout = setTimeout(() => {
                subprocess.kill()
                reject(new VideoRuntimeCapabilityError(`${executable} 预检超时`))
            }, runtimeCommandTimeoutMs)
            subprocess.once('error', (error) => {
                clearTimeout(timeout)
                reject(new VideoRuntimeCapabilityError(`${executable} 无法启动：${error.message}`))
            })
            subprocess.once('close', (exitCode) => {
                clearTimeout(timeout)
                resolve({
                    exitCode: exitCode ?? -1,
                    stdout: Buffer.concat(stdout).toString('utf8'),
                    stderr: Buffer.concat(stderr).toString('utf8'),
                })
            })
        })
    },
}

function firstLine(value: string) {
    return value.split(/\r?\n/u)[0]?.trim() ?? ''
}

async function successful(runner: VideoRuntimeCommandRunner, command: string[]) {
    const result = await runner.run(command)
    if (result.exitCode !== 0) {
        throw new VideoRuntimeCapabilityError(`${command[0]} 预检失败`)
    }
    return result
}

/** 启动前验证二进制版本和 H.264/H.265 解码能力。 */
export async function inspectVideoRuntime(
    runner: VideoRuntimeCommandRunner = systemVideoRuntimeCommandRunner,
): Promise<VideoRuntimeDescriptor> {
    const [ffmpeg, ffprobe, decoders] = await Promise.all([
        successful(runner, ['ffmpeg', '-version']),
        successful(runner, ['ffprobe', '-version']),
        successful(runner, ['ffmpeg', '-hide_banner', '-decoders']),
    ])
    const ffmpegVersion = firstLine(ffmpeg.stdout)
    const ffprobeVersion = firstLine(ffprobe.stdout)
    const hasH264 = /^\s*V\S*\s+h264\b/imu.test(decoders.stdout)
    const hasHevc = /^\s*V\S*\s+hevc\b/imu.test(decoders.stdout)
    if (!ffmpegVersion || !ffprobeVersion || !hasH264 || !hasHevc) {
        throw new VideoRuntimeCapabilityError(
            '视频 Worker 需要 ffmpeg、ffprobe 以及 H.264/H.265 解码能力',
        )
    }
    return {
        ffmpegVersion,
        ffprobeVersion,
        capabilities: { h264: true, hevc: true },
    }
}
