BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- 素材尝试编号是租约围栏，人工重试开启新周期时只推进周期起点。
ALTER TABLE public.analysis_assets
    ALTER COLUMN processing_attempt_count TYPE integer,
    ADD COLUMN processing_cycle_start_attempt integer NOT NULL DEFAULT 0,
    DROP CONSTRAINT analysis_assets_processing_attempt_check,
    ADD CONSTRAINT analysis_assets_processing_attempt_check CHECK (processing_attempt_count >= 0),
    ADD CONSTRAINT analysis_assets_processing_cycle_check CHECK (
        processing_cycle_start_attempt >= 0
        AND processing_cycle_start_attempt <= processing_attempt_count
    );

-- 旧版仅显式人工重试会让已有尝试的图片回到 uploaded；保留这次已接受的重试。
UPDATE public.analysis_assets
SET processing_cycle_start_attempt = processing_attempt_count
WHERE state = 'uploaded' AND processing_attempt_count > 0;

ALTER TABLE public.analysis_video_assets
    ALTER COLUMN processing_attempt_count TYPE integer,
    ADD COLUMN processing_cycle_start_attempt integer NOT NULL DEFAULT 0,
    DROP CONSTRAINT analysis_video_assets_attempt_count_check,
    ADD CONSTRAINT analysis_video_assets_attempt_count_check CHECK (processing_attempt_count >= 0),
    ADD CONSTRAINT analysis_video_assets_processing_cycle_check CHECK (
        processing_cycle_start_attempt >= 0
        AND processing_cycle_start_attempt <= processing_attempt_count
    );

ALTER TABLE public.analysis_video_processing_attempts
    ALTER COLUMN attempt_number TYPE integer,
    DROP CONSTRAINT analysis_video_processing_attempts_number_check,
    ADD CONSTRAINT analysis_video_processing_attempts_number_check CHECK (attempt_number >= 1);

