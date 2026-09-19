import { Elysia } from 'elysia'

import { API_CODES } from '../config/constants'
import { logger } from '../utils/logger'
import { fail } from '../utils/response'
import { getRequestLogContext } from './request-log'

interface SafeDatabaseErrorLog {
    type: string
    message: 'Database query failed'
    causeCode?: string
    causeConstraint?: string
    causeRoutine?: string
    causeSchema?: string
    causeTable?: string
}

interface SafeDatabaseErrorContext {
    databaseCode?: string
    databaseConstraint?: string
    databaseRoutine?: string
    databaseSchema?: string
    databaseTable?: string
}

const databaseIdentifierMaxLength = 128

function readStableErrorCode(error: unknown) {
    if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
    return typeof error.code === 'string' && /^[A-Z0-9_]{1,32}$/u.test(error.code)
        ? error.code
        : undefined
}

function hasDatabaseQueryContext(error: Error) {
    return 'query' in error || 'params' in error
}

function readSafeDatabaseIdentifier(error: unknown, keys: readonly string[]) {
    if (typeof error !== 'object' || error === null) return undefined
    const record = error as Record<string, unknown>
    for (const key of keys) {
        const value = record[key]
        if (
            typeof value === 'string' &&
            value.length <= databaseIdentifierMaxLength &&
            /^[A-Za-z0-9_.-]+$/u.test(value)
        ) {
            return value
        }
    }
    return undefined
}

function readSafeDatabaseErrorContext(error: unknown): SafeDatabaseErrorContext | null {
    if (!(error instanceof Error) || !hasDatabaseQueryContext(error)) return null
    const cause = error.cause
    return {
        databaseCode: readStableErrorCode(cause),
        databaseConstraint: readSafeDatabaseIdentifier(cause, ['constraint_name', 'constraint']),
        databaseRoutine: readSafeDatabaseIdentifier(cause, ['routine']),
        databaseSchema: readSafeDatabaseIdentifier(cause, ['schema_name', 'schema']),
        databaseTable: readSafeDatabaseIdentifier(cause, ['table_name', 'table']),
    }
}

/** 数据库驱动异常可能携带完整查询参数，日志仅保留稳定诊断信息。 */
function toSafeLogError(error: unknown): Error | SafeDatabaseErrorLog | { type: 'UnknownError' } {
    if (!(error instanceof Error)) return { type: 'UnknownError' }
    if (!hasDatabaseQueryContext(error)) return error

    const context = readSafeDatabaseErrorContext(error)

    return {
        type: error.name || error.constructor.name,
        message: 'Database query failed',
        causeCode: context?.databaseCode,
        causeConstraint: context?.databaseConstraint,
        causeRoutine: context?.databaseRoutine,
        causeSchema: context?.databaseSchema,
        causeTable: context?.databaseTable,
    }
}

/** 记录未捕获异常，并将框架错误映射为统一响应 */
export const errorMiddleware = new Elysia({ name: 'error-handler' })
    .onError(({ code, error, request, set }) => {
        const requestContext = getRequestLogContext(request)
        const fields = {
            event: 'http_request_failed',
            requestId: requestContext?.requestId,
            method: request.method,
            path: new URL(request.url).pathname,
            errorCode: code,
        }

        if (code === 'NOT_FOUND') {
            set.status = 404
            return fail(API_CODES.NOT_FOUND, '请求的资源不存在')
        }

        if (code === 'PARSE' || code === 'VALIDATION') {
            logger.debug(fields, '请求参数校验失败')
            set.status = 400
            return fail(API_CODES.VALIDATION_ERROR, '请求参数无效')
        }

        const databaseContext = readSafeDatabaseErrorContext(error)
        if (databaseContext) {
            logger.debug(
                {
                    ...fields,
                    event: 'database_error_context',
                    ...databaseContext,
                },
                '数据库请求失败诊断',
            )
        }
        logger.error({ ...fields, err: toSafeLogError(error) }, '请求处理异常')
        set.status = 500
        return fail(API_CODES.INTERNAL_ERROR, '服务器内部错误')
    })
    .as('global')
