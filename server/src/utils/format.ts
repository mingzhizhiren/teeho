/** 按地区与币种格式化金额 */
export function formatCurrency(value: number | string, locale = 'zh-CN', currency = 'CNY') {
    const amount = typeof value === 'number' ? value : Number(value)

    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
    }).format(Number.isFinite(amount) ? amount : 0)
}
