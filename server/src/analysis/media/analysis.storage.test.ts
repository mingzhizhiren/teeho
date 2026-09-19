import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logs = vi.hoisted(() => ({ debug: vi.fn() }))
vi.mock('../../utils/logger', () => ({ logger: logs }))
vi.mock('../../config/env', () => ({
    env: {
        SUPABASE_URL: 'https://storage.example.test',
        SUPABASE_SECRET_KEY: 'synthetic-test-secret',
    },
}))

import { supabaseAnalysisObjectStorage } from './analysis.storage'

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('图片存储下载诊断日志', () => {
    const path = 'private/synthetic-user/secret-file.webp'
    const hash = createHash('sha256').update(path).digest('hex')

    it('403记录上游请求编号与对象指纹，不泄漏路径、凭据或响应正文', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            statusCode: '403',
                            error: 'Forbidden',
                            message: 'sensitive-response-body',
                        }),
                        {
                            status: 403,
                            headers: {
                                'content-type': 'application/json',
                                'sb-request-id': 'upstream-123',
                                'cf-ray': 'ray-123',
                                'x-request-id': 'https://unsafe.test/?token=secret',
                            },
                        },
                    ),
            ),
        )
        await expect(supabaseAnalysisObjectStorage.download(path)).rejects.toMatchObject({
            status: 403,
        })
        const start = logs.debug.mock.calls[0]![0]
        const http = logs.debug.mock.calls[1]![0]
        const failure = logs.debug.mock.calls[2]![0]
        expect(start).toMatchObject({
            event: 'analysis_storage_download_started',
            objectKeyHash: hash,
        })
        expect(http).toMatchObject({
            event: 'analysis_storage_download_http',
            status: 403,
            upstreamRequestId: 'upstream-123',
            edgeRequestId: 'ray-123',
            upstreamTraceId: null,
            downloadId: start.downloadId,
        })
        expect(failure).toMatchObject({
            event: 'analysis_storage_download_failed',
            errorName: 'StorageApiError',
            downloadId: start.downloadId,
        })
        const output = JSON.stringify([logs.debug.mock.calls, logs.debug.mock.calls])
        for (const secret of [
            path,
            'synthetic-test-secret',
            'sensitive-response-body',
            'token=secret',
        ])
            expect(output).not.toContain(secret)
    })

    it('成功读取记录状态耗时和字节数，返回原始内容', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
        )
        expect(await supabaseAnalysisObjectStorage.download(path)).toEqual(
            new Uint8Array([1, 2, 3]),
        )
        expect(logs.debug).toHaveBeenCalledTimes(3)
        expect(logs.debug.mock.calls.at(-1)![0]).toMatchObject({
            event: 'analysis_storage_download_completed',
            byteSize: 3,
            objectKeyHash: hash,
        })
    })

    it('网络异常也留下失败事件，错误继续交给原调用方', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new TypeError('private-network-details')
            }),
        )
        await expect(supabaseAnalysisObjectStorage.download(path)).rejects.toBeDefined()
        expect(logs.debug.mock.calls.at(-1)![0]).toMatchObject({
            event: 'analysis_storage_download_failed',
            objectKeyHash: hash,
        })
        expect(JSON.stringify(logs.debug.mock.calls)).not.toContain('private-network-details')
    })
})
