-- 题火短期数据清理；扩展由 Supabase PostgreSQL 提供，不导入对象或密钥。

CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE SCHEMA teeho_internal;

REVOKE ALL ON SCHEMA teeho_internal FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.claim_analysis_media_cleanup(p_batch_size integer DEFAULT 100, p_lease_seconds integer DEFAULT 120) RETURNS TABLE(id uuid, original_object_path text, processed_object_path text)
    LANGUAGE sql SECURITY INVOKER
    SET search_path TO ''
    AS $$
    WITH candidate AS (
        SELECT asset.id
        FROM public.analysis_assets AS asset
        LEFT JOIN public.analysis_tasks AS task ON task.id = asset.task_id
        WHERE asset.cleanup_attempt_count < 5
            AND (
                asset.cleanup_next_attempt_at IS NULL
                OR asset.cleanup_next_attempt_at <= now()
            )
            AND (
                asset.task_id IS NULL
                OR task.status IN (
                    'succeeded',
                    'technical_failed',
                    'abandoned',
                    'cancelled'
                )
            )
            AND (
                (
                    asset.state = 'deleting'
                    AND asset.deletion_started_at
                        <= now() - make_interval(secs => GREATEST(p_lease_seconds, 1))
                )
                OR (
                    asset.state IN (
                        'awaiting_upload',
                        'uploaded',
                        'processing',
                        'ready',
                        'failed',
                        'expired',
                        'cleanup_failed'
                    )
                    AND (
                        asset.expires_at <= now()
                        OR asset.cleanup_requested_at IS NOT NULL
                    )
                )
            )
        ORDER BY
            COALESCE(
                asset.cleanup_next_attempt_at,
                asset.cleanup_requested_at,
                asset.expires_at
            ),
            asset.id
        LIMIT LEAST(GREATEST(p_batch_size, 1), 500)
        FOR UPDATE OF asset SKIP LOCKED
    ),
    claimed AS (
        UPDATE public.analysis_assets AS asset
        SET
            state = 'deleting',
            deletion_started_at = now(),
            cleanup_attempt_count = asset.cleanup_attempt_count + 1,
            cleanup_next_attempt_at = NULL,
            cleanup_last_error_code = NULL
        FROM candidate
        WHERE asset.id = candidate.id
        RETURNING
            asset.id,
            asset.original_object_path,
            asset.processed_object_path
    )
    SELECT
        claimed.id,
        claimed.original_object_path,
        claimed.processed_object_path
    FROM claimed;
$$;


CREATE PROCEDURE public.cleanup_expired_analysis_data(IN p_batch_size integer DEFAULT 100, IN p_max_batches integer DEFAULT 20)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_deleted integer;
    v_batch integer;
