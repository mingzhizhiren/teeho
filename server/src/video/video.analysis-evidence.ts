import { createHash } from 'node:crypto'

import { db, type DatabaseExecutor } from '../db/database'
import { AnalysisVideoEvidenceExpiredError } from '../analysis/analysis.errors'
import {
    agentVideoEvidenceSchema,
    type AgentImageAsset,
    type AgentVideoEvidence,
} from '../analysis/providers/analysis.provider'
import type { VideoEvidenceReference } from '../analysis/analysis.schema'
import { findReadyVideoEvidence, type ReadyVideoAnalysisEvidence } from './video.repository'
import { downloadVideoEvidenceObject } from './video.storage'

/** 执行器交给 Provider 的完整、供应商中立视频视觉输入。 */
export interface AgentVideoEvidenceDelivery {
    evidence: AgentVideoEvidence
    frames: AgentImageAsset[]
}

interface VideoEvidenceDeliveryDependencies {
    executor: DatabaseExecutor
    download: (path: string) => Promise<Uint8Array>
}

/** 草稿预览与提交解析当前账号的权威 ready 证据。 */
export async function loadReadyVideoEvidenceForReference(
    userId: string,
    assetId: string,
    executor: DatabaseExecutor = db,
) {
    const evidence = await findReadyVideoEvidence(executor, userId, assetId)
    if (!evidence) {
        throw new AnalysisVideoEvidenceExpiredError('视频尚未准备完成或证据已过期，请重新上传视频')
    }
    return evidence
}

/** 从可用证据中提取任务快照需要的不可变身份。 */
export function createVideoEvidenceSnapshot(
    evidence: ReadyVideoAnalysisEvidence,
): VideoEvidenceReference {
    return {
        assetId: evidence.assetId,
        evidenceId: evidence.evidenceId,
        evidenceVersion: evidence.evidenceVersion,
        originalSha256: evidence.originalSha256,
    }
}

function evidenceMatchesSnapshot(
    evidence: ReadyVideoAnalysisEvidence,
    snapshot: VideoEvidenceReference,
) {
    return (
        evidence.assetId === snapshot.assetId &&
        evidence.evidenceId === snapshot.evidenceId &&
        evidence.evidenceVersion === snapshot.evidenceVersion &&
        evidence.originalSha256 === snapshot.originalSha256
    )
}

/** 在正式任务事务内复核快照仍指向同一份可用证据。 */
export async function assertVideoEvidenceSnapshotAvailable(
    executor: DatabaseExecutor,
    userId: string,
    snapshot: VideoEvidenceReference,
) {
    const evidence = await findReadyVideoEvidence(executor, userId, snapshot.assetId)
    if (!evidence || !evidenceMatchesSnapshot(evidence, snapshot)) {
        throw new AnalysisVideoEvidenceExpiredError('视频证据已过期，请重新上传视频')
    }
    return evidence
}

/**
 * Worker 读取并逐帧校验派生 WebP；返回值不含对象路径、原视频、音频或转写。
 */
export async function loadAgentVideoEvidenceForTask(
    _taskId: string,
    userId: string,
    snapshot: VideoEvidenceReference,
    dependencies: VideoEvidenceDeliveryDependencies = {
        executor: db,
        download: downloadVideoEvidenceObject,
    },
): Promise<AgentVideoEvidenceDelivery | null> {
    const evidence = await findReadyVideoEvidence(dependencies.executor, userId, snapshot.assetId)
    if (!evidence || !evidenceMatchesSnapshot(evidence, snapshot)) {
        return null
    }

    const frames: AgentImageAsset[] = []
    const providerFrames: AgentVideoEvidence['frames'] = []
    for (const [index, frame] of evidence.frames.entries()) {
        const content = await dependencies.download(frame.objectPath)
        const digest = createHash('sha256').update(content).digest('hex')
        if (content.byteLength !== frame.byteSize || digest !== frame.sha256) {
            throw new AnalysisVideoEvidenceExpiredError('视频关键帧完整性校验失败')
        }
        const reference = `video-frame-${index + 1}`
        frames.push({
            reference,
            mediaType: 'image/webp',
            byteSize: frame.byteSize,
            width: frame.width,
            height: frame.height,
            content,
            availability: 'processed_private',
        })
        providerFrames.push({
            reference,
            timestampMs: frame.timestampMs,
            selectionReason: frame.selectionReason,
            width: frame.width,
            height: frame.height,
        })
    }

    return {
        evidence: agentVideoEvidenceSchema.parse({
            schemaVersion: 'agent-video-evidence.v1',
            durationMs: evidence.durationMs,
            width: evidence.width,
            height: evidence.height,
            container: evidence.container,
            videoCodec: evidence.videoCodec,
            hasAudio: evidence.hasAudio,
            frames: providerFrames,
        }),
        frames,
    }
}
