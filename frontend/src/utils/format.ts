/** 按当前语言格式化中等精度的日期时间 */
export function formatDateTime(value: string, locale: string) {
    return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(value))
}
