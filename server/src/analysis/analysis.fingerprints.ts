import { createHash } from 'node:crypto'
import { analysisFingerprintConstraints } from './analysis.fingerprints.constants'
import type { StandardAnalysisTask } from './analysis.schema'
import { checkupVersions } from './checkup/analysis.checkup.constants'
import type { AgentImageAsset } from './providers/analysis.provider'

export interface AnalysisFingerprints {
    schemaVersion: typeof analysisFingerprintConstraints.fingerprintVersion
    quantification: string
    level: string
    generation: string
}
function digest(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
/** 再次体检提交绑定不可变源任务；网络重试不能把同一ID用于另一个来源。 */
export function createAnalysisRecheckFingerprint(sourceTaskId: string, userId: string): string {
    return digest({ version: 'checkup-recheck.v1', sourceTaskId, userId })
}
/** 提供素材内容身份而不暴露原始内容。 */
export function createAnalysisMediaHashes(
    images: AgentImageAsset[],
    videoOriginalSha256?: string,
): string[] {
    return [
        ...images.map((image) => createHash('sha256').update(image.content).digest('hex')),
        ...(videoOriginalSha256 ? [videoOriginalSha256] : []),
    ]
}
/** 结果执行身份只依赖确认笔记与评审版本，不再携带生成偏好。 */
export function createAnalysisGenerationFingerprint(
    task: StandardAnalysisTask,
    levelFingerprint: string,
): string {
    return digest({
        levelFingerprint,
        taskVersion: task.structureVersion,
        promptVersion: checkupVersions.explanation,
    })
}
/** 将输入、评分口径与结果评审的身份分离。 */
export function createAnalysisFingerprints(
    task: StandardAnalysisTask,
    mediaHashes: string[],
): AnalysisFingerprints {
    const quantification = digest({
        version: checkupVersions.algorithm,
        fields: Object.fromEntries(
            Object.entries(task.fields).map(([name, field]) => [name, field.value]),
        ),
        contentKind: task.contentKind,
        coverReference: task.coverReference,
        mediaHashes,
    })
    const level = digest({
        quantification,
        version: checkupVersions.score,
    })
    return {
        schemaVersion: analysisFingerprintConstraints.fingerprintVersion,
        quantification,
        level,
        generation: createAnalysisGenerationFingerprint(task, level),
    }
}
