import { describe, expect, it, vi } from 'vitest'

vi.mock('../../config/env', () => ({
    env: { TEEHO_PWD: 'preparation-artifact-test-password' },
}))

import type { AgentDraftPreparation } from '../providers/analysis.provider'
import {
    createDraftPreparationArtifact,
    readDraftPreparationArtifact,
    readMediaIndependentDraftPreparationArtifact,
} from './analysis.preparation-artifact'

const preparation: AgentDraftPreparation = {
    acceptance: {
        status: 'accepted',
        message: null,
        clarificationQuestion: null,
    },
    inferredFields: { title: null, body: null, topics: null },
}

describe('draft preparation artifact', () => {
    it('只有标记为媒体无关的对话凭据能在同语义素材替换后复用', () => {
        const fullFingerprint = 'a'.repeat(64)
        const semanticFingerprint = 'b'.repeat(64)
        const artifact = createDraftPreparationArtifact(
            '00000000-0000-4000-8000-000000000001',
            fullFingerprint,
            preparation,
            { mediaIndependent: true, semanticFingerprint },
        )

        expect(
            readDraftPreparationArtifact(
                artifact,
                '00000000-0000-4000-8000-000000000001',
                fullFingerprint,
            ),
        ).not.toBeNull()
        expect(
            readMediaIndependentDraftPreparationArtifact(
                artifact,
                '00000000-0000-4000-8000-000000000001',
                semanticFingerprint,
            ),
        ).not.toBeNull()
        expect(
            readMediaIndependentDraftPreparationArtifact(
                artifact,
                '00000000-0000-4000-8000-000000000001',
                'c'.repeat(64),
            ),
        ).toBeNull()

        const regular = createDraftPreparationArtifact(
            '00000000-0000-4000-8000-000000000001',
            fullFingerprint,
            preparation,
        )
        expect(
            readMediaIndependentDraftPreparationArtifact(
                regular,
                '00000000-0000-4000-8000-000000000001',
                fullFingerprint,
            ),
        ).toBeNull()
    })
})