BEGIN
    IF p_batch_size NOT BETWEEN 1 AND 5000 THEN
        RAISE EXCEPTION 'p_batch_size must be between 1 and 5000';
    END IF;
    IF p_max_batches NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'p_max_batches must be between 1 and 100';
    END IF;

    FOR v_batch IN 1..p_max_batches LOOP
        WITH candidates AS (
            SELECT asset.id
            FROM public.analysis_assets AS asset
            WHERE asset.state = 'deleted'
                AND asset.deleted_at <= now() - interval '1 hour'
            ORDER BY asset.deleted_at, asset.id
            LIMIT p_batch_size
            FOR UPDATE OF asset SKIP LOCKED
        )
        DELETE FROM public.analysis_assets AS asset
        USING candidates
        WHERE asset.id = candidates.id;

        GET DIAGNOSTICS v_deleted = ROW_COUNT;
        COMMIT AND CHAIN;
        EXIT WHEN v_deleted < p_batch_size;
    END LOOP;

    FOR v_batch IN 1..p_max_batches LOOP
        WITH candidates AS (
            SELECT session.id
            FROM public.analysis_media_upload_sessions AS session
            WHERE session.expires_at <= now()
                AND NOT EXISTS (
                    SELECT 1
                    FROM public.analysis_assets AS asset
                    WHERE asset.upload_session_id = session.id
                )
            ORDER BY session.expires_at, session.id
            LIMIT p_batch_size
            FOR UPDATE OF session SKIP LOCKED
        )
        DELETE FROM public.analysis_media_upload_sessions AS session
        USING candidates
        WHERE session.id = candidates.id;

        GET DIAGNOSTICS v_deleted = ROW_COUNT;
        COMMIT AND CHAIN;
        EXIT WHEN v_deleted < p_batch_size;
    END LOOP;

    FOR v_batch IN 1..p_max_batches LOOP
        WITH candidates AS (
            SELECT result.task_id, result.result_version
            FROM public.analysis_results AS result
            INNER JOIN public.analysis_tasks AS task
                ON task.id = result.task_id
                AND task.user_id = result.user_id
            WHERE result.created_at <= now() - interval '24 hours'
                AND task.status IN (
                    'succeeded',
                    'technical_failed',
                    'abandoned',
                    'cancelled'
                )
            ORDER BY result.created_at, result.task_id, result.result_version
            LIMIT p_batch_size
            FOR UPDATE OF result SKIP LOCKED
        )
        DELETE FROM public.analysis_results AS result
        USING candidates
        WHERE result.task_id = candidates.task_id
            AND result.result_version = candidates.result_version;

        GET DIAGNOSTICS v_deleted = ROW_COUNT;
        COMMIT AND CHAIN;
        EXIT WHEN v_deleted < p_batch_size;
    END LOOP;

    FOR v_batch IN 1..p_max_batches LOOP
        WITH candidates AS (
            SELECT task.id
            FROM public.analysis_tasks AS task
            WHERE task.completed_at <= now() - interval '24 hours'
                AND task.status IN (
                    'succeeded',
                    'technical_failed',
                    'abandoned',
                    'cancelled'
                )
                AND NOT EXISTS (
                    SELECT 1
                    FROM public.analysis_assets AS asset
                    WHERE asset.task_id = task.id
                        AND asset.user_id = task.user_id
                )
            ORDER BY task.completed_at, task.id
            LIMIT p_batch_size
            FOR UPDATE OF task SKIP LOCKED
        )
        DELETE FROM public.analysis_tasks AS task
        USING candidates
        WHERE task.id = candidates.id;

        GET DIAGNOSTICS v_deleted = ROW_COUNT;
        COMMIT AND CHAIN;
        EXIT WHEN v_deleted < p_batch_size;
    END LOOP;
END;
$$;


