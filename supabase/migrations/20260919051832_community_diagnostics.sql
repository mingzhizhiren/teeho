-- 社区版首次部署：仅用于独立、空业务库；不修改既有部署历史。
-- 业务写入经过后端验证，浏览器权限在后续迁移中显式授予。
SET check_function_bodies = true;

-- agent_usage_calls

CREATE TABLE public.agent_usage_calls (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    association_kind text NOT NULL,
    association_id uuid NOT NULL,
    task_id uuid,
    provider_request_id uuid NOT NULL,
    stage text NOT NULL,
    provider text NOT NULL,
    model text,
    provider_version text NOT NULL,
    prompt_version text NOT NULL,
    attempt_number smallint NOT NULL,
    status text DEFAULT 'started'::text NOT NULL,
    error_category text,
    retry_scheduled boolean DEFAULT false NOT NULL,
    execution_id text,
    input_tokens bigint,
    text_input_tokens bigint,
    image_input_tokens bigint,
    cached_input_tokens bigint,
    reasoning_tokens bigint,
    output_tokens bigint,
    total_tokens bigint,
    image_input_count integer DEFAULT 0 NOT NULL,
    video_frame_input_count integer DEFAULT 0 NOT NULL,
    price_snapshot jsonb NOT NULL,
    estimated_cost_microusd bigint,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    duration_ms bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    metered_tokens bigint DEFAULT 0 NOT NULL,
    input_diagnostics jsonb,
    CONSTRAINT agent_usage_calls_association_kind_check CHECK ((association_kind = ANY (ARRAY['draft'::text, 'conversation'::text, 'task'::text]))),
    CONSTRAINT agent_usage_calls_attempt_check CHECK ((attempt_number > 0)),
    CONSTRAINT agent_usage_calls_error_state_check CHECK ((((status = ANY (ARRAY['started'::text, 'succeeded'::text])) AND (error_category IS NULL)) OR ((status = ANY (ARRAY['technical_failed'::text, 'cancelled'::text])) AND (error_category IS NOT NULL)))),
    CONSTRAINT agent_usage_calls_estimated_cost_check CHECK (((estimated_cost_microusd IS NULL) OR (estimated_cost_microusd >= 0))),
    CONSTRAINT agent_usage_calls_input_diagnostics_check CHECK (((input_diagnostics IS NULL) OR ((jsonb_typeof(input_diagnostics) = 'object'::text) AND ((input_diagnostics ->> 'schemaVersion'::text) = ANY (ARRAY['agent-request-diagnostics.v1'::text, 'agent-request-diagnostics.v2'::text])) AND ((input_diagnostics - ARRAY['schemaVersion'::text, 'cacheBoundaryFingerprint'::text, 'promptVersion'::text, 'targetSchemaVersion'::text, 'toolConfigurationVersion'::text, 'promptCharacterCount'::text, 'stablePrefixCharacterCount'::text, 'schemaCharacterCount'::text, 'historyItemCount'::text, 'historyCharacterCount'::text, 'evidenceNoteCount'::text, 'evidenceCharacterCount'::text, 'imageCount'::text, 'videoFrameCount'::text, 'images'::text, 'contentRiskPolicy'::text]) = '{}'::jsonb) AND (input_diagnostics ?& ARRAY['schemaVersion'::text, 'cacheBoundaryFingerprint'::text, 'promptVersion'::text, 'targetSchemaVersion'::text, 'toolConfigurationVersion'::text, 'promptCharacterCount'::text, 'stablePrefixCharacterCount'::text, 'schemaCharacterCount'::text, 'historyItemCount'::text, 'historyCharacterCount'::text, 'evidenceNoteCount'::text, 'evidenceCharacterCount'::text, 'imageCount'::text, 'videoFrameCount'::text, 'images'::text]) AND ((input_diagnostics ->> 'cacheBoundaryFingerprint'::text) ~ '^[0-9a-f]{64}$'::text) AND (jsonb_typeof((input_diagnostics -> 'images'::text)) = 'array'::text) AND (((input_diagnostics ->> 'promptCharacterCount'::text))::bigint >= 0) AND (((input_diagnostics ->> 'schemaCharacterCount'::text))::bigint >= 0) AND (((input_diagnostics ->> 'historyItemCount'::text))::bigint >= 0) AND (((input_diagnostics ->> 'evidenceNoteCount'::text))::bigint >= 0) AND (((input_diagnostics ->> 'imageCount'::text))::bigint >= 0) AND (((input_diagnostics ->> 'videoFrameCount'::text))::bigint >= 0) AND ((((input_diagnostics ->> 'schemaVersion'::text) = 'agent-request-diagnostics.v1'::text) AND (NOT (input_diagnostics ? 'contentRiskPolicy'::text))) OR (((input_diagnostics ->> 'schemaVersion'::text) = 'agent-request-diagnostics.v2'::text) AND (input_diagnostics ? 'contentRiskPolicy'::text) AND (((input_diagnostics -> 'contentRiskPolicy'::text) = 'null'::jsonb) OR ((jsonb_typeof((input_diagnostics -> 'contentRiskPolicy'::text)) = 'object'::text) AND (((input_diagnostics -> 'contentRiskPolicy'::text) - ARRAY['enabled'::text, 'policyVersion'::text, 'effectiveProfileId'::text, 'effectiveRulesDigest'::text]) = '{}'::jsonb) AND ((input_diagnostics -> 'contentRiskPolicy'::text) ?& ARRAY['enabled'::text, 'policyVersion'::text, 'effectiveProfileId'::text, 'effectiveRulesDigest'::text]) AND (jsonb_typeof(((input_diagnostics -> 'contentRiskPolicy'::text) -> 'enabled'::text)) = 'boolean'::text) AND (((input_diagnostics -> 'contentRiskPolicy'::text) ->> 'effectiveRulesDigest'::text) ~ '^[0-9a-f]{64}$'::text)))))))),
    CONSTRAINT agent_usage_calls_media_counts_check CHECK (((image_input_count >= 0) AND (video_frame_input_count >= 0))),
    CONSTRAINT agent_usage_calls_price_snapshot_check CHECK ((jsonb_typeof(price_snapshot) = 'object'::text)),
    CONSTRAINT agent_usage_calls_provider_check CHECK ((provider = ANY (ARRAY['mock'::text, 'codex-cli'::text, 'openai'::text, 'gemini'::text]))),
    CONSTRAINT agent_usage_calls_stage_check CHECK ((stage = ANY (ARRAY['prepare_draft'::text, 'form_conversation_turn'::text, 'collect_web_research'::text, 'generate_result'::text, 'repair_agent_output'::text, 'generate_content_plan'::text, 'repair_content_plan'::text]))),
    CONSTRAINT agent_usage_calls_status_check CHECK ((status = ANY (ARRAY['started'::text, 'succeeded'::text, 'technical_failed'::text, 'cancelled'::text]))),
    CONSTRAINT agent_usage_calls_task_association_check CHECK ((((association_kind = ANY (ARRAY['draft'::text, 'conversation'::text])) AND (task_id IS NULL)) OR ((association_kind = 'task'::text) AND ((task_id IS NULL) OR (task_id = association_id))))),
    CONSTRAINT agent_usage_calls_terminal_state_check CHECK ((((status = 'started'::text) AND (completed_at IS NULL) AND (duration_ms IS NULL)) OR ((status <> 'started'::text) AND (completed_at IS NOT NULL) AND (duration_ms IS NOT NULL) AND (duration_ms >= 0)))),
    CONSTRAINT agent_usage_calls_token_counts_check CHECK ((((input_tokens IS NULL) OR (input_tokens >= 0)) AND ((text_input_tokens IS NULL) OR (text_input_tokens >= 0)) AND ((image_input_tokens IS NULL) OR (image_input_tokens >= 0)) AND ((cached_input_tokens IS NULL) OR (cached_input_tokens >= 0)) AND ((reasoning_tokens IS NULL) OR (reasoning_tokens >= 0)) AND ((output_tokens IS NULL) OR (output_tokens >= 0)) AND ((total_tokens IS NULL) OR (total_tokens >= 0)) AND (metered_tokens >= 0)))
);

