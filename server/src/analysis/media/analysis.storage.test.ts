import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logs = vi.hoisted(() => ({ debug: vi.fn(), warn: vi.fn() }))
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

    it('上传资格签发遇到瞬时断连时重试同一对象，不使整批图片失败', async () => {
        const fetchObject = vi
            .fn()
            .mockRejectedValueOnce(new Error('The socket connection was closed unexpectedly.'))
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        url: `/object/upload/sign/analysis-media/${path}?token=synthetic-upload`,
                    }),
                    { headers: { 'content-type': 'application/json' } },
                ),
            )
        vi.stubGlobal('fetch', fetchObject)
        await expect(supabaseAnalysisObjectStorage.createSignedUpload(path)).resolves.toMatchObject(
            {
                token: 'synthetic-upload',
            },
        )
        expect(fetchObject).toHaveBeenCalledTimes(2)
        expect(fetchObject.mock.calls[0]![0]).toBe(fetchObject.mock.calls[1]![0])
        expect(JSON.stringify(logs.warn.mock.calls)).not.toContain('synthetic-upload')
    })

    it('连接在下载响应前断开时重读同一对象，不让瞬时故障终止分析', async () => {
        const fetchObject = vi
            .fn()
            .mockRejectedValueOnce(
                Object.assign(new Error('The socket connection was closed unexpectedly.'), {
                    code: 'ECONNRESET',
                }),
            )
            .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
        vi.stubGlobal('fetch', fetchObject)

        await expect(supabaseAnalysisObjectStorage.download(path)).resolves.toEqual(
            new Uint8Array([1, 2, 3]),
        )
        expect(fetchObject).toHaveBeenCalledTimes(2)
        expect(fetchObject.mock.calls[0]![0]).toBe(fetchObject.mock.calls[1]![0])
    })

    it('上传确认读取对象信息遇到临时连接失败时不会误报对象不存在', async () => {
        const fetchObject = vi
            .fn()
            .mockRejectedValueOnce(new TypeError('fetch failed'))
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ size: 1024, contentType: 'image/jpeg' }), {
                    headers: { 'content-type': 'application/json' },
                }),
            )
        vi.stubGlobal('fetch', fetchObject)

        await expect(supabaseAnalysisObjectStorage.info(path)).resolves.toEqual({
            size: 1024,
            contentType: 'image/jpeg',
        })
        expect(fetchObject).toHaveBeenCalledTimes(2)
    })

    it.each([400, 401, 403, 404])('下载的 %s 响应不重试', async (status) => {
        const fetchObject = vi.fn(
            async () =>
                new Response(JSON.stringify({ message: 'private-response' }), {
                    status,
                    headers: { 'content-type': 'application/json' },
                }),
        )
        vi.stubGlobal('fetch', fetchObject)
        await expect(supabaseAnalysisObjectStorage.download(path)).rejects.toMatchObject({ status })
        expect(fetchObject).toHaveBeenCalledTimes(1)
        expect(logs.warn).not.toHaveBeenCalled()
    })

    it.each([408, 429, 503])('下载的临时 %s 错误在限定重试次数内恢复', async (status) => {
        const fetchObject = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ message: 'private-response' }), {
                    status,
                    headers: { 'content-type': 'application/json' },
                }),
            )
            .mockResolvedValueOnce(new Response(new Uint8Array([4, 5])))
        vi.stubGlobal('fetch', fetchObject)
        await expect(supabaseAnalysisObjectStorage.download(path)).resolves.toEqual(
            new Uint8Array([4, 5]),
        )
        expect(fetchObject).toHaveBeenCalledTimes(2)
        expect(logs.warn.mock.calls[0]![0]).toMatchObject({
            event: 'analysis_storage_access_retry',
            operation: 'download',
            objectKeyHash: hash,
            attempt: 1,
        })
        expect(JSON.stringify(logs.warn.mock.calls)).not.toContain('private-response')
    })

    it('持续断连最多读取三次，并保留原始失败供任务结算', async () => {
        const fetchObject = vi.fn(async () => {
            throw new TypeError('fetch failed')
        })
        vi.stubGlobal('fetch', fetchObject)
        await expect(supabaseAnalysisObjectStorage.download(path)).rejects.toMatchObject({
            name: 'StorageUnknownError',
        })
        expect(fetchObject).toHaveBeenCalledTimes(3)
        expect(logs.warn).toHaveBeenCalledTimes(2)
    })

    it('取消读取不自动重试', async () => {
        const fetchObject = vi.fn(async () => {
            throw new DOMException('The operation was aborted', 'AbortError')
        })
        vi.stubGlobal('fetch', fetchObject)
        await expect(supabaseAnalysisObjectStorage.download(path)).rejects.toBeDefined()
        expect(fetchObject).toHaveBeenCalledTimes(1)
    })

    it('只有真实 404 表示对象不存在，其余信息读取错误返回安全消息', async () => {
        const fetchObject = vi.fn(
            async () =>
                new Response(JSON.stringify({ message: 'sensitive-provider-details' }), {
                    status: 404,
                    headers: { 'content-type': 'application/json' },
                }),
        )
        vi.stubGlobal('fetch', fetchObject)
        await expect(supabaseAnalysisObjectStorage.info(path)).resolves.toBeNull()
        fetchObject.mockImplementation(
            async () =>
                new Response(JSON.stringify({ message: 'sensitive-provider-details' }), {
                    status: 403,
                    headers: { 'content-type': 'application/json' },
                }),
        )
        await expect(supabaseAnalysisObjectStorage.info(path)).rejects.toThrow(
            '图片存储暂不可用，请稍后重试',
        )
        expect(fetchObject).toHaveBeenCalledTimes(2)
        expect(JSON.stringify(logs.warn.mock.calls)).not.toContain('sensitive-provider-details')
    })

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
