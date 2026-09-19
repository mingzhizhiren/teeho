import { z } from 'zod'

import { BYTE_SIZE } from '@/config/constants'
import type { AnalysisDraftPayload } from './analysis.contract'

const browserStorageEstimateSchema = z.object({
    usage: z.number().finite().nonnegative().optional(),
    quota: z.number().finite().positive().optional(),
})

const expectedResultKibibytes = 256
const recordMetadataKibibytes = 64
const expectedResultBytes = expectedResultKibibytes * BYTE_SIZE.KIBIBYTE
const recordMetadataBytes = recordMetadataKibibytes * BYTE_SIZE.KIBIBYTE
const encryptedStorageSafetyFactor = 1.15

export interface LocalHistorySizeInput {
    draft: AnalysisDraftPayload
    images: File[]
}

export interface BrowserStorageEstimate {
    usage?: number
    quota?: number
}

export type StorageCapacity =
    | {
          status: 'sufficient'
          requiredBytes: number
          availableBytes: number
      }
    | {
          status: 'insufficient'
          requiredBytes: number
          availableBytes: number
      }
    | {
          status: 'unknown'
          requiredBytes: number
          availableBytes: null
      }

export type InsufficientStorageChoice = 'manage_history' | 'session_only' | 'cancel'

export type StorageSubmissionDecision =
    | { action: 'submit'; persistHistory: boolean }
    | { action: 'await_choice' | 'manage_history' | 'cancel' }

/** 计算 JSON 序列化后的 UTF-8 字节数 */
function jsonBytes(value: unknown) {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

/**
 * 估算一条本地历史需要的原图、任务快照、预期结果和加密存储开销。
 * 该值刻意保留安全余量，避免只按图片原始字节判断。
 */
export function estimateLocalHistoryBytes(input: LocalHistorySizeInput) {
    const imageBytes = input.images.reduce((total, image) => total + image.size, 0)
    const taskBytes = jsonBytes(input.draft)
    return Math.ceil(
        (imageBytes + taskBytes + expectedResultBytes + recordMetadataBytes) *
            encryptedStorageSafetyFactor,
    )
}

/** 将浏览器的 origin 级配额估算转换为本次历史保存决策。 */
export function evaluateStorageCapacity(
    requiredBytes: number,
    estimate: BrowserStorageEstimate,
): StorageCapacity {
    const parsedRequiredBytes = z.number().finite().nonnegative().parse(requiredBytes)
    const parsedEstimate = browserStorageEstimateSchema.parse(estimate)
    if (parsedEstimate.usage === undefined || parsedEstimate.quota === undefined) {
        return {
            status: 'unknown',
            requiredBytes: parsedRequiredBytes,
            availableBytes: null,
        }
    }

    const availableBytes = Math.max(0, parsedEstimate.quota - parsedEstimate.usage)
    return {
        status: availableBytes >= parsedRequiredBytes ? 'sufficient' : 'insufficient',
        requiredBytes: parsedRequiredBytes,
        availableBytes,
    }
}

/** 读取浏览器 Storage API；不支持或读取失败时返回 unknown，不静默删除历史。 */
export async function estimateBrowserStorageCapacity(
    requiredBytes: number,
): Promise<StorageCapacity> {
    if (!navigator.storage?.estimate) {
        return evaluateStorageCapacity(requiredBytes, {})
    }

    try {
        const estimate = await navigator.storage.estimate()
        return evaluateStorageCapacity(requiredBytes, estimate)
    } catch {
        return evaluateStorageCapacity(requiredBytes, {})
    }
}

/** 把明确的容量选择转换为是否提交、是否保存历史的纯决策。 */
export function resolveStorageSubmission(
    capacity: StorageCapacity,
    choice?: InsufficientStorageChoice,
): StorageSubmissionDecision {
    if (capacity.status !== 'insufficient') {
        return { action: 'submit', persistHistory: true }
    }
    if (!choice) {
        return { action: 'await_choice' }
    }
    if (choice === 'session_only') {
        return { action: 'submit', persistHistory: false }
    }
    return { action: choice }
}
