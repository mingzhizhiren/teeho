import { z } from 'zod'

import type {
    GuideDefinition,
    GuideProgress,
    GuideRunResult,
    GuideStartIntent,
    ProductGuideDriver,
    ProductGuideModule,
    ProductGuideProgressStorage,
    ProductGuideStepPreparer,
    ResolvedGuideStep,
} from './productGuide.types'

interface ProductGuideDependencies {
    getAccountId(): string | null
    definitions: GuideDefinition[]
    translate(key: string): string
    storage: ProductGuideProgressStorage
    driver: ProductGuideDriver
    stepPreparer?: ProductGuideStepPreparer
}

const identifierPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/u
const semanticAnchorPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u
const i18nKeyPattern = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)*$/u
const guideStepSchema = z
    .object({
        id: z.string().regex(identifierPattern),
        routeName: z.string().regex(identifierPattern).optional(),
        anchorId: z.string().regex(semanticAnchorPattern).optional(),
        titleKey: z.string().regex(i18nKeyPattern),
        contentKey: z.string().regex(i18nKeyPattern),
        placement: z.enum(['top', 'right', 'bottom', 'left', 'center']),
        interaction: z.enum(['highlight_only', 'interactive', 'click_to_advance']),
    })
    .strict()
const guideDefinitionSchema = z
    .object({
        id: z.string().regex(identifierPattern),
        steps: z.array(guideStepSchema).min(1),
    })
    .strict()

function createDefinitionMap(definitions: GuideDefinition[]): Map<string, GuideDefinition> {
    const parsedDefinitions = definitions.map((definition) => {
        if (definition.steps.length === 0) {
            throw new TypeError('产品引导至少需要一个步骤')
        }
        const parsed = guideDefinitionSchema.safeParse(definition)
        if (!parsed.success) throw new TypeError('产品引导定义无效')
        const stepIds = new Set(parsed.data.steps.map((step) => step.id))
        if (stepIds.size !== parsed.data.steps.length) {
            throw new TypeError('产品引导步骤标识不能重复')
        }
        return parsed.data
    })
    const guideIds = new Set(parsedDefinitions.map((definition) => definition.id))
    if (guideIds.size !== parsedDefinitions.length) {
        throw new TypeError('产品引导标识不能重复')
    }
    return new Map(parsedDefinitions.map((definition) => [definition.id, definition]))
}

function unique(values: readonly string[]): string[] {
    return [...new Set(values)]
}

function resolveSteps(
    definition: GuideDefinition,
    progress: GuideProgress | null,
    intent: GuideStartIntent,
    translate: (key: string) => string,
): ResolvedGuideStep[] {
    const completed = new Set(progress?.completedStepIds ?? [])
    const incomplete = definition.steps.filter((step) => !completed.has(step.id))
    const selected = intent === 'manual_replay' ? definition.steps : incomplete
    return selected.map((step) => ({
        ...step,
        title: translate(step.titleKey),
        content: translate(step.contentKey),
    }))
}

async function readProgress(
    storage: ProductGuideProgressStorage,
    accountId: string,
    guideId: string,
): Promise<GuideProgress | null> {
    try {
        return await storage.read(accountId, guideId)
    } catch {
        return null
    }
}

async function writeProgress(
    storage: ProductGuideProgressStorage,
    accountId: string,
    progress: GuideProgress,
): Promise<void> {
    try {
        await storage.write(accountId, progress)
    } catch {
        // 浏览器存储不可用时仍允许本次引导继续。
    }
}

/** 创建产品引导深模块；业务调用方只使用返回值的 startGuide。 */
export function createProductGuideModule(
    dependencies: ProductGuideDependencies,
): ProductGuideModule {
    const definitions = createDefinitionMap(dependencies.definitions)
    let isRunning = false
    let lifecycleGeneration = 0

    async function startGuide(
        guideId: string,
        options: { intent?: GuideStartIntent } = {},
    ): Promise<GuideRunResult> {
        const accountId = dependencies.getAccountId()
        if (!accountId) return { status: 'unavailable', reason: 'account_required' }
        const definition = definitions.get(guideId)
        if (!definition) return { status: 'unavailable', reason: 'definition_missing' }
        if (isRunning) return { status: 'unavailable', reason: 'already_running' }

        isRunning = true
        const generation = ++lifecycleGeneration
        const intent = options.intent ?? 'automatic'
        const isManualReplay = intent === 'manual_replay'
        const isCurrentRun = () =>
            generation === lifecycleGeneration && dependencies.getAccountId() === accountId
        let progress = await readProgress(dependencies.storage, accountId, guideId)
        if (
            !isManualReplay &&
            (progress?.status === 'completed' || progress?.status === 'skipped')
        ) {
            isRunning = false
            return { status: 'suppressed', reason: progress.status }
        }
        const currentStepIds = new Set(definition.steps.map((step) => step.id))
        let completedStepIds = unique(progress?.completedStepIds ?? []).filter((stepId) =>
            currentStepIds.has(stepId),
        )
        progress = progress ? { ...progress, completedStepIds } : null
        let progressWriteQueue: Promise<void> = Promise.resolve()
        const persistProgress = (nextProgress: GuideProgress): Promise<void> => {
            progress = nextProgress
            progressWriteQueue = progressWriteQueue.then(async () => {
                if (!isCurrentRun()) return
                await writeProgress(dependencies.storage, accountId, nextProgress)
            })
            return progressWriteQueue
        }
        const steps = resolveSteps(
            definition,
            progress,
            intent,
            dependencies.translate,
        )

        try {
            let result: 'completed' | 'skipped'
            try {
                result = await dependencies.driver.run({
                    steps,
                    startIndex: 0,
                    prepareStep: (step) =>
                        dependencies.stepPreparer?.prepare(step) ??
                        Promise.resolve({ status: 'ready' as const }),
                    unavailableMessage: (reason) =>
                        dependencies.translate(`productGuide.errors.${reason}`),
                    skipStepLabel: dependencies.translate('productGuide.skipStep'),
                    nextLabel: dependencies.translate('productGuide.next'),
                    previousLabel: dependencies.translate('productGuide.previous'),
                    doneLabel: dependencies.translate('productGuide.done'),
                    closeLabel: dependencies.translate('productGuide.close'),
                    onStepEntered: async (stepId) => {
                        if (!isCurrentRun() || isManualReplay) return
                        await persistProgress({
                            guideId,
                            status: 'in_progress',
                            currentStepId: stepId,
                            completedStepIds,
                        })
                    },
                    onStepCompleted: async (stepId) => {
                        if (!isCurrentRun() || isManualReplay) return
                        completedStepIds = unique([...completedStepIds, stepId])
                        await persistProgress({
                            guideId,
                            status: 'in_progress',
                            currentStepId: stepId,
                            completedStepIds,
                        })
                    },
                })
            } catch {
                await progressWriteQueue
                return { status: 'unavailable', reason: 'driver_unavailable' }
            }
            if (!isCurrentRun()) return { status: 'skipped' }
            if (isManualReplay) return { status: result }
            const persistedStatus = result
            const finalProgress: GuideProgress = {
                guideId,
                status: persistedStatus,
                currentStepId:
                    persistedStatus === 'completed' ? null : (progress?.currentStepId ?? null),
                completedStepIds,
            }
            await persistProgress(finalProgress)
            return { status: result }
        } finally {
            dependencies.driver.destroy()
            dependencies.stepPreparer?.destroy()
            isRunning = false
        }
    }

    return {
        startGuide,
        destroy: () => {
            lifecycleGeneration += 1
            dependencies.driver.destroy()
            dependencies.stepPreparer?.destroy()
        },
    }
}
