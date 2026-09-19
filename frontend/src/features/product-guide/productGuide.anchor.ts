import type { Directive } from 'vue'

const anchorAttribute = 'data-guide-anchor'
const anchorIdPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/
type GuideAnchorValue = string | null | undefined

function setAnchor(element: HTMLElement, anchorId: string): void {
    if (!anchorIdPattern.test(anchorId)) {
        throw new TypeError(`无效的产品引导锚点：${anchorId}`)
    }
    element.setAttribute(anchorAttribute, anchorId)
}

function syncAnchor(element: HTMLElement, anchorId: GuideAnchorValue): void {
    if (anchorId === null || anchorId === undefined) {
        element.removeAttribute(anchorAttribute)
        return
    }
    setAnchor(element, anchorId)
}

/** 只按固定属性和值查找语义锚点，不接受调用方 CSS 选择器。 */
export function findGuideAnchor(root: ParentNode, anchorId: string): Element | null {
    return [...root.querySelectorAll(`[${anchorAttribute}]`)].find(
        (element) => element.getAttribute(anchorAttribute) === anchorId,
    ) ?? null
}

/** 页面声明稳定语义锚点的唯一 Vue 指令。 */
export const guideAnchorDirective: Directive<HTMLElement, GuideAnchorValue> = {
    mounted: (element, binding) => syncAnchor(element, binding.value),
    updated: (element, binding) => syncAnchor(element, binding.value),
    unmounted: (element) => element.removeAttribute(anchorAttribute),
}
