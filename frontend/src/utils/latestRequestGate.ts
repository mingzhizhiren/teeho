/**
 * 串行执行轮询请求，并让状态变更可以使旧响应失效。
 * 调用方必须在写操作开始和完成时各调用一次 `invalidate()`。
 */
export class LatestRequestGate {
    private version = 0
    private inFlight: Promise<void> | null = null

    /**
     * 提升请求版本，使此前启动的异步请求失去写入资格。
     */
    invalidate(): void {
        this.version += 1
    }

    /**
     * 在同一时刻只运行一个请求，并返回判断结果是否仍为最新的函数。
     * @param operation 需要通过最新请求门禁执行的异步操作
     */
    run(operation: (isCurrent: () => boolean) => Promise<void>): Promise<void> {
        if (this.inFlight) {
            return this.inFlight
        }

        const requestVersion = this.version
        /** 判断异步请求是否仍是最新版本 */
        const isCurrent = () => requestVersion === this.version
        const current = operation(isCurrent)
        const tracked = current.finally(() => {
            if (this.inFlight === tracked) {
                this.inFlight = null
            }
        })
        this.inFlight = tracked
        return this.inFlight
    }
}
