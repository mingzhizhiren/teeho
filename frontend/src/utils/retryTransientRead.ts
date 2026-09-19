import { API_CODES } from '@/config/constants'
import { ApiRequestError } from './apiRequestError'

const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 400
const SERVER_ERROR_MIN = 500
const SERVER_ERROR_MAX = 599

/** 仅供幂等读取：短暂断网或服务端错误有限重试，鉴权、维护和契约错误原样返回。 */
export async function retryTransientRead<T>(read: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await read()
        } catch (error) {
            const transient =
                error instanceof ApiRequestError &&
                error.code !== API_CODES.SERVICE_MAINTENANCE &&
                ((error.status === null && error.code === null) ||
                    (error.status !== null &&
                        error.status >= SERVER_ERROR_MIN &&
                        error.status <= SERVER_ERROR_MAX))
            if (!transient || attempt >= MAX_ATTEMPTS) throw error
            await new Promise<void>((resolve) =>
                setTimeout(resolve, RETRY_DELAY_MS * attempt),
            )
        }
    }
}
