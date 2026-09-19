import type {
    AnalysisConversationControl,
    AnalysisConversationSessionIdentity,
} from './analysis.conversation'

export type ConversationAuthorityDecision =
    | { kind: 'current' }
    | { kind: 'adopt_generation'; generation: number }
    | { kind: 'ended' }
    | { kind: 'superseded' }

/** 本地没有可恢复正文时，以服务端当前代数创建下一份尚未发送的新会话。 */
export function createFreshConversationSession(
    browserInstanceId: string,
    sessionId: string,
    control: AnalysisConversationControl,
): AnalysisConversationSessionIdentity {
    return {
        sessionId,
        generation: control ? control.generation + 1 : 1,
        browserInstanceId,
    }
}

/** Pure authority decision; callers control when decrypted state becomes visible. */
export function reconcileConversationAuthority(
    local: AnalysisConversationSessionIdentity,
    control: AnalysisConversationControl,
): ConversationAuthorityDecision {
    if (!control) return { kind: 'current' }

    if (control.status === 'cleared') {
        if (local.generation >= control.generation && local.sessionId !== control.sessionId) {
            return { kind: 'current' }
        }
        return { kind: 'ended' }
    }
    if (control.status === 'submitted') {
        // 尚未发送的新草稿还未登记到服务端，上一任务的提交状态不能清掉它。
        if (local.generation > control.generation && local.sessionId !== control.sessionId) {
            return { kind: 'current' }
        }
        return { kind: 'ended' }
    }
    if (
        local.browserInstanceId !== control.browserInstanceId ||
        local.sessionId !== control.sessionId
    ) {
        return { kind: 'superseded' }
    }
    if (control.generation > local.generation) {
        return { kind: 'adopt_generation', generation: control.generation }
    }
    return control.generation === local.generation ? { kind: 'current' } : { kind: 'ended' }
}
