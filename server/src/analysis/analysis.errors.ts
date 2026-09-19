/** 仅记录数量和筛选条件，不包含笔记正文或用户身份。 */
export interface AnalysisReferenceSelectionDiagnostics {
    readonly candidateCount: number
    readonly selectedCount: number
    readonly similarityPolicy: 'ranking'
    readonly trackCode: number
    readonly sourceVersion: string
    readonly cutoff: string
}

/** 参考数据不足是预期的任务失败，不是 Provider 或服务器故障。 */
export class AnalysisReferenceUnavailableError extends Error {
    constructor(readonly selection: AnalysisReferenceSelectionDiagnostics) {
        super('本次没有找到有效参考笔记，未扣费。')
        this.name = 'AnalysisReferenceUnavailableError'
    }
}

/** 分析队列已达到账号容量上限 */
export class AnalysisQueueCapacityError extends Error {
    readonly reason = 'analysis_queue_capacity'

    /**
     * 创建队列容量超限异常。
     * @param message 可安全返回给调用方的错误描述
     */
    constructor(message = '当前已有分析任务，请等待任务完成或取消任务后再提交') {
        super(message)
        this.name = 'AnalysisQueueCapacityError'
    }
}

/** 账户退款审核期间不能创建会继续消耗积分的新任务。 */
export class AnalysisRefundInProgressError extends Error {
    readonly reason = 'analysis_refund_in_progress'

    constructor(message = '退款申请处理中，暂不能创建或重新分析任务') {
        super(message)
        this.name = 'AnalysisRefundInProgressError'
    }
}

/** 账号积分无法完整预留，任务不得受理。 */
export class AnalysisInsufficientPointsError extends Error {
    readonly reason = 'insufficient_points'

    constructor(readonly pointCost: number) {
        super(`当前积分不足，本任务需要 ${pointCost} 积分`)
        this.name = 'AnalysisInsufficientPointsError'
    }
}

/** 当前订阅档位不包含任务所需的受限分析能力。 */
export class AnalysisCapabilityRequiredError extends Error {
    readonly reason = 'analysis_capability_required'

    constructor(message = '当前套餐不支持视频分析，请先开通 Coffee 或 Plus') {
        super(message)
        this.name = 'AnalysisCapabilityRequiredError'
    }
}

/** 任务当前状态不允许执行请求的生命周期操作 */
export class AnalysisTaskStateError extends Error {
    readonly reason = 'analysis_task_state'

    /**
     * 创建任务状态不允许当前操作的异常。
     * @param message 当前状态与请求操作冲突的说明
     */
    constructor(message: string) {
        super(message)
        this.name = 'AnalysisTaskStateError'
    }
}

/** 图片临时素材已经过期或不完整 */
export class AnalysisAssetExpiredError extends Error {
    /**
     * 创建分析图片素材失效异常。
     * @param message 可安全返回给调用方的错误描述
     */
    constructor(
        message = '任务图片素材已过期，请重新提交任务',
        readonly reason = 'analysis_asset_expired',
    ) {
        super(message)
        this.name = 'AnalysisAssetExpiredError'
    }
}

/** 视频证据未就绪、版本不受支持、越权或已超过临时保留期。 */
export class AnalysisVideoEvidenceExpiredError extends AnalysisAssetExpiredError {
    constructor(message = '视频证据不可用，请重新上传视频') {
        super(message, 'analysis_video_evidence_expired')
        this.name = 'AnalysisVideoEvidenceExpiredError'
    }
}

/** worker 租约已经被其他实例回收，迟到结果不得再改变任务 */
export class AnalysisTaskLeaseLostError extends Error {
    readonly reason = 'analysis_task_lease_lost'

    /** 创建任务处理租约已失效的异常。 */
    constructor() {
        super('分析任务租约已失效')
        this.name = 'AnalysisTaskLeaseLostError'
    }
}

/** 图片上传频率超过账号级安全阈值 */
export class AnalysisUploadRateError extends Error {
    readonly reason = 'analysis_upload_rate'

    /**
     * 创建图片上传频率超限异常。
     * @param message 可安全返回给调用方的错误描述
     */
    constructor(message = '图片上传过于频繁，请稍后再试') {
        super(message)
        this.name = 'AnalysisUploadRateError'
    }
}

/** 同一个幂等提交标识不得绑定到不同的有效输入。 */
export class AnalysisSubmissionConflictError extends Error {
    readonly reason = 'analysis_submission_conflict'

    /**
     * 创建幂等提交标识与有效输入冲突的异常。
     * @param message 可安全返回给调用方的错误描述
     */
    constructor(message = '提交状态冲突，请刷新后重试') {
        super(message)
        this.name = 'AnalysisSubmissionConflictError'
    }
}

/** 草稿发送达到账号固定窗口上限。 */
export class AnalysisPreparationRateError extends Error {
    readonly reason = 'analysis_preparation_rate'

    /**
     * 创建草稿发送窗口超限异常。
     * @param retryAfterSeconds 距离窗口重置的向上取整秒数
     * @param retryAt 服务端计算的窗口重置时间
     * @param message 可安全返回给调用方的错误描述
     */
    constructor(
        readonly retryAfterSeconds: number,
        readonly retryAt: string,
        message = '草稿发送次数已达上限，请稍后再试',
    ) {
        super(message)
        this.name = 'AnalysisPreparationRateError'
    }
}

/** 账号滚动二十四小时任务形成用量达到档位安全上限。 */
export class AnalysisRollingUsageExhaustedError extends Error {
    readonly reason = 'rolling_agent_usage'

    constructor(
        readonly retryAfterSeconds: number,
        readonly retryAt: string,
        readonly canUpgrade: boolean,
        message = '今日 Agent 使用较多，请稍后再试',
    ) {
        super(message)
        this.name = 'AnalysisRollingUsageExhaustedError'
    }
}
