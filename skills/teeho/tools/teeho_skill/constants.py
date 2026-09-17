"""技能接口路径总览及本地限制，便于集中查阅。"""

# 地址拼接约定：
# 1. API_* 均相对题火 API 根地址；根地址由 endpoint.json / TEEHO_API_URL 提供，
#    例如根地址 https://teeho.chat/api 加 /points/summary 得到完整请求 URL。
# 2. *_TEMPLATE 使用具名占位符，由 api.py 校验标识或编码路径参数后填入。
# 3. “Skill Bearer”指题火设备授权换取的访问凭据，不是浏览器 Cookie 或机器标识。
# 4. 登录 verificationUrl、图片 uploadUrl、视频上传 endpoint 均来自服务端响应；
#    它们可能包含临时授权信息，不作为固定常量保存，也不写入日志。

# 身份与授权 #############################################################

# POST：发起正式账号的设备授权，返回用户需打开的授权链接、代码和轮询间隔。
# 鉴权：无需已有 Bearer；请求体携带本机生成的 deviceToken 和展示用 deviceName。
# 调用阶段：用户明确要求登录时；后续通过 API_AUTH_TOKEN 查询是否授权成功。
API_AUTH_START = "/skill/auth/start"

# POST：使用设备摘要初始化匿名身份，由服务端执行匿名创建限额检查。
# 鉴权：无需已有 Bearer；请求体携带 deviceToken、machineId 摘要和 deviceName。
# 调用阶段：首次诊断且没有现有身份时；重试复用已保存的 deviceToken。
API_AUTH_ANONYMOUS = "/skill/auth/anonymous"

# POST：用 deviceToken 换取用户身份、访问凭据及到期时间。
# 鉴权：请求体中的 deviceToken；不要求现有 Bearer，也不传浏览器刷新凭据。
# 调用阶段：登录授权轮询、匿名初始化之后、访问凭据过期或收到明确 401 后。
# 特殊响应：409 表示授权尚未完成，由调用方继续等待，不当作服务故障。
API_AUTH_TOKEN = "/skill/auth/token"

# POST：撤销当前设备的授权，请求体为 {}。
# 鉴权：Skill Bearer；auth.py 先取得有效访问凭据，再执行撤销。
# 调用阶段：退出正式账号或清除正式身份；此接口不负责删除本机历史。
API_AUTH_LOGOUT = "/skill/auth/logout"

# 积分与任务配置 ############################################################

# GET：读取当前账号的积分状态、余额和计价信息，无请求体。
# 鉴权：Skill Bearer。
# 调用阶段：status 展示及新诊断的积分预检；实际受理、扣费仍由服务端决定。
API_POINTS_SUMMARY = "/points/summary"

# GET：读取可用赛道、素材上传限制和视频计价等任务配置，无请求体。
# 鉴权：Skill Bearer。
# 调用阶段：config 命令、视频文件大小检查及视频积分预检。
API_TASK_CONFIG = "/analysis/task-config"

# 图片素材 ###############################################################

# POST：根据 files 中的文件名、媒体类型及字节数申请图片上传资格。
# 鉴权：Skill Bearer；响应 session.assets 含素材 id 和临时 uploadUrl。
# 调用阶段：上传图片前；原始图片字节随后发往 uploadUrl，不发往本接口。
API_IMAGE_UPLOAD_SESSIONS = "/analysis/media/upload-sessions"

# POST：通过请求体 assetIds 批量查询图片素材状态。
# 鉴权：Skill Bearer。
# 调用阶段：恢复时核对既有素材，或上传后轮询；素材 ready 后才能继续提交。
API_IMAGE_STATUSES = "/analysis/media/statuses"

# POST：通知服务端检查已上传的图片对象，请求体为 {}。
# 鉴权：Skill Bearer；{asset_id} 为上传资格返回的素材 UUID。
# 调用阶段：文件上传后；上传响应成功或对象冲突均不能代替此服务端确认。
API_IMAGE_COMPLETE_TEMPLATE = "/analysis/media/{asset_id}/complete"

