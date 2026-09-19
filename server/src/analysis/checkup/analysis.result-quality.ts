import type { AgentResultGenerationInput } from '../providers/analysis.provider'
import type { CheckupAgentResult } from './analysis.checkup.contract'

interface GeneratedResultForQualityCheck {
    summary: string
    strengths: string[]
    uncertainties: string[]
    risks: CheckupAgentResult['risks']
}

export interface GeneratedResultQualityViolation {
    path: string
    reason: 'internal_state' | 'invalid_location' | 'ungrounded_quote'
}

const internalStatePattern =
    /(?:\b(?:quantitativeReport|webResearch|topicEvidence|matchedTopicIds)(?:\.[A-Za-z]+)?\b\s*(?:为|是|=|:|：|为空|缺失|状态)|\bno_sources\b)/iu

function userVisibleTextEntries(result: GeneratedResultForQualityCheck) {
    return [
        { path: 'summary', value: result.summary },
        ...result.strengths.map((value, index) => ({
            path: `strengths.${index}`,
            value,
        })),
        ...result.uncertainties.map((value, index) => ({ path: `uncertainties.${index}`, value })),
        ...result.risks.flatMap((risk, index) => [
            { path: `risks.${index}.message`, value: risk.message },
            { path: `risks.${index}.suggestion`, value: risk.suggestion },
        ]),
    ]
}

function normalizedQuote(value: string): string {
    return value.normalize('NFC').replace(/\s+/gu, '')
}

function riskLocationViolation(
    location: CheckupAgentResult['risks'][number]['location'],
    index: number,
    input: AgentResultGenerationInput,
): GeneratedResultQualityViolation[] {
    const prefix = `risks.${index}.location`
    const invalid = (field: string): GeneratedResultQualityViolation[] => [
        { path: `${prefix}.${field}`, reason: 'invalid_location' },
    ]
    if (location.imageIndex !== undefined && location.kind !== 'image' && location.kind !== 'cover')
        return invalid('imageIndex')
    if (location.timestampMs !== undefined && location.kind !== 'video')
        return invalid('timestampMs')
    if (location.kind === 'image' || location.kind === 'cover') {
        if (
            input.images.length === 0 ||
            (location.kind === 'image' && input.task.contentKind !== 'image')
        )
            return invalid('kind')
        if (
            (location.kind === 'image' && location.imageIndex === undefined) ||
            (location.imageIndex !== undefined &&
                (location.imageIndex < 0 ||
                    location.imageIndex >= input.task.imageReferences.length))
        )
            return invalid('imageIndex')
    }
    if (
        location.kind === 'video' &&
        (input.task.contentKind !== 'video' ||
            !input.videoEvidence ||
            location.timestampMs === undefined ||
            location.timestampMs < 0 ||
            location.timestampMs > input.videoEvidence.durationMs)
    )
        return invalid('timestampMs')
    if (location.quote && (location.kind === 'title' || location.kind === 'body')) {
        const quote = normalizedQuote(location.quote)
        const original = normalizedQuote(input.task.fields[location.kind].value ?? '')
        if (quote && !original.includes(quote))
            return [{ path: `${prefix}.quote`, reason: 'ungrounded_quote' }]
    }
    return []
}

/** 找出不应进入用户可见分析结果的内部状态或回复式文本。 */
export function findGeneratedResultQualityViolations(
    result: GeneratedResultForQualityCheck,
    input?: AgentResultGenerationInput,
): GeneratedResultQualityViolation[] {
    const violations = userVisibleTextEntries(result).flatMap(
        (entry): GeneratedResultQualityViolation[] =>
            internalStatePattern.test(entry.value)
                ? [{ path: entry.path, reason: 'internal_state' }]
                : [],
    )

    return [
        ...violations,
        ...(input
            ? result.risks.flatMap((risk, index) =>
                  riskLocationViolation(risk.location, index, input),
              )
            : []),
    ]
}
