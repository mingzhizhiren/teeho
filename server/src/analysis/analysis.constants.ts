import { BYTE_SIZE, TIME_MS, VIDEO_RULES } from '../config/constants'

const maximumFileMebibytes = 5
const maximumBatchMebibytes = 80
const uploadRetentionHours = 24
const defaultProcessingTimeoutMinutes = 10
const defaultTaskLeaseMinutes = 2
const taskLeaseRenewalSeconds = 30
const signedUploadLifetimeMinutes = 5
const processingLeaseMinutes = 2
const cleanupRetryDelayMinutes = 15
const providerMaximumSingleMebibytes = 20
const openAiMaximumBatchMebibytes = 45
const geminiMaximumBatchMebibytes = 18
const secondsPerMinute = TIME_MS.MINUTE / TIME_MS.SECOND
const conversationInitialTimeoutSeconds = 30
const conversationRetryTimeoutSeconds = 60

/** 共享草稿素材上传的账号级滚动窗口。 */
export const analysisMediaUploadAdmissionRules = {
    windowMs: TIME_MS.MINUTE,
    maximumImages: 50,
    maximumVideos: 5,
} as const

/** 分析草稿和标准任务字段的集中输入约束。 */
export const analysisInputConstraints = {
    rawTextMaxLength: 3_000,
    clarification: {
        questionMaxLength: 300,
        answerMaxLength: 2_000,
    },
    providerMessageMaxLength: 500,
    fields: {
        customTrackNameMaxLength: 100,
        titleMaxLength: 200,
        bodyMaxLength: 1_000,
        topicsMaxItems: 25,
        existingTopicMaxLength: 100,
        topicItemMaxLength: 100,
    },
} as const

/** 分析图片上传与临时保留约束。 */
export const analysisUploadConstraints = {
    allowedMediaTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxFiles: 18,
    maxFileBytes: maximumFileMebibytes * BYTE_SIZE.MEBIBYTE,
    maxTotalBytes: maximumBatchMebibytes * BYTE_SIZE.MEBIBYTE,
    maxPixels: 40_000_000,
    retentionSeconds: (uploadRetentionHours * TIME_MS.HOUR) / TIME_MS.SECOND,
    maxImagesPerMinute: analysisMediaUploadAdmissionRules.maximumImages,
    videoEnabled: true,
    video: {
        allowedMediaTypes: VIDEO_RULES.allowedMediaTypes,
        maxFileBytes: VIDEO_RULES.maximumUploadBytes,
        maxUploadsPerMinute: analysisMediaUploadAdmissionRules.maximumVideos,
        pointCost: 0,
    },
} as const

/** 私有分析图片的上传、处理、轮询与清理策略。 */
export const analysisMediaConstraints = {
    originalFileNameMaxLength: 255,
    derivedMaxEdgePixels: 2_048,
    lossyQuality: 82,
    signedUploadLifetimeSeconds: signedUploadLifetimeMinutes * secondsPerMinute,
    processingPollIntervalMs: 500,
    processingLeaseSeconds: processingLeaseMinutes * secondsPerMinute,
    maxProcessingAttempts: 3,
    cleanupBatchSize: 100,
    cleanupMaxAttempts: 5,
    cleanupRetryDelaySeconds: cleanupRetryDelayMinutes * secondsPerMinute,
    storageBucket: 'analysis-media',
} as const

/** 各 Provider 适配器接收派生图时的保守请求边界。 */
export const analysisProviderImageConstraints = {
    maxFiles: analysisUploadConstraints.maxFiles,
    maxSingleBytes: providerMaximumSingleMebibytes * BYTE_SIZE.MEBIBYTE,
    maxEdgePixels: analysisMediaConstraints.derivedMaxEdgePixels,
    maxTotalBytes: {
        codex: analysisUploadConstraints.maxTotalBytes,
        openai: openAiMaximumBatchMebibytes * BYTE_SIZE.MEBIBYTE,
        gemini: geminiMaximumBatchMebibytes * BYTE_SIZE.MEBIBYTE,
    },
} as const

/** 私有笔记事实及合成证据的读取边界。 */
export const analysisEvidenceConstraints = {
    noteIdMaxLength: 100,
    sourceVersionMaxLength: 100,
    evidenceVersionLength: 64,
    maxCommentsPerNote: 3,
    commentMaxCharacters: 120,
    candidateLimit: 1000,
    searchTermLimit: 20,
    searchTermMaxLength: 80,
    mockTitleTopicMaxLength: 24,
    mockBodyTopicMaxLength: 60,
    mockTagTopicMaxLength: 18,
} as const

/** 分析任务执行、重试、列表和前端展示共用策略。 */
export const analysisExecutionConstraints = {
    firstResultVersion: 1,
    maxAutomaticAttempts: 2,
    maxDraftPreparationAttempts: 2,
    preparationRequestMarginMs: 30_000,
    defaultProcessingTimeoutMs: defaultProcessingTimeoutMinutes * TIME_MS.MINUTE,
    defaultTaskLeaseMs: defaultTaskLeaseMinutes * TIME_MS.MINUTE,
    taskLeaseRenewalIntervalMs: taskLeaseRenewalSeconds * TIME_MS.SECOND,
    defaultWorkerPollIntervalMs: TIME_MS.SECOND,
    cancellationPollIntervalMs: 500,
    taskListLimit: 20,
    expectedDurationWithoutImagesSeconds: 60,
    expectedDurationWithImagesSeconds: 180,
    preparationArtifactMaxLength: 100_000,
    trace: {
        modelMaxLength: 200,
        executionIdMaxLength: 500,
        versionMaxLength: 100,
    },
} as const

/** 账号控制的 Agent 会话租约策略。 */
export const analysisConversationConstraints = {
    providerAttemptTimeoutSeconds: [
        conversationInitialTimeoutSeconds,
        conversationRetryTimeoutSeconds,
        conversationRetryTimeoutSeconds,
    ] as const,
    settlementGraceSeconds: 30,
    historyCompressionEstimatedTokenThreshold: 12_000,
} as const

/** 回合租约覆盖全部 Provider 尝试与最终数据库结算。 */
export function resolveAnalysisConversationTurnLeaseSeconds(): number {
    return (
        analysisConversationConstraints.providerAttemptTimeoutSeconds.reduce<number>(
            (total, seconds) => total + seconds,
            0,
        ) + analysisConversationConstraints.settlementGraceSeconds
    )
}

/** 联网资料快照的稳定版本与公开展示边界。 */
export const analysisWebResearchConstraints = {
    queryVersion: 'web-research-query.v1',
    snapshotVersion: 'analysis-web-research-snapshot.v1',
    maxSources: 5,
    maxFacts: 12,
    maxConflicts: 6,
    queryMaxLength: 120,
    maxQueries: 2,
    minimumSemanticQueryLength: 2,
    bodyKeywordMaxLength: 16,
    maxTopicQueryTerms: 3,
    minimumIndependentSources: 2,
    tokenBudget: 12_000,
    tokenReservationPerAttempt: 12_000,
    providerTotalTokenLimit: 96_000,
    maxAttempts: 1,
    summaryMaxLength: 800,
    factMaxLength: 300,
    sourceTitleMaxLength: 300,
    sourceSiteMaxLength: 120,
} as const

/** Provider DEBUG 日志的脱敏与截断边界。 */
export const analysisProviderDebugConstraints = {
    stringMaxLength: 20_000,
    arrayMaxLength: 100,
    objectMaxKeys: 100,
    valueMaxDepth: 6,
} as const
