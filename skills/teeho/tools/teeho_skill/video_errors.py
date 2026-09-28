"""将已确认的视频终态映射为安全错误，不把网络问题当作素材无效。"""

from .errors import TeehoError

VIDEO_FAILURE_CODES = frozenset({
    "video_too_long", "video_too_large", "video_edge_too_large", "video_pixel_limit",
    "unsupported_video_codec", "unsupported_video_container", "video_container_mismatch",
    "video_corrupt", "video_stream_missing", "video_duration_invalid", "video_decode_failed",
    "ffmpeg_timeout", "video_worker_lost",
})


def check_video_failure(video: dict) -> None:
    """原错误码仅接受白名单，终态要求新素材；禁止反复查询旧失败对象。"""
    state = video["state"]
    if state in {"cancelled", "expired", "deleting", "deleted", "cleanup_failed"}:
        raise TeehoError("video_reupload_required")
    if state in {"technical_failed", "deterministic_failed", "failed"}:
        code = video.get("errorCode")
        raise TeehoError(code if isinstance(code, str) and code in VIDEO_FAILURE_CODES else "video_processing_failed")
