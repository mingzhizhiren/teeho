import { z } from 'zod'
import type { InsightPredictor } from '../../runtime/insight'
import type { AnalysisEvidenceSet } from '../evidence/analysis.evidence'
import { checkupOutputConstraints } from './analysis.checkup.constants'
import { roundCheckupScore, type CheckupReference } from './analysis.checkup.contract'

const REFERENCE_SCORE_TIMEOUT_MS = 3_000
const REFERENCE_MODEL_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })
const predictionSchema = z.object({
    status: z.literal('available'),
    limited: z.literal(false),
    coverage: z.number().finite().positive().max(1),
    baseScore: z.number().finite().min(0).max(checkupOutputConstraints.insightMaximumScore),
    modelId: z.string().nullable(),
})

interface ReferenceScoringInput {
    readonly references: readonly CheckupReference[]
    readonly evidence: AnalysisEvidenceSet
    readonly predict?: InsightPredictor
    readonly signal: AbortSignal
    readonly expectedModelId: string | null
    readonly onUnavailable: (category: string, durationMs: number) => void
}

function predictReference(
    note: AnalysisEvidenceSet['notes'][number],
    input: ReferenceScoringInput,
) {
    return input.predict!(
        {
            title: note.title,
            body: note.body,
            topics: note.topics,
            cover: note.coverDescription ?? null,
            contentType: note.noteType === 'video' ? 'video' : 'image',
            publishedAt: REFERENCE_MODEL_DATE.format(new Date(note.publishedAt)),
        },
        input.evidence.selectedAt,
        note.modelTrackCode!,
        [],
    )
}

async function scoreReference(
    reference: CheckupReference,
    input: ReferenceScoringInput,
): Promise<CheckupReference> {
    const started = Date.now()
    const note = input.evidence.notes.find((item) => item.noteId === reference.noteId)
    if (!note || !input.predict) return reference
    if (note.modelTrackCode == null) {
        input.onUnavailable('reference_classification_unavailable', Date.now() - started)
        return { ...reference, modelScore: null }
    }
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(REFERENCE_SCORE_TIMEOUT_MS)])
    let abort: () => void = () => undefined
    try {
        signal.throwIfAborted()
        const prediction = await Promise.race([
            predictReference(note, input),
            new Promise<never>((_, reject) => {
                abort = () => reject(signal.reason)
                signal.addEventListener('abort', abort, { once: true })
            }),
        ])
        const parsed = predictionSchema.safeParse(prediction)
        if (!parsed.success || parsed.data.modelId !== input.expectedModelId) {
            input.onUnavailable('unavailable', Date.now() - started)
            return { ...reference, modelScore: null }
        }
        return {
            ...reference,
            modelScore: roundCheckupScore(parsed.data.baseScore),
            modelId: parsed.data.modelId,
        }
    } catch {
        input.signal.throwIfAborted()
        input.onUnavailable(signal.aborted ? 'timeout' : 'prediction_failed', Date.now() - started)
        return { ...reference, modelScore: null }
    } finally {
        signal.removeEventListener('abort', abort)
    }
}

/** 参考评分为可选事实，不能改动参考身份或用户模型分。 */
export async function scoreCheckupReferences(
    input: ReferenceScoringInput,
): Promise<CheckupReference[]> {
    input.signal.throwIfAborted()
    const references = await Promise.all(
        input.references.map((reference) => scoreReference(reference, input)),
    )
    input.signal.throwIfAborted()
    return references
}
