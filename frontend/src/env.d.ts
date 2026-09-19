/// <reference types="vite/client" />

/** 构建时注入、在浏览器中通过 `import.meta.env` 读取的变量（以 `VITE_` 为前缀） */
interface ImportMetaEnv {
    /** 后端 REST 基地址，含 `/api` 路径段 */
    readonly VITE_API_BASE_URL: string

    /** 本地开发时前端服务端口（数字字符串，供 Vite 等读取） */
    readonly VITE_FRONTEND_PORT: string

    /** 站点展示用名称 */
    readonly VITE_APP_NAME: string

    /** 浏览器端用户数据加密种子；公开配置，不属于服务端密钥 */
    readonly VITE_TEEHO_PWD: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