CREATE FUNCTION public.complete_analysis_media_cleanup(p_asset_id uuid, p_succeeded boolean, p_error_code text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY INVOKER
    SET search_path TO ''
    AS $$
BEGIN
    IF p_succeeded THEN
        UPDATE public.analysis_assets AS asset
        SET
            state = 'deleted',
            deleted_at = COALESCE(asset.deleted_at, now()),
            deletion_started_at = NULL,
            cleanup_next_attempt_at = NULL,
            cleanup_last_error_code = NULL
        WHERE asset.id = p_asset_id
            AND asset.state IN ('deleting', 'deleted');
        RETURN FOUND;
    END IF;

    UPDATE public.analysis_assets AS asset
    SET
        state = 'cleanup_failed',
        deletion_started_at = NULL,
        cleanup_next_attempt_at = now() + interval '15 minutes',
        cleanup_last_error_code = LEFT(
            COALESCE(NULLIF(p_error_code, ''), 'storage_delete_failed'),
            100
        )
    WHERE asset.id = p_asset_id
        AND asset.state = 'deleting';
    RETURN FOUND;
END;
$$;


REVOKE ALL ON FUNCTION public.claim_analysis_media_cleanup(integer, integer) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.complete_analysis_media_cleanup(uuid, boolean, text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON PROCEDURE public.cleanup_expired_analysis_data(integer, integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.claim_analysis_media_cleanup(integer, integer) TO service_role;

GRANT EXECUTE ON FUNCTION public.complete_analysis_media_cleanup(uuid, boolean, text) TO service_role;

CREATE FUNCTION teeho_internal.invoke_analysis_media_cleanup() RETURNS bigint
    LANGUAGE plpgsql SECURITY INVOKER
    SET search_path TO ''
    AS $$
DECLARE
    v_project_url text;
    v_cron_secret text;
    v_request_id bigint;
BEGIN
    SELECT secret.decrypted_secret
    INTO v_project_url
    FROM vault.decrypted_secrets AS secret
    WHERE secret.name = 'teeho_project_url';

    SELECT secret.decrypted_secret
    INTO v_cron_secret
    FROM vault.decrypted_secrets AS secret
    WHERE secret.name = 'teeho_media_cleanup_secret';

    IF v_project_url IS NULL OR v_cron_secret IS NULL THEN
        RAISE WARNING 'analysis media cleanup Vault configuration is missing';
        RETURN NULL;
    END IF;

    SELECT net.http_post(
        url := rtrim(v_project_url, '/') || '/functions/v1/cleanup-analysis-media',
        headers := jsonb_build_object(
            'content-type', 'application/json',
            'x-teeho-cron-secret', v_cron_secret
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
    )
    INTO v_request_id;

    RETURN v_request_id;
END;
$$;


REVOKE ALL ON FUNCTION teeho_internal.invoke_analysis_media_cleanup() FROM PUBLIC, anon, authenticated, service_role;

-- 兼容公共核心既有的主动清理调用；只供部署数据库角色调度，不授予 Vault 读取权。
CREATE FUNCTION public.invoke_analysis_media_cleanup() RETURNS bigint
    LANGUAGE sql SECURITY INVOKER
    SET search_path TO ''
    AS $$
    SELECT teeho_internal.invoke_analysis_media_cleanup();
$$;

REVOKE ALL ON FUNCTION public.invoke_analysis_media_cleanup() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoke_analysis_media_cleanup() TO postgres;

-- 私有 bucket 仅保存本部署用户素材；通过业务 API 签发短期上传/读取地址。

-- 不创建 storage.objects 的浏览器读写 policy，不通过 SQL 删除平台对象。

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('analysis-media', 'analysis-media', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']::text[])
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('analysis-video', 'analysis-video', false, 419430400, ARRAY['video/mp4', 'video/quicktime', 'image/webp', 'application/json']::text[])
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;


SELECT cron.schedule(
    'teeho-analysis-conversation-logout-session-retention',
    '*/15 * * * *',
    $cron$
        DELETE FROM public.analysis_conversation_logout_sessions
        WHERE expires_at <= clock_timestamp();
    $cron$
);

SELECT cron.schedule(
    'teeho-analysis-conversation-turn-run-retention',
    '*/15 * * * *',
    $cron$
        DELETE FROM public.analysis_conversation_turn_runs
        WHERE expires_at <= now()
    $cron$
);

SELECT cron.schedule(
    'teeho-analysis-media-cleanup',
    '0 19 * * *',
    $cron$SELECT teeho_internal.invoke_analysis_media_cleanup()$cron$
);

SELECT cron.schedule(
    'teeho-analysis-retention-cleanup',
    '30 19 * * *',
    $cron$CALL public.cleanup_expired_analysis_data(100, 20)$cron$
);

SELECT cron.schedule(
    'teeho-auth-login-throttle-cleanup',
    '7 * * * *',
    $cron$
        DELETE FROM public.auth_login_throttles
        WHERE updated_at < now() - interval '24 hours'
            AND (locked_until IS NULL OR locked_until <= now())
    $cron$
);

SELECT cron.schedule(
    'teeho-auth-password-change-throttle-cleanup',
    '11 * * * *',
    $cron$
        DELETE FROM public.auth_password_change_throttles
        WHERE updated_at < now() - interval '24 hours'
            AND (blocked_until IS NULL OR blocked_until <= now())
    $cron$
);
