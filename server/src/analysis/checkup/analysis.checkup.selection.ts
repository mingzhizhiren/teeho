import {
    PERFORMANCE,
    comparePerformanceObservations,
    performanceWindowStart,
} from '@teeho/content-metrics'
import { scoreCasePerformance as scorePerformance } from '../../runtime/case-ranking'
import type { StandardAnalysisTask } from '../analysis.schema'
import type { AnalysisEvidenceSet } from '../evidence/analysis.evidence'
import { hasComparableIntent } from '../tracks/analysis.intent'
import { sampleByTrack } from '../tracks/analysis.track-sampling'
import { normalizeAnalysisTrackSelection } from '../tracks/analysis.track-selection'
import { resolveAnalysisTrackCode } from '../tracks/analysis.tracks'
import {
    checkupOutputConstraints,
    checkupSampling,
    checkupTextComparison,
} from './analysis.checkup.constants'
import type { CheckupReference } from './analysis.checkup.contract'

type EvidenceNote = AnalysisEvidenceSet['notes'][number]
export interface SelectedCheckupNote {
    readonly note: EvidenceNote
    readonly similarity: number
    readonly latest: EvidenceNote['observations'][number]
}

const stopWords = new Set(['的', '了', '是', '在', '和', '与', 'the', 'and', 'a', 'an', 'to'])

/** 观察时间相同时使用记录身份降序，避免输入排列与机器语言影响结果。 */
export function compareCheckupObservations(
    left: Readonly<{ observedAt: string; observationId?: string }>,
    right: Readonly<{ observedAt: string; observationId?: string }>,
): number {
    return comparePerformanceObservations(left, right)
}

/** 固定词项供确定性比较；不调用语义模型或改写用户原文。 */
export function checkupTerms(text: string): string[] {
    const segments =
        text
            .normalize('NFKC')
            .toLowerCase()
            .match(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu) ?? []
    const terms = segments.flatMap((segment) => {
        if (!/\p{Script=Han}/u.test(segment) || segment.length < checkupTextComparison.hanTermWidth)
            return [segment]
        return Array.from({ length: segment.length - 1 }, (_, index) =>
            segment.slice(index, index + checkupTextComparison.hanTermWidth),
        )
    })
    return [...new Set(terms.filter((term) => !stopWords.has(term)))].slice(
        0,
        checkupSampling.tokenLimit,
    )
}

/** Dice词面关联度，相关度不直接等于内容质量。 */
export function checkupSimilarity(left: string, right: string): number {
    const a = new Set(checkupTerms(left))
    const b = new Set(checkupTerms(right))
    if (a.size + b.size === 0) return 0
    return (
        (checkupTextComparison.diceIntersectionMultiplier *
            [...a].filter((term) => b.has(term)).length) /
        (a.size + b.size)
    )
}

function validCount(value: number | null): value is number {
    return value !== null && Number.isSafeInteger(value) && value >= 0
}

function selectCandidate(
    note: EvidenceNote,
    task: StandardAnalysisTask,
    asOf: number,
    inputText: string,
    minimumSimilarity: number | undefined,
): SelectedCheckupNote[] {
    if (note.noteType && note.noteType !== (task.contentKind === 'video' ? 'video' : 'normal'))
        return []
    if (!hasComparableIntent(note.title, note.body, task.analysisIntent)) return []
    const published = Date.parse(note.publishedAt)
    const latest = [...note.observations]
        .filter((observation) => Date.parse(observation.observedAt) <= asOf)
        .sort(compareCheckupObservations)[0]
    if (!latest || !validCount(latest.likes) || !validCount(latest.collects)) return []
    const observed = Date.parse(latest.observedAt)
    if (
        published > observed ||
        published > asOf ||
        asOf - published > checkupSampling.observationMaxAgeDays * checkupSampling.dayMs ||
        asOf - observed > checkupSampling.observationMaxAgeDays * checkupSampling.dayMs
    )
        return []
    const similarity = checkupSimilarity(
        inputText,
        [note.title, note.body, ...note.topics].join(' '),
    )
    return minimumSimilarity !== undefined && similarity < minimumSimilarity
        ? []
        : [{ note, similarity, latest }]
}

