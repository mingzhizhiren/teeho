import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { BYTE_SIZE } from './constants'
import { env } from './env'
import { logger } from '../utils/logger'

const maximumRequestBodyMebibytes = 82
const maxAnalysisRequestBodyBytes = maximumRequestBodyMebibytes * BYTE_SIZE.MEBIBYTE

/** 构造 Elysia `listen` 参数；配置了有效证书路径时启用 HTTPS，否则退回 HTTP */
export function createListenOptions() {
    const CertPath = env.HTTPS_CERT_PATH ? resolve(env.HTTPS_CERT_PATH) : ''
    const KeyPath = env.HTTPS_KEY_PATH ? resolve(env.HTTPS_KEY_PATH) : ''
    const HttpsEnabled = Boolean(CertPath && KeyPath)

    if (!HttpsEnabled) {
        return {
            options: {
                port: env.PORT,
                maxRequestBodySize: maxAnalysisRequestBodyBytes,
            },
            protocol: 'http',
        } as const
    }

    if (!existsSync(CertPath) || !existsSync(KeyPath)) {
        logger.warn(
            {
                event: 'https_certificate_missing',
                certPath: CertPath,
                keyPath: KeyPath,
            },
            'HTTPS certificate files not found, fallback to HTTP',
        )

        return {
            options: {
                port: env.PORT,
                maxRequestBodySize: maxAnalysisRequestBodyBytes,
            },
            protocol: 'http',
        } as const
    }

    return {
        options: {
            port: env.PORT,
            maxRequestBodySize: maxAnalysisRequestBodyBytes,
            tls: {
                cert: Bun.file(CertPath),
                key: Bun.file(KeyPath),
            },
        },
        protocol: 'https',
    } as const
}
