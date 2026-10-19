import { ref, type Ref } from 'vue'
import { getAppConfig, updateAppConfig } from '@/utils/appConfig'

/** 仅允许通过安全的小红书地址打开同类笔记。 */
export function getComparisonNoteUrl(value: string | null | undefined): string | null {
    if (!value) return null
    try {
        const url = new URL(value)
        const isAllowedHost = ['xiaohongshu.com', 'xhslink.com', 'rednote.com'].some(
            (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
        )
        return ['https:', 'http:'].includes(url.protocol) &&
            isAllowedHost &&
            !url.username &&
            !url.password
            ? url.href
            : null
    } catch {
        return null
    }
}

interface ComparisonNoteLink {
    isNoticeOpen: Ref<boolean>
    requestOpen: (event: MouseEvent, url: string) => void
    confirmOpen: () => void
    cancelOpen: () => void
}

/** 首次打开同类笔记前说明扫码要求；确认后记住设备偏好。 */
export function useComparisonNoteLink(): ComparisonNoteLink {
    const isNoticeOpen = ref(false)
    let pendingUrl: string | null = null
    let hasAcknowledged = false

    function cancelOpen(): void {
        pendingUrl = null
        isNoticeOpen.value = false
    }

    function requestOpen(event: MouseEvent, value: string): void {
        if (event.button !== 0 && event.button !== 1) return
        const url = getComparisonNoteUrl(value)
        if (!url) {
            event.preventDefault()
            return
        }
        if (hasAcknowledged || getAppConfig().hasAcknowledgedNoteScanNotice) return
        event.preventDefault()
        pendingUrl = url
        isNoticeOpen.value = true
    }

    function confirmOpen(): void {
        if (!pendingUrl) return
        // 保持在确认点击的同步调用栈内打开，避免异步操作触发浏览器弹窗拦截。
        window.open(pendingUrl, '_blank', 'noopener,noreferrer')
        hasAcknowledged = true
        updateAppConfig({ hasAcknowledgedNoteScanNotice: true })
        cancelOpen()
    }

    return { isNoticeOpen, requestOpen, confirmOpen, cancelOpen }
}
