import { logger } from '../../utils/logger'
import { analysisMediaConstraints } from '../analysis.constants'
import { AnalysisImageValidationError, processAnalysisImage } from './analysis.media'
import {
    claimNextMediaAsset,
    markMediaAssetFailed,
    markMediaAssetReady,
    type AnalysisMediaAssetRecord,
} from './analysis.media.repository'
import { supabaseAnalysisObjectStorage, type AnalysisObjectStorage } from './analysis.storage'

interface AnalysisMediaWorkerOptions {
    storage?: AnalysisObjectStorage
    claimNext?: () => Promise<AnalysisMediaAssetRecord | null>
    markReady?: typeof markMediaAssetReady
    markFailed?: typeof markMediaAssetFailed
    pollIntervalMs?: number
    log?: Pick<typeof logger, 'info' | 'warn'>
}

function processedObjectPath(asset: AnalysisMediaAssetRecord, mediaType: string) {
    const extension =
        mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/png' ? 'png' : 'webp'
    const base = asset.originalObjectPath.replace(/\/original\/[^/]+$/u, '/processed')
    return `${base}/${asset.id}.${extension}`
}

/** Durable PostgreSQL queue consumer for validating and deriving private analysis images. */
export class AnalysisMediaWorker {
    private readonly storage: AnalysisObjectStorage
    private readonly claimNext: () => Promise<AnalysisMediaAssetRecord | null>
    private readonly markReady: typeof markMediaAssetReady
    private readonly markFailed: typeof markMediaAssetFailed
    private readonly pollIntervalMs: number
    private readonly log: Pick<typeof logger, 'info' | 'warn'>
    private timer: ReturnType<typeof setInterval> | undefined
    private running = false
    private claimFailureLogged = false

    constructor(options: AnalysisMediaWorkerOptions = {}) {
        this.storage = options.storage ?? supabaseAnalysisObjectStorage
        this.claimNext =
            options.claimNext ??
            (() => claimNextMediaAsset(analysisMediaConstraints.processingLeaseSeconds))
        this.markReady = options.markReady ?? markMediaAssetReady
        this.markFailed = options.markFailed ?? markMediaAssetFailed
        this.pollIntervalMs =
            options.pollIntervalMs ?? analysisMediaConstraints.processingPollIntervalMs
        this.log = options.log ?? logger
    }

    start() {
        if (this.timer) {
            return
        }
        this.timer = setInterval(() => void this.wake(), this.pollIntervalMs)
        void this.wake()
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = undefined
        }
    }

    /** 暴露只读生命周期快照，供维护恢复健康矩阵判断待命状态。 */
    readReadiness(): { readonly started: boolean; readonly busy: boolean } {
        return { started: Boolean(this.timer), busy: this.running }
    }

    wake() {
        if (this.running) {
            return
        }
        this.running = true
        void this.runOnce().finally(() => {
            this.running = false
        })
    }

    /** 领取并处理一张图片；无待处理记录时返回 false。 */
    async runOnce() {
        const startedAt = performance.now()
        let asset: AnalysisMediaAssetRecord | null
        try {
            asset = await this.claimNext()
            if (this.claimFailureLogged) {
                this.log.info({ event: 'analysis_media_claim_recovered' }, '分析图片队列领取已恢复')
                this.claimFailureLogged = false
            }
        } catch (error) {
            if (!this.claimFailureLogged) {
                this.claimFailureLogged = true
                this.log.warn(
                    {
                        event: 'analysis_media_claim_failed',
                        errorCode: 'analysis_media_claim_failed',
                        err: error,
                    },
                    '领取待处理分析图片失败，将在下一轮重试',
                )
            }
            return false
        }
        if (!asset) {
            return false
        }
        try {
            const original = await this.storage.download(asset.originalObjectPath)
            if (original.byteLength !== asset.declaredByteSize) {
                throw new AnalysisImageValidationError(
                    'image_decode_failed',
                    '图片大小与上传申请不一致',
                )
            }
            const processed = await processAnalysisImage(original, {
                fileName: asset.fileName,
                declaredMediaType: asset.declaredMediaType,
            })
            const derivedPath = processedObjectPath(asset, processed.mediaType)
            await this.storage.upload(derivedPath, processed.content, processed.mediaType)
            const committed = await this.markReady(asset.id, derivedPath, processed)
            if (!committed) {
                await this.storage.remove([derivedPath])
                this.log.info(
                    {
                        event: 'analysis_media_processed_object_discarded',
                        assetId: asset.id,
                    },
                    '分析图片已被作废，派生对象已删除',
                )
                return true
            }
            this.log.info(
                {
                    event: 'analysis_media_processed',
                    assetId: asset.id,
                    attemptNumber: asset.processingAttemptCount,
                    mediaType: processed.mediaType,
                    byteSize: processed.byteSize,
                    width: processed.width,
                    height: processed.height,
                    durationMs: Math.round(performance.now() - startedAt),
                },
                '分析图片处理完成',
            )
        } catch (error) {
            const failureCode =
                error instanceof AnalysisImageValidationError
                    ? error.code
                    : 'image_processing_failed'
            try {
                await this.markFailed(asset.id, failureCode)
            } catch (persistenceError) {
                this.log.warn(
                    {
                        assetId: asset.id,
                        event: 'analysis_media_failure_state_write_failed',
                        failureCode,
                        errorCode: 'analysis_media_failure_state_write_failed',
                        errorName:
                            persistenceError instanceof Error
                                ? persistenceError.name
                                : 'UnknownError',
                    },
                    '分析图片失败状态写入失败，将由处理租约回收',
                )
            }
            this.log.warn(
                {
                    assetId: asset.id,
                    event: 'analysis_media_processing_failed',
                    failureCode,
                    errorName: error instanceof Error ? error.name : 'UnknownError',
                },
                '分析图片处理失败',
            )
        }
        return true
    }
}
