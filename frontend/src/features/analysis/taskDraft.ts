import type {
    AnalysisDraftPayload,
    AnalysisInputMode,
    AnalysisTaskConfig,
    ResolvedTaskField,
    StandardAnalysisTask,
    TaskFieldName,
    TaskFieldDefinition,
    TaskFieldValue,
} from './analysis.contract'

/** Agent 与定制模式共用的唯一草稿状态 */
export type SharedTaskImageStatus = 'uploading' | 'processing' | 'ready' | 'failed'

export interface SharedTaskImage {
    localId: string
    file: File
    assetId: string | null
    status: SharedTaskImageStatus
    uploadProgress: number
    contentHash: string | null
    errorCode: string | null
    failureStage: 'upload' | 'processing' | null
}

/** 分析任务支持的内容形态。 */
export type AnalysisContentKind = 'image' | 'video'
/** 跨页面共享的视频处理状态。 */
export type SharedTaskVideoStatus =
    | 'uploading'
    | 'upload_paused'
    | 'queued'
    | 'processing'
    | 'ready'
    | 'failed'

/** 跨页面共享的视频素材摘要。 */
export interface SharedTaskVideo {
    localId: string
    file: File | null
    fileName: string
    byteSize: number
    declaredMediaType: 'video/mp4' | 'video/quicktime'
    videoId: string | null
    status: SharedTaskVideoStatus
    uploadProgress: number
    queuePosition: number | null
    evidenceId: string | null
    errorCode: string | null
    remoteUpdatedAt: string | null
}

export interface SharedTaskDraft {
    contentKind: AnalysisContentKind
    rawText: string
    images: SharedTaskImage[]
    coverLocalId?: string | null
    video: SharedTaskVideo | null
    fields: Partial<Record<TaskFieldName, TaskFieldValue>>
}

/** 图片仍在上传/处理或已经失败时，禁止把不完整草稿静默提交。 */
export class AnalysisImagesNotReadyError extends Error {
    constructor() {
        super('图片尚未准备完成')
        this.name = 'AnalysisImagesNotReadyError'
    }
}

/** 视频尚未完成预处理时禁止创建正式分析任务。 */
export class AnalysisVideoNotReadyError extends Error {
    constructor() {
        super('视频尚未准备完成')
        this.name = 'AnalysisVideoNotReadyError'
    }
}

/** 创建空白共享草稿 */
export function createEmptyTaskDraft(): SharedTaskDraft {
    return {
        contentKind: 'image',
        rawText: '',
        images: [],
        coverLocalId: null,
        video: null,
        fields: {},
    }
}

/** 切换展示与提交形态，完整素材仍由同一草稿持有。 */
export function setDraftContentKind(draft: SharedTaskDraft, contentKind: AnalysisContentKind) {
    draft.contentKind = contentKind
}

/** 视频只使用第一张封面；隐藏图片仍留在草稿中。 */
export function activeDraftImages(draft: SharedTaskDraft): SharedTaskImage[] {
    return draft.contentKind === 'video' ? draft.images.slice(0, 1) : draft.images
}

/** 规范化字段值中的首尾空白和空项 */
function normalizeFieldValue(value: TaskFieldValue | undefined) {
    if (typeof value === 'string') {
        return value.trim() || undefined
    }
    if (Array.isArray(value)) {
        const items = value.map((item) => item.trim()).filter(Boolean)
        return items.length > 0 ? items : undefined
    }
    return value === null ? undefined : value
}

