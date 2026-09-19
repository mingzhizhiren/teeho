-- 社区版关系、不可变快照、工作区失效通知与最小 Data API 权限。

ALTER TABLE public.analysis_results
    ADD CONSTRAINT analysis_results_checkup_report_check CHECK ((((jsonb_typeof(checkup_report) = 'object'::text) AND ((checkup_report ->> 'schemaVersion'::text) = result_schema_version) AND (checkup_report ?& ARRAY['primaryTrack'::text, 'insight'::text, 'radar'::text, 'differences'::text, 'qualitativeConclusion'::text, 'comparisonNotes'::text, 'topicSupport'::text]) AND (NOT (checkup_report ?| ARRAY['scoring'::text, 'quantitativeReport'::text, 'publicationDecision'::text, 'risks'::text, 'uncertainties'::text, 'references'::text, 'bestContentPlan'::text])) AND (jsonb_typeof((checkup_report -> 'primaryTrack'::text)) = 'number'::text) AND ((((checkup_report ->> 'primaryTrack'::text))::numeric >= (0)::numeric) AND (((checkup_report ->> 'primaryTrack'::text))::numeric <= (30)::numeric)) AND (((checkup_report ->> 'primaryTrack'::text))::numeric = trunc(((checkup_report ->> 'primaryTrack'::text))::numeric)) AND (((result_schema_version = 'analysis-result.v6'::text) AND ((checkup_report #>> '{insight,status}'::text[]) = 'available'::text) AND ((checkup_report #> '{insight,limited}'::text[]) = 'false'::jsonb) AND (jsonb_typeof((checkup_report #> '{insight,score}'::text[])) = 'number'::text) AND ((((checkup_report #>> '{insight,score}'::text[]))::numeric >= (0)::numeric) AND (((checkup_report #>> '{insight,score}'::text[]))::numeric <= (10)::numeric)) AND (((checkup_report #>> '{insight,score}'::text[]))::numeric = level)) OR ((result_schema_version = 'analysis-result.v7'::text) AND (jsonb_typeof((checkup_report #> '{primaryScore,value}'::text[])) = 'number'::text) AND ((((checkup_report #>> '{primaryScore,value}'::text[]))::numeric >= (0)::numeric) AND (((checkup_report #>> '{primaryScore,value}'::text[]))::numeric <= (10)::numeric)) AND (((checkup_report #>> '{primaryScore,value}'::text[]))::numeric = level) AND ((((checkup_report #>> '{primaryScore,source}'::text[]) = 'insight'::text) AND ((checkup_report #>> '{insight,status}'::text[]) = 'available'::text) AND ((checkup_report #> '{insight,limited}'::text[]) = 'false'::jsonb) AND (((checkup_report #>> '{insight,score}'::text[]))::numeric = level)) OR (((checkup_report #>> '{primaryScore,source}'::text[]) = 'radar_average'::text) AND ((checkup_report -> 'insight'::text) = 'null'::jsonb) AND ((((((
CASE
    WHEN (jsonb_typeof((checkup_report #> '{radar,topicDemand}'::text[])) = 'number'::text) THEN 1
    ELSE 0
END +
CASE
    WHEN (jsonb_typeof((checkup_report #> '{radar,titleExpression}'::text[])) = 'number'::text) THEN 1
    ELSE 0
END) +
CASE
    WHEN (jsonb_typeof((checkup_report #> '{radar,contentDevelopment}'::text[])) = 'number'::text) THEN 1
    ELSE 0
END) +
CASE
    WHEN (jsonb_typeof((checkup_report #> '{radar,readingExperience}'::text[])) = 'number'::text) THEN 1
    ELSE 0
END) +
CASE
    WHEN (jsonb_typeof((checkup_report #> '{radar,interactionPotential}'::text[])) = 'number'::text) THEN 1
    ELSE 0
END) +
CASE
    WHEN (jsonb_typeof((checkup_report #> '{radar,distinctiveness}'::text[])) = 'number'::text) THEN 1
    ELSE 0
END) >= 4) AND (level = round(((((((COALESCE(((checkup_report #>> '{radar,topicDemand}'::text[]))::numeric, (0)::numeric) + COALESCE(((checkup_report #>> '{radar,titleExpression}'::text[]))::numeric, (0)::numeric)) + COALESCE(((checkup_report #>> '{radar,contentDevelopment}'::text[]))::numeric, (0)::numeric)) + COALESCE(((checkup_report #>> '{radar,readingExperience}'::text[]))::numeric, (0)::numeric)) + COALESCE(((checkup_report #>> '{radar,interactionPotential}'::text[]))::numeric, (0)::numeric)) + COALESCE(((checkup_report #>> '{radar,distinctiveness}'::text[]))::numeric, (0)::numeric)) / (NULLIF((((((
CASE
    WHEN (jsonb_typeof((checkup_report #> '{radar,topicDemand}'::text[])) = 'number'::text) THEN 1
    ELSE 0
END +
CASE
    WHEN (jsonb_typeof((checkup_report #> '{radar,titleExpression}'::text[])) = 'number'::text) THEN 1
    ELSE 0
END) +
CASE
    WHEN (jsonb_typeof((checkup_report #> '{radar,contentDevelopment}'::text[])) = 'number'::text) THEN 1
    ELSE 0
END) +
CASE
    WHEN (jsonb_typeof((checkup_report #> '{radar,readingExperience}'::text[])) = 'number'::text) THEN 1
    ELSE 0
END) +
CASE
    WHEN (jsonb_typeof((checkup_report #> '{radar,interactionPotential}'::text[])) = 'number'::text) THEN 1
    ELSE 0
END) +
CASE
    WHEN (jsonb_typeof((checkup_report #> '{radar,distinctiveness}'::text[])) = 'number'::text) THEN 1
    ELSE 0
END), 0))::numeric), 2)))))) AND (jsonb_typeof((checkup_report -> 'radar'::text)) = 'object'::text) AND ((checkup_report -> 'radar'::text) ?& ARRAY['topicDemand'::text, 'titleExpression'::text, 'contentDevelopment'::text, 'readingExperience'::text, 'interactionPotential'::text, 'distinctiveness'::text]) AND (jsonb_typeof((checkup_report #> '{radar,topicDemand}'::text[])) = ANY (ARRAY['number'::text, 'null'::text])) AND (jsonb_typeof((checkup_report #> '{radar,titleExpression}'::text[])) = ANY (ARRAY['number'::text, 'null'::text])) AND (jsonb_typeof((checkup_report #> '{radar,contentDevelopment}'::text[])) = ANY (ARRAY['number'::text, 'null'::text])) AND (jsonb_typeof((checkup_report #> '{radar,readingExperience}'::text[])) = ANY (ARRAY['number'::text, 'null'::text])) AND (jsonb_typeof((checkup_report #> '{radar,interactionPotential}'::text[])) = ANY (ARRAY['number'::text, 'null'::text])) AND (jsonb_typeof((checkup_report #> '{radar,distinctiveness}'::text[])) = ANY (ARRAY['number'::text, 'null'::text])) AND (((checkup_report #> '{radar,topicDemand}'::text[]) = 'null'::jsonb) OR ((((checkup_report #>> '{radar,topicDemand}'::text[]))::numeric >= (0)::numeric) AND (((checkup_report #>> '{radar,topicDemand}'::text[]))::numeric <= (10)::numeric))) AND (((checkup_report #> '{radar,titleExpression}'::text[]) = 'null'::jsonb) OR ((((checkup_report #>> '{radar,titleExpression}'::text[]))::numeric >= (0)::numeric) AND (((checkup_report #>> '{radar,titleExpression}'::text[]))::numeric <= (10)::numeric))) AND (((checkup_report #> '{radar,contentDevelopment}'::text[]) = 'null'::jsonb) OR ((((checkup_report #>> '{radar,contentDevelopment}'::text[]))::numeric >= (0)::numeric) AND (((checkup_report #>> '{radar,contentDevelopment}'::text[]))::numeric <= (10)::numeric))) AND (((checkup_report #> '{radar,readingExperience}'::text[]) = 'null'::jsonb) OR ((((checkup_report #>> '{radar,readingExperience}'::text[]))::numeric >= (0)::numeric) AND (((checkup_report #>> '{radar,readingExperience}'::text[]))::numeric <= (10)::numeric))) AND (((checkup_report #> '{radar,interactionPotential}'::text[]) = 'null'::jsonb) OR ((((checkup_report #>> '{radar,interactionPotential}'::text[]))::numeric >= (0)::numeric) AND (((checkup_report #>> '{radar,interactionPotential}'::text[]))::numeric <= (10)::numeric))) AND (((checkup_report #> '{radar,distinctiveness}'::text[]) = 'null'::jsonb) OR ((((checkup_report #>> '{radar,distinctiveness}'::text[]))::numeric >= (0)::numeric) AND (((checkup_report #>> '{radar,distinctiveness}'::text[]))::numeric <= (10)::numeric))) AND (jsonb_typeof((checkup_report -> 'comparisonNotes'::text)) = 'array'::text) AND ((jsonb_array_length((checkup_report -> 'comparisonNotes'::text)) >= 1) AND (jsonb_array_length((checkup_report -> 'comparisonNotes'::text)) <= 3)) AND (jsonb_typeof((checkup_report -> 'differences'::text)) = 'array'::text) AND (jsonb_array_length((checkup_report -> 'differences'::text)) <= 3) AND (jsonb_typeof((checkup_report #> '{qualitativeConclusion,summary}'::text[])) = 'string'::text) AND ((char_length(btrim((checkup_report #>> '{qualitativeConclusion,summary}'::text[]))) >= 1) AND (char_length(btrim((checkup_report #>> '{qualitativeConclusion,summary}'::text[]))) <= 800)) AND (jsonb_typeof((checkup_report #> '{topicSupport,bonus}'::text[])) = 'number'::text) AND ((((checkup_report #>> '{topicSupport,bonus}'::text[]))::numeric >= (0)::numeric) AND (((checkup_report #>> '{topicSupport,bonus}'::text[]))::numeric <= (1)::numeric)) AND (((checkup_report #> '{radar,topicDemand}'::text[]) <> 'null'::jsonb) OR (((checkup_report #>> '{topicSupport,bonus}'::text[]))::numeric = (0)::numeric))) IS TRUE));

ALTER TABLE public.analysis_results
    ADD CONSTRAINT analysis_results_schema_version_check CHECK ((result_schema_version = ANY (ARRAY['analysis-result.v6'::text, 'analysis-result.v7'::text])));

ALTER TABLE public.analysis_tasks
    ADD CONSTRAINT analysis_tasks_failure_code_check CHECK (((failure_code IS NULL) OR (failure_code = ANY (ARRAY['agent_timeout'::text, 'agent_invalid_output'::text, 'agent_failure'::text, 'image_expired'::text, 'video_evidence_expired'::text, 'insight_unavailable'::text, 'no_reference_notes'::text, 'radar_unavailable'::text]))));

ALTER TABLE public.analysis_tasks
    ADD CONSTRAINT analysis_tasks_cover_required CHECK (
        (
            (
                standard_task_snapshot ->> 'contentKind' = 'video'
                AND NOT (standard_task_snapshot ? 'coverReference')
            )
            OR (
                jsonb_typeof(standard_task_snapshot -> 'coverReference') = 'string'
                AND standard_task_snapshot ->> 'coverReference'
                    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            )
        ) IS TRUE
    );



ALTER TABLE ONLY public.agent_usage_calls
    ADD CONSTRAINT agent_usage_calls_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.analysis_tasks(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.agent_usage_calls
    ADD CONSTRAINT agent_usage_calls_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_assets
    ADD CONSTRAINT analysis_assets_task_owner_fk FOREIGN KEY (task_id, user_id) REFERENCES public.analysis_tasks(id, user_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.analysis_assets
    ADD CONSTRAINT analysis_assets_upload_session_fk FOREIGN KEY (upload_session_id, user_id) REFERENCES public.analysis_media_upload_sessions(id, user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_conversation_controls
    ADD CONSTRAINT analysis_conversation_controls_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_conversation_logout_sessions
    ADD CONSTRAINT analysis_conversation_logout_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_conversation_turn_runs
    ADD CONSTRAINT analysis_conversation_turn_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_draft_send_reservations
    ADD CONSTRAINT analysis_draft_send_reservations_window_fk FOREIGN KEY (user_id, window_started_at) REFERENCES public.analysis_draft_send_windows(user_id, window_started_at) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_draft_send_windows
    ADD CONSTRAINT analysis_draft_send_windows_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_evidence_sets
    ADD CONSTRAINT analysis_evidence_sets_task_owner_fk FOREIGN KEY (task_id, user_id) REFERENCES public.analysis_tasks(id, user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_media_upload_sessions
    ADD CONSTRAINT analysis_media_upload_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.analysis_results
    ADD CONSTRAINT analysis_results_task_owner_fk FOREIGN KEY (task_id, user_id) REFERENCES public.analysis_tasks(id, user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_tasks
    ADD CONSTRAINT analysis_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_video_assets
    ADD CONSTRAINT analysis_video_assets_evidence_fk FOREIGN KEY (evidence_id) REFERENCES public.analysis_video_evidence_packages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.analysis_video_assets
    ADD CONSTRAINT analysis_video_assets_session_fk FOREIGN KEY (upload_session_id, user_id) REFERENCES public.analysis_video_upload_sessions(id, user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_video_assets
    ADD CONSTRAINT analysis_video_assets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_video_evidence_frames
    ADD CONSTRAINT analysis_video_evidence_frames_evidence_package_id_fkey FOREIGN KEY (evidence_package_id) REFERENCES public.analysis_video_evidence_packages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_video_evidence_packages
    ADD CONSTRAINT analysis_video_evidence_packages_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.analysis_video_assets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_video_evidence_restore_sessions
    ADD CONSTRAINT analysis_video_evidence_restore_sessions_asset_fk FOREIGN KEY (asset_id, user_id) REFERENCES public.analysis_video_assets(id, user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_video_evidence_restore_sessions
    ADD CONSTRAINT analysis_video_evidence_restore_sessions_evidence_fk FOREIGN KEY (evidence_package_id, asset_id) REFERENCES public.analysis_video_evidence_packages(id, asset_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_video_evidence_restore_sessions
    ADD CONSTRAINT analysis_video_evidence_restore_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_video_processing_attempts
    ADD CONSTRAINT analysis_video_processing_attempts_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.analysis_video_assets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_video_start_events
    ADD CONSTRAINT analysis_video_start_events_asset_owner_fk FOREIGN KEY (asset_id, user_id) REFERENCES public.analysis_video_assets(id, user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_video_start_events
    ADD CONSTRAINT analysis_video_start_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_video_upload_sessions
    ADD CONSTRAINT analysis_video_upload_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analysis_web_research_snapshots
    ADD CONSTRAINT analysis_web_research_snapshots_task_owner_fk FOREIGN KEY (task_id, user_id) REFERENCES public.analysis_tasks(id, user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.business_notifications
    ADD CONSTRAINT business_notifications_analysis_result_fk FOREIGN KEY (analysis_task_id, analysis_result_version) REFERENCES public.analysis_results(task_id, result_version) ON DELETE CASCADE;

ALTER TABLE ONLY public.business_notifications
    ADD CONSTRAINT business_notifications_analysis_task_owner_fk FOREIGN KEY (analysis_task_id, user_id) REFERENCES public.analysis_tasks(id, user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.business_notifications
    ADD CONSTRAINT business_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.skill_device_grants
    ADD CONSTRAINT skill_device_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.workspace_event_versions
    ADD CONSTRAINT workspace_event_versions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE FUNCTION public.prevent_analysis_evidence_set_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
    RAISE EXCEPTION 'analysis evidence set is immutable';
END;
$$;


CREATE FUNCTION public.prevent_analysis_result_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
    RAISE EXCEPTION 'analysis result versions are immutable';
END;
$$;


CREATE FUNCTION public.prevent_analysis_task_snapshot_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.input_mode IS DISTINCT FROM OLD.input_mode
        OR NEW.structure_config_version IS DISTINCT FROM OLD.structure_config_version
        OR NEW.standard_task_snapshot IS DISTINCT FROM OLD.standard_task_snapshot
        OR NEW.input_fingerprint IS DISTINCT FROM OLD.input_fingerprint
        OR NEW.quantification_fingerprint IS DISTINCT FROM OLD.quantification_fingerprint
        OR NEW.level_fingerprint IS DISTINCT FROM OLD.level_fingerprint
        OR NEW.generation_fingerprint IS DISTINCT FROM OLD.generation_fingerprint
        OR NEW.web_research_enabled IS DISTINCT FROM OLD.web_research_enabled
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'analysis task snapshot is immutable';
    END IF;

    RETURN NEW;
END;
$$;


CREATE FUNCTION public.publish_workspace_event() RETURNS trigger
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
            IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
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


CREATE TRIGGER protect_analysis_evidence_set BEFORE UPDATE ON public.analysis_evidence_sets FOR EACH ROW EXECUTE FUNCTION public.prevent_analysis_evidence_set_update();

CREATE TRIGGER protect_analysis_result_version BEFORE UPDATE ON public.analysis_results FOR EACH ROW EXECUTE FUNCTION public.prevent_analysis_result_update();

CREATE TRIGGER protect_analysis_task_snapshot BEFORE UPDATE ON public.analysis_tasks FOR EACH ROW EXECUTE FUNCTION public.prevent_analysis_task_snapshot_update();

CREATE TRIGGER publish_analysis_conversation_control_event AFTER INSERT OR UPDATE ON public.analysis_conversation_controls FOR EACH ROW EXECUTE FUNCTION public.publish_workspace_event();

CREATE TRIGGER publish_analysis_result_event AFTER INSERT ON public.analysis_results FOR EACH ROW EXECUTE FUNCTION public.publish_workspace_event();

CREATE TRIGGER publish_analysis_task_event AFTER INSERT OR UPDATE OF status ON public.analysis_tasks FOR EACH ROW EXECUTE FUNCTION public.publish_workspace_event();

CREATE TRIGGER publish_analysis_video_asset_event AFTER INSERT OR UPDATE OF state ON public.analysis_video_assets FOR EACH ROW EXECUTE FUNCTION public.publish_workspace_event();

CREATE TRIGGER publish_business_notification_event AFTER INSERT ON public.business_notifications FOR EACH ROW EXECUTE FUNCTION public.publish_workspace_event();

REVOKE ALL ON FUNCTION public.prevent_analysis_evidence_set_update() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.prevent_analysis_result_update() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.prevent_analysis_task_snapshot_update() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.publish_workspace_event() FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_usage_calls TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_assets TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_conversation_controls TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_conversation_logout_sessions TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_conversation_turn_runs TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_draft_send_reservations TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_draft_send_windows TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_evidence_sets TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_media_upload_sessions TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_results TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_tasks TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_video_assets TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_video_evidence_frames TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_video_evidence_packages TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_video_evidence_restore_sessions TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_video_processing_attempts TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_video_start_events TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_video_upload_sessions TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_video_workers TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_web_research_snapshots TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.auth_login_throttles TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.auth_password_change_throttles TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_notifications TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.skill_anonymous_requests TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.skill_device_grants TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.skill_request_limits TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_event_versions TO service_role;

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

CREATE POLICY analysis_tasks_read_own ON public.analysis_tasks
    FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY analysis_results_read_own ON public.analysis_results
    FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

GRANT SELECT ON TABLE public.analysis_tasks TO authenticated;

-- 内部执行追踪不通过 Data API 暴露；完整报告通过认证业务 API 返回。

GRANT SELECT (task_id, result_version, user_id, level, result_schema_version, created_at)
    ON TABLE public.analysis_results TO authenticated;
