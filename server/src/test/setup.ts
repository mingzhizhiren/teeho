Object.assign(process.env, {
    DEBUG: 'false',
    NODE_ENV: 'test',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
    DATABASE_DIRECT_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    TEEHO_DEPLOYMENT_MODE: 'local',
    TEEHO_AGENT_PROVIDER: 'mock',
    TEEHO_INSIGHT_ENABLED: 'false',
    TEEHO_AGENT_MODEL: '',
    TEEHO_PWD: 'test-only-secret',
})