/** 仅整理用户已有话题，去展示前缀及完全重复项，不补写新话题。 */
export function normalizeDraftTopics(value: TaskFieldValue | undefined): string[] {
    if (!Array.isArray(value)) return []
    return [...new Set(value.map((item) => item.trim().replace(/^#/u, '').trim()).filter(Boolean))]
}

/** 完整笔记准入校验发现的首个字段问题。 */
export interface DraftFieldIssue {
    field: TaskFieldDefinition
    reason: 'required' | 'maxLength' | 'maxItems' | 'itemMaxLength'
    limit?: number
}

/** 按公开任务配置校验用户已填写的标题、正文及话题。 */
export function getDraftFieldIssue(
    draft: SharedTaskDraft,
    config: AnalysisTaskConfig,
): DraftFieldIssue | null {
    for (const field of config.fields) {
        if (field.name !== 'title' && field.name !== 'body' && field.name !== 'topics') continue
        const value =
            field.name === 'topics'
                ? normalizeDraftTopics(draft.fields[field.name])
                : normalizeFieldValue(draft.fields[field.name])
        if (value === undefined || (Array.isArray(value) && value.length === 0)) {
            if (field.name === 'body') continue
            return { field, reason: 'required' }
        }
        const limits = field.validation
        if (typeof value === 'string' && limits?.maxLength && value.length > limits.maxLength) {
            return { field, reason: 'maxLength', limit: limits.maxLength }
        }
        if (Array.isArray(value) && limits?.maxItems && value.length > limits.maxItems) {
            return { field, reason: 'maxItems', limit: limits.maxItems }
        }
        if (
            Array.isArray(value) &&
            limits?.itemMaxLength &&
            value.some((item) => item.length > limits.itemMaxLength!)
        ) {
            return { field, reason: 'itemMaxLength', limit: limits.itemMaxLength }
        }
    }
    return null
}

/** 判断字段规范化后是否仍有有效内容 */
function hasValue(value: TaskFieldValue | undefined) {
    const normalized = normalizeFieldValue(value)
    return normalized !== undefined && (!Array.isArray(normalized) || normalized.length > 0)
}

/** 根据版本化配置判断浏览器草稿是否有可交给后端的实际内容 */
export function hasEffectiveDraftContent(
    draft: SharedTaskDraft,
    config: AnalysisTaskConfig | null,
) {
    if (draft.rawText.trim() || draft.images.length > 0 || draft.video) {
        return true
    }
    return (
        config?.fields.some((field) => field.countsAsInput && hasValue(draft.fields[field.name])) ??
        false
    )
}

/** 仅识别仍会自动推进的上传/处理状态；失败和暂停需要用户主动修复。 */
export function isDraftMediaPreparing(draft: SharedTaskDraft): boolean {
    if (
        activeDraftImages(draft).some(
            (image) => image.status === 'uploading' || image.status === 'processing',
        )
    )
        return true
    if (draft.contentKind === 'video') {
        return Boolean(
            draft.video &&
            (draft.video.status === 'uploading' ||
                draft.video.status === 'queued' ||
                draft.video.status === 'processing'),
        )
    }
    return false
}

/** 从同一份草稿创建提交载荷；切换模式只改变入口元数据 */
export function createDraftPayload(
    draft: SharedTaskDraft,
    inputMode: AnalysisInputMode,
): AnalysisDraftPayload {
    const images = activeDraftImages(draft)
    if (!areDraftImagesReady(images)) {
        throw new AnalysisImagesNotReadyError()
    }
    if (
        draft.contentKind === 'video' &&
        draft.video &&
        (draft.video.status !== 'ready' || !draft.video.videoId)
    ) {
        throw new AnalysisVideoNotReadyError()
    }
    const fields = Object.fromEntries(
        Object.entries(draft.fields)
            .filter(([name]) =>
                ['track', 'customTrackName', 'title', 'body', 'topics'].includes(name),
            )
            .map(([name, value]) => [
                name,
                name === 'topics' ? normalizeDraftTopics(value) : normalizeFieldValue(value),
            ])
            .filter((entry) => entry[1] !== undefined),
    )
    const cover =
        draft.contentKind === 'video'
            ? images[0]
            : (images.find((image) => image.localId === draft.coverLocalId) ?? images[0])

    return {
        inputMode,
        rawText: inputMode === 'custom' ? '' : draft.rawText,
        // 未提供视频时按实际图片提交，避免丢掉用户已经上传的封面。
        imageReferences:
            draft.contentKind === 'video' && draft.video
                ? []
                : images.map((image) => image.assetId!),
        ...(cover?.assetId ? { coverReference: cover.assetId } : {}),
        ...(draft.contentKind === 'video' && draft.video?.videoId
            ? { videoReference: draft.video.videoId }
            : {}),
        fields,
    }
}

/** 所有图片都必须拥有后端确认的 ready ID 与派生内容哈希。 */
export function areDraftImagesReady(images: SharedTaskImage[]) {
    return images.every(
        (image) => image.status === 'ready' && image.assetId !== null && image.contentHash !== null,
    )
}

/** 视频任务必须已经取得 ready 的服务端视频与证据身份。 */
export function isDraftVideoReady(video: SharedTaskVideo | null) {
    return Boolean(video && video.status === 'ready' && video.videoId && video.evidenceId)
}

/** 读取字段当前展示值；显式输入始终覆盖后端推断或默认值 */
export function resolveDraftFieldForDisplay(
    draft: SharedTaskDraft,
    fieldName: TaskFieldName,
    standardTask: StandardAnalysisTask | null,
): ResolvedTaskField | null {
    const userValue = normalizeFieldValue(draft.fields[fieldName])
    if (userValue !== undefined) {
        return { value: userValue, source: 'user_input' }
    }

    const resolved = standardTask?.fields[fieldName]
    if (!resolved || resolved.source !== 'agent_inference') {
        return null
    }
    const value = normalizeFieldValue(resolved.value)
    if (value === undefined || value === 'auto') {
        return null
    }
    return { value, source: resolved.source }
}
