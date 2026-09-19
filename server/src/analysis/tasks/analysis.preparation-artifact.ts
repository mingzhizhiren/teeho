import { z } from 'zod'

import { decryptJson, encryptJson } from '../../utils/crypto'
import {
    agentDraftPreparationSchema,
    type AgentDraftPreparation,
} from '../providers/analysis.provider'

const draftPreparationArtifactPayloadSchema = z
    .object({
        schemaVersion: z.literal('draft-preparation-artifact.v2'),
        userId: z.string().uuid(),
        fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
        semanticFingerprint: z
            .string()
            .regex(/^[0-9a-f]{64}$/u)
            .nullable(),
        mediaIndependent: z.boolean(),
        submissionId: z.string().uuid(),
        preparation: agentDraftPreparationSchema,
    })
    .strict()

/** 创建可跨进程实例验证的加密草稿预览凭据 */
export function createDraftPreparationArtifact(
    userId: string,
    fingerprint: string,
    preparation: AgentDraftPreparation,
    options: {
        mediaIndependent?: boolean
        semanticFingerprint?: string
    } = {},
): string {
    return encryptJson({
        schemaVersion: 'draft-preparation-artifact.v2',
        userId,
        fingerprint,
        semanticFingerprint: options.semanticFingerprint ?? null,
        mediaIndependent: options.mediaIndependent ?? false,
        submissionId: crypto.randomUUID(),
        preparation,
    })
}

function parseDraftPreparationArtifact(artifact: string) {
    try {
        const parsed = draftPreparationArtifactPayloadSchema.safeParse(
            decryptJson<unknown>(artifact),
        )
        return parsed.success ? parsed.data : null
    } catch {
        return null
    }
}

/** 已验证的草稿预览凭据内容 */
export interface DraftPreparationArtifact {
    submissionId: string
    preparation: AgentDraftPreparation
}

/** 仅当账号与有效输入均未改变时读取草稿预览凭据 */
export function readDraftPreparationArtifact(
    artifact: string,
    userId: string,
    fingerprint: string,
): DraftPreparationArtifact | null {
    const parsed = parseDraftPreparationArtifact(artifact)
    if (!parsed || parsed.userId !== userId || parsed.fingerprint !== fingerprint) {
        return null
    }
    return {
        submissionId: parsed.submissionId,
        preparation: parsed.preparation,
    }
}

/** 只允许任务形成阶段明确声明媒体无关的签名凭据跨同形态素材替换复用。 */
export function readMediaIndependentDraftPreparationArtifact(
    artifact: string,
    userId: string,
    semanticFingerprint: string,
): DraftPreparationArtifact | null {
    const parsed = parseDraftPreparationArtifact(artifact)
    if (
        !parsed ||
        parsed.userId !== userId ||
        !parsed.mediaIndependent ||
        parsed.semanticFingerprint !== semanticFingerprint
    ) {
        return null
    }
    return {
        submissionId: parsed.submissionId,
        preparation: parsed.preparation,
    }
}
