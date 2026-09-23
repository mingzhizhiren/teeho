import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migrationDirectory = new URL('../migrations/', import.meta.url)

export const communityMigrations = readdirSync(migrationDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(new URL(name, migrationDirectory), 'utf8') }))

// 平台替身仅验证业务 DDL、权限和 SQL；不模拟 Auth、Storage HTTP 或扩展调度执行。
const platformFixture = `
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (
        id text PRIMARY KEY, name text, public boolean,
        file_size_limit bigint, allowed_mime_types text[]
    );
    CREATE SCHEMA cron;
    CREATE TABLE cron.job (
        jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        jobname text UNIQUE, schedule text, command text,
        active boolean DEFAULT true
    );
    CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE sql AS $$
        INSERT INTO cron.job(jobname, schedule, command) VALUES ($1, $2, $3)
        ON CONFLICT(jobname) DO UPDATE SET schedule=$2, command=$3 RETURNING jobid
    $$;
    CREATE SCHEMA vault;
    CREATE TABLE vault.decrypted_secrets (name text PRIMARY KEY, decrypted_secret text);
    CREATE SCHEMA net;
    CREATE TABLE net.test_requests (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        url text, headers jsonb, body jsonb, timeout_milliseconds integer
    );
    CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer)
        RETURNS bigint LANGUAGE sql AS $$
        INSERT INTO net.test_requests(url, headers, body, timeout_milliseconds)
        VALUES ($1, $2, $3, $4) RETURNING id
    $$;
`

/** 在内存 PostgreSQL 中执行全部数据库迁移；不读取连接配置、不接触远端。 */
export async function createCommunityDatabase(): Promise<PGlite> {
    const database = new PGlite()
    try {
        await database.exec(platformFixture)
        for (const migration of communityMigrations) {
            await database.exec(migration.sql.replace(/^CREATE EXTENSION[^;]+;\r?\n/gmu, ''))
        }
        return database
    } catch (error: unknown) {
        await database.close()
        throw error
    }
}
