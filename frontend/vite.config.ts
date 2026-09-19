import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'
import { createSkillDocumentPlugin } from './scripts/skill-document'

/** 社区构建仅解析当前公开仓库，API 地址由部署环境提供。 */
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    const target = env.API_PROXY_TARGET || 'http://127.0.0.1:9634'
    return {
        plugins: [createSkillDocumentPlugin(), vue()],
        resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
        server: {
            host: '127.0.0.1',
            port: Number(env.VITE_FRONTEND_PORT) || 8080,
            proxy: { '/api': { target, changeOrigin: true } },
        },
    }
})