ALTER TABLE ONLY public.agent_usage_calls
    ADD CONSTRAINT agent_usage_calls_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_usage_calls
    ADD CONSTRAINT agent_usage_calls_request_stage_attempt_key UNIQUE (provider_request_id, stage, attempt_number);

CREATE INDEX agent_usage_calls_association_idx ON public.agent_usage_calls USING btree (association_kind, association_id, attempt_number);

CREATE INDEX agent_usage_calls_task_idx ON public.agent_usage_calls USING btree (task_id, attempt_number) WHERE (task_id IS NOT NULL);

CREATE INDEX agent_usage_calls_user_started_idx ON public.agent_usage_calls USING btree (user_id, started_at DESC);

ALTER TABLE public.agent_usage_calls ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_usage_calls FROM PUBLIC, anon, authenticated, service_role;

-- analysis_assets

CREATE TABLE public.analysis_assets (
    id uuid NOT NULL,
    task_id uuid,
    user_id uuid NOT NULL,
    "position" smallint NOT NULL,
    media_type text,
    byte_size integer,
    width integer,
    height integer,
    sha256 text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL,
    cleanup_requested_at timestamp with time zone,
    upload_session_id uuid NOT NULL,
    state text DEFAULT 'awaiting_upload'::text NOT NULL,
    file_name text NOT NULL,
    declared_media_type text NOT NULL,
    declared_byte_size integer NOT NULL,
    original_object_path text NOT NULL,
    processed_object_path text,
    original_sha256 text,
    upload_expires_at timestamp with time zone NOT NULL,
    uploaded_at timestamp with time zone,
    processing_started_at timestamp with time zone,
    processing_attempt_count smallint DEFAULT 0 NOT NULL,
    ready_at timestamp with time zone,
    failure_code text,
    deletion_started_at timestamp with time zone,
    deleted_at timestamp with time zone,
    cleanup_attempt_count smallint DEFAULT 0 NOT NULL,
    cleanup_next_attempt_at timestamp with time zone,
    cleanup_last_error_code text,
    CONSTRAINT analysis_assets_cleanup_attempt_check CHECK (((cleanup_attempt_count >= 0) AND (cleanup_attempt_count <= 5))),
    CONSTRAINT analysis_assets_declared_byte_size_check CHECK (((declared_byte_size >= 1) AND (declared_byte_size <= 5242880))),
    CONSTRAINT analysis_assets_declared_media_type_check CHECK ((declared_media_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text]))),
    CONSTRAINT analysis_assets_expiry_check CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '24:00:00'::interval)))),
    CONSTRAINT analysis_assets_file_name_check CHECK (((char_length(file_name) >= 1) AND (char_length(file_name) <= 255))),
    CONSTRAINT analysis_assets_object_paths_check CHECK (((char_length(original_object_path) >= 1) AND (char_length(original_object_path) <= 1000) AND ((processed_object_path IS NULL) OR ((char_length(processed_object_path) >= 1) AND (char_length(processed_object_path) <= 1000))))),
    CONSTRAINT analysis_assets_position_check CHECK ((("position" >= 0) AND ("position" <= 17))),
    CONSTRAINT analysis_assets_processed_dimensions_check CHECK ((((width IS NULL) AND (height IS NULL)) OR ((width > 0) AND (height > 0) AND (GREATEST(width, height) <= 2048)))),
    CONSTRAINT analysis_assets_processed_media_type_check CHECK (((media_type IS NULL) OR (media_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text])))),
    CONSTRAINT analysis_assets_processed_sha_check CHECK ((((sha256 IS NULL) OR (sha256 ~ '^[0-9a-f]{64}$'::text)) AND ((original_sha256 IS NULL) OR (original_sha256 ~ '^[0-9a-f]{64}$'::text)))),
    CONSTRAINT analysis_assets_processed_size_check CHECK (((byte_size IS NULL) OR (byte_size > 0))),
    CONSTRAINT analysis_assets_processing_attempt_check CHECK (((processing_attempt_count >= 0) AND (processing_attempt_count <= 3))),
    CONSTRAINT analysis_assets_ready_payload_check CHECK (((state <> 'ready'::text) OR ((processed_object_path IS NOT NULL) AND (media_type IS NOT NULL) AND (byte_size IS NOT NULL) AND (width IS NOT NULL) AND (height IS NOT NULL) AND (sha256 IS NOT NULL) AND (original_sha256 IS NOT NULL) AND (ready_at IS NOT NULL) AND (failure_code IS NULL)))),
    CONSTRAINT analysis_assets_state_check CHECK ((state = ANY (ARRAY['awaiting_upload'::text, 'uploaded'::text, 'processing'::text, 'ready'::text, 'failed'::text, 'expired'::text, 'deleting'::text, 'deleted'::text, 'cleanup_failed'::text])))
);

