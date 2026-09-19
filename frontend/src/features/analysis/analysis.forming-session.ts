export interface DraftRevisionState {
    currentRevision: number
    confirmedRevision: number | null
}

export function createDraftRevisionState(): DraftRevisionState {
    return { currentRevision: 0, confirmedRevision: null }
}

/** 草稿或素材每次有效变化都会产生新版本，旧确认不能继续提交。 */
export function invalidateDraftRevision(state: DraftRevisionState) {
    state.currentRevision += 1
    state.confirmedRevision = null
}

/** 只把此刻完整草稿标记为用户可提交的确认版本。 */
export function confirmDraftRevision(state: DraftRevisionState) {
    state.confirmedRevision = state.currentRevision
}

export function isDraftRevisionConfirmed(state: DraftRevisionState) {
    return state.confirmedRevision === state.currentRevision
}

interface SessionContentSummary {
    rawText: string
    nonTrackFieldCount: number
    userMessageCount: number
    imageCount: number
    videoPresent: boolean
}

/** 赛道选择会跨任务保留，因此它本身不构成需要二次确认才能清空的任务内容。 */
export function sessionHasUserContent(summary: SessionContentSummary) {
    return (
        summary.rawText.trim().length > 0 ||
        summary.nonTrackFieldCount > 0 ||
        summary.userMessageCount > 0 ||
        summary.imageCount > 0 ||
        summary.videoPresent
    )
}
