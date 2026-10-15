import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useUserStorage } from '@/composables/useUserStorage'
import type { StandardAnalysisTask } from './analysis.contract'
import {
    AnalysisConversationPersistenceError,
    type AnalysisConversationPersistence,
    type AnalysisConversationRestoreResult,
    type AnalysisFormingConversationSnapshot,
} from './analysis.conversation-persistence'
import { createBrowserAnalysisConversationPersistence } from './analysis.conversation-persistence.browser'
import { reconcileRestoredDraftVideo } from './analysis.video-upload'
import { browserAnalysisVideoTransport } from './analysis.video-upload.adapter'
import { createEmptyTaskDraft, type SharedTaskDraft, type SharedTaskImage } from './taskDraft'

interface FormPersistenceOptions {
    ownerUserId: () => string | null
    draft: SharedTaskDraft
    draftPreview: Ref<StandardAnalysisTask | null>
    busy: Ref<boolean>
    invalidate: () => void
    report: (key: string) => void
}

/** 沿用账号密文草稿格式，只恢复表单和素材，不恢复已退役的对话执行。 */
export function useAnalysisFormPersistence(options: FormPersistenceOptions) {
    const userStorage = useUserStorage()
    const ready = ref(false)
    const healthy = ref(true)
    const recoveredInput = ref('')
    const clearing = ref(false)
    let persistence: AnalysisConversationPersistence | null = null
    let generation = 0
    let applying = false
    let expiryTimer: ReturnType<typeof setTimeout> | null = null
    let expiryPending = false
    let session: AnalysisFormingConversationSnapshot['session'] = {
        sessionId: crypto.randomUUID(),
        generation: 1,
        browserInstanceId: crypto.randomUUID(),
    }

    function stopExpiry(): void {
        if (expiryTimer !== null) clearTimeout(expiryTimer)
        expiryTimer = null
    }

    function reportFailure(error?: unknown): void {
        healthy.value = false
        options.report(
            error instanceof AnalysisConversationPersistenceError && error.code === 'quota_exceeded'
                ? 'workspace.formDraft.storageFull'
                : 'workspace.formDraft.unavailable',
        )
    }

    function reset(): void {
        recoveredInput.value = ''
        expiryPending = false
        Object.assign(options.draft, createEmptyTaskDraft())
        options.draftPreview.value = null
        options.invalidate()
        stopExpiry()
    }

    async function expire(): Promise<void> {
        if (options.busy.value || clearing.value) {
            expiryPending = true
            return
        }
        const activeGeneration = generation
        expiryPending = false
        if ((await clear()) && activeGeneration === generation) {
            options.report('workspace.formDraft.expired')
        }
    }

    function scheduleExpiry(expiresAt: string): void {
        stopExpiry()
        expiryTimer = setTimeout(
            () => void expire(),
            Math.max(0, Date.parse(expiresAt) - Date.now()),
        )
    }

    function snapshot(): AnalysisFormingConversationSnapshot {
        return {
            session: { ...session },
            pendingComposerText: recoveredInput.value,
            pendingTurn: null,
            draft: {
                ...options.draft,
                fields: { ...options.draft.fields },
                images: [...options.draft.images],
                video: options.draft.video ? { ...options.draft.video } : null,
            },
            conversationState: null,
            draftPreview: options.draftPreview.value,
            preparationId: null,
            confirmation: { currentRevision: 0, confirmedRevision: null, visible: false },
            trackLocked: false,
        }
    }

    async function save(): Promise<boolean> {
        if (!persistence || !ready.value || !healthy.value || applying || clearing.value)
            return false
        const target = persistence
        const activeGeneration = generation
        try {
            const saved = await target.save(snapshot())
            if (target !== persistence || activeGeneration !== generation) return false
            scheduleExpiry(saved.expiresAt)
            return true
        } catch (error) {
            if (target === persistence && activeGeneration === generation) reportFailure(error)
            return false
        }
    }

    async function apply(
        result: AnalysisConversationRestoreResult,
        reconcileVideo: boolean,
    ): Promise<void> {
        const activeGeneration = generation
        if (result.status === 'unavailable') {
            reportFailure()
            return
        }
        applying = true
        try {
            if (result.status !== 'restored') {
                reset()
                if (result.status === 'expired') options.report('workspace.formDraft.expired')
                if (result.status === 'reset_corrupt') options.report('workspace.formDraft.reset')
                return
            }
            const restored = result.snapshot
            recoveredInput.value = restored.pendingComposerText
            session = { ...restored.session }
            Object.assign(options.draft, {
                ...restored.draft,
                fields: { ...restored.draft.fields },
                images: [...restored.draft.images],
                video: restored.draft.video ? { ...restored.draft.video } : null,
            })
            options.draftPreview.value = restored.draftPreview
            options.invalidate()
            scheduleExpiry(result.expiresAt)
            if (reconcileVideo && restored.draft.video?.videoId) {
                const video = await reconcileRestoredDraftVideo(
                    restored.draft.video,
                    browserAnalysisVideoTransport,
                )
                if (activeGeneration === generation) {
                    options.draft.video = video
                    if (!video && restored.draft.video.origin === 'report') {
                        options.report('workspace.edit.videoUnavailable')
                    }
                }
            }
        } finally {
            if (activeGeneration === generation) applying = false
        }
    }

    async function initialize(userId: string | null): Promise<void> {
        const activeGeneration = ++generation
        ready.value = false
        healthy.value = true
        persistence?.close()
        persistence = null
        applying = false
        clearing.value = false
        expiryPending = false
        reset()
        if (!userId) {
            ready.value = true
            return
        }
        const manager = userStorage.files.value
        if (!manager) {
            reportFailure()
            ready.value = true
            return
        }
        try {
            const target = await createBrowserAnalysisConversationPersistence({ userId, manager })
            const restored = await target.restore()
            if (activeGeneration !== generation) {
                target.close()
                return
            }
            persistence = target
            session = { ...session, browserInstanceId: target.browserInstanceId }
            await apply(restored, true)
            if (activeGeneration !== generation) return
            target.subscribe((result) => {
                if (target === persistence && !options.busy.value && !clearing.value) {
                    void apply(result, false).catch((error: unknown) => {
                        if (target === persistence) reportFailure(error)
                    })
                }
            })
        } catch (error) {
            if (activeGeneration === generation) reportFailure(error)
        } finally {
            if (activeGeneration === generation) ready.value = true
        }
    }

    async function clear(scope: 'all' | 'submitted' = 'all'): Promise<boolean> {
        if (clearing.value) return false
        const target = persistence
        const activeGeneration = generation
        const retainedInput = scope === 'submitted' ? recoveredInput.value : ''
        clearing.value = true
        try {
            // 自动移除已提交草稿不等于用户决定丢弃旧输入，沿用当前保留期限。
            const retained =
                retainedInput && target
                    ? await target.save({
                          ...snapshot(),
                          draft: createEmptyTaskDraft(),
                          draftPreview: null,
                      })
                    : null
            if (!retained) await target?.clear()
            if (activeGeneration !== generation || target !== persistence) return false
            reset()
            if (retained) {
                recoveredInput.value = retainedInput
                scheduleExpiry(retained.expiresAt)
            }
            return true
        } catch (error) {
            if (activeGeneration === generation) reportFailure(error)
            return false
        } finally {
            if (activeGeneration === generation) clearing.value = false
        }
    }

    async function readImages(images: readonly SharedTaskImage[]): Promise<(File | null)[]> {
        const target = persistence
        const activeGeneration = generation
        if (
            !target ||
            !(await save()) ||
            target !== persistence ||
            activeGeneration !== generation
        ) {
            throw new AnalysisConversationPersistenceError('storage_unavailable')
        }
        return target.readImages(images)
    }

    watch(options.ownerUserId, (userId) => void initialize(userId), { immediate: true })
    watch([options.busy, clearing], ([busy, isClearing]) => {
        if (!busy && !isClearing && expiryPending) void expire()
    })
    onBeforeUnmount(() => {
        generation += 1
        stopExpiry()
        persistence?.close()
    })

    return {
        ready,
        healthy,
        clearing: computed(() => clearing.value),
        recoveredInput: computed(() => recoveredInput.value),
        initializationState: computed<'loading' | 'ready' | 'error'>(() =>
            !healthy.value ? 'error' : ready.value ? 'ready' : 'loading',
        ),
        save,
        clear,
        readImages,
        reportFailure,
    }
}
