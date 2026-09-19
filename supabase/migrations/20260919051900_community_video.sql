-- 社区版视频预处理、证据和短期恢复存储；不包含任何媒体对象。
-- analysis_video_assets

CREATE TABLE public.analysis_video_assets (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    upload_session_id uuid NOT NULL,
    state text DEFAULT 'awaiting_upload'::text NOT NULL,
    file_name text NOT NULL,
    declared_media_type text NOT NULL,
    declared_byte_size bigint NOT NULL,
    original_object_path text NOT NULL,
    upload_expires_at timestamp with time zone NOT NULL,
    verified_media_type text,
    verified_byte_size bigint,
    processing_attempt_count smallint DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone,
    failure_code text,
    failure_detail text,
    evidence_id uuid,
    uploaded_at timestamp with time zone,
    queued_at timestamp with time zone,
    processing_started_at timestamp with time zone,
    ready_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    original_cleanup_state text DEFAULT 'retained'::text NOT NULL,
    original_cleanup_attempt_count smallint DEFAULT 0 NOT NULL,
    original_cleanup_next_attempt_at timestamp with time zone,
    original_cleanup_last_error_code text,
    original_cleanup_worker_id text,
    original_cleanup_lease_expires_at timestamp with time zone,
    original_deleted_at timestamp with time zone,
    cancellation_requested_at timestamp with time zone,
    CONSTRAINT analysis_video_assets_attempt_count_check CHECK (((processing_attempt_count >= 0) AND (processing_attempt_count <= 2))),
    CONSTRAINT analysis_video_assets_declared_size_check CHECK (((declared_byte_size >= 1) AND (declared_byte_size <= 419430400))),
    CONSTRAINT analysis_video_assets_file_name_check CHECK (((char_length(file_name) >= 1) AND (char_length(file_name) <= 255))),
    CONSTRAINT analysis_video_assets_media_type_check CHECK ((declared_media_type = ANY (ARRAY['video/mp4'::text, 'video/quicktime'::text]))),
    CONSTRAINT analysis_video_assets_original_cleanup_attempts_check CHECK (((original_cleanup_attempt_count >= 0) AND (original_cleanup_attempt_count <= 5))),
    CONSTRAINT analysis_video_assets_original_cleanup_state_check CHECK ((original_cleanup_state = ANY (ARRAY['retained'::text, 'deleting'::text, 'deleted'::text, 'cleanup_failed'::text]))),
    CONSTRAINT analysis_video_assets_state_check CHECK ((state = ANY (ARRAY['awaiting_upload'::text, 'uploaded'::text, 'queued'::text, 'processing'::text, 'ready'::text, 'deterministic_failed'::text, 'technical_failed'::text, 'cancelled'::text, 'expired'::text, 'deleting'::text, 'deleted'::text, 'cleanup_failed'::text]))),
    CONSTRAINT analysis_video_assets_verified_size_check CHECK (((verified_byte_size IS NULL) OR ((verified_byte_size >= 1) AND (verified_byte_size <= 419430400))))
);

ALTER TABLE ONLY public.analysis_video_assets
    ADD CONSTRAINT analysis_video_assets_original_object_path_key UNIQUE (original_object_path);

ALTER TABLE ONLY public.analysis_video_assets
    ADD CONSTRAINT analysis_video_assets_owner_key UNIQUE (id, user_id);

ALTER TABLE ONLY public.analysis_video_assets
    ADD CONSTRAINT analysis_video_assets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.analysis_video_assets
    ADD CONSTRAINT analysis_video_assets_session_key UNIQUE (upload_session_id);

CREATE UNIQUE INDEX analysis_video_assets_one_active_per_user_idx ON public.analysis_video_assets USING btree (user_id) WHERE (state = ANY (ARRAY['awaiting_upload'::text, 'uploaded'::text, 'queued'::text, 'processing'::text]));

CREATE INDEX analysis_video_assets_original_cleanup_idx ON public.analysis_video_assets USING btree (original_cleanup_next_attempt_at, original_cleanup_lease_expires_at, updated_at, id) WHERE (original_cleanup_state = ANY (ARRAY['retained'::text, 'deleting'::text, 'cleanup_failed'::text]));

