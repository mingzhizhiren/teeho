-- 报告最多保存八篇对照；展示数量仍由服务端冻结的档位权限决定。
-- 仅放宽既有校验中的篇数上限，不修改历史报告、评分公式或函数权限。
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $migration$
DECLARE
    old_fragment constant text := '(jsonb_array_length((checkup_report -> ''comparisonNotes''::text)) <= 4)';
    new_fragment constant text := '(jsonb_array_length((checkup_report -> ''comparisonNotes''::text)) <= 8)';
    previous_definition text;
    report_check text;
BEGIN
    SELECT pg_get_functiondef(
        'teeho_internal.analysis_report_before_note_coefficient(numeric,text,jsonb)'::regprocedure
    ) INTO STRICT previous_definition;
    -- 精确匹配一次；前置迁移缺失或环境发生漂移时失败，不盲目重写其他条件。
    IF (length(previous_definition) - length(replace(previous_definition, old_fragment, '')))
        <> length(old_fragment) THEN
        RAISE EXCEPTION 'Expected one four-note comparison limit in the existing report validator';
    END IF;
    SELECT pg_get_expr(conbin, conrelid) INTO STRICT report_check
    FROM pg_constraint
    WHERE conrelid = 'public.analysis_results'::regclass
      AND conname = 'analysis_results_checkup_report_check';

    EXECUTE replace(previous_definition, old_fragment, new_fragment);
    -- CHECK 引用不可变函数，替换函数后显式重新校验存量行。
    ALTER TABLE public.analysis_results DROP CONSTRAINT analysis_results_checkup_report_check;
    EXECUTE format('ALTER TABLE public.analysis_results ADD CONSTRAINT '
        'analysis_results_checkup_report_check CHECK (%s)', report_check);
END;
$migration$;

COMMIT;
