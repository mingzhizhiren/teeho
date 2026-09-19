/** 界面反馈的承载范围。 */
export type FeedbackScope = 'field' | 'item' | 'form' | 'module' | 'page' | 'global'

/** 界面反馈的视觉与语义等级。 */
export type FeedbackTone = 'info' | 'success' | 'warning' | 'error'

/** 提示的关闭策略；持久提示只由事实所有者清除。 */
export type FeedbackDismissPolicy = 'persistent' | 'after-interaction'

/** 界面反馈提供的恢复动作。 */
export interface FeedbackAction {
    readonly kind: 'retry' | 'focus' | 'navigate' | 'dismiss'
    readonly label: string
    readonly target?: string
}

/** 已校验、本地化且可以安全展示的界面反馈。 */
export interface UiFeedback {
    readonly key: string
    readonly scope: FeedbackScope
    readonly tone: FeedbackTone
    readonly message: string
    readonly action?: FeedbackAction
    readonly announce?: 'polite' | 'assertive'
}