-- 提交身份先冻结；仅素材执行证据在准备完成后允许一次受约束补齐。
ALTER TABLE public.analysis_tasks
    DROP CONSTRAINT analysis_tasks_checkup_contract_check,
    ADD CONSTRAINT analysis_tasks_checkup_contract_check CHECK ((
        structure_config_version = 'analysis-task.v6'
        AND jsonb_typeof(standard_task_snapshot) = 'object'
        AND standard_task_snapshot ->> 'structureVersion' = structure_config_version
        AND standard_task_snapshot ->> 'contentKind' IN ('image', 'video')
        AND standard_task_snapshot ?& ARRAY['fields', 'imageReferences', 'videoEvidence']
        AND NOT standard_task_snapshot ?| ARRAY['generationPreferences', 'generationConstraints']
        AND standard_task_snapshot ->> 'rawText' = ''
        AND jsonb_typeof(standard_task_snapshot #> '{fields,title,value}') = 'string'
        AND char_length(btrim(standard_task_snapshot #>> '{fields,title,value}')) BETWEEN 1 AND 200
        AND jsonb_typeof(standard_task_snapshot #> '{fields,body,value}') = 'string'
        AND char_length(btrim(standard_task_snapshot #>> '{fields,body,value}')) BETWEEN 0 AND 1000
        AND jsonb_typeof(standard_task_snapshot #> '{fields,topics,value}') = 'array'
        AND jsonb_array_length(standard_task_snapshot #> '{fields,topics,value}') BETWEEN 1 AND 25
        AND (
            NOT standard_task_snapshot ? 'coverReference'
            OR (
                jsonb_typeof(standard_task_snapshot -> 'coverReference') = 'string'
                AND standard_task_snapshot ->> 'coverReference'
                    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            )
        )
        AND jsonb_typeof(standard_task_snapshot -> 'imageReferences') = 'array'
        AND (
            (
                standard_task_snapshot ->> 'contentKind' = 'image'
                AND jsonb_array_length(standard_task_snapshot -> 'imageReferences') BETWEEN 0 AND 18
                AND (
                    NOT standard_task_snapshot ? 'coverReference'
                    OR (standard_task_snapshot -> 'imageReferences')
                        ? (standard_task_snapshot ->> 'coverReference')
                )
                AND jsonb_typeof(standard_task_snapshot -> 'videoEvidence') = 'null'
            )
            OR (
                standard_task_snapshot ->> 'contentKind' = 'video'
                AND jsonb_array_length(standard_task_snapshot -> 'imageReferences') = 0
                AND (
                    jsonb_typeof(standard_task_snapshot -> 'videoEvidence') = 'object'
                    OR (
                        standard_task_snapshot ? 'mediaPreparation'
                        AND jsonb_typeof(standard_task_snapshot -> 'videoEvidence') = 'null'
                    )
                )
            )
        )
    ) IS TRUE),
    ADD CONSTRAINT analysis_tasks_media_preparation_check CHECK ((
        NOT standard_task_snapshot ? 'mediaPreparation'
        OR (
            jsonb_typeof(standard_task_snapshot -> 'mediaPreparation') = 'object'
            AND standard_task_snapshot #>> '{mediaPreparation,schemaVersion}' = 'media-preparation.v1'
            AND (standard_task_snapshot -> 'mediaPreparation')
                - ARRAY['schemaVersion', 'videoReference', 'deadlineAt']::text[] = '{}'::jsonb
            AND jsonb_typeof(standard_task_snapshot #> '{mediaPreparation,deadlineAt}') = 'string'
            AND pg_catalog.pg_input_is_valid(
                standard_task_snapshot #>> '{mediaPreparation,deadlineAt}', 'timestamptz'
            )
            AND standard_task_snapshot #>> '{mediaPreparation,deadlineAt}'
                ~ '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?Z$'
            AND status IN ('queued', 'technical_failed', 'abandoned', 'cancelled')
            AND attempt_count = 0
            AND started_at IS NULL
            AND jsonb_typeof(standard_task_snapshot -> 'videoEvidence') = 'null'
            AND (
                (
                    standard_task_snapshot ->> 'contentKind' = 'image'
                    AND NOT (standard_task_snapshot -> 'mediaPreparation') ? 'videoReference'
                )
                OR (
                    standard_task_snapshot ->> 'contentKind' = 'video'
                    AND jsonb_typeof(standard_task_snapshot #> '{mediaPreparation,videoReference}') = 'string'
                    AND standard_task_snapshot #>> '{mediaPreparation,videoReference}'
                        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                )
            )
        )
    ) IS TRUE);

-- 素材失败不增加分析尝试次数；其余状态载荷保持既有语义。
ALTER TABLE public.analysis_tasks
    DROP CONSTRAINT analysis_tasks_status_payload_check,
    ADD CONSTRAINT analysis_tasks_status_payload_check CHECK (
        (
            status IN ('researching', 'queued')
            AND attempt_count = 0 AND started_at IS NULL
            AND lease_expires_at IS NULL AND worker_id IS NULL
            AND completed_at IS NULL AND failure_code IS NULL AND failure_message IS NULL
        )
        OR (
            status = 'processing' AND attempt_count BETWEEN 1 AND 2
            AND started_at IS NOT NULL AND lease_expires_at IS NOT NULL AND worker_id IS NOT NULL
            AND completed_at IS NULL AND failure_code IS NULL AND failure_message IS NULL
        )
        OR (
            status = 'retrying' AND attempt_count BETWEEN 1 AND 2 AND started_at IS NOT NULL
            AND completed_at IS NULL AND failure_code IS NULL AND failure_message IS NULL
            AND (
                (lease_expires_at IS NULL AND worker_id IS NULL)
                OR (lease_expires_at IS NOT NULL AND worker_id IS NOT NULL)
            )
        )
        OR (
            status = 'succeeded' AND attempt_count BETWEEN 1 AND 2
            AND lease_expires_at IS NULL AND worker_id IS NULL AND completed_at IS NOT NULL
            AND failure_code IS NULL AND failure_message IS NULL
        )
        OR (
            status = 'technical_failed'
            AND (
                attempt_count BETWEEN 1 AND 2
                OR (
                    attempt_count = 0 AND started_at IS NULL
                    AND standard_task_snapshot ? 'mediaPreparation'
                )
            )
            AND lease_expires_at IS NULL AND worker_id IS NULL AND completed_at IS NOT NULL
            AND failure_code IS NOT NULL AND failure_message IS NOT NULL
        )
        OR (
            status IN ('abandoned', 'cancelled') AND attempt_count BETWEEN 0 AND 2
            AND lease_expires_at IS NULL AND worker_id IS NULL AND completed_at IS NOT NULL
            AND failure_code IS NULL AND failure_message IS NULL
        )
    ),
    DROP CONSTRAINT analysis_tasks_failure_code_check,
    ADD CONSTRAINT analysis_tasks_failure_code_check CHECK (
        failure_code IS NULL OR failure_code IN (
            'agent_timeout', 'agent_invalid_output', 'agent_failure', 'image_expired',
            'video_evidence_expired', 'insight_unavailable', 'no_reference_notes',
            'radar_unavailable', 'media_preparation_failed', 'media_preparation_timeout'
        )
    );

CREATE OR REPLACE FUNCTION public.prevent_analysis_task_snapshot_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
    preparation_completed boolean;
    preparation_retried boolean;
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.input_mode IS DISTINCT FROM OLD.input_mode
        OR NEW.structure_config_version IS DISTINCT FROM OLD.structure_config_version
        OR NEW.input_fingerprint IS DISTINCT FROM OLD.input_fingerprint
        OR NEW.web_research_enabled IS DISTINCT FROM OLD.web_research_enabled
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'analysis task snapshot is immutable';
    END IF;

    preparation_completed := (
        OLD.standard_task_snapshot ? 'mediaPreparation'
        AND NOT NEW.standard_task_snapshot ? 'mediaPreparation'
        AND OLD.status = 'queued'
        AND NEW.status = CASE WHEN OLD.web_research_enabled THEN 'researching' ELSE 'queued' END
        AND OLD.attempt_count = 0 AND NEW.attempt_count = 0
        AND OLD.started_at IS NULL AND NEW.started_at IS NULL
        AND NEW.manual_retry_count = OLD.manual_retry_count
        AND (NEW.standard_task_snapshot - 'videoEvidence') IS NOT DISTINCT FROM
            (OLD.standard_task_snapshot - ARRAY['mediaPreparation', 'videoEvidence']::text[])
        AND (
            (
                OLD.standard_task_snapshot ->> 'contentKind' = 'image'
                AND NEW.standard_task_snapshot -> 'videoEvidence'
                    IS NOT DISTINCT FROM OLD.standard_task_snapshot -> 'videoEvidence'
            )
            OR (
                OLD.standard_task_snapshot ->> 'contentKind' = 'video'
                AND jsonb_typeof(NEW.standard_task_snapshot -> 'videoEvidence') = 'object'
                AND NEW.standard_task_snapshot #>> '{videoEvidence,assetId}'
                    = OLD.standard_task_snapshot #>> '{mediaPreparation,videoReference}'
            )
        )
    ) IS TRUE;

    -- 人工重试只刷新准备截止时间；不能借失败恢复更换原稿或素材。
    preparation_retried := (
        OLD.standard_task_snapshot ? 'mediaPreparation'
        AND NEW.standard_task_snapshot ? 'mediaPreparation'
        AND OLD.status = 'technical_failed' AND NEW.status = 'queued'
        AND OLD.attempt_count = 0 AND NEW.attempt_count = 0
        AND OLD.started_at IS NULL AND NEW.started_at IS NULL
        AND NEW.manual_retry_count::bigint = OLD.manual_retry_count::bigint + 1
        AND (NEW.standard_task_snapshot #- '{mediaPreparation,deadlineAt}') IS NOT DISTINCT FROM
            (OLD.standard_task_snapshot #- '{mediaPreparation,deadlineAt}')
        AND NEW.quantification_fingerprint IS NOT DISTINCT FROM OLD.quantification_fingerprint
        AND NEW.level_fingerprint IS NOT DISTINCT FROM OLD.level_fingerprint
        AND NEW.generation_fingerprint IS NOT DISTINCT FROM OLD.generation_fingerprint
    ) IS TRUE;

    -- 迟到回调不能复活终态准备任务；不改快照的状态更新也受同一重试门禁保护。
    IF OLD.standard_task_snapshot ? 'mediaPreparation'
        AND OLD.status <> 'queued' AND NEW.status = 'queued'
        AND NOT preparation_retried
    THEN
        RAISE EXCEPTION 'analysis task preparation retry is invalid';
    END IF;

    IF (
        NEW.standard_task_snapshot IS DISTINCT FROM OLD.standard_task_snapshot
        OR NEW.quantification_fingerprint IS DISTINCT FROM OLD.quantification_fingerprint
        OR NEW.level_fingerprint IS DISTINCT FROM OLD.level_fingerprint
        OR NEW.generation_fingerprint IS DISTINCT FROM OLD.generation_fingerprint
    ) AND NOT (preparation_completed OR preparation_retried)
    THEN
        RAISE EXCEPTION 'analysis task snapshot is immutable';
    END IF;

    RETURN NEW;
END;
$$;

-- 保持触发器和调用权限，网页不能通过 Data API 修改受理快照。
REVOKE ALL ON FUNCTION public.prevent_analysis_task_snapshot_update()
    FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
