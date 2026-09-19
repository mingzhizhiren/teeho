import { z } from 'zod'

const environmentConstraints = {
    webSocketUrlMaxLength: 2_000,
    defaultPort: 9_634,
    databasePoolMaximum: 5,
    databaseIdleTimeoutSeconds: 20,
    databaseConnectTimeoutSeconds: 10,
    agentModelMaxLength: 200,
    agentTimeoutSeconds: 180,
    agentTimeoutMaximumSeconds: 600,
    codexCliPathMaxLength: 1_000,
    codexRemoteTokenMaxLength: 4_000,
    logFileRetentionDays: 14,
    sendWindowSeconds: 60,
    sendLimit: 10,
    sessionTokenBudget: 60_000,
    rollingWindowSeconds: 86_400,
    rollingTokenLimit: 1_000_000,
    imageMaximumEdgeLimit: 4_096,
    imageMaximumEdge: 2_048,
} as const

function createDatabaseUrlSchema(variableName: string) {
    return z
        .string()
        .url()
        .refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol), {
            message: `${variableName} must use the postgres or postgresql protocol`,
        })
}

const databaseUrlSchema = createDatabaseUrlSchema('DATABASE_DIRECT_URL')

const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])

const corsOriginSchema = z
    .string()
    .trim()
    .refine(
        (value) => {
            if (!value) {
                return true
            }
            try {
                const url = new URL(value)
                return ['http:', 'https:'].includes(url.protocol) && url.origin === value
            } catch {
                return false
            }
        },
        { message: 'CORS_ORIGIN must be an exact HTTP(S) origin or empty' },
    )

const optionalWebSocketUrlSchema = z
    .string()
    .trim()
    .max(environmentConstraints.webSocketUrlMaxLength)
    .refine(
        (value) => {
            if (!value) {
                return true
            }
            try {
                return ['ws:', 'wss:'].includes(new URL(value).protocol)
            } catch {
                return false
            }
        },
        { message: 'TEEHO_CODEX_REMOTE_URL must use the ws or wss protocol' },
    )

