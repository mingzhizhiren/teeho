-- 同一任务中的 Agent 等待重试；不改变任务快照、积分预留或租约身份。
ALTER TABLE public.analysis_tasks
    ADD COLUMN agent_retry_waits text[] NOT NULL DEFAULT '{}'::text[],
    ADD CONSTRAINT analysis_tasks_agent_retry_waits_check CHECK (
        cardinality(agent_retry_waits) <= 4
        AND array_position(agent_retry_waits, NULL) IS NULL
        AND agent_retry_waits <@ ARRAY['cover', 'content', 'classification', 'review']::text[]
        AND (cardinality(agent_retry_waits) = 0 OR (
            status IN ('processing', 'retrying') AND worker_id IS NOT NULL
            AND lease_expires_at IS NOT NULL
        ))
    );

ALTER TABLE public.analysis_tasks DROP CONSTRAINT analysis_tasks_failure_code_check;
ALTER TABLE public.analysis_tasks ADD CONSTRAINT analysis_tasks_failure_code_check CHECK (
    failure_code IS NULL OR failure_code IN (
        'agent_timeout', 'agent_invalid_output', 'agent_failure', 'agent_busy',
        'model_service_unavailable', 'image_expired', 'video_evidence_expired',
        'insight_unavailable', 'no_reference_notes', 'radar_unavailable',
        'media_preparation_failed', 'media_preparation_timeout'
    )
);

-- 终态、人工重试和租约恢复都清理等待信息，旧执行者不能留下跨轮次状态。
CREATE FUNCTION public.clear_analysis_agent_retry_waits() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF NEW.status NOT IN ('processing', 'retrying')
        OR NEW.worker_id IS DISTINCT FROM OLD.worker_id
        OR NEW.attempt_count IS DISTINCT FROM OLD.attempt_count THEN
        NEW.agent_retry_waits := '{}'::text[];
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_analysis_agent_retry_waits() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER clear_analysis_agent_retry_waits
BEFORE UPDATE ON public.analysis_tasks FOR EACH ROW
EXECUTE FUNCTION public.clear_analysis_agent_retry_waits();

CREATE OR REPLACE FUNCTION public.publish_workspace_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER
    SET search_path TO ''
    AS $$
DECLARE
    v_type text;
    v_user_id uuid;
    v_resource_id uuid;
    v_status text;
    v_version bigint;
    v_payload jsonb;
    v_event_id bigint;
BEGIN
    CASE TG_TABLE_NAME
        WHEN 'analysis_tasks' THEN
            IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
                AND NEW.agent_retry_waits IS NOT DISTINCT FROM OLD.agent_retry_waits THEN
                RETURN NEW;
            END IF;
            v_type := 'task.changed';
            v_user_id := NEW.user_id;
            v_resource_id := NEW.id;
            v_status := NEW.status;
            v_version := NULL;
        WHEN 'analysis_results' THEN
            v_type := 'result.available';
            v_user_id := NEW.user_id;
            v_resource_id := NEW.task_id;
            v_status := NULL;
            v_version := NEW.result_version;
        WHEN 'business_notifications' THEN
            v_type := 'notification.created';
            v_user_id := NEW.user_id;
            v_resource_id := NEW.id;
            v_status := NULL;
            v_version := NEW.analysis_result_version;
        WHEN 'analysis_video_assets' THEN
            IF TG_OP = 'UPDATE' AND NEW.state IS NOT DISTINCT FROM OLD.state THEN
                RETURN NEW;
            END IF;
            v_type := 'video.changed';
            v_user_id := NEW.user_id;
            v_resource_id := NEW.id;
            v_status := NEW.state;
            v_version := NULL;
        WHEN 'analysis_conversation_controls' THEN
            IF NEW.status = 'idle' THEN
                RETURN NEW;
            END IF;
            IF TG_OP = 'UPDATE'
                AND NEW.session_id IS NOT DISTINCT FROM OLD.session_id
                AND NEW.generation IS NOT DISTINCT FROM OLD.generation
                AND NEW.browser_instance_id IS NOT DISTINCT FROM OLD.browser_instance_id
                AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
                RETURN NEW;
            END IF;
            v_type := 'conversation.changed';
            v_user_id := NEW.user_id;
            v_resource_id := NEW.session_id;
            v_status := NEW.status;
            v_version := NEW.generation;
        ELSE
            RAISE EXCEPTION 'unsupported workspace event table';
    END CASE;

    INSERT INTO public.workspace_event_versions (user_id, last_event_id)
    VALUES (v_user_id, 1)
    ON CONFLICT (user_id) DO UPDATE SET
        last_event_id = public.workspace_event_versions.last_event_id + 1,
        updated_at = now()
    RETURNING last_event_id INTO v_event_id;

    v_payload := jsonb_build_object(
        'id', v_event_id::text,
        'type', v_type,
        'userId', v_user_id,
        'resourceId', v_resource_id,
        'status', v_status,
        'version', v_version,
        'occurredAt', now()
    );
    PERFORM pg_notify('teeho_workspace_events', v_payload::text);
    RETURN NEW;
END;
$$;

DROP TRIGGER publish_analysis_task_event ON public.analysis_tasks;
CREATE TRIGGER publish_analysis_task_event
AFTER INSERT OR UPDATE ON public.analysis_tasks FOR EACH ROW
EXECUTE FUNCTION public.publish_workspace_event();