# 视频素材 ##################################################################

# POST：根据 file 中的文件名、媒体类型及字节数申请视频上传资格。
# 鉴权：Skill Bearer；响应 session.video 含视频 id 及签名上传信息。
# 调用阶段：视频上传前；先持久化资格，响应丢失时才能继续恢复原视频。
API_VIDEO_UPLOAD_SESSIONS = "/analysis/video/upload-sessions"

# GET：查询单个视频的上传及处理状态，无请求体。
# 鉴权：Skill Bearer；{video_id} 为上传资格返回的视频 UUID。
# 调用阶段：上传恢复检查、等待服务端视频处理完成。
API_VIDEO_DETAIL_TEMPLATE = "/analysis/video/{video_id}"

# POST：通知服务端检查已上传的视频对象，请求体为 {}。
# 鉴权：Skill Bearer；{video_id} 与本次保存的上传资格一致。
# 调用阶段：视频上传后；确认受理后仍通过视频详情接口等待 ready。
API_VIDEO_COMPLETE_TEMPLATE = "/analysis/video/{video_id}/complete"

# 诊断任务 ###############################################################

# POST：提交笔记字段、素材引用及 admission 受理信息，创建诊断任务。
# 鉴权：Skill Bearer；submissionId 与 admission.idempotencyKey 使用同一标识。
# 调用阶段：素材就绪之后；请求前记录 submitting，未知结果通过受理查询恢复。
API_TASK_SUBMIT = "/analysis/tasks"

# GET：按提交标识查询是否已经受理，响应 task 可为 null，无请求体。
# 鉴权：Skill Bearer；{submission_id} 为本机持久化的原提交 UUID。
# 调用阶段：提交响应丢失等结果未知场景；核对原提交，避免创建另一个收费任务。
API_TASK_ADMISSION_TEMPLATE = "/analysis/tasks/admissions/{submission_id}"

# GET：读取任务进度、终态及已生成的分析结果，无请求体。
# 鉴权：Skill Bearer；{task_id} 为已确认的任务 UUID。
# 调用阶段：task、wait、已受理任务的 resume，以及开始下一篇前归档上一份报告。
API_TASK_DETAIL_TEMPLATE = "/analysis/tasks/{task_id}"

# 存储签名上传 ###########################################################

# PUT：向存储服务上传文件；此路径相对上传资格 endpoint 的 origin，
# 不相对题火 API 根地址。{bucket_name} 和 {object_name} 由资格响应提供，
# 前者整体 URL 编码，后者逐段编码并保留目录分隔符。
# 鉴权：查询参数 token 使用资格中的 signature，不附带 Skill Bearer。
# 调用阶段：视频上传；请求体为 multipart，包含 cacheControl 和文件字段。
# 图片使用服务端直接返回的完整 uploadUrl，同样由 api.upload_file 统一发送。
STORAGE_SIGNED_UPLOAD_TEMPLATE = "/storage/v1/object/upload/sign/{bucket_name}/{object_name}"


MAX_IMAGES = 18
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_IMAGE_BYTES = 80 * 1024 * 1024
MAX_TITLE_UNITS = 200
MAX_BODY_UNITS = 1000
MAX_TOPIC_UNITS = 100
MAX_TOPICS = 25
MAX_INPUT_BYTES = 512 * 1024
MAX_NOTE_FILE_BYTES = 64 * 1024
MAX_NOTE_FILES = 20
EXCERPT_CHARACTERS = 6
MEDIA_WAIT_SECONDS = 300
POLL_SECONDS = 2
FINISHED_STATUSES = frozenset(
    {
        "completed",
        "succeeded",
        "technical_failed",
        "failed",
        "insufficient_points",
        "cancelled",
        "abandoned",
    }
)
IMAGE_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}
VIDEO_TYPES = {".mp4": "video/mp4", ".mov": "video/quicktime"}