ALTER TABLE ONLY public.analysis_assets
    ADD CONSTRAINT analysis_assets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.analysis_assets
    ADD CONSTRAINT analysis_assets_task_position_unique UNIQUE (task_id, "position");

CREATE INDEX analysis_assets_cleanup_queue_v3_idx ON public.analysis_assets USING btree (COALESCE(cleanup_next_attempt_at, cleanup_requested_at, expires_at), id) WHERE (state <> 'deleted'::text);

CREATE UNIQUE INDEX analysis_assets_original_object_idx ON public.analysis_assets USING btree (original_object_path);

CREATE UNIQUE INDEX analysis_assets_processed_object_idx ON public.analysis_assets USING btree (processed_object_path) WHERE (processed_object_path IS NOT NULL);

CREATE INDEX analysis_assets_processing_queue_idx ON public.analysis_assets USING btree (created_at, id) WHERE (state = 'uploaded'::text);

CREATE UNIQUE INDEX analysis_assets_session_position_idx ON public.analysis_assets USING btree (upload_session_id, "position") WHERE (task_id IS NULL);

CREATE INDEX analysis_assets_status_poll_idx ON public.analysis_assets USING btree (user_id, id, state);

CREATE INDEX analysis_assets_user_created_idx ON public.analysis_assets USING btree (user_id, created_at DESC);

ALTER TABLE public.analysis_assets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_assets FROM PUBLIC, anon, authenticated, service_role;

-- analysis_conversation_controls

CREATE TABLE public.analysis_conversation_controls (
    user_id uuid NOT NULL,
    session_id uuid,
    generation bigint DEFAULT 1 NOT NULL,
    browser_instance_id uuid,
    content_kind text,
    status text DEFAULT 'idle'::text NOT NULL,
    lease_id uuid,
    lease_expires_at timestamp with time zone,
    consumed_tokens bigint DEFAULT 0 NOT NULL,
    rolling_usage_reset_at timestamp with time zone,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analysis_conversation_controls_consumed_tokens_check CHECK ((consumed_tokens >= 0)),
    CONSTRAINT analysis_conversation_controls_content_kind_check CHECK ((content_kind = ANY (ARRAY['text'::text, 'image'::text, 'video'::text]))),
    CONSTRAINT analysis_conversation_controls_generation_check CHECK ((generation > 0)),
    CONSTRAINT analysis_conversation_controls_identity_check CHECK ((((status = 'idle'::text) AND (session_id IS NULL) AND (browser_instance_id IS NULL) AND (content_kind IS NULL) AND (consumed_tokens = 0)) OR ((status <> 'idle'::text) AND (session_id IS NOT NULL) AND (browser_instance_id IS NOT NULL)))),
    CONSTRAINT analysis_conversation_controls_lease_check CHECK ((((status = 'processing'::text) AND (lease_id IS NOT NULL) AND (lease_expires_at IS NOT NULL)) OR ((status <> 'processing'::text) AND (lease_id IS NULL) AND (lease_expires_at IS NULL)))),
    CONSTRAINT analysis_conversation_controls_status_check CHECK ((status = ANY (ARRAY['idle'::text, 'active'::text, 'processing'::text, 'finalized'::text, 'submitted'::text, 'cleared'::text])))
);

ALTER TABLE ONLY public.analysis_conversation_controls
    ADD CONSTRAINT analysis_conversation_controls_pkey PRIMARY KEY (user_id);

CREATE INDEX analysis_conversation_controls_lease_idx ON public.analysis_conversation_controls USING btree (lease_expires_at) WHERE (status = 'processing'::text);

CREATE UNIQUE INDEX analysis_conversation_controls_session_generation_idx ON public.analysis_conversation_controls USING btree (session_id, generation) WHERE (session_id IS NOT NULL);

ALTER TABLE public.analysis_conversation_controls ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_conversation_controls FROM PUBLIC, anon, authenticated, service_role;

-- analysis_conversation_logout_sessions

CREATE TABLE public.analysis_conversation_logout_sessions (
    user_id uuid NOT NULL,
    auth_session_key text NOT NULL,
    logged_out_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    expires_at timestamp with time zone DEFAULT (clock_timestamp() + '24:00:00'::interval) NOT NULL,
    CONSTRAINT analysis_conversation_logout_sessions_expiry_check CHECK ((expires_at > logged_out_at)),
    CONSTRAINT analysis_conversation_logout_sessions_key_check CHECK (((char_length(auth_session_key) >= 1) AND (char_length(auth_session_key) <= 100)))
);

ALTER TABLE ONLY public.analysis_conversation_logout_sessions
    ADD CONSTRAINT analysis_conversation_logout_sessions_pkey PRIMARY KEY (user_id, auth_session_key);

CREATE INDEX analysis_conversation_logout_sessions_expiry_idx ON public.analysis_conversation_logout_sessions USING btree (expires_at, user_id);

ALTER TABLE public.analysis_conversation_logout_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_conversation_logout_sessions FROM PUBLIC, anon, authenticated, service_role;

-- analysis_conversation_turn_runs

