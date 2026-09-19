/** 产品引导接管的稳定键盘动作。 */
export type GuideKeyboardAction = 'next' | 'previous' | 'close' | 'focus_next' | 'focus_previous'

interface GuideKeyboardInput {
    key: string
    target: EventTarget | null
    shiftKey: boolean
}

interface GuideSwipeInput {
    startX: number
    startY: number
    endX: number
    endY: number
}

const horizontalSwipeThresholdPx = 48

function isEditableTarget(target: EventTarget | null): boolean {
    if (!target || typeof target !== 'object') return false
    const element = target as Partial<HTMLElement>
    const tagName = element.tagName?.toLowerCase()
    return (
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        element.isContentEditable === true
    )
}

/** 把键盘事件解析成受控动作；输入控件保留左右方向键。 */
export function resolveGuideKeyboardAction(input: GuideKeyboardInput): GuideKeyboardAction | null {
    if (input.key === 'Escape') return 'close'
    if (input.key === 'Tab') return input.shiftKey ? 'focus_previous' : 'focus_next'
    if (isEditableTarget(input.target)) return null
    if (input.key === 'ArrowRight') return 'next'
    if (input.key === 'ArrowLeft') return 'previous'
    return null
}

/** 只把明显横向卡片手势解析成步骤动作，纵向手势交回页面滚动。 */
export function resolveGuideSwipe(input: GuideSwipeInput): 'next' | 'previous' | null {
    const horizontalDistance = input.endX - input.startX
    const verticalDistance = input.endY - input.startY
    if (
        Math.abs(horizontalDistance) < horizontalSwipeThresholdPx ||
        Math.abs(horizontalDistance) <= Math.abs(verticalDistance)
    ) {
        return null
    }
    return horizontalDistance < 0 ? 'next' : 'previous'
}

/** 点击推进只接受浏览器标记为用户产生的真实事件。 */
export function canAdvanceFromGuideTargetClick(event: Pick<Event, 'isTrusted'>): boolean {
    return event.isTrusted
}
