import { z } from 'zod'

import { useUserStorage } from '@/composables/useUserStorage'
import { useAuthStore } from '@/stores/auth'

const REANALYSIS_INTENT_PREFIX = 'analysis.reanalysis-intent.v1.'
const reanalysisIntentSchema = z
    .object({
        sourceTaskId: z.string().uuid(),
        submissionId: z.string().uuid(),
    })
    .strict()

/** 一次待确认再次体检的账号与请求身份，仅用于内部协调。 */
export interface PreparedReanalysisIntent {
    ownerUserId: string
    sourceTaskId: string
    submissionId: string
}

/** 生命周期在正式请求前保存身份，收到权威任务后完成清理。 */
export interface AnalysisReanalysisIntents {
    prepare: (sourceTaskId: string) => Promise<PreparedReanalysisIntent>
    isCurrentOwner: (intent: PreparedReanalysisIntent) => boolean
    confirm: (intent: PreparedReanalysisIntent) => Promise<void>
}

/** 本地请求身份不可用时禁止发送无法安全重试的付费请求。 */
export class ReanalysisIntentError extends Error {
    constructor() {
        super('analysis_reanalysis_intent_unavailable')
        this.name = 'ReanalysisIntentError'
    }
}

/** 按账号和来源任务加密保存再次体检身份，未知响应及刷新均复用。 */
export function useAnalysisReanalysisIntents(): AnalysisReanalysisIntents {
    const storage = useUserStorage()
    const auth = useAuthStore()
    let mutationQueue = Promise.resolve()

    function assertOwner(ownerUserId: string): void {
        if (auth.user?.id !== ownerUserId) throw new ReanalysisIntentError()
    }

    function mutate<T>(owner: string, source: string, operation: () => Promise<T>): Promise<T> {
        const guarded = async () => {
            assertOwner(owner)
            try {
                return await operation()
            } catch {
                throw new ReanalysisIntentError()
            }
        }
        const run = async (): Promise<T> =>
            typeof navigator !== 'undefined' && navigator.locks
                ? await navigator.locks.request(
                      `${REANALYSIS_INTENT_PREFIX}${owner}.${source}`,
                      guarded,
                  )
                : await guarded()
        const result = mutationQueue.then(run, run)
        mutationQueue = result.then(
            () => undefined,
            () => undefined,
        )
        return result
    }

    return {
        isCurrentOwner: (intent) => auth.user?.id === intent.ownerUserId,
        async prepare(sourceTaskId) {
            const ownerUserId = auth.user?.id
            if (!ownerUserId) throw new ReanalysisIntentError()
            return mutate(ownerUserId, sourceTaskId, async () => {
                const key = `${REANALYSIS_INTENT_PREFIX}${sourceTaskId}`
                const existing = await storage.getValue(key, reanalysisIntentSchema)
                assertOwner(ownerUserId)
                if (existing && existing.sourceTaskId !== sourceTaskId)
                    throw new ReanalysisIntentError()
                const intent =
                    existing ??
                    reanalysisIntentSchema.parse({
                        sourceTaskId,
                        submissionId: crypto.randomUUID(),
                    })
                if (!existing) await storage.setValue(key, intent)
                assertOwner(ownerUserId)
                return { ...intent, ownerUserId }
            })
        },
        async confirm(intent) {
            return mutate(intent.ownerUserId, intent.sourceTaskId, async () => {
                const key = `${REANALYSIS_INTENT_PREFIX}${intent.sourceTaskId}`
                const current = await storage.getValue(key, reanalysisIntentSchema)
                assertOwner(intent.ownerUserId)
                if (current?.submissionId === intent.submissionId) await storage.removeValue(key)
            })
        },
    }
}
