-- 压平 20261015152850、20261016031325、20261016143307 三份社区迁移。
-- 新报告先乘结构系数，再乘原有星级倍率；对照笔记直接支持最终十篇上限。
-- 仅适用于三份原迁移均未执行的环境；已执行环境不得重跑本文件。
-- 先应用迁移，再发布会写入 noteScoringCoefficient 的服务端；不回算历史 JSONB。
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE SCHEMA IF NOT EXISTS teeho_internal;

-- 冻结本环境当前两条旧校验，避免复制长表达式时遗漏社区/私有历史差异。
DO $migration$
DECLARE
    old_fragment constant text := '(jsonb_array_length((checkup_report -> ''comparisonNotes''::text)) <= 4)';
    new_fragment constant text := '(jsonb_array_length((checkup_report -> ''comparisonNotes''::text)) <= 10)';
    report_check text;
    consistency_check text;
BEGIN
    SELECT pg_get_expr(conbin, conrelid) INTO STRICT report_check
    FROM pg_constraint
    WHERE conrelid = 'public.analysis_results'::regclass
      AND conname = 'analysis_results_checkup_report_check';
    SELECT pg_get_expr(conbin, conrelid) INTO STRICT consistency_check
    FROM pg_constraint
    WHERE conrelid = 'public.analysis_results'::regclass
      AND conname = 'analysis_results_v122_score_policy_check';
    -- 在首次冻结旧规则时直接放宽容量，省去四→八→十的函数替换与重复校验。
    IF (length(report_check) - length(replace(report_check, old_fragment, '')))
        <> length(old_fragment) THEN
        RAISE EXCEPTION 'Expected one four-note comparison limit in the existing report validator';
    END IF;
    report_check := replace(report_check, old_fragment, new_fragment);
    EXECUTE format(
        'CREATE FUNCTION teeho_internal.analysis_report_before_note_coefficient('
        'level numeric, result_schema_version text, checkup_report jsonb) RETURNS boolean '
        'LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '''' AS %L',
        'SELECT ((' || report_check || ') AND (' || consistency_check || ')) IS TRUE'
    );
END;
$migration$;

CREATE FUNCTION teeho_internal.analysis_note_coefficient_valid(
    report jsonb, final_score numeric, schema_version text
) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
    audit jsonb := report -> 'noteScoringAudit';
    entry jsonb;
    metric_value jsonb;
    reference jsonb;
    metric text;
    excluded text;
    seen text[] := ARRAY[]::text[];
    metric_names constant text[] := ARRAY[
        'titleLength', 'bodyLength', 'paragraphLength', 'paragraphCount', 'topicCount',
        'topicLength', 'maxTopicLength', 'maxParagraphLength', 'imageCount', 'videoDurationSeconds'
    ];
    evaluated_count integer;
    unavailable_count integer;
    ratio numeric;
    contribution numeric;
    contribution_sum numeric := 0;
    coefficient numeric;
    expected_coefficient numeric;
    stars numeric;
    multiplier numeric;
    original_score numeric;
    legacy_original numeric;
    legacy_score numeric;
    legacy_report jsonb;
    radar_average numeric;
    is_completed boolean;
    tolerance constant numeric := 0.0000000001;
BEGIN
    -- 先确认类型，再转数值；未知策略、字段缺失和 JSON null 都不能绕过校验。
    IF (schema_version = 'analysis-result.v7'
        AND report ->> 'schemaVersion' = schema_version
        AND jsonb_typeof(report -> 'noteScoringCoefficient') = 'number'
        AND jsonb_typeof(audit) = 'object'
        AND jsonb_typeof(report #> '{primaryScore,value}') = 'number'
        AND report #>> '{contentAnalysis,scorePolicy}' = 'consistency-weighted.v2'
        AND report #>> '{contentAnalysis,status}' IN ('completed', 'fallback')
        AND jsonb_typeof(report #> '{contentAnalysis,consistency,stars}') = 'number'
        AND jsonb_typeof(report -> 'structureMetrics') = 'object'
        AND jsonb_typeof(report -> 'structureReferences') = 'object') IS NOT TRUE
    THEN RETURN false; END IF;
    coefficient := (report ->> 'noteScoringCoefficient')::numeric;
    stars := (report #>> '{contentAnalysis,consistency,stars}')::numeric;
    is_completed := report #>> '{contentAnalysis,status}' = 'completed';
    IF coefficient NOT BETWEEN 0.55 AND 1.05 OR stars NOT BETWEEN 0 AND 5
        OR stars <> trunc(stars) OR (NOT is_completed AND stars <> 3)
        OR (report #>> '{primaryScore,value}')::numeric IS DISTINCT FROM final_score
    THEN RETURN false; END IF;
    IF report #>> '{primaryScore,source}' = 'insight' AND
        (jsonb_typeof(report #> '{insight,score}') <> 'number'
            OR (report #>> '{insight,score}')::numeric IS DISTINCT FROM final_score)
    THEN RETURN false; END IF;
    IF (jsonb_typeof(report #> '{contentAnalysis,originalScore}') = 'number') IS TRUE THEN
        original_score := (report #>> '{contentAnalysis,originalScore}')::numeric;
        IF original_score NOT BETWEEN 0 AND 10 THEN RETURN false; END IF;
    ELSIF (is_completed AND stars = 0
        AND report #> '{contentAnalysis,originalScore}' = 'null'::jsonb) IS NOT TRUE THEN
        RETURN false;
    END IF;

    IF NOT (report -> 'structureMetrics') ?& ARRAY['titleLength', 'bodyLength',
        'paragraphLength', 'paragraphCount', 'topicCount', 'topicLength']
        OR NOT (report -> 'structureReferences') ?& ARRAY['titleLength', 'bodyLength',
        'paragraphLength', 'paragraphCount', 'topicCount', 'topicLength']
        OR EXISTS (SELECT 1 FROM jsonb_object_keys(report -> 'structureMetrics') AS field(name)
            WHERE NOT name = ANY(metric_names))
        OR EXISTS (SELECT 1 FROM jsonb_object_keys(report -> 'structureReferences') AS field(name)
            WHERE NOT name = ANY(metric_names))
    THEN RETURN false; END IF;
    FOREACH metric IN ARRAY metric_names LOOP
        metric_value := report #> ARRAY['structureMetrics', metric];
        reference := report #> ARRAY['structureReferences', metric];
        IF metric_value IS NOT NULL AND metric_value <> 'null'::jsonb THEN
            IF jsonb_typeof(metric_value) <> 'number' THEN RETURN false; END IF;
            IF (metric_value #>> '{}')::numeric < 0
                OR (metric NOT IN ('paragraphLength', 'topicLength', 'videoDurationSeconds')
                    AND (metric_value #>> '{}')::numeric <> trunc((metric_value #>> '{}')::numeric))
            THEN RETURN false; END IF;
        END IF;
        IF reference IS NOT NULL AND reference <> 'null'::jsonb THEN
            IF (jsonb_typeof(reference) = 'object'
                AND jsonb_typeof(reference -> 'low') = 'number'
                AND jsonb_typeof(reference -> 'high') = 'number'
                AND jsonb_typeof(reference -> 'sampleCount') = 'number'
                AND reference ->> 'severity' IN ('aligned', 'minor', 'moderate', 'major', 'critical')) IS NOT TRUE
            THEN RETURN false; END IF;
            IF (SELECT count(*) FROM jsonb_object_keys(reference)) <> 4
                OR (reference ->> 'low')::numeric < 0
                OR (reference ->> 'high')::numeric < (reference ->> 'low')::numeric
                OR (reference ->> 'sampleCount')::numeric < 3
                OR (reference ->> 'sampleCount')::numeric <> trunc((reference ->> 'sampleCount')::numeric)
            THEN RETURN false; END IF;
        END IF;
    END LOOP;

    IF (audit ->> 'policy' = 'structure-coefficient.v1'
        AND audit ->> 'contentKind' IN ('image', 'video')
        AND jsonb_typeof(audit -> 'reviewCompleted') = 'boolean'
        AND (audit ->> 'reviewCompleted')::boolean = is_completed
        AND jsonb_typeof(audit -> 'evaluated') = 'array'
        AND jsonb_typeof(audit -> 'unavailable') = 'array'
        AND jsonb_typeof(audit -> 'notApplicable') = 'array') IS NOT TRUE
    THEN RETURN false; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(audit)) <> 6 THEN RETURN false; END IF;
    excluded := CASE audit ->> 'contentKind' WHEN 'image' THEN 'videoDurationSeconds' ELSE 'imageCount' END;
    evaluated_count := jsonb_array_length(audit -> 'evaluated');
    unavailable_count := jsonb_array_length(audit -> 'unavailable');
    IF audit -> 'notApplicable' <> jsonb_build_array(excluded)
        OR evaluated_count + unavailable_count <> cardinality(metric_names) - 1
    THEN RETURN false; END IF;

    FOR entry IN SELECT value FROM jsonb_array_elements(audit -> 'evaluated') LOOP
        metric := entry ->> 'metric';
        reference := report #> ARRAY['structureReferences', metric];
        IF (jsonb_typeof(entry) = 'object'
            AND jsonb_typeof(entry -> 'metric') = 'string'
            AND metric = ANY(metric_names) AND metric <> excluded AND NOT metric = ANY(seen)
            AND jsonb_typeof(entry -> 'contribution') = 'number'
            AND jsonb_typeof(report #> ARRAY['structureMetrics', metric]) = 'number'
            AND jsonb_typeof(reference) = 'object'
            AND reference ->> 'severity' = entry ->> 'severity'
            AND jsonb_typeof(reference -> 'low') = 'number'
            AND jsonb_typeof(reference -> 'high') = 'number'
            AND jsonb_typeof(reference -> 'sampleCount') = 'number') IS NOT TRUE
        THEN RETURN false; END IF;
        IF (SELECT count(*) FROM jsonb_object_keys(entry)) <> 3
            OR (SELECT count(*) FROM jsonb_object_keys(reference)) <> 4
            OR (reference ->> 'low')::numeric < 0
            OR (reference ->> 'high')::numeric < (reference ->> 'low')::numeric
            OR (reference ->> 'sampleCount')::numeric < 3
            OR (reference ->> 'sampleCount')::numeric <> trunc((reference ->> 'sampleCount')::numeric)
            OR (report #>> ARRAY['structureMetrics', metric])::numeric < 0
        THEN RETURN false; END IF;
        IF metric NOT IN ('paragraphLength', 'topicLength', 'videoDurationSeconds')
            AND (report #>> ARRAY['structureMetrics', metric])::numeric <>
                trunc((report #>> ARRAY['structureMetrics', metric])::numeric)
        THEN RETURN false; END IF;
        ratio := CASE entry ->> 'severity'
            WHEN 'aligned' THEN 1 WHEN 'minor' THEN 0.75 WHEN 'moderate' THEN 0.5
            WHEN 'major' THEN 0.25 WHEN 'critical' THEN 0 ELSE NULL END;
        contribution := (entry ->> 'contribution')::numeric;
        IF ratio IS NULL OR contribution NOT BETWEEN 0 AND 0.5
            OR abs(contribution - 0.5 / evaluated_count * ratio) > tolerance
        THEN RETURN false; END IF;
        seen := array_append(seen, metric);
        contribution_sum := contribution_sum + contribution;
    END LOOP;
    FOR entry IN SELECT value FROM jsonb_array_elements(audit -> 'unavailable') LOOP
        metric := entry #>> '{}';
        IF (jsonb_typeof(entry) = 'string' AND metric = ANY(metric_names)
            AND metric <> excluded AND NOT metric = ANY(seen)) IS NOT TRUE
        THEN RETURN false; END IF;
        IF report #> ARRAY['structureMetrics', metric] IS NOT NULL
            AND report #> ARRAY['structureMetrics', metric] <> 'null'::jsonb
            AND report #> ARRAY['structureReferences', metric] IS NOT NULL
            AND report #> ARRAY['structureReferences', metric] <> 'null'::jsonb
        THEN RETURN false; END IF;
        seen := array_append(seen, metric);
    END LOOP;
    expected_coefficient := CASE WHEN evaluated_count = 0 THEN 1 ELSE
        least(CASE WHEN unavailable_count > 0 OR NOT is_completed THEN 1 ELSE 1.05 END,
              0.55 + contribution_sum) END;
    IF abs(coefficient - expected_coefficient) > tolerance THEN RETURN false; END IF;
    multiplier := CASE WHEN NOT is_completed THEN 1 ELSE
        CASE stars WHEN 0 THEN 0 WHEN 1 THEN 0.3 WHEN 2 THEN 0.6 ELSE 1 END END;
    IF final_score IS DISTINCT FROM round(round(least(10,
        coalesce(original_score, 0) * coefficient * multiplier), 12), 2)
    THEN RETURN false; END IF;

    -- 使用旧规则投影检查原有报告形状；只构造函数内 JSON，不更新已保存报告。
    legacy_original := original_score;
    IF report #>> '{primaryScore,source}' = 'radar_average' THEN
        SELECT avg((value #>> '{}')::numeric) INTO radar_average
        FROM jsonb_each(report -> 'radar')
        WHERE key = ANY(ARRAY['topicDemand', 'titleExpression', 'contentDevelopment',
            'readingExperience', 'interactionPotential', 'distinctiveness'])
          AND jsonb_typeof(value) = 'number';
        IF radar_average IS NULL OR original_score IS NULL
            OR abs(original_score - radar_average) > tolerance THEN RETURN false; END IF;
        legacy_original := round(radar_average, 2);
    END IF;
    legacy_score := round(coalesce(legacy_original, 0) * multiplier, 2);
    legacy_report := jsonb_set(report, '{primaryScore,value}', to_jsonb(legacy_score));
    legacy_report := jsonb_set(legacy_report, '{contentAnalysis,originalScore}',
        coalesce(to_jsonb(legacy_original), 'null'::jsonb));
    IF report #>> '{primaryScore,source}' = 'insight' THEN
        legacy_report := jsonb_set(legacy_report, '{insight,score}', to_jsonb(legacy_score));
    END IF;
    RETURN teeho_internal.analysis_report_before_note_coefficient(
        legacy_score, schema_version, legacy_report);
EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range OR division_by_zero THEN
        RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION teeho_internal.analysis_report_before_note_coefficient(numeric, text, jsonb)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION teeho_internal.analysis_note_coefficient_valid(jsonb, numeric, text)
    FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA teeho_internal TO service_role;
GRANT EXECUTE ON FUNCTION teeho_internal.analysis_report_before_note_coefficient(numeric, text, jsonb)
    TO service_role;
GRANT EXECUTE ON FUNCTION teeho_internal.analysis_note_coefficient_valid(jsonb, numeric, text)
    TO service_role;

ALTER TABLE public.analysis_results
    DROP CONSTRAINT analysis_results_checkup_report_check,
    DROP CONSTRAINT analysis_results_v122_score_policy_check,
    ADD CONSTRAINT analysis_results_checkup_report_check CHECK ((
        CASE WHEN checkup_report ?| ARRAY['noteScoringCoefficient', 'noteScoringAudit']
            THEN teeho_internal.analysis_note_coefficient_valid(checkup_report, level, result_schema_version)
            ELSE teeho_internal.analysis_report_before_note_coefficient(level, result_schema_version, checkup_report)
        END
    ) IS TRUE);

COMMENT ON FUNCTION teeho_internal.analysis_note_coefficient_valid(jsonb, numeric, text)
    IS '结构系数 v1 与星级 v2 联合校验；无外部访问、无副作用、无需特权执行。';
COMMIT;