CREATE TABLE public.analysis_conversation_turn_runs (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    session_id uuid NOT NULL,
    generation integer NOT NULL,
    browser_instance_id uuid NOT NULL,
    status text DEFAULT 'processing'::text NOT NULL,
    result_payload jsonb,
    failure_reason text,
    processing_expires_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    acknowledged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL,
    CONSTRAINT analysis_conversation_turn_runs_failure_reason_check CHECK (((failure_reason IS NULL) OR (failure_reason = ANY (ARRAY['turn_failed'::text, 'server_restarted'::text, 'conversation_cleared'::text, 'logged_out'::text])))),
    CONSTRAINT analysis_conversation_turn_runs_generation_check CHECK ((generation > 0)),
    CONSTRAINT analysis_conversation_turn_runs_payload_check CHECK ((((status = 'processing'::text) AND (result_payload IS NULL) AND (failure_reason IS NULL) AND (completed_at IS NULL) AND (acknowledged_at IS NULL)) OR ((status = 'completed'::text) AND (result_payload IS NOT NULL) AND (failure_reason IS NULL) AND (completed_at IS NOT NULL) AND (acknowledged_at IS NULL)) OR ((status = 'failed'::text) AND (result_payload IS NULL) AND (failure_reason = ANY (ARRAY['turn_failed'::text, 'server_restarted'::text])) AND (completed_at IS NOT NULL) AND (acknowledged_at IS NULL)) OR ((status = 'cancelled'::text) AND (result_payload IS NULL) AND (failure_reason = ANY (ARRAY['conversation_cleared'::text, 'logged_out'::text])) AND (completed_at IS NOT NULL) AND (acknowledged_at IS NULL)) OR ((status = 'acknowledged'::text) AND (result_payload IS NULL) AND (failure_reason IS NULL) AND (completed_at IS NOT NULL) AND (acknowledged_at IS NOT NULL)))),
    CONSTRAINT analysis_conversation_turn_runs_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'acknowledged'::text]))),
    CONSTRAINT analysis_conversation_turn_runs_time_check CHECK (((processing_expires_at > created_at) AND (expires_at > created_at) AND (expires_at <= (created_at + '24:00:00'::interval))))
);

ALTER TABLE ONLY public.analysis_conversation_turn_runs
    ADD CONSTRAINT analysis_conversation_turn_runs_pkey PRIMARY KEY (id);

CREATE INDEX analysis_conversation_turn_runs_expiry_idx ON public.analysis_conversation_turn_runs USING btree (expires_at, id);

CREATE UNIQUE INDEX analysis_conversation_turn_runs_one_processing_user_idx ON public.analysis_conversation_turn_runs USING btree (user_id) WHERE (status = 'processing'::text);

CREATE INDEX analysis_conversation_turn_runs_recovery_idx ON public.analysis_conversation_turn_runs USING btree (user_id, browser_instance_id, session_id, generation, id);

ALTER TABLE public.analysis_conversation_turn_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_conversation_turn_runs FROM PUBLIC, anon, authenticated, service_role;

-- analysis_draft_send_reservations

CREATE TABLE public.analysis_draft_send_reservations (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    window_started_at timestamp with time zone NOT NULL,
    state text DEFAULT 'reserved'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analysis_draft_send_reservations_state_check CHECK ((state = ANY (ARRAY['reserved'::text, 'committed'::text, 'released'::text])))
);

ALTER TABLE ONLY public.analysis_draft_send_reservations
    ADD CONSTRAINT analysis_draft_send_reservations_pkey PRIMARY KEY (id);

CREATE INDEX analysis_draft_send_reservations_user_state_idx ON public.analysis_draft_send_reservations USING btree (user_id, state, created_at);

ALTER TABLE public.analysis_draft_send_reservations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_draft_send_reservations FROM PUBLIC, anon, authenticated, service_role;

-- analysis_draft_send_windows

CREATE TABLE public.analysis_draft_send_windows (
    user_id uuid NOT NULL,
    window_started_at timestamp with time zone NOT NULL,
    accepted_count smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analysis_draft_send_windows_count_check CHECK (((accepted_count >= 0) AND (accepted_count <= 16)))
);

ALTER TABLE ONLY public.analysis_draft_send_windows
    ADD CONSTRAINT analysis_draft_send_windows_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.analysis_draft_send_windows
    ADD CONSTRAINT analysis_draft_send_windows_user_start_key UNIQUE (user_id, window_started_at);

ALTER TABLE public.analysis_draft_send_windows ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_draft_send_windows FROM PUBLIC, anon, authenticated, service_role;

-- analysis_evidence_sets

CREATE TABLE public.analysis_evidence_sets (
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    evidence_version text NOT NULL,
    evidence_query_version text NOT NULL,
    matched_note_count integer NOT NULL,
    selected_note_count integer NOT NULL,
    selection_criteria jsonb NOT NULL,
    evidence_set jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analysis_evidence_sets_counts_check CHECK (((matched_note_count >= 0) AND ((selected_note_count >= 0) AND (selected_note_count <= 1000)))),
    CONSTRAINT analysis_evidence_sets_json_check CHECK (((jsonb_typeof(selection_criteria) = 'object'::text) AND (jsonb_typeof(evidence_set) = 'object'::text) AND ((evidence_set ->> 'schemaVersion'::text) = 'analysis-evidence.v3'::text) AND ((evidence_set ->> 'evidenceVersion'::text) = evidence_version) AND (jsonb_typeof((evidence_set -> 'notes'::text)) = 'array'::text) AND (jsonb_array_length((evidence_set -> 'notes'::text)) = selected_note_count) AND (((evidence_set ->> 'matchedNoteCount'::text))::integer = matched_note_count))),
    CONSTRAINT analysis_evidence_sets_query_version_check CHECK (((char_length(evidence_query_version) >= 1) AND (char_length(evidence_query_version) <= 100))),
    CONSTRAINT analysis_evidence_sets_version_check CHECK ((evidence_version ~ '^[0-9a-f]{64}$'::text))
);

