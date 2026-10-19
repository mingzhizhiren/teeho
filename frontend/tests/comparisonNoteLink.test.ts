import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
    getComparisonNoteUrl,
    useComparisonNoteLink,
} from '../src/features/analysis/useComparisonNoteLink'
import { getAppConfig, updateAppConfig } from '../src/utils/appConfig'

const firstUrl = 'https://www.xiaohongshu.com/explore/example?xsec_token=sample'
const nextUrl = 'https://www.rednote.com/search_result/another'
const open = mock(() => null)
let stored: Map<string, string>

function click(button = 0): MouseEvent {
    return { button, preventDefault: mock(() => undefined) } as unknown as MouseEvent
}

beforeEach(() => {
    stored = new Map()
    open.mockClear()
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            open,
            localStorage: {
                getItem: (key: string) => stored.get(key) ?? null,
                setItem: (key: string, value: string) => stored.set(key, value),
                removeItem: (key: string) => stored.delete(key),
            },
        },
    })
})

afterEach(() => Reflect.deleteProperty(globalThis, 'window'))

describe('同类笔记首次扫码提示', () => {
    test('取消不跳转不记忆，确认仅打开一次并保留其他设备偏好', () => {
        updateAppConfig({ locale: 'en-US', theme: 'dark' })
        const link = useComparisonNoteLink()
        const event = click()
        link.requestOpen(event, firstUrl)
        expect(event.preventDefault).toHaveBeenCalledTimes(1)
        expect(link.isNoticeOpen.value).toBe(true)
        expect(open).not.toHaveBeenCalled()
        link.cancelOpen()
        link.confirmOpen()
        expect(open).not.toHaveBeenCalled()
        expect(getAppConfig().hasAcknowledgedNoteScanNotice).toBe(false)

        link.requestOpen(click(), firstUrl)
        link.confirmOpen()
        link.confirmOpen()
        expect(open).toHaveBeenCalledTimes(1)
        expect(open).toHaveBeenCalledWith(firstUrl, '_blank', 'noopener,noreferrer')
        expect(link.isNoticeOpen.value).toBe(false)
        expect(getAppConfig()).toMatchObject({
            hasAcknowledgedNoteScanNotice: true,
            locale: 'en-US',
            theme: 'dark',
        })
    })

    test('重新创建报告后直接保留后续链接的原生点击及中键行为', () => {
        const first = useComparisonNoteLink()
        first.requestOpen(click(1), firstUrl)
        expect(first.isNoticeOpen.value).toBe(true)
        first.confirmOpen()
        const next = useComparisonNoteLink()
        for (const button of [0, 1]) {
            const event = click(button)
            next.requestOpen(event, nextUrl)
            expect(event.preventDefault).not.toHaveBeenCalled()
            expect(next.isNoticeOpen.value).toBe(false)
        }
    })

    test('无法写存储时当前报告仍能打开并在内存记住确认', () => {
        Object.defineProperty(window, 'localStorage', {
            get: () => {
                throw new Error('blocked')
            },
        })
        const link = useComparisonNoteLink()
        link.requestOpen(click(), firstUrl)
        expect(() => link.confirmOpen()).not.toThrow()
        const next = click()
        link.requestOpen(next, nextUrl)
        expect(next.preventDefault).not.toHaveBeenCalled()
    })

    test('旧配置补齐未确认默认值，不把字符串当布尔值', () => {
        stored.set('teeho.app-config.v1', JSON.stringify({ locale: 'en-US' }))
        expect(getAppConfig()).toMatchObject({
            locale: 'en-US',
            hasAcknowledgedNoteScanNotice: false,
        })
        stored.set('teeho.app-config.v1', JSON.stringify({ hasAcknowledgedNoteScanNotice: 'true' }))
        expect(getAppConfig().hasAcknowledgedNoteScanNotice).toBe(false)
    })

    test('仅接受平台 HTTP(S) 地址，不接受脚本、伪造域名或凭据', () => {
        for (const url of [firstUrl, nextUrl, 'http://xhslink.com/example']) {
            expect(getComparisonNoteUrl(url)).toBe(url)
        }
        for (const url of [
            null,
            '',
            'javascript:alert(1)',
            'https://xiaohongshu.com.evil.test/',
            'https://user:pass@www.xiaohongshu.com/',
        ]) {
            expect(getComparisonNoteUrl(url)).toBeNull()
            const event = click()
            const link = useComparisonNoteLink()
            link.requestOpen(event, url ?? '')
            expect(event.preventDefault).toHaveBeenCalledTimes(1)
            expect(link.isNoticeOpen.value).toBe(false)
        }
        expect(open).not.toHaveBeenCalled()
    })
})
