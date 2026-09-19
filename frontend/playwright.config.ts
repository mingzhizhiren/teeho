import { defineConfig } from '@playwright/test'

export default defineConfig({
    testDir: './tests/browser',
    testMatch: '**/*.e2e.ts',
    timeout: 45_000,
    workers: 1,
    use: { baseURL: 'http://127.0.0.1:4186', viewport: { width: 1280, height: 900 } },
    webServer: {
        command: 'bun run dev --port 4186 --strictPort',
        url: 'http://127.0.0.1:4186',
        reuseExistingServer: process.env.TEEHO_REUSE_DEV_SERVER === '1',
        env: { VITE_API_BASE_URL: '/api', VITE_TEEHO_PWD: 'teeho-community-browser-fixture' },
    },
})
