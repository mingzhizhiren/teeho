/** 只携带宿主校验过的能力身份和安全错误类别。 */
export class PluginError extends Error {
    constructor(
        readonly capability: string,
        readonly category: string,
    ) {
        super(`Plugin ${capability}: ${category}`)
        this.name = 'PluginError'
    }
}
