import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { z } from 'zod'

const analysisSubmissionIntentSchema = z
    .object({
        submissionId: z.string().min(1),
        inputFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
        persistHistory: z.boolean(),
    })
    .strict()

/** 加密本地存储中的提交意图列表结构。 */
export const analysisSubmissionIntentsSchema = z.array(analysisSubmissionIntentSchema)

/** 正式请求发出前持久化的轻量分析提交意图。 */
export type AnalysisSubmissionIntent = z.infer<typeof analysisSubmissionIntentSchema>

/** 提交意图注册表使用的账号级持久化适配器。 */
export interface AnalysisSubmissionIntentStorage {
    load: () => Promise<AnalysisSubmissionIntent[]>
    save: (intents: AnalysisSubmissionIntent[]) => Promise<void>
    clear: () => Promise<void>
}

/** 提交意图注册表对工作台和提交编排暴露的最小接口。 */
export interface AnalysisSubmissionIntentRegistry {
    intents: Readonly<Ref<AnalysisSubmissionIntent[]>>
    intentIds: ComputedRef<ReadonlySet<string>>
    load: () => Promise<AnalysisSubmissionIntent[]>
    remember: (intent: AnalysisSubmissionIntent) => Promise<void>
    forget: (submissionId: string) => Promise<void>
}

/** 创建串行写入的提交意图注册表，避免并发保存与清理互相覆盖。 */
export function createAnalysisSubmissionIntentRegistry(
    storage: AnalysisSubmissionIntentStorage,
): AnalysisSubmissionIntentRegistry {
    const intents = ref<AnalysisSubmissionIntent[]>([])
    let mutationQueue = Promise.resolve()

    function enqueue<T>(operation: () => Promise<T>) {
        const result = mutationQueue.then(operation, operation)
        mutationQueue = result.then(
            () => undefined,
            () => undefined,
        )
        return result
    }

    return {
        intents,
        intentIds: computed(() => new Set(intents.value.map((intent) => intent.submissionId))),

        load() {
            return enqueue(async () => {
                intents.value = await storage.load()
                return intents.value
            })
        },

        remember(intent) {
            return enqueue(async () => {
                const nextIntents = [
                    intent,
                    ...intents.value.filter(
                        (candidate) => candidate.submissionId !== intent.submissionId,
                    ),
                ]
                await storage.save(nextIntents)
                intents.value = nextIntents
            })
        },

        forget(submissionId) {
            return enqueue(async () => {
                const nextIntents = intents.value.filter(
                    (intent) => intent.submissionId !== submissionId,
                )
                if (nextIntents.length === 0) {
                    await storage.clear()
                } else {
                    await storage.save(nextIntents)
                }
                intents.value = nextIntents
            })
        },
    }
}
