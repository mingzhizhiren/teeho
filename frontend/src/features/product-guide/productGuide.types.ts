/** Driver 浮层相对语义锚点的位置。 */
export type GuidePlacement = 'top' | 'right' | 'bottom' | 'left' | 'center'
/** 引导步骤允许的真实页面交互模式。 */
export type GuideInteraction = 'highlight_only' | 'interactive' | 'click_to_advance'
/** 调用意图决定是否读取和改写自动引导历史。 */
export type GuideStartIntent = 'automatic' | 'manual_replay'

/** 只由 TypeScript 与 i18n key 组成的单个引导步骤。 */
export interface GuideStep {
    id: string
    routeName?: string
    anchorId?: string
    titleKey: string
    contentKey: string
    placement: GuidePlacement
    interaction: GuideInteraction
}

/** 一个具有稳定 ID 和稳定步骤 ID 的产品引导。 */
export interface GuideDefinition {
    id: string
    steps: GuideStep[]
}

/** 已把 i18n key 解析为纯文本的 Driver 步骤。 */
export interface ResolvedGuideStep extends GuideStep {
    title: string
    content: string
}

/** 当前账号在浏览器中的步骤级引导进度。 */
export interface GuideProgress {
    guideId: string
    status: 'in_progress' | 'completed' | 'skipped'
    currentStepId: string | null
    completedStepIds: string[]
}

/** 跨页导航与锚点等待后的步骤准备结果。 */
export type GuideStepPreparation =
    | { status: 'ready' }
    | {
          status: 'unavailable'
          reason: 'navigation_failed' | 'anchor_missing'
      }

/** 在 Driver 展示步骤前完成路由和语义锚点准备。 */
export interface ProductGuideStepPreparer {
    prepare(step: ResolvedGuideStep): Promise<GuideStepPreparation>
    destroy(): void
}

/** 账号隔离的产品引导进度存储 seam。 */
export interface ProductGuideProgressStorage {
    read(accountId: string, guideId: string): Promise<GuideProgress | null>
    write(accountId: string, progress: GuideProgress): Promise<void>
}

/** Driver adapter 一次运行所需的受控输入与进度回调。 */
export interface ProductGuideDriverRun {
    steps: ResolvedGuideStep[]
    startIndex: number
    prepareStep(step: ResolvedGuideStep): Promise<GuideStepPreparation>
    unavailableMessage(
        reason: Extract<GuideStepPreparation, { status: 'unavailable' }>['reason'],
    ): string
    skipStepLabel: string
    nextLabel: string
    previousLabel: string
    doneLabel: string
    closeLabel: string
    onStepEntered(stepId: string): Promise<void>
    onStepCompleted(stepId: string): Promise<void>
}

/** 产品引导渲染 Adapter 的最小 interface。 */
export interface ProductGuideDriver {
    run(input: ProductGuideDriverRun): Promise<'completed' | 'skipped'>
    destroy(): void
}

/** 业务调用方可观察的引导运行结果。 */
export type GuideRunResult =
    | { status: 'completed' }
    | { status: 'skipped' }
    | { status: 'suppressed'; reason: 'completed' | 'skipped' }
    | {
          status: 'unavailable'
          reason:
              | 'account_required'
              | 'definition_missing'
              | 'already_running'
              | 'driver_unavailable'
      }

/** 产品引导模块对业务调用方暴露的唯一 interface。 */
export interface ProductGuideModule {
    startGuide(
        guideId: string,
        options?: { intent?: GuideStartIntent },
    ): Promise<GuideRunResult>
    destroy(): void
}
