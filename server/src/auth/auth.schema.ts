import { z } from 'zod'

import { authConstraints } from './auth.constants'

/** Supabase 邮箱字段 */
export const authEmailSchema = z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(authConstraints.emailMaxLength)

const authCredentialsSchema = z.object({
    email: authEmailSchema,
    password: z
        .string()
        .min(authConstraints.passwordMinLength)
        .max(authConstraints.passwordMaxLength),
})

/** 登录接口入参校验 */
export const loginSchema = authCredentialsSchema

/** 注册接口入参校验 */
export const registerSchema = authCredentialsSchema

/** 已登录密码凭证账号修改密码的输入。 */
export const changePasswordSchema = z
    .object({
        currentPassword: z
            .string()
            .min(authConstraints.passwordMinLength)
            .max(authConstraints.passwordMaxLength),
        newPassword: z
            .string()
            .min(authConstraints.passwordMinLength)
            .max(authConstraints.passwordMaxLength),
        confirmPassword: z
            .string()
            .min(authConstraints.passwordMinLength)
            .max(authConstraints.passwordMaxLength),
    })
    .strict()
    .superRefine((value, context) => {
        if (value.newPassword !== value.confirmPassword) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['confirmPassword'],
                message: '两次输入的新密码不一致',
            })
        }
        if (value.newPassword === value.currentPassword) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['newPassword'],
                message: '新密码不能与当前密码相同',
            })
        }
    })

/** 注销接口的可选后台清理意图。 */
export const logoutSchema = z
    .object({
        cleanupCloudAssets: z.boolean().optional().default(false),
    })
    .catch({ cleanupCloudAssets: false })

/** 登录完成后的站内跳转路径 */
export const authRedirectSchema = z
    .string()
    .startsWith('/')
    .refine((value) => !value.startsWith('//') && !/[\\\u0000-\u001f\u007f]/.test(value))
    .default('/workspace')

/** Google OAuth 回调参数 */
export const oauthCallbackSchema = z.object({
    code: z.string().min(1).optional(),
    error: z.string().optional(),
})

/** Supabase 邮箱密码登录参数 */
export type LoginParam = z.infer<typeof loginSchema>

/** Supabase 邮箱密码注册参数 */
export type RegisterParam = z.infer<typeof registerSchema>
/** 修改密码输入类型。 */
export type ChangePasswordParam = z.infer<typeof changePasswordSchema>