/** 同类及意图决定资格，词面相关性用于排序；仅显式调用方可要求额外门槛。 */
export function selectCheckupNotes(
    evidence: AnalysisEvidenceSet,
    task: StandardAnalysisTask,
    limit: number = checkupSampling.candidateLimit,
    minimumSimilarity?: number,
    useWindow = true,
): SelectedCheckupNote[] {
    const asOf = Date.parse(evidence.selectedAt)
    const inputText = [
        task.fields.title.value,
        task.fields.body.value,
        ...task.fields.topics.value,
        task.materialSummary ?? '',
    ].join(' ')
    const seen = new Set<string>()
    const candidates = evidence.notes
        .slice(0, checkupSampling.candidateLimit)
        .flatMap((note) => {
            if (seen.has(note.noteId)) return []
            seen.add(note.noteId)
            return selectCandidate(note, task, asOf, inputText, minimumSimilarity)
        })
        .sort(
            (left, right) =>
                right.similarity - left.similarity ||
                Date.parse(right.note.publishedAt) - Date.parse(left.note.publishedAt) ||
                (left.note.noteId < right.note.noteId
                    ? -1
                    : left.note.noteId > right.note.noteId
                      ? 1
                      : 0),
        )
    const selection = normalizeAnalysisTrackSelection(
        resolveAnalysisTrackCode(task.fields.track.value),
        task.secondaryTracks,
    )
    const sample = (items: readonly SelectedCheckupNote[]) =>
        sampleByTrack(items, selection, limit, (item) => item.note)
    if (!useWindow) return sample(candidates)
    for (const days of PERFORMANCE.windows) {
        const start = performanceWindowStart(evidence.selectedAt, days)
        const selected = candidates.filter(
            (sample) => Date.parse(sample.latest.observedAt) >= start,
        )
        if (selected.length >= PERFORMANCE.minimumSamples || days === PERFORMANCE.maximumDays)
            return sample(selected)
    }
    return []
}

/** 案例与差异共享优秀群体及稳定排序，保留原始笔记身份。 */
export function excellentCheckupSamples(
    samples: readonly SelectedCheckupNote[],
    minimumPoolSize = 1,
): SelectedCheckupNote[] {
    if (!samples.length) return []
    const asOf = new Date(
        Math.max(...samples.map((sample) => Date.parse(sample.latest.observedAt))),
    ).toISOString()
    const scores = scorePerformance(
        samples.map(({ note }) => note),
        asOf,
    )
    const ranked = samples
        .map((sample, index) => ({ ...sample, performance: scores[index]! }))
        .sort(
            (a, b) =>
                b.performance - a.performance ||
                b.similarity - a.similarity ||
                a.note.noteId.localeCompare(b.note.noteId),
        )
    const pool =
        ranked.length >= PERFORMANCE.minimumSamples
            ? ranked.slice(
                  0,
                  Math.max(minimumPoolSize, Math.ceil(ranked.length * PERFORMANCE.topFraction)),
              )
            : ranked
    return pool
}

/** 用户仅看到有限对照，不返回采集时间或原始数据库记录。 */
export function checkupReferences(samples: readonly SelectedCheckupNote[]): CheckupReference[] {
    const unique = excellentCheckupSamples(samples, checkupOutputConstraints.maxReferences)
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, checkupOutputConstraints.maxReferences)
    return mapCheckupReferences(unique)
}

/** 已通过资格的参考只映射展示字段，不再次筛选表现、赛道或年龄。 */
export function mapCheckupReferences(
    samples: readonly SelectedCheckupNote[],
    reason = 'similar_content',
): CheckupReference[] {
    return samples.slice(0, checkupOutputConstraints.maxReferences).map(({ note, latest }) => ({
        noteId: note.noteId,
        title:
            note.title.length > checkupOutputConstraints.referenceTitleMaxLength
                ? note.title.slice(0, checkupOutputConstraints.referenceTitleMaxLength - 1) + '…'
                : note.title,
        bodyExcerpt:
            note.body.length > checkupOutputConstraints.excerptMaxLength
                ? note.body.slice(0, checkupOutputConstraints.excerptMaxLength - 1) + '…'
                : note.body,
        likes: latest.likes!,
        collects: latest.collects!,
        comments: latest.comments,
        url: safeNoteUrl(note.noteUrl),
        reason,
    }))
}

/** 原文地址保留访问参数，只允许来源平台的 HTTPS 地址。 */
function safeNoteUrl(value: string | null | undefined): string | null {
    if (!value) return null
    try {
        const url = new URL(value)
        const allowed = ['xiaohongshu.com', 'xhslink.com', 'rednote.com']
        return url.protocol === 'https:' &&
            !url.username &&
            !url.password &&
            allowed.some((host) => url.hostname === host || url.hostname.endsWith('.' + host))
            ? value
            : null
    } catch {
        return null
    }
}
