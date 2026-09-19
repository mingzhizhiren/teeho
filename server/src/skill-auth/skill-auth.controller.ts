import { HTTP_STATUS } from '../config/constants'
import { ZodError, z } from 'zod'
import {
    anonymousSchema,
    approvalSchema,
    startSchema,
    tokenSchema,
    deviceListSchema,
    SkillAuthError,
    type SkillAuthDependencies,
} from './skill-auth.contract'
import { createSkillAuthService } from './skill-auth.service'
import { logger } from '../utils/logger'
import { fail, ok } from '../utils/response'

function isProviderStatus(error: unknown): error is { status: number } {
    return (
        typeof error === 'object' &&
        error !== null &&
        typeof Reflect.get(error, 'status') === 'number' &&
        Number.isInteger(Reflect.get(error, 'status'))
    )
}

function isProviderCode(error: unknown): error is { code: string } {
    const code = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : null
    return typeof code === 'string' && /^[a-zA-Z0-9_-]{1,32}$/u.test(code)
}

/** 映射授权协议错误，外部不暴露凭据与数据库异常。 */
export function createSkillAuthController(deps: SkillAuthDependencies) {
    const service = createSkillAuthService(deps)
    async function handle(operation: () => Promise<unknown>, stage = 'unknown') {
        try {
            return { status: 200, response: ok(await operation()) }
        } catch (error) {
            if (error instanceof ZodError)
                return { status: 400, response: fail(HTTP_STATUS.BAD_REQUEST, '请求参数无效') }
            if (error instanceof SkillAuthError)
                return { status: error.status, response: fail(error.status, error.reason) }
            logger.warn(
                {
                    event: 'skill_authorization_failed',
                    errorName: error instanceof Error ? error.name : 'UnknownError',
                    ...(stage === 'anonymous' ? { stage } : {}),
                    ...(stage === 'anonymous' && isProviderStatus(error)
                        ? { providerStatus: error.status }
                        : {}),
                    ...(stage === 'anonymous' && isProviderCode(error)
                        ? { providerCode: error.code }
                        : {}),
                },
                'Skill授权服务暂不可用',
            )
            return {
                status: 503,
                response: fail(HTTP_STATUS.SERVICE_UNAVAILABLE, '授权服务暂不可用'),
            }
        }
    }
    return {
        devices: (cookieToken: string, query: unknown = {}) =>
            handle(() => service.devices(cookieToken, deviceListSchema.parse(query).cursor)),
        logout: (bearer: string) => handle(() => service.logout(bearer)),
        revoke: (body: unknown, cookieToken: string, origin: string) =>
            handle(() => {
                if (origin !== deps.origin)
                    throw new SkillAuthError(HTTP_STATUS.FORBIDDEN, 'invalid_origin')
                const input = z
                    .object({ id: z.string().regex(/^[a-f0-9]{64}$/) })
                    .strict()
                    .parse(body)
                return service.revoke(input.id, cookieToken)
            }),
        anonymous: (body: unknown, ip: string) =>
            handle(() => {
                const input = anonymousSchema.parse(body)
                return service.anonymous(input.deviceToken, input.deviceName, input.machineId, ip)
            }, 'anonymous'),
        start: (body: unknown, ip: string) =>
            handle(() => {
                const input = startSchema.parse(body)
                return service.start(input.deviceToken, input.deviceName, ip)
            }),
        token: (body: unknown, ip: string) =>
            handle(() => service.token(tokenSchema.parse(body).deviceToken, ip)),
        approve: (body: unknown, cookieToken: string, origin: string, ip: string) =>
            handle(() => {
                if (origin !== deps.origin)
                    throw new SkillAuthError(HTTP_STATUS.FORBIDDEN, 'invalid_origin')
                const input = approvalSchema.parse(body)
                return service.approve(input.userCode, input.remember, cookieToken, ip)
            }),
    }
}
export type SkillAuthController = ReturnType<typeof createSkillAuthController>
