import { Elysia } from 'elysia'
import { resolve } from 'node:path'
import { createSkillDistributionRoutes } from '@teeho/community-server/skill-distribution/skill-distribution.routes'
import { createSkillDistributionController } from '@teeho/community-server/skill-distribution/skill-distribution.controller'
import { skillCompatibilityRoutes } from './skill-distribution/skill-compat.routes'

import { env } from './config/env'
import { analysisExecutionConstraints } from './analysis/analysis.constants'
import {
    createAnalysisTaskExecutor,
    postgresAnalysisTaskExecutionPersistence,
    systemAnalysisExecutionClock,
} from './analysis/tasks/analysis.execution'
import { AnalysisMediaWorker } from './analysis/media/analysis.media.worker'
import { bindAnalysisTaskProcessing } from './analysis/tasks/analysis.processing'
import {
    getRuntimeAgentProvider,
    getRuntimeAgentProviderDescriptor,
} from './analysis/providers/analysis.provider-runtime'
import {
    claimNextAnalysisTask,
    recoverExpiredAnalysisTaskLeases,
} from './analysis/tasks/analysis.queue.service'
import { analysisRoutes } from './analysis/http/analysis.routes'
import { AnalysisTaskWorker, systemAnalysisWorkerClock } from './analysis/tasks/analysis.worker'
import { createBaseApp } from './app-base'
import { createAuthRoutes } from './auth/auth.routes'
import { createSkillAuthRoutes } from '@teeho/community-server/skill-auth/skill-auth.routes'
import { skillAuthController } from '@teeho/community-server/skill-auth/skill-auth.runtime'
import { loadPluginRuntime } from './customization/loader'
import { getCurrentUser, changePassword } from './auth/auth.service'
import { resolveAuthSessionKey } from './auth/auth.session-key'
import { passwordChangeCoordinator } from './auth-password-change/auth-password-change.coordinator'
import {
    checkPasswordChangeThrottle,
    recordInvalidCurrentPassword,
} from './auth-password-change/auth-password-change.throttle'
import { createPasswordChangeUseCase } from './auth-password-change/auth-password-change.use-case'
import { analysisConversationTurnRunService } from './analysis/conversation/analysis.conversation-turn-run.service'
import { notificationRoutes } from './notifications/notification.routes'
import { logger } from '@teeho/community-server/utils/logger'
import { videoRoutes } from '@teeho/community-server/video/video.routes'
import { WorkspaceEventHub } from '@teeho/community-server/workspace-events/workspace-event'
import { workspaceEventConstraints } from '@teeho/community-server/workspace-events/workspace-event.constants'
import { PostgresWorkspaceEventListener } from '@teeho/community-server/workspace-events/workspace-event.listener'
import { createWorkspaceEventRoutes } from '@teeho/community-server/workspace-events/workspace-event.routes'

/** 装配 Elysia、Provider、单次分析执行器与 PostgreSQL Worker。 */
export async function createApplication() {
    const passwordChangeUseCase = createPasswordChangeUseCase({
        resolveAccount: getCurrentUser,
        updateCredential: changePassword,
        checkThrottle: checkPasswordChangeThrottle,
        recordInvalidPassword: recordInvalidCurrentPassword,
        invalidateAgentTurn: (userId, accessToken) =>
            analysisConversationTurnRunService.invalidateUser(
                userId,
                resolveAuthSessionKey(accessToken),
            ),
        coordinator: passwordChangeCoordinator,
    })
    const workspaceEventHub = new WorkspaceEventHub({
        maximumConnections: workspaceEventConstraints.maximumConnections,
        maximumPerUser: workspaceEventConstraints.maximumConnectionsPerUser,
    })
    const workspaceEventListener = new PostgresWorkspaceEventListener({
        databaseUrl: env.DATABASE_DIRECT_URL,
        hub: workspaceEventHub,
        log: logger,
    })
    const provider = getRuntimeAgentProvider()
    const plugins = await loadPluginRuntime(env.TEEHO_PLUGIN_CONFIG)
    const executor = createAnalysisTaskExecutor({
        plugins,
        provider,
        evidenceSource: plugins.dataSource,
        topicEvidenceSource: plugins.topicSource,
        providerDescriptor: getRuntimeAgentProviderDescriptor('generate_result'),
        processingTimeoutMs: analysisExecutionConstraints.defaultProcessingTimeoutMs,
        cancellationPollIntervalMs: analysisExecutionConstraints.cancellationPollIntervalMs,
        taskLeaseMs: analysisExecutionConstraints.defaultTaskLeaseMs,
        taskLeaseRenewalIntervalMs: analysisExecutionConstraints.taskLeaseRenewalIntervalMs,
        persistence: postgresAnalysisTaskExecutionPersistence,
        clock: systemAnalysisExecutionClock,
        log: logger,
    })
    const worker = new AnalysisTaskWorker({
        executor,
        claimNextTask: claimNextAnalysisTask,
        recoverExpiredTaskLeases: recoverExpiredAnalysisTaskLeases,
        processingTimeoutMs: analysisExecutionConstraints.defaultProcessingTimeoutMs,
        taskLeaseMs: analysisExecutionConstraints.defaultTaskLeaseMs,
        pollIntervalMs: analysisExecutionConstraints.defaultWorkerPollIntervalMs,
        clock: systemAnalysisWorkerClock,
        log: logger,
    })
    const mediaWorker = new AnalysisMediaWorker({ log: logger })
    const disposeProcessing = bindAnalysisTaskProcessing({
        requestProcessing: () => worker.wake(),
        cancelRunning: (taskId) => executor.cancel(taskId),
    })
    const appBase = await createBaseApp({ corsCredentials: true })
    const apiRoutes = new Elysia({ prefix: '/api' })
        .get('/health', () => ({
            code: 0,
            message: 'ok',
            data: {
                name: 'teeho API',
                status: 'healthy',
                mode: 'community',
                time: new Date().toISOString(),
            },
        }))
        .use(createAuthRoutes(passwordChangeUseCase))
        .use(createSkillAuthRoutes(skillAuthController))
        .use(skillCompatibilityRoutes)
        .use(
            createSkillDistributionRoutes(
                createSkillDistributionController({
                    publicApiUrl: env.PUBLIC_API_URL,
                    archivePaths: [
                        resolve(process.cwd(), '../frontend/public/downloads/teeho-skill.zip'),
                        resolve(process.cwd(), '../frontend/dist/downloads/teeho-skill.zip'),
                    ],
                    onError: () =>
                        logger.error(
                            { event: 'skill_download_failed' },
                            'Skill 安装包生成失败，请检查公开地址与安装包文件',
                        ),
                }),
            ),
        )
        .use(analysisRoutes)
        .use(videoRoutes)
        .use(notificationRoutes)
        .use(createWorkspaceEventRoutes({ hub: workspaceEventHub }))
    const app = appBase.use(apiRoutes)

    return {
        app,
        worker,
        mediaWorker,
        workspaceEventListener,
        dispose: disposeProcessing,
    }
}
