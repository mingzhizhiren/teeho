import { PERFORMANCE, performanceWindowStart } from '@teeho/content-metrics'
import type { StandardAnalysisTask } from '../analysis.schema'
import type { AnalysisEvidenceSet } from '../evidence/analysis.evidence'
import { selectCheckupNotes, type SelectedCheckupNote } from './analysis.checkup.selection'
/** 独立窗口内同时保留相关集合和同类总体；不以模型主分驱动六维。 */
export function contextSamples(
    evidence: AnalysisEvidenceSet,
    task: StandardAnalysisTask,
): {
    selected: SelectedCheckupNote[]
    population: SelectedCheckupNote[]
    windowDays: number
} {
    const all = selectCheckupNotes(evidence, task, Number.MAX_SAFE_INTEGER, 0, false)
    const related = new Set(
        selectCheckupNotes(evidence, task, Number.MAX_SAFE_INTEGER, undefined, false).map(
            (sample) => sample.note.noteId,
        ),
    )
    for (const days of PERFORMANCE.windows) {
        const start = performanceWindowStart(evidence.selectedAt, days)
        const population = all.filter((sample) => Date.parse(sample.latest.observedAt) >= start)
        const selected = population.filter((sample) => related.has(sample.note.noteId))
        if (selected.length >= PERFORMANCE.minimumSamples)
            return { population, selected, windowDays: days }
    }
    return { population: [], selected: [], windowDays: PERFORMANCE.maximumDays }
}
