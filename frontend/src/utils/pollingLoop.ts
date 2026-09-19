/** 可启动和停止的串行轮询。 */
export interface PollingLoop {
    start(): void
    stop(): void
}

/**
 * 创建不会重叠执行的递归轮询；操作自身负责把错误转换成界面状态。
 */
export function createPollingLoop(intervalMs: number, operation: () => Promise<void>): PollingLoop {
    let stopped = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight = false

    /** 安排下一次非重叠轮询 */
    const schedule = (): void => {
        if (stopped || timer || inFlight) {
            return
        }
        timer = setTimeout(() => {
            timer = undefined
            if (stopped) {
                return
            }
            inFlight = true
            void Promise.resolve()
                .then(operation)
                .then(
                    () => {
                        inFlight = false
                        schedule()
                    },
                    () => {
                        inFlight = false
                        schedule()
                    },
                )
        }, intervalMs)
    }

    return {
        /**
         * 启动非重叠轮询；重复调用不会创建额外计时器。
         */
        start(): void {
            if (!stopped) {
                return
            }
            stopped = false
            schedule()
        },
        /**
         * 停止后续轮询调度，但不会强制中断正在执行的操作。
         */
        stop(): void {
            stopped = true
            if (timer) {
                clearTimeout(timer)
                timer = undefined
            }
        },
    }
}
