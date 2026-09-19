import type { StandardAnalysisTask } from '../analysis.schema'
import type { WebResearchCollectionInput } from '../research/analysis.research-provider'
import type { AgentConversationTurnInput, AgentResultGenerationInput } from './analysis.provider'

export type AnalysisOutputLanguage = 'zh-CN' | 'en-US'

const explicitEnglishPattern =
    /(?:用|输出|请用)(?:英文|英语)|\b(?:write|respond|output|keep)(?:[\s\S]{0,24})\bin english\b/iu
const explicitChinesePattern =
    /(?:用|输出|请用)(?:中文|汉语)|\b(?:write|respond|output)(?:[\s\S]{0,24})\bin chinese\b/iu

/** 用户显式语言优先；否则按主要内容中的中英文字符确定，平局回到中文。 */
function explicitOutputLanguage(text: string): AnalysisOutputLanguage | null {
    if (explicitEnglishPattern.test(text)) return 'en-US'
    if (explicitChinesePattern.test(text)) return 'zh-CN'
    return null
}

export function resolveAnalysisOutputLanguage(
    texts: readonly (string | null | undefined)[],
): AnalysisOutputLanguage {
    const available = texts.filter((text): text is string => Boolean(text?.trim()))
    const joined = available.join('\n')
    const explicit = explicitOutputLanguage(joined)
    if (explicit) return explicit
    const chineseCharacters = joined.match(/\p{Script=Han}/gu)?.length ?? 0
    const englishCharacters = joined.match(/[A-Za-z]/gu)?.length ?? 0
    return englishCharacters > chineseCharacters ? 'en-US' : 'zh-CN'
}

function nonEmptyValue(value: unknown): string | string[] | undefined {
    if (typeof value === 'string') return value.trim() || undefined
    if (!Array.isArray(value)) return undefined
    const items = value.map((item) => String(item).trim()).filter(Boolean)
    return items.length > 0 ? items : undefined
}

function compactResolvedFields(fields: AgentConversationTurnInput['completeDraft']['fields']) {
    return Object.fromEntries(
        Object.entries(fields).flatMap(([name, field]) => {
            const value = nonEmptyValue(field.value)
            return value === undefined || field.source === 'system_default' ? [] : [[name, value]]
        }),
    )
}

/** 所有正式阶段共用用户显式语言优先的解析规则。 */
export function outputLanguageForTask(task: StandardAnalysisTask): AnalysisOutputLanguage {
    return resolveAnalysisOutputLanguage([
        task.fields.title.value,
        task.fields.body.value,
        ...task.fields.topics.value,
    ])
}

function compactTask(task: StandardAnalysisTask) {
    return {
        contentKind: task.contentKind,
        fields: {
            track: task.fields.track.value,
            ...(task.fields.customTrackName.value
                ? { customTrackName: task.fields.customTrackName.value }
                : {}),
            title: task.fields.title.value,
            body: task.fields.body.value,
            topics: task.fields.topics.value,
        },
        coverImageIndex: !task.coverReference
            ? null
            : task.contentKind === 'video'
              ? 0
              : task.coverReference
                ? task.imageReferences.indexOf(task.coverReference)
                : 0,
    }
}

function compactWebResearch(input: AgentResultGenerationInput) {
    const research = input.webResearch
    if (!research || research.status !== 'collected') return undefined
    return {
        status: research.status,
        summary: research.summary,
        keyFacts: research.keyFacts.map((fact) => ({
            text: fact.text,
            sourceUrls: [...fact.sourceUrls],
        })),
        conflicts: research.conflicts.map((conflict) => ({
            draftClaim: conflict.draftClaim,
            externalFinding: conflict.externalFinding,
            sourceUrls: [...conflict.sourceUrls],
        })),
        sources: research.sources.map((source) => ({
            title: source.title,
            site: source.site,
            publishedAt: source.publishedAt,
            url: source.url,
            sourceType: source.sourceType,
        })),
    }
}

function compactTopicEvidence(input: AgentResultGenerationInput) {
    const evidence = input.topicEvidence
    if (!evidence) return undefined
    return {
        status: evidence.status,
        asOf: evidence.asOf,
        topics:
            evidence.status === 'collected'
                ? evidence.topics.map((topic) => ({
                      topicId: topic.topicId,
                      title: topic.title,
                      observedAt: topic.observedAt,
                      joinCount: topic.joinCount,
                      viewCount: topic.viewCount,
                      previousObservedAt: topic.previousObservedAt,
                      joinDelta: topic.joinDelta,
                      viewDelta: topic.viewDelta,
                  }))
                : [],
    }
}

function compactMedia(input: AgentResultGenerationInput) {
    const images = input.images.map((image, attachmentIndex) => {
        const originalReferences = image.originalReferences ?? [image.reference]
        return {
            width: image.width,
            height: image.height,
            attachmentIndex,
            noteImageIndices: input.task.imageReferences.flatMap((reference, noteImageIndex) =>
                originalReferences.includes(reference) ? [noteImageIndex] : [],
            ),
            isCover: Boolean(
                input.task.coverReference && originalReferences.includes(input.task.coverReference),
            ),
        }
    })
    const video = input.videoEvidence
        ? {
              durationMs: input.videoEvidence.durationMs,
              width: input.videoEvidence.width,
              height: input.videoEvidence.height,
              hasAudio: input.videoEvidence.hasAudio,
              frames: input.videoEvidence.frames.map((frame) => ({
                  timestampMs: frame.timestampMs,
                  selectionReason: frame.selectionReason,
                  width: frame.width,
                  height: frame.height,
              })),
          }
        : undefined
    return {
        imageCount: images.length,
        noteImageCount: input.task.imageReferences.length,
        ...(images.length > 0 ? { images } : {}),
        ...(video ? { video } : {}),
    }
}

export function createConversationTurnProviderDto(input: AgentConversationTurnInput) {
    return {
        outputLanguage: resolveAnalysisOutputLanguage([
            input.message,
            input.completeDraft.rawText,
            ...input.history
                .filter((message) => message.role === 'user')
                .map((message) => message.text),
        ]),
        history: input.history.map(({ role, text }) => ({ role, text })),
        message: input.message,
        currentDraft: {
            userText: input.completeDraft.rawText,
            fields: compactResolvedFields(input.completeDraft.fields),
        },
        contentKind: input.contentKind,
        media: { ...input.media },
    }
}

export function createResultGenerationProviderDto(input: AgentResultGenerationInput) {
    const webResearch = compactWebResearch(input)
    const topicEvidence = compactTopicEvidence(input)
    return {
        ...(input.materialDescriptions ? { materialDescriptions: input.materialDescriptions } : {}),
        outputLanguage: outputLanguageForTask(input.task),
        task: compactTask(input.task),
        ...(webResearch ? { webResearch } : {}),
        ...(topicEvidence ? { topicEvidence } : {}),
        media: compactMedia(input),
    }
}

export function createWebResearchProviderDto(input: WebResearchCollectionInput) {
    const researchValues = Object.values(input.researchInput).filter(
        (value): value is string => typeof value === 'string' && Boolean(value.trim()),
    )
    return {
        outputLanguage: resolveAnalysisOutputLanguage(researchValues),
        seedSearchQueries: [...input.queryPlan.queries],
    }
}