CREATE INDEX analysis_video_assets_owner_state_idx ON public.analysis_video_assets USING btree (user_id, state, created_at DESC);

CREATE INDEX analysis_video_assets_queue_idx ON public.analysis_video_assets USING btree (next_attempt_at, queued_at, id) WHERE (state = ANY (ARRAY['queued'::text, 'technical_failed'::text]));

CREATE INDEX analysis_video_assets_upload_expiry_idx ON public.analysis_video_assets USING btree (upload_expires_at, id) WHERE (state = 'awaiting_upload'::text);

ALTER TABLE public.analysis_video_assets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_video_assets FROM PUBLIC, anon, authenticated, service_role;

-- analysis_video_evidence_frames

CREATE TABLE public.analysis_video_evidence_frames (
    id uuid NOT NULL,
    evidence_package_id uuid NOT NULL,
    "position" smallint NOT NULL,
    timestamp_ms bigint NOT NULL,
    selection_reason text NOT NULL,
    object_path text NOT NULL,
    sha256 text NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    byte_size bigint NOT NULL,
    media_type text DEFAULT 'image/webp'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analysis_video_evidence_frames_dimensions_check CHECK (((width > 0) AND (height > 0))),
    CONSTRAINT analysis_video_evidence_frames_hash_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT analysis_video_evidence_frames_media_type_check CHECK ((media_type = 'image/webp'::text)),
    CONSTRAINT analysis_video_evidence_frames_position_check CHECK ((("position" >= 0) AND ("position" <= 49))),
    CONSTRAINT analysis_video_evidence_frames_size_check CHECK ((byte_size > 0)),
    CONSTRAINT analysis_video_evidence_frames_timestamp_check CHECK ((timestamp_ms >= 0))
);

ALTER TABLE ONLY public.analysis_video_evidence_frames
    ADD CONSTRAINT analysis_video_evidence_frames_object_path_key UNIQUE (object_path);

ALTER TABLE ONLY public.analysis_video_evidence_frames
    ADD CONSTRAINT analysis_video_evidence_frames_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.analysis_video_evidence_frames
    ADD CONSTRAINT analysis_video_evidence_frames_position_key UNIQUE (evidence_package_id, "position");

CREATE INDEX analysis_video_evidence_frames_package_idx ON public.analysis_video_evidence_frames USING btree (evidence_package_id, "position");

ALTER TABLE public.analysis_video_evidence_frames ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_video_evidence_frames FROM PUBLIC, anon, authenticated, service_role;

-- analysis_video_evidence_packages

CREATE TABLE public.analysis_video_evidence_packages (
    id uuid NOT NULL,
    asset_id uuid NOT NULL,
    evidence_version text NOT NULL,
    original_sha256 text NOT NULL,
    duration_ms bigint NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    container text NOT NULL,
    video_codec text NOT NULL,
    has_audio boolean NOT NULL,
    media_metadata jsonb NOT NULL,
    pipeline_version text NOT NULL,
    pipeline_config_version text NOT NULL,
    ffmpeg_version text NOT NULL,
    manifest_object_path text NOT NULL,
    generated_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    cleanup_state text DEFAULT 'retained'::text NOT NULL,
    cleanup_attempt_count smallint DEFAULT 0 NOT NULL,
    cleanup_next_attempt_at timestamp with time zone,
    cleanup_last_error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cleanup_worker_id text,
    cleanup_lease_expires_at timestamp with time zone,
    deleted_at timestamp with time zone,
    CONSTRAINT analysis_video_evidence_packages_cleanup_attempts_check CHECK (((cleanup_attempt_count >= 0) AND (cleanup_attempt_count <= 5))),
    CONSTRAINT analysis_video_evidence_packages_cleanup_state_check CHECK ((cleanup_state = ANY (ARRAY['retained'::text, 'deleting'::text, 'deleted'::text, 'cleanup_failed'::text]))),
    CONSTRAINT analysis_video_evidence_packages_dimensions_check CHECK (((width > 0) AND (height > 0))),
    CONSTRAINT analysis_video_evidence_packages_duration_check CHECK ((duration_ms > 0)),
    CONSTRAINT analysis_video_evidence_packages_expiry_check CHECK ((expires_at > generated_at)),
    CONSTRAINT analysis_video_evidence_packages_hash_check CHECK ((original_sha256 ~ '^[0-9a-f]{64}$'::text))
);

