import { expect, test, type Page } from '@playwright/test'

const account = {
    id: '10000000-0000-4000-8000-000000000001',
    email: 'community@example.test',
    canChangePassword: true,
}
const config = {
    version: 'analysis-task.v6',
    fields: [
        {
            name: 'track',
            kind: 'select',
            order: 1,
            labelKey: 'workspace.configFields.track',
            helpKey: '',
            defaultValue: 'custom',
            countsAsInput: false,
            options: [
                { value: 'custom', labelKey: 'workspace.trackSelector.custom', enabled: true },
            ],
        },
        {
            name: 'title',
            kind: 'text',
            order: 2,
            labelKey: 'workspace.configFields.title',
            helpKey: '',
            defaultValue: null,
            countsAsInput: true,
            validation: { maxLength: 200 },
        },
        {
            name: 'body',
            kind: 'textarea',
            order: 3,
            labelKey: 'workspace.configFields.body',
            helpKey: '',
            defaultValue: null,
            countsAsInput: true,
            validation: { maxLength: 1000 },
        },
        {
            name: 'topics',
            kind: 'tags',
            order: 4,
            labelKey: 'workspace.configFields.topics',
            helpKey: '',
            defaultValue: [],
            countsAsInput: true,
            validation: { maxItems: 25, itemMaxLength: 30 },
        },
    ],
    tracks: [
        {
            id: 'custom',
            code: 0,
            order: 1,
            labelKey: 'workspace.trackSelector.custom',
            keywords: [],
            custom: true,
        },
    ],
    trackDefaults: {},
    uploads: {
        allowedMediaTypes: ['image/jpeg', 'image/png', 'image/webp'],
        maxFiles: 18,
        maxFileBytes: 10485760,
        maxTotalBytes: 52428800,
        maxPixels: 40000000,
        retentionSeconds: 86400,
        maxImagesPerMinute: 20,
        videoEnabled: true,
        video: {
            allowedMediaTypes: ['video/mp4'],
            maxFileBytes: 104857600,
            maxUploadsPerMinute: 5,
        },
    },
    runtime: { mode: 'local', preparationRequestTimeoutMs: 10000 },
}

async function installCommunityApi(
    page: Page,
    initiallySignedIn = true,
): Promise<{ requests: string[] }> {
    page.on('pageerror', (error) => console.error(error.stack))
    let signedIn = initiallySignedIn
    const requests: string[] = []
    await page.route(
        (url) => url.pathname.startsWith('/api/'),
        async (route) => {
            const path = new URL(route.request().url()).pathname.replace(/^\/api/u, '')
            requests.push(path)
            const fulfill = (data: unknown, status = 200) =>
                route.fulfill({
                    status,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        code: status === 200 ? 0 : status,
                        message: status === 200 ? 'ok' : 'fixture unavailable',
                        data,
                    }),
                })
            if (path === '/auth/me')
                return fulfill(signedIn ? { user: account } : null, signedIn ? 200 : 401)
            if (path === '/auth/refresh') return fulfill(null, 401)
            if (path === '/auth/login' || path === '/auth/register') {
                signedIn = true
                return fulfill({ user: account, requiresEmailConfirmation: false })
            }
            if (path === '/analysis/task-config') return fulfill({ config })
            if (path === '/analysis/tasks') return fulfill({ tasks: [] })
            if (path === '/analysis/tasks/latest') return fulfill({ task: null })
            if (path === '/analysis/conversation/control') return fulfill({ control: null })
            if (path === '/notifications')
                return fulfill({ notifications: [], nextCursor: null, unreadCount: 0 })
            if (path === '/workspace/events/token')
                return fulfill({ token: 'synthetic-stream', expiresAt: '2099-01-01T00:00:00.000Z' })
            if (path === '/workspace/events')
                return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' })
            return fulfill(null, 404)
        },
    )
    return { requests }
}

test('workspace loads without commercial or telemetry requests', async ({ page }) => {
    const api = await installCommunityApi(page)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/workspace')
    await expect(page.getByTestId('mode-toggle')).toBeVisible()
    await expect(page.locator('#analysis-raw-text')).toBeVisible()
    await expect(page.getByTestId('account-trigger')).toBeVisible()
    await expect(page.getByTestId('account-membership')).toHaveCount(0)
    expect(api.requests).toContain('/analysis/task-config')
    expect(api.requests).toContain('/notifications')
    expect(
        api.requests.filter((path) =>
            /^\/(points|billing|refunds|admin|analytics)(\/|$)/u.test(path),
        ),
    ).toEqual([])
    expect(errors).toEqual([])
})

test('registration uses the same auth flow without official legal or paid UI', async ({
    page,
}) => {
    const api = await installCommunityApi(page, false)
    await page.goto('/register')
    await page.locator('#email').fill('community@example.test')
    await page.locator('#password').fill('synthetic-test-password-123')
    await page.locator('#confirm-password').fill('synthetic-test-password-123')
    await expect(page.locator('input[name="legal-agreement"]')).toHaveCount(0)
    await page.getByRole('button', { name: '注册新账号', exact: true }).click()
    await expect(page).toHaveURL(/\/workspace$/u)
    await expect(page.getByTestId('mode-toggle')).toBeVisible()
    expect(api.requests).toContain('/auth/register')
    expect(
        api.requests.filter((path) =>
            /^\/(points|billing|refunds|admin|analytics)(\/|$)/u.test(path),
        ),
    ).toEqual([])
})
