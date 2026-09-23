import { env } from './env'

/** 部署能力由服务端控制。 */
export function isVideoEnabled(environment: Pick<typeof env, 'VIDEO_ENABLED'> = env): boolean {
    return environment.VIDEO_ENABLED
}

/** 默认部署不启用积分账户；兼容旧客户端读取的配置字段。 */
export const deploymentCapabilities = {
    mode: env.TEEHO_DEPLOYMENT_MODE,
    pointsEnabled: false,
} as const
