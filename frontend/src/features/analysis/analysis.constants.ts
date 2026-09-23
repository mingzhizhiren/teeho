import { TIME_MS } from '@/config/constants'

const longRunningTaskThresholdMinutes = 5
const agentTypingIntervalMilliseconds = 18
const agentTypingMaximumDurationMilliseconds = 1_800
const formingConversationRetentionHours = 24
const resultActionRetentionHours = 24

/** 分析工作台的浏览器交互与本地展示约束。 */
export const analysisUiConstraints = {
    rawTextMaxLength: 3_000,
    mediaStatusPollingIntervalMs: 1_000,
    clockRefreshIntervalMs: 30_000,
    longRunningTaskThresholdMs: longRunningTaskThresholdMinutes * TIME_MS.MINUTE,
    megabyteIntegerDisplayThreshold: 10,
    localHistoryNameMaxLength: 48,
    localHistorySchemaVersion: 2,
    customTrackNameMaxLength: 100,
    scoreMaximum: 100,
    scoreDisplayDecimalPlaces: 2,
    referenceSourcesMaximum: 4,
    agentTypingIntervalMs: agentTypingIntervalMilliseconds,
    agentTypingMaximumDurationMs: agentTypingMaximumDurationMilliseconds,
    actionToastDurationMs: 3_000,
    formingConversationRetentionMs: formingConversationRetentionHours * TIME_MS.HOUR,
    resultActionRetentionMs: resultActionRetentionHours * TIME_MS.HOUR,
    percentageMinimum: 0,
    percentageComplete: 100,
} as const
