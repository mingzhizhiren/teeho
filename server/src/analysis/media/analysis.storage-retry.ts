import { HTTP_STATUS } from '../../config/constants'
import { logger } from '../../utils/logger'
import { analysisMediaConstraints } from '../analysis.constants'

const REQUEST_TIMEOUT_STATUS = 408
const HTTP_ERROR_STATUS_LIMIT = 600
const MAX_ERROR_CAUSE_DEPTH = 3
const TRANSIENT_NETWORK_CODES =
    /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|UND_ERR_SOCKET)$/u
const TRANSIENT_NETWORK_MESSAGE =
    /socket connection.*closed|fetch failed|failed to fetch|network.*(error|failed)|timed?\s*out/iu

interface StorageAccessContext {
    readonly operation: 'info' | 'download' | 'sign_upload'
    readonly readId: string
    readonly objectKeyHash: string
}

function isTransientReadError(error: unknown, depth = 0): boolean {
    if (!error || typeof error !== 'object' || depth > MAX_ERROR_CAUSE_DEPTH) return false
    const details = error as Record<string, unknown>
    if (details.name === 'AbortError') return false
    const status = Number(details.status ?? details.statusCode)
    if (Number.isFinite(status) && status > 0) {
        return (
            status === REQUEST_TIMEOUT_STATUS ||
            status === HTTP_STATUS.TOO_MANY_REQUESTS ||
            (status >= HTTP_STATUS.INTERNAL_SERVER_ERROR && status < HTTP_ERROR_STATUS_LIMIT)
        )
    }
    // Supabase 将 fetch 错误包装为 StorageUnknownError，底层错误码在 originalError。
    return (
        details.name === 'TimeoutError' ||
        TRANSIENT_NETWORK_CODES.test(String(details.code)) ||
        TRANSIENT_NETWORK_MESSAGE.test(String(details.message)) ||
        isTransientReadError(details.originalError ?? details.cause, depth + 1)
    )
}

/** 重试同一对象的读取或资格签发；不重复上传、创建业务素材或放宽权限。 */
export async function retryAnalysisStorageAccess<T>(
    access: () => Promise<T>,
    context: StorageAccessContext,
): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await access()
        } catch (error: unknown) {
            if (
                attempt >= analysisMediaConstraints.storageAccessMaxAttempts ||
                !isTransientReadError(error)
            )
                throw error
            logger.warn(
                { event: 'analysis_storage_access_retry', ...context, attempt },
                '图片存储访问暂时失败，重试同一对象',
            )
            await new Promise<void>((resolve) =>
                setTimeout(resolve, analysisMediaConstraints.storageAccessRetryDelayMs * attempt),
            )
        }
    }
}
