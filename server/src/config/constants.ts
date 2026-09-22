/** 统一业务错误码 */
export const API_CODES = {
    OK: 0,
    BAD_REQUEST: 4000,
    VALIDATION_ERROR: 4001,
    NOT_FOUND: 4002,
    UNAUTHORIZED: 4010,
    FORBIDDEN: 4011,
    CONFLICT: 4090,
    SKILL_UPGRADE_REQUIRED: 4260,
    RATE_LIMITED: 4290,
    SERVICE_MAINTENANCE: 5030,
    INTERNAL_ERROR: 5000,
} as const

/** 业务错误码联合类型 */
export type ApiCode = (typeof API_CODES)[keyof typeof API_CODES]

/** 业务代码显式分支使用的 HTTP 状态。 */
export const HTTP_STATUS = {
    OK: 200,
    CREATED: 201,
    ACCEPTED: 202,
    NOT_MODIFIED: 304,
    FOUND: 302,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    GONE: 410,
    UNPROCESSABLE_CONTENT: 422,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
} as const

/** 跨模块使用的时间单位，避免重复手写换算系数。 */
export const TIME_MS = {
    SECOND: 1_000,
    MINUTE: 60_000,
    HOUR: 3_600_000,
    DAY: 86_400_000,
} as const

/** 二进制容量单位。 */
export const BYTE_SIZE = {
    KIBIBYTE: 1_024,
    MEBIBYTE: 1_048_576,
} as const
const maximumVideoUploadMebibytes = 400
const videoSignedUploadLifetimeMinutes = 5
const videoEvidenceRetentionHours = 24
const videoEvidenceCleanupLeaseMinutes = 2
const videoEvidenceCleanupRetryMinutes = 15
const videoProcessingTimeoutMinutes = 10
const videoStorageDownloadTimeoutMinutes = 10
const videoProcessingLeaseMinutes = 2
const videoWorkerHeartbeatSeconds = 30
const videoWorkerHealthyWithinSeconds = 90
const videoStartWindowMinutes = 1
const maximumWaitingVideosPerHealthyWorker = 5
const maximumVideoProcessingAttempts = 2
const maximumVideoOriginalCleanupAttempts = 5
const videoOriginalCleanupRetryMinutes = 1
const videoOriginalFileNameMaxLength = 255
const maximumVideoDurationMinutes = 5
const maximumVideoEdgePixels = 4_096
const maximumVideoPixels = 9_000_000
const videoOpeningCoverageSeconds = 5
const videoTemporalIntervalSeconds = 5
const videoSceneChangeThreshold = 0.35
const videoSceneFrameSelectionRatio = 0.2
const maximumVideoSceneCandidates = 100
const videoPerceptualHashDistance = 6

/** 小红书证据数据使用的稳定赛道编码。 */
export const TRACKS_OTHER = 0 // 其他
/** 美妆个护赛道编码。 */
export const TRACKS_BEAUTY_SKINCARE = 1 // 美妆个护
/** 时尚穿搭赛道编码。 */
export const TRACKS_FASHION = 2 // 时尚穿搭
/** 美食饮品赛道编码。 */
export const TRACKS_FOOD_AND_DRINK = 3 // 美食饮品
/** 旅行赛道编码。 */
export const TRACKS_TRAVEL = 4 // 旅行
/** 健康养生赛道编码。 */
export const TRACKS_HEALTH_AND_WELLNESS = 5 // 健康养生
/** 家居家装赛道编码。 */
export const TRACKS_HOME_AND_RENOVATION = 6 // 家居家装
/** 运动体育赛道编码。 */
export const TRACKS_SPORTS_AND_FITNESS = 7 // 运动体育
/** 母婴育儿赛道编码。 */
export const TRACKS_PARENTING = 8 // 母婴育儿
/** 本地生活赛道编码。 */
export const TRACKS_LOCAL_LIFE = 9 // 本地生活
/** 宠物赛道编码。 */
export const TRACKS_PETS = 10 // 宠物
/** AI 与效率工具赛道编码。 */
export const TRACKS_AI_AND_PRODUCTIVITY = 11 // AI 与效率工具
/** 户外赛道编码。 */
export const TRACKS_OUTDOORS = 12 // 户外
/** 情感心理赛道编码。 */
export const TRACKS_RELATIONSHIPS_AND_PSYCHOLOGY = 13 // 情感心理
/** 兴趣生活赛道编码。 */
export const TRACKS_HOBBIES_AND_LIFESTYLE = 14 // 兴趣生活
/** 教育学习赛道编码。 */
export const TRACKS_EDUCATION = 15 // 教育学习
/** 个人成长赛道编码。 */
export const TRACKS_PERSONAL_GROWTH = 16 // 个人成长
/** 职场就业赛道编码。 */
export const TRACKS_CAREER_AND_EMPLOYMENT = 17 // 职场就业
/** 摄影设计赛道编码。 */
export const TRACKS_PHOTOGRAPHY_AND_DESIGN = 18 // 摄影设计
/** 数码科技赛道编码。 */
export const TRACKS_CONSUMER_TECHNOLOGY = 19 // 数码科技
/** 婚恋家庭赛道编码。 */
export const TRACKS_MARRIAGE_AND_FAMILY = 20 // 婚恋家庭
/** 游戏动漫赛道编码。 */
export const TRACKS_GAMING_AND_ANIME = 21 // 游戏动漫
/** 影视娱乐赛道编码。 */
export const TRACKS_FILM_AND_ENTERTAINMENT = 22 // 影视娱乐
/** 商业创业赛道编码。 */
export const TRACKS_BUSINESS_AND_ENTREPRENEURSHIP = 23 // 商业创业
/** 汽车出行赛道编码。 */
export const TRACKS_AUTOMOTIVE_AND_MOBILITY = 24 // 汽车出行
/** 文化人文赛道编码。 */
export const TRACKS_CULTURE_AND_HUMANITIES = 25 // 文化人文
/** 房产置业赛道编码。 */
export const TRACKS_REAL_ESTATE = 26 // 房产置业
/** 财经理财赛道编码。 */
export const TRACKS_FINANCE_AND_INVESTING = 27 // 财经理财
/** 科学科普赛道编码。 */
export const TRACKS_SCIENCE_EDUCATION = 28 // 科学科普
/** 法律社会赛道编码。 */
export const TRACKS_LAW_AND_SOCIETY = 29 // 法律社会
/** 三农乡村赛道编码。 */
export const TRACKS_AGRICULTURE_AND_RURAL_LIFE = 30 // 三农乡村

