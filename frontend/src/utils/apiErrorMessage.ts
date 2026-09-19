const apiErrorTranslationKeys: Readonly<Record<string, string>> = {
    '服务器功能异常': 'common.serverUnavailable',
    '服务器内部错误': 'common.serverUnavailable',
    'Agent 正在另一个页面处理消息，请稍后再试。': 'workspace.agentChat.turnBusy',
    '当前会话已在另一个页面开始。': 'workspace.agentChat.conversationSuperseded',
}

const apiErrorReasonTranslationKeys: Readonly<Record<string, string>> = {
    video_evidence_download_unavailable: 'workspace.apiErrors.videoEvidenceDownloadUnavailable',
    analysis_queue_capacity: 'workspace.apiErrors.queueCapacity',
    analysis_refund_in_progress: 'workspace.apiErrors.refundInProgress',
    analysis_capability_required: 'workspace.apiErrors.capabilityRequired',
    analysis_task_state: 'workspace.apiErrors.taskState',
    analysis_asset_expired: 'workspace.apiErrors.assetExpired',
    analysis_video_evidence_expired: 'workspace.apiErrors.videoEvidenceExpired',
    analysis_task_lease_lost: 'workspace.apiErrors.taskLeaseLost',
    analysis_upload_rate: 'workspace.apiErrors.uploadRate',
    analysis_submission_conflict: 'workspace.apiErrors.submissionConflict',
    analysis_preparation_rate: 'workspace.apiErrors.preparationRate',
    rolling_agent_usage: 'workspace.apiErrors.rollingAgentUsage',
}

const containsChineseCharacters = /\p{Script=Han}/u

/**
 * 英文界面不直接渲染后端中文；已知稳定错误保留精确语义，未知错误回退为通用文案。
 */
export function resolveApiErrorMessage(
    message: string,
    locale: string,
    translate: (key: string) => string,
    reason?: string,
): string {
    const reasonTranslationKey = reason ? apiErrorReasonTranslationKeys[reason] : undefined
    if (reasonTranslationKey) {
        return translate(reasonTranslationKey)
    }
    if (locale === 'zh-CN') {
        return message
    }
    const translationKey = apiErrorTranslationKeys[message]
    if (translationKey) {
        return translate(translationKey)
    }
    return containsChineseCharacters.test(message) ? translate('common.requestFailed') : message
}