ALTER TABLE ONLY public.analysis_video_evidence_packages
    ADD CONSTRAINT analysis_video_evidence_packages_asset_id_key UNIQUE (asset_id);

ALTER TABLE ONLY public.analysis_video_evidence_packages
    ADD CONSTRAINT analysis_video_evidence_packages_id_asset_key UNIQUE (id, asset_id);

ALTER TABLE ONLY public.analysis_video_evidence_packages
    ADD CONSTRAINT analysis_video_evidence_packages_manifest_object_path_key UNIQUE (manifest_object_path);

ALTER TABLE ONLY public.analysis_video_evidence_packages
    ADD CONSTRAINT analysis_video_evidence_packages_pkey PRIMARY KEY (id);

CREATE INDEX analysis_video_evidence_cleanup_lease_idx ON public.analysis_video_evidence_packages USING btree (cleanup_next_attempt_at, cleanup_lease_expires_at, expires_at, id) WHERE (cleanup_state = ANY (ARRAY['retained'::text, 'deleting'::text, 'cleanup_failed'::text]));

CREATE INDEX analysis_video_evidence_packages_expiry_idx ON public.analysis_video_evidence_packages USING btree (expires_at, cleanup_state);

ALTER TABLE public.analysis_video_evidence_packages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_video_evidence_packages FROM PUBLIC, anon, authenticated, service_role;

-- analysis_video_evidence_restore_sessions

CREATE TABLE public.analysis_video_evidence_restore_sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    evidence_package_id uuid NOT NULL,
    state text DEFAULT 'issued'::text NOT NULL,
    manifest_object_path text NOT NULL,
    frame_object_paths jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    failure_code text,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analysis_video_evidence_restore_sessions_expiry_check CHECK ((expires_at > created_at)),
    CONSTRAINT analysis_video_evidence_restore_sessions_paths_check CHECK (((jsonb_typeof(frame_object_paths) = 'array'::text) AND ((jsonb_array_length(frame_object_paths) >= 1) AND (jsonb_array_length(frame_object_paths) <= 50)))),
    CONSTRAINT analysis_video_evidence_restore_sessions_state_check CHECK ((state = ANY (ARRAY['issued'::text, 'completed'::text, 'failed'::text, 'expired'::text])))
);

ALTER TABLE ONLY public.analysis_video_evidence_restore_sessions
    ADD CONSTRAINT analysis_video_evidence_restore_sessio_manifest_object_path_key UNIQUE (manifest_object_path);

ALTER TABLE ONLY public.analysis_video_evidence_restore_sessions
    ADD CONSTRAINT analysis_video_evidence_restore_sessions_owner_key UNIQUE (id, user_id, asset_id);

ALTER TABLE ONLY public.analysis_video_evidence_restore_sessions
    ADD CONSTRAINT analysis_video_evidence_restore_sessions_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX analysis_video_evidence_restore_sessions_active_idx ON public.analysis_video_evidence_restore_sessions USING btree (evidence_package_id) WHERE (state = 'issued'::text);

CREATE INDEX analysis_video_evidence_restore_sessions_cleanup_guard_idx ON public.analysis_video_evidence_restore_sessions USING btree (evidence_package_id, state, expires_at);

ALTER TABLE public.analysis_video_evidence_restore_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_video_evidence_restore_sessions FROM PUBLIC, anon, authenticated, service_role;

-- analysis_video_processing_attempts

