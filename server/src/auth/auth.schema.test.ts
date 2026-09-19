import { describe, expect, it } from 'vitest'
import { authRedirectSchema, changePasswordSchema, loginSchema } from './auth.schema'

describe('loginSchema', () => {
    it('normalizes an email login', () => {
        expect(
            loginSchema.parse({
                email: '  User@Example.com  ',
                password: 'password123',
            }),
        ).toEqual({
            email: 'user@example.com',
            password: 'password123',
        })
    })

    it.each(['tester', 'tester@invalid'])('rejects an invalid email %s', (email) => {
        expect(
            loginSchema.safeParse({
                email,
                password: 'password123',
            }).success,
        ).toBe(false)
    })

    it('rejects the removed username login payload', () => {
        expect(
            loginSchema.safeParse({
                identifier: 'tester',
                password: 'password123',
            }).success,
        ).toBe(false)
    })
})

describe('authRedirectSchema', () => {
    it.each(['https://example.com', '//example.com', '/\\example.com'])(
        'rejects external redirect %s',
        (redirect) => {
            expect(authRedirectSchema.safeParse(redirect).success).toBe(false)
        },
    )

    it('accepts an internal path with a query string', () => {
        expect(authRedirectSchema.parse('/workspace?tab=recent')).toBe('/workspace?tab=recent')
    })
})

describe('changePasswordSchema', () => {
    it('接受当前密码和一致的新密码', () => {
        expect(
            changePasswordSchema.parse({
                currentPassword: 'current123',
                newPassword: 'changed456',
                confirmPassword: 'changed456',
            }),
        ).toEqual({
            currentPassword: 'current123',
            newPassword: 'changed456',
            confirmPassword: 'changed456',
        })
    })

    it.each([
        ['new mismatch', 'changed456', 'changed789'],
        ['same password', 'current123', 'current123'],
    ])('拒绝 %s', (_name, newPassword, confirmPassword) => {
        expect(
            changePasswordSchema.safeParse({
                currentPassword: 'current123',
                newPassword,
                confirmPassword,
            }).success,
        ).toBe(false)
    })
})
