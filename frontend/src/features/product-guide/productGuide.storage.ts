import { z, type ZodType } from 'zod'

import type { ProductGuideProgressStorage } from './productGuide.types'

const GUIDE_ID_MAX_LENGTH = 100
const STEP_ID_MAX_LENGTH = 100
const MAX_COMPLETED_STEPS = 200

const guideProgressSchema = z.object({
    guideId: z.string().min(1).max(GUIDE_ID_MAX_LENGTH),
    status: z.enum(['in_progress', 'completed', 'skipped']),
    currentStepId: z.string().min(1).max(STEP_ID_MAX_LENGTH).nullable(),
    completedStepIds: z
        .array(z.string().min(1).max(STEP_ID_MAX_LENGTH))
        .max(MAX_COMPLETED_STEPS),
})

function storageKey(guideId: string): string {
    return `product-guide.${guideId}`
}

interface ProductGuideUserStorageAdapter {
    getAccountId(): string | null
    getValue<T>(key: string, schema: ZodType<T>): Promise<T | null>
    setValue<T>(key: string, value: T): Promise<void>
}

/** 通过当前账号的 useUserStorage interface 保存产品引导进度。 */
export function createProductGuideProgressStorage(
    storage: ProductGuideUserStorageAdapter,
): ProductGuideProgressStorage {
    return {
        read: (accountId, guideId) =>
            storage.getAccountId() === accountId
                ? storage.getValue(storageKey(guideId), guideProgressSchema)
                : Promise.resolve(null),
        write: (accountId, progress) =>
            storage.getAccountId() === accountId
                ? storage.setValue(storageKey(progress.guideId), progress)
                : Promise.resolve(),
    }
}
