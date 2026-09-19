import { ref } from 'vue'
import { readTransferredFiles } from './analysis.attachment-intake'

interface AttachmentTransferOptions {
    isLocked: () => boolean
    isVideo: () => boolean
    addImages: (files: File[]) => Promise<void>
    addVideo: (files: File[]) => Promise<void>
    onError: () => void
}

/** 浏览器事件适配，与聊天框布局和上传实现无关。 */
export function useAttachmentTransfer(options: AttachmentTransferOptions): {
    isDragging: ReturnType<typeof ref<boolean>>
    onPaste: (event: ClipboardEvent) => void
    onDragOver: (event: DragEvent) => void
    onDragLeave: (event: DragEvent) => void
    onDrop: (event: DragEvent) => void
} {
    const isDragging = ref(false)
    async function accept(files: File[]): Promise<void> {
        if (options.isLocked()) return
        const videos = options.isVideo()
            ? files.filter((file) => file.type.startsWith('video/'))
            : []
        const images = files.filter((file) => !videos.includes(file))
        try {
            await Promise.all([
                images.length ? options.addImages(images) : Promise.resolve(),
                videos.length ? options.addVideo(videos) : Promise.resolve(),
            ])
        } catch {
            options.onError()
        }
    }
    function onPaste(event: ClipboardEvent): void {
        const files = readTransferredFiles(event.clipboardData)
        if (!files.length) return
        // 混合剪贴板保留浏览器的文字粘贴行为。
        if (!event.clipboardData?.getData('text/plain')) event.preventDefault()
        void accept(files)
    }
    function onDragOver(event: DragEvent): void {
        if (!event.dataTransfer?.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = options.isLocked() ? 'none' : 'copy'
        isDragging.value = !options.isLocked()
    }
    function onDragLeave(event: DragEvent): void {
        const host = event.currentTarget as HTMLElement
        if (event.relatedTarget instanceof Node && host.contains(event.relatedTarget)) return
        isDragging.value = false
    }
    function onDrop(event: DragEvent): void {
        isDragging.value = false
        const files = readTransferredFiles(event.dataTransfer)
        if (!files.length && !event.dataTransfer?.types.includes('Files')) return
        event.preventDefault()
        void accept(files)
    }
    return { isDragging, onPaste, onDragOver, onDragLeave, onDrop }
}
