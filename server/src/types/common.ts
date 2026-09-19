/** 后端统一响应结构 */
export interface ApiResult<T> {
    code: number
    message: string
    data: T
}

/** 统一响应结构别名 */
export type ApiResponse<T> = ApiResult<T>

/** 分页响应结构 */
export interface Pagination {
    page: number
    pageSize: number
    total: number
}
