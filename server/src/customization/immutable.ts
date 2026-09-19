/** JSON领域数据的递归只读类型，保留数组元素类型。 */
export type ReadonlyData<T> = T extends object ? { readonly [K in keyof T]: ReadonlyData<T[K]> } : T

/** 只冻结已校验的JSON输入与结果；不冻结schema、AbortSignal等运行时对象。 */
export function freezeData<T>(value: T): T {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freezeData(child)
        Object.freeze(value)
    }
    return value
}
