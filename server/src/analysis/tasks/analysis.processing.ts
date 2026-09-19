/** 分析用例唤醒调度与取消当前执行所需的运行时端口。 */
export interface AnalysisTaskProcessingControl {
    requestProcessing: () => void
    cancelRunning: (taskId: string) => boolean
}

const inactiveProcessingControl: AnalysisTaskProcessingControl = {
    /** 在未配置 Worker 时忽略队列处理请求 */
    requestProcessing() {},
    /** 在未配置 Worker 时返回任务未被取消 */
    cancelRunning() {
        return false
    },
}

let processingControl = inactiveProcessingControl

/**
 * 由应用组合入口绑定当前进程的执行器与 Worker。
 *
 * 返回的释放函数只会清理由本次绑定安装的实例，便于测试与优雅退出。
 */
export function bindAnalysisTaskProcessing(control: AnalysisTaskProcessingControl) {
    processingControl = control
    return () => {
        if (processingControl === control) {
            processingControl = inactiveProcessingControl
        }
    }
}

/** 新任务或人工操作完成后请求当前 Worker 检查队列。 */
export function requestAnalysisTaskProcessing() {
    processingControl.requestProcessing()
}

/** 把用户取消传播到当前进程内的执行器。 */
export function cancelRunningAnalysisTask(taskId: string) {
    return processingControl.cancelRunning(taskId)
}