CREATE TABLE public.analysis_video_processing_attempts (
    id uuid NOT NULL,
    asset_id uuid NOT NULL,
    attempt_number smallint NOT NULL,
    state text DEFAULT 'processing'::text NOT NULL,
    worker_id text,
    lease_expires_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    failure_code text,
    failure_detail text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analysis_video_processing_attempts_number_check CHECK (((attempt_number >= 1) AND (attempt_number <= 2))),
    CONSTRAINT analysis_video_processing_attempts_state_check CHECK ((state = ANY (ARRAY['processing'::text, 'succeeded'::text, 'deterministic_failed'::text, 'technical_failed'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY public.analysis_video_processing_attempts
    ADD CONSTRAINT analysis_video_processing_attempts_asset_number_key UNIQUE (asset_id, attempt_number);

ALTER TABLE ONLY public.analysis_video_processing_attempts
    ADD CONSTRAINT analysis_video_processing_attempts_pkey PRIMARY KEY (id);

CREATE INDEX analysis_video_processing_attempts_lease_idx ON public.analysis_video_processing_attempts USING btree (lease_expires_at) WHERE (state = 'processing'::text);

ALTER TABLE public.analysis_video_processing_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_video_processing_attempts FROM PUBLIC, anon, authenticated, service_role;

-- analysis_video_start_events

CREATE TABLE public.analysis_video_start_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    user_id uuid NOT NULL,
    state text DEFAULT 'counted'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    released_at timestamp with time zone,
    reset_at timestamp with time zone,
    release_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analysis_video_start_events_payload_check CHECK ((((state = 'counted'::text) AND (released_at IS NULL) AND (reset_at IS NULL) AND (release_reason IS NULL)) OR ((state = 'released'::text) AND (released_at IS NOT NULL) AND (reset_at IS NULL) AND (release_reason = 'system_technical_failure'::text)) OR ((state = 'reset'::text) AND (released_at IS NULL) AND (reset_at IS NOT NULL) AND (release_reason = 'video_succeeded'::text)))),
    CONSTRAINT analysis_video_start_events_state_check CHECK ((state = ANY (ARRAY['counted'::text, 'released'::text, 'reset'::text])))
);

ALTER TABLE ONLY public.analysis_video_start_events
    ADD CONSTRAINT analysis_video_start_events_asset_key UNIQUE (asset_id);

ALTER TABLE ONLY public.analysis_video_start_events
    ADD CONSTRAINT analysis_video_start_events_pkey PRIMARY KEY (id);

CREATE INDEX analysis_video_start_events_user_window_idx ON public.analysis_video_start_events USING btree (user_id, started_at DESC) WHERE (state = 'counted'::text);

ALTER TABLE public.analysis_video_start_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_video_start_events FROM PUBLIC, anon, authenticated, service_role;

-- analysis_video_upload_sessions

CREATE TABLE public.analysis_video_upload_sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    state text DEFAULT 'issued'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analysis_video_upload_sessions_expiry_check CHECK ((expires_at > created_at)),
    CONSTRAINT analysis_video_upload_sessions_state_check CHECK ((state = ANY (ARRAY['issued'::text, 'uploaded'::text, 'queued'::text, 'expired'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY public.analysis_video_upload_sessions
    ADD CONSTRAINT analysis_video_upload_sessions_owner_key UNIQUE (id, user_id);

ALTER TABLE ONLY public.analysis_video_upload_sessions
    ADD CONSTRAINT analysis_video_upload_sessions_pkey PRIMARY KEY (id);

ALTER TABLE public.analysis_video_upload_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_video_upload_sessions FROM PUBLIC, anon, authenticated, service_role;

-- analysis_video_workers

CREATE TABLE public.analysis_video_workers (
    worker_id text NOT NULL,
    status text DEFAULT 'healthy'::text NOT NULL,
    last_heartbeat_at timestamp with time zone NOT NULL,
    ffmpeg_version text NOT NULL,
    ffprobe_version text NOT NULL,
    capabilities jsonb NOT NULL,
    started_at timestamp with time zone NOT NULL,
    stopped_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analysis_video_workers_id_check CHECK (((char_length(worker_id) >= 1) AND (char_length(worker_id) <= 255))),
    CONSTRAINT analysis_video_workers_status_check CHECK ((status = ANY (ARRAY['healthy'::text, 'stopped'::text])))
);

ALTER TABLE ONLY public.analysis_video_workers
    ADD CONSTRAINT analysis_video_workers_pkey PRIMARY KEY (worker_id);

CREATE INDEX analysis_video_workers_heartbeat_idx ON public.analysis_video_workers USING btree (status, last_heartbeat_at);

ALTER TABLE public.analysis_video_workers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_video_workers FROM PUBLIC, anon, authenticated, service_role;