ALTER TABLE ONLY public.analysis_evidence_sets
    ADD CONSTRAINT analysis_evidence_sets_pkey PRIMARY KEY (task_id);

CREATE INDEX analysis_evidence_sets_user_created_idx ON public.analysis_evidence_sets USING btree (user_id, created_at DESC);

ALTER TABLE public.analysis_evidence_sets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_evidence_sets FROM PUBLIC, anon, authenticated, service_role;

-- analysis_media_upload_sessions

CREATE TABLE public.analysis_media_upload_sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    file_count smallint NOT NULL,
    total_bytes bigint NOT NULL,
    state text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT analysis_media_upload_sessions_file_count_check CHECK (((file_count >= 1) AND (file_count <= 18))),
    CONSTRAINT analysis_media_upload_sessions_state_check CHECK ((state = ANY (ARRAY['open'::text, 'completed'::text, 'expired'::text]))),
    CONSTRAINT analysis_media_upload_sessions_time_check CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '00:10:00'::interval)) AND (((state = 'open'::text) AND (completed_at IS NULL)) OR (state <> 'open'::text)))),
    CONSTRAINT analysis_media_upload_sessions_total_bytes_check CHECK (((total_bytes >= 1) AND (total_bytes <= 83886080)))
);

ALTER TABLE ONLY public.analysis_media_upload_sessions
    ADD CONSTRAINT analysis_media_upload_sessions_id_user_unique UNIQUE (id, user_id);

ALTER TABLE ONLY public.analysis_media_upload_sessions
    ADD CONSTRAINT analysis_media_upload_sessions_pkey PRIMARY KEY (id);

ALTER TABLE public.analysis_media_upload_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_media_upload_sessions FROM PUBLIC, anon, authenticated, service_role;

-- analysis_results

CREATE TABLE public.analysis_results (
    task_id uuid NOT NULL,
    result_version smallint NOT NULL,
    user_id uuid NOT NULL,
    level numeric(5,2) NOT NULL,
    result_schema_version text NOT NULL,
    internal_execution_trace jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    checkup_report jsonb NOT NULL,
    CONSTRAINT analysis_results_internal_trace_check CHECK ((((jsonb_typeof(internal_execution_trace) = 'object'::text) AND ((internal_execution_trace ->> 'schemaVersion'::text) = 'execution-trace.v4'::text) AND ((internal_execution_trace ->> 'taskStructureVersion'::text) = 'analysis-task.v6'::text) AND (internal_execution_trace ?& ARRAY['provider'::text, 'model'::text, 'requestId'::text, 'executionId'::text, 'algorithmVersion'::text, 'evidenceSourceVersion'::text, 'generateResultPromptVersion'::text, 'taskStructureVersion'::text, 'evidenceVersion'::text, 'checkupFeatureHash'::text, 'topicEvidence'::text, 'matchedNoteCount'::text, 'usage'::text]) AND (NOT (internal_execution_trace ?| ARRAY['generationMode'::text, 'bestContentPlanPromptVersion'::text, 'contentPlanPromptVersion'::text, 'noteMetricReports'::text, 'commonMetricReports'::text, 'agentMetricReports'::text, 'effectiveWeights'::text, 'levelWeights'::text])) AND ((internal_execution_trace ->> 'evidenceVersion'::text) ~ '^[0-9a-f]{64}$'::text) AND ((internal_execution_trace ->> 'checkupFeatureHash'::text) ~ '^[0-9a-f]{64}$'::text)) IS TRUE)),
    CONSTRAINT analysis_results_level_check CHECK (((level >= (0)::numeric) AND (level <= (100)::numeric))),
    CONSTRAINT analysis_results_result_version_check CHECK ((result_version > 0))
);

ALTER TABLE ONLY public.analysis_results
    ADD CONSTRAINT analysis_results_pkey PRIMARY KEY (task_id, result_version);

CREATE INDEX analysis_results_retention_idx ON public.analysis_results USING btree (created_at, task_id, result_version);

CREATE INDEX analysis_results_user_idx ON public.analysis_results USING btree (user_id);

ALTER TABLE public.analysis_results ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_results FROM PUBLIC, anon, authenticated, service_role;

-- analysis_tasks

