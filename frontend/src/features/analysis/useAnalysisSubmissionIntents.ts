import { inject, type InjectionKey } from 'vue'

import { useAuthStore } from '@/stores/auth'
import {
    getUserLocalValue,
    removeUserLocalValue,
    setUserLocalValue,
} from '@/utils/userLocalStorage'
import {
    analysisSubmissionIntentsSchema,
    ANALYSIS_SUBMISSION_INTENT_STORAGE_KEY,
    createAnalysisSubmissionIntentRegistry,
    type AnalysisSubmissionIntentRegistry,
} from './analysisSubmissionIntents'

/** 创建当前账号使用的加密 localStorage 提交意图注册表。 */
export function useAnalysisSubmissionIntents() {
    const ownerUserId = useAuthStore().user?.id
    function requireOwner(): string {
        if (!ownerUserId) throw new Error('analysis_submission_owner_unavailable')
        return ownerUserId
    }
    return createAnalysisSubmissionIntentRegistry({
        async load() {
            return (
                (await getUserLocalValue(
                    requireOwner(),
                    ANALYSIS_SUBMISSION_INTENT_STORAGE_KEY,
                    analysisSubmissionIntentsSchema,
                )) ?? []
            )
        },
        save: (intents) =>
            setUserLocalValue(requireOwner(), ANALYSIS_SUBMISSION_INTENT_STORAGE_KEY, intents),
        clear: () => removeUserLocalValue(requireOwner(), ANALYSIS_SUBMISSION_INTENT_STORAGE_KEY),
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
