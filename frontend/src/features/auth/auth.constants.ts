/** 与后端认证边界保持一致的浏览器输入约束。 */
export const authInputConstraints = {
    emailMaxLength: 254,
    passwordMinLength: 8,
    passwordMaxLength: 128,
} as const
