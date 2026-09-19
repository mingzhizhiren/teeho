import type { InjectionKey } from 'vue'

export const DEFAULT_INTERACTION_FEEDBACK_MINIMUM_VISIBLE_MS = 2_000

interface InteractionFeedbackRegistrationOptions {
    readonly minimumVisibleMs?: number
    readonly containsTarget: (target: EventTarget | null) => boolean
    readonly onDismiss: () => void
}

export interface InteractionFeedbackRegistration {
    setVisible: (visible: boolean) => void
    unregister: () => void
}

interface InteractionFeedbackKeyboardInput {
    readonly key: string
    readonly altKey?: boolean
    readonly ctrlKey?: boolean
    readonly metaKey?: boolean
    readonly isComposing?: boolean
    readonly repeat?: boolean
}

export type InteractionFeedbackInput =
    | { readonly kind: 'click'; readonly target: EventTarget | null }
    | {
          readonly kind: 'keydown'
          readonly target: EventTarget | null
          readonly keyboard: InteractionFeedbackKeyboardInput
      }

export interface InteractionFeedbackCoordinator {
    register: (options: InteractionFeedbackRegistrationOptions) => InteractionFeedbackRegistration
    handleInteraction: (input: InteractionFeedbackInput) => void
    dispose: () => void
}

interface RegisteredFeedback extends InteractionFeedbackRegistrationOptions {
    readonly id: symbol
    readonly minimumVisibleMs: number
    visibleSince: number | null
    dismissed: boolean
}

interface InteractionFeedbackCoordinatorOptions {
    readonly now?: () => number
}

const navigationKeys = new Set([
    'Alt',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'Control',
    'End',
    'Escape',
    'Home',
    'Meta',
    'PageDown',
    'PageUp',
    'Shift',
    'Tab',
])

function isDismissalKeyboardInput(input: InteractionFeedbackKeyboardInput): boolean {
    return !(
        input.altKey ||
        input.ctrlKey ||
        input.metaKey ||
        input.isComposing ||
        input.repeat ||
        navigationKeys.has(input.key)
    )
}

/** 协调所有可交互关闭提示的独立可见时间与下一次有效页面操作。 */
export function createInteractionFeedbackCoordinator(
    options: InteractionFeedbackCoordinatorOptions = {},
): InteractionFeedbackCoordinator {
    const now = options.now ?? Date.now
    const registrations = new Map<symbol, RegisteredFeedback>()

    function register(
        registrationOptions: InteractionFeedbackRegistrationOptions,
    ): InteractionFeedbackRegistration {
        const id = Symbol('interaction-feedback')
        const registration: RegisteredFeedback = {
            ...registrationOptions,
            id,
            minimumVisibleMs: Math.max(
                0,
                registrationOptions.minimumVisibleMs ??
                    DEFAULT_INTERACTION_FEEDBACK_MINIMUM_VISIBLE_MS,
            ),
            visibleSince: null,
            dismissed: false,
        }
        registrations.set(id, registration)

        return {
            setVisible(visible) {
                const current = registrations.get(id)
                if (!current || current.dismissed) return
                if (!visible) {
                    current.visibleSince = null
                    return
                }
                if (current.visibleSince === null) {
                    current.visibleSince = now()
                }
            },
            unregister() {
                registrations.delete(id)
            },
        }
    }

    function handleInteraction(input: InteractionFeedbackInput) {
        if (input.kind === 'keydown' && !isDismissalKeyboardInput(input.keyboard)) {
            return
        }

        const visibleFeedback = [...registrations.values()].filter(
            (registration) => !registration.dismissed && registration.visibleSince !== null,
        )
        if (visibleFeedback.some((registration) => registration.containsTarget(input.target))) {
            return
        }

        const interactionTime = now()
        const eligibleFeedback = visibleFeedback.filter((registration) => {
            const visibleSince = registration.visibleSince
            return (
                visibleSince !== null &&
                interactionTime - visibleSince >= registration.minimumVisibleMs
            )
        })
        for (const registration of eligibleFeedback) {
            registration.dismissed = true
            registration.visibleSince = null
            registration.onDismiss()
        }
    }

    return {
        register,
        handleInteraction,
        dispose() {
            registrations.clear()
        },
    }
}

export const interactionFeedbackCoordinatorKey = Symbol(
    'interaction-feedback-coordinator',
) as InjectionKey<InteractionFeedbackCoordinator>

/** 将协调模块连接到唯一的浏览器鼠标与键盘监听入口。 */
export function attachInteractionFeedbackBrowserEvents(
    coordinator: InteractionFeedbackCoordinator,
    target: Document,
): () => void {
    const handleClick = (event: MouseEvent) => {
        coordinator.handleInteraction({ kind: 'click', target: event.target })
    }
    const handleKeydown = (event: KeyboardEvent) => {
        coordinator.handleInteraction({
            kind: 'keydown',
            target: event.target,
            keyboard: {
                key: event.key,
                altKey: event.altKey,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                isComposing: event.isComposing,
                repeat: event.repeat,
            },
        })
    }
    target.addEventListener('click', handleClick)
    target.addEventListener('keydown', handleKeydown)

    return () => {
        target.removeEventListener('click', handleClick)
        target.removeEventListener('keydown', handleKeydown)
    }
}
