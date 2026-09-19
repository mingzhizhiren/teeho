import type { AnalysisDraft } from './analysis.schema'

const bareTechnicalArtifactPattern =
    /^(?:[a-z]:)?(?:[^\r\n\\/]+[\\/])*[^\r\n\\/]+\.(?:c|cc|cpp|cs|go|h|hpp|java|js|jsx|py|rs|sql|ts|tsx|vue)$/iu

const explicitContentFields = [
    'title',
    'body',
    'topics',
] as const satisfies readonly (keyof AnalysisDraft['fields'])[]

/** 首次消息只有技术文件名或路径时，不能机械复制为小红书选题。 */
export function needsInitialTopicClarification(input: {
    message: string
    hasPriorMessages: boolean
    clarificationProvided: boolean
    fields: AnalysisDraft['fields']
}) {
    if (input.hasPriorMessages || input.clarificationProvided) return false
    const hasExplicitContent = explicitContentFields.some((fieldName) => {
        const value = input.fields[fieldName]
        return Array.isArray(value)
            ? value.length > 0
            : typeof value === 'string' && value.trim().length > 0
    })
    return !hasExplicitContent && bareTechnicalArtifactPattern.test(input.message.trim())
}

export const initialTopicClarification = {
    message: '当前输入还没有完整的待体检笔记。',
    question: '请提供已有笔记的标题、正文和话题，并上传封面及素材。',
} as const
