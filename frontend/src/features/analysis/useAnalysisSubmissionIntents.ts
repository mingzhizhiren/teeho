import { inject, type InjectionKey } from 'vue'

import { useUserStorage } from '@/composables/useUserStorage'
import {
    analysisSubmissionIntentsSchema,
    createAnalysisSubmissionIntentRegistry,
    type AnalysisSubmissionIntentRegistry,
} from './analysisSubmissionIntents'

const submissionIntentStorageKey = 'analysis.submission-intents.v1'

/** 创建当前账号使用的加密 localStorage 提交意图注册表。 */
export function useAnalysisSubmissionIntents() {
    const userStorage = useUserStorage()
    return createAnalysisSubmissionIntentRegistry({
        async load() {
            return (
                (await userStorage.getValue(
                    submissionIntentStorageKey,
                    analysisSubmissionIntentsSchema,
                )) ?? []
            )
        },
        save: (intents) => userStorage.setValue(submissionIntentStorageKey, intents),
        clear: () => userStorage.removeValue(submissionIntentStorageKey),
    })
}

/** 工作台向分析提交模块提供同一份提交意图注册表。 */
export const analysisSubmissionIntentKey: InjectionKey<AnalysisSubmissionIntentRegistry> = Symbol(
    'analysis-submission-intents',
)

/** 读取工作台提供的提交意图注册表。 */
export function useAnalysisSubmissionIntentContext() {
    const registry = inject(analysisSubmissionIntentKey)
    if (!registry) {
        throw new Error('Analysis submission intent context is unavailable')
    }
    return registry
}