export const communityEnvironmentSchema = z.object({
    DEBUG: z
        .enum(['true', 'false'])
        .default('false')
        .transform((value) => value === 'true'),
    PORT: z.coerce.number().default(environmentConstraints.defaultPort),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    CORS_ORIGIN: corsOriginSchema.default('http://localhost:8080'),
    PUBLIC_API_URL: z.string().url().default('http://localhost:9634'),
    HTTPS_CERT_PATH: z.string().default(''),
    HTTPS_KEY_PATH: z.string().default(''),
    TEEHO_PWD: z
        .string()
        .refine((value) => value.trim().length > 0, {
            message: 'TEEHO_PWD is required',
        })
        .default('teeho'),
    SUPABASE_URL: z.string().url().default('http://127.0.0.1:54321'),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1).default('replace_with_local_anon_key'),
    SUPABASE_SECRET_KEY: z.string().trim().default(''),
    DATABASE_DIRECT_URL: databaseUrlSchema.default(
        'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    ),
    DATABASE_POOL_MAX: z.coerce
        .number()
        .int()
        .positive()
        .default(environmentConstraints.databasePoolMaximum),
    DATABASE_IDLE_TIMEOUT_SECONDS: z.coerce
        .number()
        .int()
        .nonnegative()
        .default(environmentConstraints.databaseIdleTimeoutSeconds),
    DATABASE_CONNECT_TIMEOUT_SECONDS: z.coerce
        .number()
        .int()
        .positive()
        .default(environmentConstraints.databaseConnectTimeoutSeconds),
    TEEHO_DEPLOYMENT_MODE: z.enum(['cloud', 'local']).default('local'),
    TEEHO_AGENT_PROVIDER: z.enum(['mock', 'codex-cli', 'openai', 'gemini']).default('mock'),
    TEEHO_AGENT_MODEL: z
        .string()
        .trim()
        .max(environmentConstraints.agentModelMaxLength)
        .default(''),
    TEEHO_TASK_FORMATION_AGENT_MODEL: z
        .string()
        .trim()
        .max(environmentConstraints.agentModelMaxLength)
        .default(''),
    TEEHO_AGENT_TIMEOUT_SECONDS: z.coerce
        .number()
        .int()
        .positive()
        .max(environmentConstraints.agentTimeoutMaximumSeconds)
        .default(environmentConstraints.agentTimeoutSeconds),
    TEEHO_AGENT_MAX_CONCURRENCY: z.coerce.number().int().positive().default(1),
    TEEHO_CODEX_MODE: z.enum(['local', 'remote']).default('local'),
    TEEHO_CODEX_CLI_PATH: z
        .string()
        .trim()
        .min(1)
        .max(environmentConstraints.codexCliPathMaxLength)
        .default('codex'),
    TEEHO_CODEX_REMOTE_URL: optionalWebSocketUrlSchema.default(''),
    TEEHO_CODEX_REMOTE_TOKEN: z
        .string()
        .trim()
        .max(environmentConstraints.codexRemoteTokenMaxLength)
        .default(''),
    TEEHO_PLUGIN_CONFIG: z.string().trim().min(1).default('../plugins/example/config.ts'),
    TEEHO_INSIGHT_ENABLED: z
        .enum(['true', 'false'])
        .default('false')
        .transform((value) => value === 'true'),
    OPENAI_API_KEY: z.string().trim().default(''),
    GEMINI_API_KEY: z.string().trim().default(''),
    TEEHO_AGENT_SEND_WINDOW_SECONDS: z.coerce
        .number()
        .int()
        .positive()
        .default(environmentConstraints.sendWindowSeconds),
    TEEHO_AGENT_SEND_LIMIT: z.coerce
        .number()
        .int()
        .positive()
        .default(environmentConstraints.sendLimit),
    TEEHO_AGENT_SESSION_TOKEN_BUDGET: z.coerce
        .number()
        .int()
        .positive()
        .default(environmentConstraints.sessionTokenBudget),
    TEEHO_AGENT_ROLLING_WINDOW_SECONDS: z.coerce
        .number()
        .int()
        .positive()
        .default(environmentConstraints.rollingWindowSeconds),
    TEEHO_AGENT_ROLLING_TOKEN_LIMIT: z.coerce
        .number()
        .int()
        .positive()
        .default(environmentConstraints.rollingTokenLimit),
    TEEHO_AGENT_IMAGE_MAXIMUM_EDGE: z.coerce
        .number()
        .int()
        .positive()
        .max(environmentConstraints.imageMaximumEdgeLimit)
        .default(environmentConstraints.imageMaximumEdge),
    VIDEO_ENABLED: z
        .enum(['true', 'false'])
        .default('true')
        .transform((value) => value === 'true'),
    LOG_LEVEL: logLevelSchema.default('info'),
    // 日志目录；为空时调试构建输出精简文本，发布构建输出结构化 JSON
    LOG_FILE_DIR: z.string().default(''),
    // 每日滚动日志的历史文件保留数量
    LOG_FILE_RETENTION_DAYS: z.coerce
        .number()
        .int()
        .positive()
        .default(environmentConstraints.logFileRetentionDays),
})
const envSchema = communityEnvironmentSchema.superRefine((environment, context) => {
    if (environment.TEEHO_AGENT_PROVIDER === 'mock') {
        if (environment.TEEHO_AGENT_MODEL || environment.TEEHO_TASK_FORMATION_AGENT_MODEL) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: [
                    environment.TEEHO_AGENT_MODEL
                        ? 'TEEHO_AGENT_MODEL'
                        : 'TEEHO_TASK_FORMATION_AGENT_MODEL',
                ],
                message: 'Agent models must be empty when TEEHO_AGENT_PROVIDER is mock',
            })
        }
        return
    }

    if (!environment.TEEHO_AGENT_MODEL) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['TEEHO_AGENT_MODEL'],
            message: 'TEEHO_AGENT_MODEL is required for real Agent Providers',
        })
    }
    if (environment.TEEHO_AGENT_PROVIDER === 'openai' && !environment.OPENAI_API_KEY) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['OPENAI_API_KEY'],
            message: 'OPENAI_API_KEY is required when TEEHO_AGENT_PROVIDER is openai',
        })
    }
    if (environment.TEEHO_AGENT_PROVIDER === 'gemini' && !environment.GEMINI_API_KEY) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['GEMINI_API_KEY'],
            message: 'GEMINI_API_KEY is required when TEEHO_AGENT_PROVIDER is gemini',
        })
    }
    if (
        environment.TEEHO_AGENT_PROVIDER === 'codex-cli' &&
        environment.TEEHO_CODEX_MODE === 'remote'
    ) {
        if (!environment.TEEHO_CODEX_REMOTE_URL) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['TEEHO_CODEX_REMOTE_URL'],
                message: 'TEEHO_CODEX_REMOTE_URL is required when TEEHO_CODEX_MODE is remote',
            })
        }
        if (!environment.TEEHO_CODEX_REMOTE_TOKEN) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['TEEHO_CODEX_REMOTE_TOKEN'],
                message: 'TEEHO_CODEX_REMOTE_TOKEN is required when TEEHO_CODEX_MODE is remote',
            })
        }
    }
})

/** 后端进程环境变量的已校验类型 */
export type Environment = z.infer<typeof envSchema>

/** 校验一份隔离的进程环境，供启动和配置测试复用 */
export function parseEnvironment(input: unknown): Environment {
    return envSchema.parse(input)
}

/** 经 Zod 校验后的进程环境变量，供全局读取 */
export const env = parseEnvironment(process.env)
