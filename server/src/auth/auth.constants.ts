/** 认证输入和会话字段约束。 */
export const authConstraints = {
    emailMaxLength: 254,
    passwordMinLength: 8,
    passwordMaxLength: 128,
} as const
