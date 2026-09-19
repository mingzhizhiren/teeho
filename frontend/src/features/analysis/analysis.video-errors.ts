const exactMessageKeys: Readonly<Record<string, string>> = {
    video_disabled: 'workspace.video.failures.disabled',
    worker_unavailable: 'workspace.video.failures.unavailable',
    capacity_reached: 'workspace.video.failures.capacity',
    account_busy: 'workspace.video.failures.accountBusy',
    rate_limited: 'workspace.video.failures.rateLimited',
    subscription_required: 'workspace.video.failures.subscriptionRequired',
    insufficient_points: 'workspace.video.failures.insufficientPoints',
    upload_expired: 'workspace.video.failures.reselect',
    upload_not_resumable: 'workspace.video.failures.reselect',
    not_found: 'workspace.video.failures.reselect',
    upload_mismatch: 'workspace.video.failures.invalidFile',
    invalid_file: 'workspace.video.failures.invalidFile',
    unsupported_video_container: 'workspace.video.failures.unsupportedFormat',
    video_container_mismatch: 'workspace.video.failures.unsupportedFormat',
    unsupported_video_codec: 'workspace.video.failures.unsupportedCodec',
    video_too_long: 'workspace.video.failures.tooLong',
    video_too_large: 'workspace.video.failures.tooLarge',
    video_edge_too_large: 'workspace.video.failures.resolution',
    video_pixel_limit: 'workspace.video.failures.resolution',
    video_corrupt: 'workspace.video.failures.corrupt',
    video_stream_missing: 'workspace.video.failures.corrupt',
    video_duration_invalid: 'workspace.video.failures.corrupt',
    video_decode_failed: 'workspace.video.failures.corrupt',
    ffmpeg_timeout: 'workspace.video.failures.timeout',
    video_upload_failed: 'workspace.video.failures.upload',
    video_upload_cancelled: 'workspace.video.failures.reselect',
    video_cancelled: 'workspace.video.failures.reselect',
    video_expired: 'workspace.video.failures.reselect',
    video_deleted: 'workspace.video.failures.reselect',
}

/** 将内部失败码压缩为稳定、可行动且不暴露基础设施的 i18n 文案键。 */
export function resolveVideoFailureMessageKey(errorCode: string | null) {
    return errorCode
        ? (exactMessageKeys[errorCode] ?? 'workspace.video.failures.technical')
        : 'workspace.video.failures.technical'
}
