import { sql } from 'drizzle-orm'

import { db } from '../../db/database'
import { analysisEvidenceSetSchema, type AnalysisEvidenceSet } from './analysis.evidence'

interface FrozenEvidenceRow extends Record<string, unknown> {
    evidenceSet: unknown
}

/** 读取任务首次分析时已经冻结的证据集。 */
export async function findFrozenAnalysisEvidenceSet(
    taskId: string,
    userId: string,
): Promise<AnalysisEvidenceSet | null> {
    const rows = await db.execute<FrozenEvidenceRow>(sql`
        SELECT evidence_set AS "evidenceSet"
        FROM public.analysis_evidence_sets
        WHERE task_id = ${taskId}::uuid
            AND user_id = ${userId}::uuid
        LIMIT 1
    `)
    const row = rows[0]
    return row ? analysisEvidenceSetSchema.parse(row.evidenceSet) : null
}

/**
 * 首次写入任务证据集；并发执行时返回最先成功冻结的版本，之后不得覆盖。
 */
export async function freezeAnalysisEvidenceSet(
    taskId: string,
    userId: string,
    evidence: AnalysisEvidenceSet,
): Promise<AnalysisEvidenceSet> {
    const parsed = analysisEvidenceSetSchema.parse(evidence)
    await db.execute(sql`
        INSERT INTO public.analysis_evidence_sets (
            task_id,
            user_id,
            evidence_version,
            evidence_query_version,
            matched_note_count,
            selected_note_count,
            selection_criteria,
            evidence_set
        )
        VALUES (
            ${taskId}::uuid,
            ${userId}::uuid,
            ${parsed.evidenceVersion},
            ${parsed.selectionCriteria.selectionVersion},
            ${parsed.matchedNoteCount},
            ${parsed.notes.length},
            ${JSON.stringify(parsed.selectionCriteria)}::jsonb,
            ${JSON.stringify(parsed)}::jsonb
        )
        ON CONFLICT (task_id) DO NOTHING
    `)
    const frozen = await findFrozenAnalysisEvidenceSet(taskId, userId)
    if (!frozen) {
        throw new Error('冻结分析证据集失败')
    }
    return frozen
}
