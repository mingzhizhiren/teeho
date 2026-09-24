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
    trackCode: number,
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
        trackCode,
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
    const trackCodes = [
        ...new Set(
            note.modelTrackCodes ?? (note.modelTrackCode == null ? [] : [note.modelTrackCode]),
        ),
    ]
    if (trackCodes.length === 0) {
        input.onUnavailable('reference_classification_unavailable', Date.now() - started)
        return { ...reference, modelScore: null }
    }
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(REFERENCE_SCORE_TIMEOUT_MS)])
    let abort: () => void = () => undefined
    try {
        signal.throwIfAborted()
        const predictions = await Promise.race([
            Promise.all(trackCodes.map((track) => predictReference(note, input, track))),
            new Promise<never>((_, reject) => {
                abort = () => reject(signal.reason)
                signal.addEventListener('abort', abort, { once: true })
            }),
        ])
        const parsed = z.array(predictionSchema).safeParse(predictions)
        if (
            !parsed.success ||
            parsed.data.some((prediction) => prediction.modelId !== input.expectedModelId)
        ) {
            input.onUnavailable('unavailable', Date.now() - started)
            return { ...reference, modelScore: null }
        }
        return {
            ...reference,
            // 参考库没有主次排序，全部真实分类等权参与，避免按代码顺序偏向某赛道。
            modelScore: roundCheckupScore(
                parsed.data.reduce((sum, prediction) => sum + prediction.baseScore, 0) /
                    parsed.data.length,
            ),
            modelId: input.expectedModelId,
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
