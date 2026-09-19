import { inject, type InjectionKey } from 'vue'

import type { GuideRunResult, GuideStartIntent } from './productGuide.types'

/** Vue 组件可注入的产品引导业务 interface。 */
export interface ProductGuideContext {
    startGuide(
        guideId: string,
        options?: { intent?: GuideStartIntent },
    ): Promise<GuideRunResult>
}

/** 产品引导模块的类型安全注入键。 */
export const productGuideKey: InjectionKey<ProductGuideContext> = Symbol('product-guide')

/** 取得产品引导的唯一业务 interface。 */
export function useProductGuide(): ProductGuideContext {
    const context = inject(productGuideKey)
    if (!context) throw new Error('产品引导模块尚未装配')
    return context
}
