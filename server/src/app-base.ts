import cors from '@elysiajs/cors'
import { Elysia } from 'elysia'

import { env } from './config/env'
import { errorMiddleware } from './middleware/error'
import { requestLogMiddleware } from './middleware/request-log'

export interface BaseAppOptions {
    corsCredentials?: boolean
    corsOrigin?: string
}

/** 创建 API 服务的基础应用 */
export async function createBaseApp(options: BaseAppOptions = {}) {
    const appBase = new Elysia()
    const corsOrigin = options.corsOrigin ?? env.CORS_ORIGIN
    if (corsOrigin) {
        appBase.use(
            cors({
                origin: corsOrigin,
                credentials: options.corsCredentials ?? false,
            }),
        )
    }

    return appBase.use(requestLogMiddleware).use(errorMiddleware)
}