CREATE TABLE public.analysis_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    input_mode text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    structure_config_version text NOT NULL,
    standard_task_snapshot jsonb NOT NULL,
    failure_code text,
    failure_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    attempt_count smallint DEFAULT 0 NOT NULL,
    manual_retry_count integer DEFAULT 0 NOT NULL,
    queued_at timestamp with time zone DEFAULT now() NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    lease_expires_at timestamp with time zone,
    worker_id text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    input_fingerprint text NOT NULL,
    quantification_fingerprint text NOT NULL,
    level_fingerprint text NOT NULL,
    generation_fingerprint text NOT NULL,
    web_research_enabled boolean DEFAULT true NOT NULL,
    cancellation_reason text,
    CONSTRAINT analysis_tasks_attempt_count_check CHECK (((attempt_count >= 0) AND (attempt_count <= 2))),
    CONSTRAINT analysis_tasks_cancellation_reason_check CHECK (cancellation_reason IS NULL OR (status = 'cancelled' AND char_length(cancellation_reason) BETWEEN 1 AND 100)),
    CONSTRAINT analysis_tasks_checkup_contract_check CHECK ((((structure_config_version = 'analysis-task.v6'::text) AND (jsonb_typeof(standard_task_snapshot) = 'object'::text) AND ((standard_task_snapshot ->> 'structureVersion'::text) = structure_config_version) AND ((standard_task_snapshot ->> 'contentKind'::text) = ANY (ARRAY['image'::text, 'video'::text])) AND (standard_task_snapshot ?& ARRAY['fields'::text, 'imageReferences'::text, 'videoEvidence'::text]) AND (NOT (standard_task_snapshot ?| ARRAY['generationPreferences'::text, 'generationConstraints'::text])) AND ((standard_task_snapshot ->> 'rawText'::text) = ''::text) AND (jsonb_typeof((standard_task_snapshot #> '{fields,title,value}'::text[])) = 'string'::text) AND ((char_length(btrim((standard_task_snapshot #>> '{fields,title,value}'::text[]))) >= 1) AND (char_length(btrim((standard_task_snapshot #>> '{fields,title,value}'::text[]))) <= 200)) AND (jsonb_typeof((standard_task_snapshot #> '{fields,body,value}'::text[])) = 'string'::text) AND ((char_length(btrim((standard_task_snapshot #>> '{fields,body,value}'::text[]))) >= 0) AND (char_length(btrim((standard_task_snapshot #>> '{fields,body,value}'::text[]))) <= 1000)) AND (jsonb_typeof((standard_task_snapshot #> '{fields,topics,value}'::text[])) = 'array'::text) AND ((jsonb_array_length((standard_task_snapshot #> '{fields,topics,value}'::text[])) >= 1) AND (jsonb_array_length((standard_task_snapshot #> '{fields,topics,value}'::text[])) <= 25)) AND ((NOT (standard_task_snapshot ? 'coverReference'::text)) OR ((jsonb_typeof((standard_task_snapshot -> 'coverReference'::text)) = 'string'::text) AND ((standard_task_snapshot ->> 'coverReference'::text) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text))) AND (jsonb_typeof((standard_task_snapshot -> 'imageReferences'::text)) = 'array'::text) AND ((((standard_task_snapshot ->> 'contentKind'::text) = 'image'::text) AND ((jsonb_array_length((standard_task_snapshot -> 'imageReferences'::text)) >= 0) AND (jsonb_array_length((standard_task_snapshot -> 'imageReferences'::text)) <= 18)) AND ((NOT (standard_task_snapshot ? 'coverReference'::text)) OR ((standard_task_snapshot -> 'imageReferences'::text) ? (standard_task_snapshot ->> 'coverReference'::text))) AND (jsonb_typeof((standard_task_snapshot -> 'videoEvidence'::text)) = 'null'::text)) OR (((standard_task_snapshot ->> 'contentKind'::text) = 'video'::text) AND (jsonb_array_length((standard_task_snapshot -> 'imageReferences'::text)) = 0) AND (jsonb_typeof((standard_task_snapshot -> 'videoEvidence'::text)) = 'object'::text)))) IS TRUE)),
    CONSTRAINT analysis_tasks_generation_fingerprint_check CHECK ((generation_fingerprint ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT analysis_tasks_input_fingerprint_check CHECK ((input_fingerprint ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT analysis_tasks_input_mode_check CHECK ((input_mode = ANY (ARRAY['agent'::text, 'custom'::text]))),
    CONSTRAINT analysis_tasks_lease_check CHECK (((lease_expires_at IS NULL) OR ((started_at IS NOT NULL) AND (lease_expires_at > started_at)))),
    CONSTRAINT analysis_tasks_level_fingerprint_check CHECK ((level_fingerprint ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT analysis_tasks_manual_retry_count_check CHECK ((manual_retry_count >= 0)),
    CONSTRAINT analysis_tasks_quantification_fingerprint_check CHECK ((quantification_fingerprint ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT analysis_tasks_status_check CHECK ((status = ANY (ARRAY['researching'::text, 'queued'::text, 'processing'::text, 'retrying'::text, 'succeeded'::text, 'technical_failed'::text, 'abandoned'::text, 'cancelled'::text]))),
    CONSTRAINT analysis_tasks_status_payload_check CHECK ((((status = 'researching'::text) AND (attempt_count = 0) AND (started_at IS NULL) AND (lease_expires_at IS NULL) AND (worker_id IS NULL) AND (completed_at IS NULL) AND (failure_code IS NULL) AND (failure_message IS NULL)) OR ((status = 'queued'::text) AND (attempt_count = 0) AND (started_at IS NULL) AND (lease_expires_at IS NULL) AND (worker_id IS NULL) AND (completed_at IS NULL) AND (failure_code IS NULL) AND (failure_message IS NULL)) OR ((status = 'processing'::text) AND ((attempt_count >= 1) AND (attempt_count <= 2)) AND (started_at IS NOT NULL) AND (lease_expires_at IS NOT NULL) AND (worker_id IS NOT NULL) AND (completed_at IS NULL) AND (failure_code IS NULL) AND (failure_message IS NULL)) OR ((status = 'retrying'::text) AND ((attempt_count >= 1) AND (attempt_count <= 2)) AND (started_at IS NOT NULL) AND (completed_at IS NULL) AND (failure_code IS NULL) AND (failure_message IS NULL) AND (((lease_expires_at IS NULL) AND (worker_id IS NULL)) OR ((lease_expires_at IS NOT NULL) AND (worker_id IS NOT NULL)))) OR ((status = 'succeeded'::text) AND ((attempt_count >= 1) AND (attempt_count <= 2)) AND (lease_expires_at IS NULL) AND (worker_id IS NULL) AND (completed_at IS NOT NULL) AND (failure_code IS NULL) AND (failure_message IS NULL)) OR ((status = 'technical_failed'::text) AND ((attempt_count >= 1) AND (attempt_count <= 2)) AND (lease_expires_at IS NULL) AND (worker_id IS NULL) AND (completed_at IS NOT NULL) AND (failure_code IS NOT NULL) AND (failure_message IS NOT NULL)) OR ((status = 'abandoned'::text) AND ((attempt_count >= 0) AND (attempt_count <= 2)) AND (lease_expires_at IS NULL) AND (worker_id IS NULL) AND (completed_at IS NOT NULL) AND (failure_code IS NULL) AND (failure_message IS NULL)) OR ((status = 'cancelled'::text) AND ((attempt_count >= 0) AND (attempt_count <= 2)) AND (lease_expires_at IS NULL) AND (worker_id IS NULL) AND (completed_at IS NOT NULL) AND (failure_code IS NULL) AND (failure_message IS NULL))))
);

ALTER TABLE ONLY public.analysis_tasks
    ADD CONSTRAINT analysis_tasks_id_user_unique UNIQUE (id, user_id);

ALTER TABLE ONLY public.analysis_tasks
    ADD CONSTRAINT analysis_tasks_pkey PRIMARY KEY (id);

CREATE INDEX analysis_tasks_queue_claim_idx ON public.analysis_tasks USING btree (available_at, queued_at, id) WHERE (status = ANY (ARRAY['queued'::text, 'retrying'::text]));

CREATE INDEX analysis_tasks_reuse_idx ON public.analysis_tasks USING btree (user_id, quantification_fingerprint, level_fingerprint, generation_fingerprint, completed_at DESC) WHERE (status = 'succeeded'::text);

CREATE INDEX analysis_tasks_terminal_retention_idx ON public.analysis_tasks USING btree (completed_at, id) WHERE ((completed_at IS NOT NULL) AND (status = ANY (ARRAY['succeeded'::text, 'technical_failed'::text, 'abandoned'::text, 'cancelled'::text])));

CREATE UNIQUE INDEX analysis_tasks_user_active_idx ON public.analysis_tasks USING btree (user_id) WHERE (status = ANY (ARRAY['researching'::text, 'queued'::text, 'processing'::text, 'retrying'::text]));

CREATE INDEX analysis_tasks_user_created_idx ON public.analysis_tasks USING btree (user_id, created_at DESC);

ALTER TABLE public.analysis_tasks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_tasks FROM PUBLIC, anon, authenticated, service_role;

-- analysis_web_research_snapshots

CREATE TABLE public.analysis_web_research_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    generation_version integer NOT NULL,
    status text NOT NULL,
    summary text,
    key_facts jsonb DEFAULT '[]'::jsonb NOT NULL,
    conflicts jsonb DEFAULT '[]'::jsonb NOT NULL,
    adopted_sources jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_time timestamp with time zone,
    query_version text NOT NULL,
    snapshot_version text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    allocated_tokens integer DEFAULT 0 NOT NULL,
    worker_id uuid,
    lease_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analysis_web_research_snapshots_budget_check CHECK (((attempt_count >= 0) AND (attempt_count <= 1) AND ((allocated_tokens >= 0) AND (allocated_tokens <= 12000)))),
    CONSTRAINT analysis_web_research_snapshots_generation_check CHECK ((generation_version > 0)),
    CONSTRAINT analysis_web_research_snapshots_json_check CHECK (((jsonb_typeof(key_facts) = 'array'::text) AND (jsonb_typeof(conflicts) = 'array'::text) AND (jsonb_typeof(adopted_sources) = 'array'::text) AND (jsonb_array_length(adopted_sources) <= 5))),
    CONSTRAINT analysis_web_research_snapshots_payload_check CHECK ((((status = 'collecting'::text) AND (summary IS NULL) AND (jsonb_array_length(key_facts) = 0) AND (jsonb_array_length(conflicts) = 0) AND (jsonb_array_length(adopted_sources) = 0) AND (source_time IS NULL) AND (worker_id IS NOT NULL) AND (lease_expires_at IS NOT NULL)) OR ((status = 'collected'::text) AND (summary IS NOT NULL) AND (char_length(summary) > 0) AND (jsonb_array_length(adopted_sources) > 0) AND (source_time IS NOT NULL) AND (worker_id IS NULL) AND (lease_expires_at IS NULL)) OR ((status = 'no_sources'::text) AND (summary IS NULL) AND (jsonb_array_length(key_facts) = 0) AND (jsonb_array_length(conflicts) = 0) AND (jsonb_array_length(adopted_sources) = 0) AND (source_time IS NOT NULL) AND (worker_id IS NULL) AND (lease_expires_at IS NULL)))),
    CONSTRAINT analysis_web_research_snapshots_status_check CHECK ((status = ANY (ARRAY['collecting'::text, 'collected'::text, 'no_sources'::text])))
);

ALTER TABLE ONLY public.analysis_web_research_snapshots
    ADD CONSTRAINT analysis_web_research_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.analysis_web_research_snapshots
    ADD CONSTRAINT analysis_web_research_snapshots_task_generation_key UNIQUE (task_id, generation_version);

CREATE INDEX analysis_web_research_snapshots_collecting_idx ON public.analysis_web_research_snapshots USING btree (status, lease_expires_at, created_at);

CREATE INDEX analysis_web_research_snapshots_user_created_idx ON public.analysis_web_research_snapshots USING btree (user_id, created_at DESC);

ALTER TABLE public.analysis_web_research_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_web_research_snapshots FROM PUBLIC, anon, authenticated, service_role;

-- auth_login_throttles

CREATE TABLE public.auth_login_throttles (
    scope text NOT NULL,
    key_hash text NOT NULL,
    failed_count integer DEFAULT 1 NOT NULL,
    attempt_limit integer NOT NULL,
    observation_window_ms integer NOT NULL,
    lock_duration_ms integer NOT NULL,
    window_started_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_until timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auth_login_throttles_attempt_limit_check CHECK ((attempt_limit > 0)),
    CONSTRAINT auth_login_throttles_failed_count_check CHECK ((failed_count > 0)),
    CONSTRAINT auth_login_throttles_key_hash_check CHECK ((key_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT auth_login_throttles_lock_duration_check CHECK ((lock_duration_ms > 0)),
    CONSTRAINT auth_login_throttles_locked_until_check CHECK (((locked_until IS NULL) OR (locked_until > window_started_at))),
    CONSTRAINT auth_login_throttles_observation_window_check CHECK ((observation_window_ms > 0)),
    CONSTRAINT auth_login_throttles_scope_check CHECK ((scope = ANY (ARRAY['identifier'::text, 'device'::text, 'ip'::text])))
);

ALTER TABLE ONLY public.auth_login_throttles
    ADD CONSTRAINT auth_login_throttles_pkey PRIMARY KEY (scope, key_hash);

CREATE INDEX auth_login_throttles_cleanup_idx ON public.auth_login_throttles USING btree (updated_at, scope, key_hash);

ALTER TABLE public.auth_login_throttles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.auth_login_throttles FROM PUBLIC, anon, authenticated, service_role;

-- auth_password_change_throttles

CREATE TABLE public.auth_password_change_throttles (
    scope text NOT NULL,
    key_hash text NOT NULL,
    failed_count integer NOT NULL,
    attempt_limit integer NOT NULL,
    observation_window_ms integer NOT NULL,
    window_started_at timestamp with time zone NOT NULL,
    blocked_until timestamp with time zone,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT auth_password_change_throttles_attempt_limit_check CHECK ((attempt_limit > 0)),
    CONSTRAINT auth_password_change_throttles_blocked_until_check CHECK (((blocked_until IS NULL) OR (blocked_until > window_started_at))),
    CONSTRAINT auth_password_change_throttles_failed_count_check CHECK ((failed_count > 0)),
    CONSTRAINT auth_password_change_throttles_key_hash_check CHECK ((key_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT auth_password_change_throttles_observation_window_check CHECK ((observation_window_ms > 0)),
    CONSTRAINT auth_password_change_throttles_scope_check CHECK ((scope = ANY (ARRAY['account'::text, 'ip'::text])))
);

ALTER TABLE ONLY public.auth_password_change_throttles
    ADD CONSTRAINT auth_password_change_throttles_pkey PRIMARY KEY (scope, key_hash);

CREATE INDEX auth_password_change_throttles_cleanup_idx ON public.auth_password_change_throttles USING btree (updated_at, scope, key_hash);

ALTER TABLE public.auth_password_change_throttles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.auth_password_change_throttles FROM PUBLIC, anon, authenticated, service_role;

-- business_notifications

CREATE TABLE public.business_notifications (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL,
    type text NOT NULL CHECK (type = 'analysis.completed'),
    payload jsonb NOT NULL,
    analysis_task_id uuid NOT NULL,
    analysis_result_version smallint NOT NULL CHECK (analysis_result_version > 0),
    deduplication_key text NOT NULL CHECK (char_length(deduplication_key) BETWEEN 1 AND 200),
    created_at timestamptz DEFAULT now() NOT NULL,
    read_at timestamptz CHECK (read_at IS NULL OR read_at >= created_at),
    CONSTRAINT business_notifications_analysis_payload_check CHECK (
        payload = jsonb_build_object('taskId', analysis_task_id::text, 'resultVersion', analysis_result_version)
        AND deduplication_key = 'analysis:' || analysis_task_id::text || ':result:' || analysis_result_version::text
    )
);

ALTER TABLE ONLY public.business_notifications
    ADD CONSTRAINT business_notifications_id_user_unique UNIQUE (id, user_id);

ALTER TABLE ONLY public.business_notifications
    ADD CONSTRAINT business_notifications_user_deduplication_unique UNIQUE (user_id, deduplication_key);

CREATE INDEX business_notifications_user_created_idx ON public.business_notifications USING btree (user_id, created_at DESC, id DESC);

CREATE INDEX business_notifications_user_unread_idx ON public.business_notifications USING btree (user_id, created_at DESC, id DESC) WHERE (read_at IS NULL);

ALTER TABLE public.business_notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_notifications FROM PUBLIC, anon, authenticated, service_role;

-- skill_anonymous_requests

CREATE TABLE public.skill_anonymous_requests (
    id text NOT NULL,
    ip text NOT NULL,
    machine text NOT NULL,
    day date NOT NULL,
    user_id uuid NOT NULL
);

ALTER TABLE ONLY public.skill_anonymous_requests
    ADD CONSTRAINT skill_anonymous_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.skill_anonymous_requests
    ADD CONSTRAINT skill_anonymous_requests_user_id_key UNIQUE (user_id);

CREATE INDEX skill_anonymous_ip_day ON public.skill_anonymous_requests USING btree (day, ip);

CREATE INDEX skill_anonymous_machine ON public.skill_anonymous_requests USING btree (machine);

ALTER TABLE public.skill_anonymous_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.skill_anonymous_requests FROM PUBLIC, anon, authenticated, service_role;

-- skill_device_grants

CREATE TABLE public.skill_device_grants (
    id text NOT NULL,
    payload jsonb NOT NULL,
    user_id uuid GENERATED ALWAYS AS (((payload ->> 'userId'::text))::uuid) STORED,
    CONSTRAINT skill_device_grants_check CHECK (((jsonb_typeof(payload) = 'object'::text) AND ((payload ->> 'id'::text) = id)))
);

ALTER TABLE ONLY public.skill_device_grants
    ADD CONSTRAINT skill_device_grants_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX skill_grants_access ON public.skill_device_grants USING btree (((payload ->> 'accessHash'::text)));

CREATE UNIQUE INDEX skill_grants_code ON public.skill_device_grants USING btree (((payload ->> 'codeHash'::text)));

CREATE INDEX skill_grants_owner ON public.skill_device_grants USING btree (((payload ->> 'userId'::text)));

ALTER TABLE public.skill_device_grants ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.skill_device_grants FROM PUBLIC, anon, authenticated, service_role;

-- skill_request_limits

CREATE TABLE public.skill_request_limits (
    key text NOT NULL,
    window_id bigint NOT NULL,
    count integer NOT NULL,
    CONSTRAINT skill_request_limits_count_check CHECK ((count > 0))
);

ALTER TABLE ONLY public.skill_request_limits
    ADD CONSTRAINT skill_request_limits_pkey PRIMARY KEY (key);

ALTER TABLE public.skill_request_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.skill_request_limits FROM PUBLIC, anon, authenticated, service_role;

-- workspace_event_versions

CREATE TABLE public.workspace_event_versions (
    user_id uuid NOT NULL,
    last_event_id bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_event_versions_nonnegative_check CHECK ((last_event_id >= 0))
);

ALTER TABLE ONLY public.workspace_event_versions
    ADD CONSTRAINT workspace_event_versions_pkey PRIMARY KEY (user_id);

ALTER TABLE public.workspace_event_versions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.workspace_event_versions FROM PUBLIC, anon, authenticated, service_role;
