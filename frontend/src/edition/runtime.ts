import { computed, type Component, type ComputedRef, type Ref } from 'vue'
import type {
    AnalysisTask,
    AnalysisTaskConfig,
    AnalysisInputMode,
} from '@/features/analysis/analysis.contract'
import type { ResultCopyTarget } from '@/features/analysis/resultDetails'

/** 部署版本可以补充受理策略；服务器始终负责最终授权与资源限制。 */
export interface AnalysisAccessInput {
    readonly config: AnalysisTaskConfig | null
    readonly contentKind: 'image' | 'video'
    readonly imageCount: number
    readonly hasVideo: boolean
}

export interface AnalysisAccess {
    readonly lockMessage: string
    readonly initialTokenBudget: {
        sessionTokenBudget: number | null
        finalDraftTokenReserve: number
        sessionProgressThresholds: { yellow: number; red: number; exhausted: number }
    } | null
    refresh(): Promise<void>
    videoBlockMessage(config: AnalysisTaskConfig | null): string
    submissionBlockMessage(input: AnalysisAccessInput): string
    submissionHint(input: AnalysisAccessInput): string
}

export interface ResultExtensionOptions {
    readonly task: () => AnalysisTask
    readonly viewContext: () => 'current' | 'history'
    readonly element: Ref<HTMLElement | null>
}

export interface ResultExtension {
    readonly component: Component | null
    readonly bindings: ComputedRef<Record<string, unknown>>
    onCopied(target: ResultCopyTarget): Promise<void>
}

/** 版本组合入口；社区核心不导入私有实现。 */
export interface FrontendRuntime {
    readonly workspaceHeader: Component | null
    readonly accountOverview: Component | null
    readonly accountExtra: Component | null
    readonly registrationAgreement: Component | null
    readonly workspaceEventTypes: readonly string[]
    useAnalysisAccess(): AnalysisAccess
    useResultExtension(options: ResultExtensionOptions): ResultExtension
    beforeSessionChange(): Promise<void>
    afterSessionChange(): void
    onDraftStarted(input: {
        inputMode: AnalysisInputMode
        contentKind: 'image' | 'video'
        trackCode: string
    }): void
    usePageMetadata(): void
    onServiceUnavailable(): void
    presentNotification(
        notification: unknown,
        translate: (key: string, params?: Record<string, unknown>) => string,
        locale: string,
    ): { title: string; body: string } | null
    notificationRoute(
        notification: unknown,
    ): { name: string; query: Record<string, string> } | 'none' | null
    analysisText(
        key:
            | 'submit'
            | 'reanalyze'
            | 'reanalyzeDescription'
            | 'reanalyzeConfirm'
            | 'taskBlocked'
            | 'usageLimited',
        context: {
            task?: AnalysisTask
            input?: AnalysisAccessInput
            duration?: string
            canUpgrade?: boolean
        },
    ): string | null
}

const communityAccess: AnalysisAccess = {
    lockMessage: '',
    initialTokenBudget: null,
    refresh: async () => {},
    videoBlockMessage: () => '',
    submissionBlockMessage: () => '',
    submissionHint: () => '',
}

const communityRuntime: FrontendRuntime = {
    workspaceHeader: null,
    accountOverview: null,
    accountExtra: null,
    registrationAgreement: null,
    workspaceEventTypes: [],
    useAnalysisAccess: () => communityAccess,
    useResultExtension: () => ({
        component: null,
        bindings: computed(() => ({})),
        onCopied: async () => {},
    }),
    beforeSessionChange: async () => {},
    afterSessionChange: () => {},
    onDraftStarted: () => {},
    usePageMetadata: () => {},
    onServiceUnavailable: () => {},
    presentNotification: () => null,
    notificationRoute: () => null,
    analysisText: () => null,
}

let runtime: FrontendRuntime = communityRuntime

/** 在应用入口一次性装配版本扩展；默认直接运行社区版。 */
export function configureFrontendRuntime(extension: FrontendRuntime): void {
    runtime = extension
}

/** 获取已装配的部署扩展；不创建请求或账户状态。 */
export function getFrontendRuntime(): FrontendRuntime {
    return runtime
}