/** 视频上传、预处理与证据包的集中业务边界。 */
export const VIDEO_RULES = {
    storageBucket: 'analysis-video',
    maximumUploadBytes: maximumVideoUploadMebibytes * BYTE_SIZE.MEBIBYTE,
    allowedMediaTypes: ['video/mp4', 'video/quicktime'] as const,
    originalFileNameMaxLength: videoOriginalFileNameMaxLength,
    signedUploadLifetimeMs: videoSignedUploadLifetimeMinutes * TIME_MS.MINUTE,
    evidenceRetentionMs: videoEvidenceRetentionHours * TIME_MS.HOUR,
    evidenceCleanupLeaseMs: videoEvidenceCleanupLeaseMinutes * TIME_MS.MINUTE,
    evidenceCleanupRetryMs: videoEvidenceCleanupRetryMinutes * TIME_MS.MINUTE,
    maximumEvidenceCleanupAttempts: 5,
    maximumEvidenceCleanupItemsPerSweep: 20,
    processingTimeoutMs: videoProcessingTimeoutMinutes * TIME_MS.MINUTE,
    storageDownloadTimeoutMs: videoStorageDownloadTimeoutMinutes * TIME_MS.MINUTE,
    processingPollIntervalMs: 500,
    processingLeaseMs: videoProcessingLeaseMinutes * TIME_MS.MINUTE,
    workerHeartbeatIntervalMs: videoWorkerHeartbeatSeconds * TIME_MS.SECOND,
    workerHealthyWithinMs: videoWorkerHealthyWithinSeconds * TIME_MS.SECOND,
    startWindowMs: videoStartWindowMinutes * TIME_MS.MINUTE,
    maximumWaitingPerHealthyWorker: maximumWaitingVideosPerHealthyWorker,
    maximumProcessingAttempts: maximumVideoProcessingAttempts,
    maximumOriginalCleanupAttempts: maximumVideoOriginalCleanupAttempts,
    originalCleanupRetryMs: videoOriginalCleanupRetryMinutes * TIME_MS.MINUTE,
    maximumLogExcerptCharacters: 2_000,
    metadataLabelMaxLength: 50,
    frameSelectionReasonMaxLength: 100,
    maximumFrames: 50,
    maximumDurationMs: maximumVideoDurationMinutes * TIME_MS.MINUTE,
    maximumEdgePixels: maximumVideoEdgePixels,
    maximumPixels: maximumVideoPixels,
    openingCoverageSeconds: videoOpeningCoverageSeconds,
    temporalIntervalSeconds: videoTemporalIntervalSeconds,
    sceneChangeThreshold: videoSceneChangeThreshold,
    sceneFrameSelectionRatio: videoSceneFrameSelectionRatio,
    maximumSceneCandidates: maximumVideoSceneCandidates,
    perceptualHashMaximumDistance: videoPerceptualHashDistance,
    frameMaximumEdgePixels: 1_024,
    frameWebpQuality: 80,
    maximumConcurrentUploads: 1,
    maximumStartsPerWindow: 5,
    evidenceVersion: 'video-evidence.v1',
    pipelineVersion: 'ffmpeg-keyframes.v4',
    pipelineConfigVersion: 'video-preprocessing.v3',
} as const
