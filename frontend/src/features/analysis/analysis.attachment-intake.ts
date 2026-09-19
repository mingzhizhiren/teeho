import { selectNewDraftImageFiles } from './analysis.media-upload'
import {
    validateBrowserVideoSelection,
    type BrowserVideoSelectionError,
} from './analysis.video-upload'

/** 图片入口共用的容量约束。 */
export interface ImageIntakeLimits {
    allowedMediaTypes: readonly string[]
    maxFiles: number
    maxFileBytes: number
    maxTotalBytes: number
}

/** 按文件顺序接收合法附件，跳过超限或不支持的文件。 */
export function selectImageAttachments(
    existing: File[],
    incoming: File[],
    limits: ImageIntakeLimits,
): { files: File[]; error: string | null } {
    const initial = {
        files: [] as File[],
        bytes: existing.reduce((total, file) => total + file.size, 0),
        error: null as string | null,
    }
    const result = selectNewDraftImageFiles(existing, incoming).reduce((state, file) => {
        const error = !limits.allowedMediaTypes.includes(file.type)
            ? 'invalidType'
            : file.size <= 0 || file.size > limits.maxFileBytes
              ? 'fileTooLarge'
              : existing.length + state.files.length >= limits.maxFiles
                ? 'tooMany'
                : state.bytes + file.size > limits.maxTotalBytes
                  ? 'batchTooLarge'
                  : null
        if (error) return { ...state, error: state.error ?? error }
        return { ...state, files: [...state.files, file], bytes: state.bytes + file.size }
    }, initial)
    return { files: result.files, error: result.error }
}

/** 从实际文件载荷读取附件；不把链接或 HTML 当作本地文件。 */
export function readTransferredFiles(data: DataTransfer | null): File[] {
    if (!data) return []
    const files = Array.from(data.files)
    if (files.length) return files
    return Array.from(data.items).flatMap((item) => {
        const file = item.kind === 'file' ? item.getAsFile() : null
        return file ? [file] : []
    })
}

/** 单视频槽位只接收首个合法文件；显式文件选择保留替换能力。 */
export function selectVideoAttachment(
    selected: File[],
    occupied: boolean,
    allowReplace: boolean,
    limits: Parameters<typeof validateBrowserVideoSelection>[1],
): { file: File | null; error: BrowserVideoSelectionError | null; skipped: boolean } {
    if (occupied && !allowReplace) {
        return { file: null, error: 'video_select_one', skipped: false }
    }
    const candidates = allowReplace
        ? selected
        : selected
              .filter((file) => validateBrowserVideoSelection([file], limits) === null)
              .slice(0, 1)
    const error = validateBrowserVideoSelection(candidates.length ? candidates : selected, limits)
    return {
        file: error ? null : (candidates[0] ?? null),
        error,
        skipped: !allowReplace && selected.length > candidates.length,
    }
}
