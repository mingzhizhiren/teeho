import { API_CODES, HTTP_STATUS } from '../config/constants'
import { fail } from '../utils/response'
import {
    createSkillDistributionService,
    type SkillDistributionOptions,
} from './skill-distribution.service'

/** 公开下载边界：只输出技能资料，故障不暴露文件路径或部署配置。 */
export function createSkillDistributionController(options: SkillDistributionOptions): {
    download: () => Promise<Response>
} {
    const download = createSkillDistributionService(options)
    return {
        async download(): Promise<Response> {
            try {
                const bytes = await download()
                return new Response(new Blob([new Uint8Array(bytes)]), {
                    headers: {
                        'content-type': 'application/zip',
                        'content-disposition': 'attachment; filename="teeho-skill.zip"',
                        'cache-control': 'no-store',
                        'x-content-type-options': 'nosniff',
                    },
                })
            } catch (error) {
                options.onError(error)
                return Response.json(
                    fail(API_CODES.INTERNAL_ERROR, '技能下载暂不可用，请稍后重试'),
                    {
                        status: HTTP_STATUS.SERVICE_UNAVAILABLE,
                        headers: { 'cache-control': 'no-store' },
                    },
                )
            }
        },
    }
}
