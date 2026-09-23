-- 仅显式可选参考允许零篇，混合参考最多四篇；保留原主分和一致性约束。
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.analysis_results DROP CONSTRAINT analysis_results_checkup_report_check;
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
END) >= 4) AND (level = round(round(((((((COALESCE(((checkup_report #>> '{radar,topicDemand}'::text[]))::numeric, (0)::numeric) + COALESCE(((checkup_report #>> '{radar,titleExpression}'::text[]))::numeric, (0)::numeric)) + COALESCE(((checkup_report #>> '{radar,contentDevelopment}'::text[]))::numeric, (0)::numeric)) + COALESCE(((checkup_report #>> '{radar,readingExperience}'::text[]))::numeric, (0)::numeric)) + COALESCE(((checkup_report #>> '{radar,interactionPotential}'::text[]))::numeric, (0)::numeric)) + COALESCE(((checkup_report #>> '{radar,distinctiveness}'::text[]))::numeric, (0)::numeric)) / (NULLIF((((((
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
END), 0))::numeric), 2) * (CASE WHEN checkup_report #>> '{contentAnalysis,scorePolicy}' = 'consistency-weighted.v2'
                AND checkup_report #>> '{contentAnalysis,status}' = 'completed'
            THEN CASE (checkup_report #>> '{contentAnalysis,consistency,stars}')::numeric
                WHEN 0 THEN 0 WHEN 1 THEN 0.3 WHEN 2 THEN 0.6 ELSE 1 END
            ELSE 1 END), 2)))))) AND (jsonb_typeof((checkup_report -> 'radar'::text)) = 'object'::text) AND ((checkup_report -> 'radar'::text) ?& ARRAY['topicDemand'::text, 'titleExpression'::text, 'contentDevelopment'::text, 'readingExperience'::text, 'interactionPotential'::text, 'distinctiveness'::text]) AND (jsonb_typeof((checkup_report #> '{radar,topicDemand}'::text[])) = ANY (ARRAY['number'::text, 'null'::text])) AND (jsonb_typeof((checkup_report #> '{radar,titleExpression}'::text[])) = ANY (ARRAY['number'::text, 'null'::text])) AND (jsonb_typeof((checkup_report #> '{radar,contentDevelopment}'::text[])) = ANY (ARRAY['number'::text, 'null'::text])) AND (jsonb_typeof((checkup_report #> '{radar,readingExperience}'::text[])) = ANY (ARRAY['number'::text, 'null'::text])) AND (jsonb_typeof((checkup_report #> '{radar,interactionPotential}'::text[])) = ANY (ARRAY['number'::text, 'null'::text])) AND (jsonb_typeof((checkup_report #> '{radar,distinctiveness}'::text[])) = ANY (ARRAY['number'::text, 'null'::text])) AND (((checkup_report #> '{radar,topicDemand}'::text[]) = 'null'::jsonb) OR ((((checkup_report #>> '{radar,topicDemand}'::text[]))::numeric >= (0)::numeric) AND (((checkup_report #>> '{radar,topicDemand}'::text[]))::numeric <= (10)::numeric))) AND (((checkup_report #> '{radar,titleExpression}'::text[]) = 'null'::jsonb) OR ((((checkup_report #>> '{radar,titleExpression}'::text[]))::numeric >= (0)::numeric) AND (((checkup_report #>> '{radar,titleExpression}'::text[]))::numeric <= (10)::numeric))) AND (((checkup_report #> '{radar,contentDevelopment}'::text[]) = 'null'::jsonb) OR ((((checkup_report #>> '{radar,contentDevelopment}'::text[]))::numeric >= (0)::numeric) AND (((checkup_report #>> '{radar,contentDevelopment}'::text[]))::numeric <= (10)::numeric))) AND (((checkup_report #> '{radar,readingExperience}'::text[]) = 'null'::jsonb) OR ((((checkup_report #>> '{radar,readingExperience}'::text[]))::numeric >= (0)::numeric) AND (((checkup_report #>> '{radar,readingExperience}'::text[]))::numeric <= (10)::numeric))) AND (((checkup_report #> '{radar,interactionPotential}'::text[]) = 'null'::jsonb) OR ((((checkup_report #>> '{radar,interactionPotential}'::text[]))::numeric >= (0)::numeric) AND (((checkup_report #>> '{radar,interactionPotential}'::text[]))::numeric <= (10)::numeric))) AND (((checkup_report #> '{radar,distinctiveness}'::text[]) = 'null'::jsonb) OR ((((checkup_report #>> '{radar,distinctiveness}'::text[]))::numeric >= (0)::numeric) AND (((checkup_report #>> '{radar,distinctiveness}'::text[]))::numeric <= (10)::numeric))) AND (jsonb_typeof((checkup_report -> 'comparisonNotes'::text)) = 'array'::text) AND (((checkup_report ->> 'referenceRequirement' = 'optional') OR (jsonb_array_length(checkup_report -> 'comparisonNotes') >= 1)) AND (jsonb_array_length((checkup_report -> 'comparisonNotes'::text)) <= 4)) AND (jsonb_typeof((checkup_report -> 'differences'::text)) = 'array'::text) AND (jsonb_array_length((checkup_report -> 'differences'::text)) <= 3) AND (jsonb_typeof((checkup_report #> '{qualitativeConclusion,summary}'::text[])) = 'string'::text) AND ((char_length(btrim((checkup_report #>> '{qualitativeConclusion,summary}'::text[]))) >= 1) AND (char_length(btrim((checkup_report #>> '{qualitativeConclusion,summary}'::text[]))) <= 800)) AND (jsonb_typeof((checkup_report #> '{topicSupport,bonus}'::text[])) = 'number'::text) AND ((((checkup_report #>> '{topicSupport,bonus}'::text[]))::numeric >= (0)::numeric) AND (((checkup_report #>> '{topicSupport,bonus}'::text[]))::numeric <= (1)::numeric)) AND (((checkup_report #> '{radar,topicDemand}'::text[]) <> 'null'::jsonb) OR (((checkup_report #>> '{topicSupport,bonus}'::text[]))::numeric = (0)::numeric))) IS TRUE));

ALTER TABLE public.analysis_results
    ADD CONSTRAINT analysis_results_reference_requirement_check CHECK (
        (NOT (checkup_report ? 'referenceRequirement') OR (
            jsonb_typeof(checkup_report -> 'referenceRequirement') = 'string'
            AND checkup_report ->> 'referenceRequirement' IN ('required', 'optional')
        )) IS TRUE
    );

COMMIT;
