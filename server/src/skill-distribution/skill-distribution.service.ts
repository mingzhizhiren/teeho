import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { readSkillZip, writeSkillZip } from './skill-distribution.zip'

const publicApiSchema = z
    .string()
    .url()
    .transform((value, context) => {
        const url = new URL(value)
        const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        if (
            (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            !['', '/', '/api', '/api/'].includes(url.pathname)
        ) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Invalid Skill API deployment URL',
            })
            return z.NEVER
        }
        return `${url.origin}/api`
    })

/** 下载配置只取服务端部署值，不读取请求的 Host 或转发头。 */
export interface SkillDistributionOptions {
    readonly publicApiUrl: string
    readonly archivePaths: readonly string[]
    readonly onError: (error: unknown) => void
}

async function readArchive(paths: readonly string[]): Promise<Buffer> {
    for (const path of paths) {
        try {
            return await readFile(path)
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        }
    }
    throw new Error('skill_archive_missing')
}

/** 将公开静态包中的配置替换为本站地址，并合并缓存并发生成。 */
export function createSkillDistributionService(
    options: SkillDistributionOptions,
): () => Promise<Uint8Array> {
    let pending: Promise<Uint8Array> | undefined
    async function build(): Promise<Uint8Array> {
        const apiUrl = publicApiSchema.parse(options.publicApiUrl)
        const files = readSkillZip(await readArchive(options.archivePaths))
        const entries = await Promise.all(
            [...files].map(async ([name, file]) => [name, await file.bytes()] as const),
        )
        return writeSkillZip({
            ...Object.fromEntries(entries),
            'teeho/endpoint.json': new TextEncoder().encode(
                JSON.stringify({
                    apiUrl,
                    debug: ['localhost', '127.0.0.1', '[::1]'].includes(new URL(apiUrl).hostname),
                }) + '\n',
            ),
        })
    }
    return () => {
        pending ??= build().catch((error: unknown) => {
            pending = undefined
            throw error
        })
        return pending
    }
}
