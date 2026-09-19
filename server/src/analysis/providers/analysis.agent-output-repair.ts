import { findGeneratedResultQualityViolations } from '../checkup/analysis.result-quality'
import { normalizeAgentGeneratedOutput } from './analysis.agent-output-normalization'
import {
    AgentContractError,
    agentGeneratedResultSchema,
    readAgentUnparseableOutput,
    type AgentGeneratedResult,
    type AgentResultGenerationInput,
} from './analysis.provider'

export interface AgentOutputRepairDiagnosis {
    mode: 'fields' | 'full'
    fieldPaths: string[]
    removePaths: string[]
    ruleId: string
    originalOutput: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeRepairPath(path: Array<PropertyKey>): string {
    const segments: string[] = []
    for (const segment of path) {
        if (typeof segment === 'number' || /^\d+$/u.test(String(segment))) break
        segments.push(String(segment))
    }
    return segments.join('.')
}

function uniquePaths(paths: string[]): string[] {
    return [...new Set(paths.filter(Boolean))].sort()
}

interface SchemaIssueLike {
    code: string
    path: Array<PropertyKey>
    keys?: string[]
}

function repairPathsFromIssues(issues: SchemaIssueLike[]): {
    fieldPaths: string[]
    removePaths: string[]
} {
    const removePaths = uniquePaths(
        issues.flatMap((issue) => {
            if (issue.code !== 'unrecognized_keys' || !issue.keys) return []
            const parent = normalizeRepairPath(issue.path)
            return issue.keys.map((key) => (parent ? `${parent}.${key}` : key))
        }),
    )
    return {
        fieldPaths: uniquePaths([
            ...issues.map((issue) => normalizeRepairPath(issue.path)),
            ...removePaths,
        ]),
        removePaths,
    }
}

/** 在不消费任何局部业务结果的前提下诊断最终 Agent 输出。 */
export function diagnoseAgentGeneratedResult(
    value: unknown,
    input?: AgentResultGenerationInput,
): AgentOutputRepairDiagnosis {
    const rawText = readAgentUnparseableOutput(value)
    if (rawText !== null) {
        return {
            mode: 'full',
            fieldPaths: [],
            removePaths: [],
            ruleId: 'generate-result.unparseable',
            originalOutput: rawText,
        }
    }
    if (!isRecord(value)) {
        return {
            mode: 'full',
            fieldPaths: [],
            removePaths: [],
            ruleId: 'generate-result.unparseable',
            originalOutput: value,
        }
    }
    const normalizedValue = normalizeAgentGeneratedOutput(value)
    const parsed = agentGeneratedResultSchema.safeParse(normalizedValue)
    if (!parsed.success) {
        const { fieldPaths, removePaths } = repairPathsFromIssues(parsed.error.issues)
        return {
            mode: fieldPaths.length === 0 ? 'full' : 'fields',
            fieldPaths,
            removePaths,
            ruleId: 'generate-result.schema',
            originalOutput: normalizedValue,
        }
    }
    const qualityViolations = findGeneratedResultQualityViolations(parsed.data, input)
    if (qualityViolations.length > 0) {
        return {
            mode: 'fields',
            fieldPaths: uniquePaths([
                ...qualityViolations.map((violation) =>
                    normalizeRepairPath(violation.path.split('.')),
                ),
                ...(qualityViolations.some((violation) => violation.reason !== 'internal_state')
                    ? ['uncertainties']
                    : []),
            ]),
            removePaths: [],
            ruleId: 'generate-result.publishable-content',
            originalOutput: normalizedValue,
        }
    }
    throw new Error('合法 Agent 输出不需要修复')
}

function leafPaths(value: unknown, prefix = ''): string[] {
    if (!isRecord(value)) return prefix ? [prefix] : []
    return Object.entries(value).flatMap(([key, child]) => {
        const path = prefix ? `${prefix}.${key}` : key
        if (Array.isArray(child) || !isRecord(child)) return [path]
        return leafPaths(child, path)
    })
}

function isAllowedRepairPath(path: string, allowed: string[]): boolean {
    return allowed.some(
        (candidate) =>
            path === candidate ||
            path.startsWith(`${candidate}.`) ||
            candidate.startsWith(`${path}.`),
    )
}

function mergeRepairPatch(original: unknown, patch: unknown): unknown {
    if (!isRecord(original) || !isRecord(patch)) return patch
    return Object.fromEntries(
        [...new Set([...Object.keys(original), ...Object.keys(patch)])].map((key) => [
            key,
            key in patch ? mergeRepairPatch(original[key], patch[key]) : original[key],
        ]),
    )
}

function repairPathTree(fieldPaths: string[]): Record<string, unknown> {
    const tree: Record<string, unknown> = {}
    for (const path of fieldPaths) {
        const segments = path.split('.').filter(Boolean)
        let current = tree
        segments.forEach((segment, index) => {
            if (index === segments.length - 1) {
                current[segment] = true
                return
            }
            const child = current[segment]
            if (!isRecord(child)) current[segment] = {}
            current = current[segment] as Record<string, unknown>
        })
    }
    return tree
}

function removeRepairPaths(value: unknown, fieldPaths: string[]): unknown {
    if (!isRecord(value) || fieldPaths.length === 0) return value
    const tree = repairPathTree(fieldPaths)
    return Object.fromEntries(
        Object.entries(value).flatMap(([key, child]) => {
            const removal = tree[key]
            if (removal === true) return []
            return [
                [
                    key,
                    isRecord(removal)
                        ? removeRepairPaths(
                              child,
                              leafPaths(removal).map((path) => path),
                          )
                        : child,
                ],
            ]
        }),
    )
}

function selectRepairOutput(
    value: unknown,
    tree: Record<string, unknown>,
): Record<string, unknown> {
    if (!isRecord(value)) return {}
    return Object.fromEntries(
        Object.entries(tree).flatMap(([key, child]) => {
            if (!(key in value)) return []
            return [
                [
                    key,
                    child === true
                        ? value[key]
                        : selectRepairOutput(value[key], child as Record<string, unknown>),
                ],
            ]
        }),
    )
}

/** 从完整合法结果中抽取仅含允许字段的修复 patch。 */
export function createAgentOutputRepairPatch(
    result: AgentGeneratedResult,
    fieldPaths: string[],
): Record<string, unknown> {
    return selectRepairOutput(result, repairPathTree(fieldPaths))
}

function parseRepairedResult(
    value: unknown,
    input?: AgentResultGenerationInput,
): AgentGeneratedResult {
    const parsed = agentGeneratedResultSchema.safeParse(normalizeAgentGeneratedOutput(value))
    if (!parsed.success) {
        throw new AgentContractError('Agent 输出修复后仍不合法', {
            validationFieldPaths: parsed.error.issues.map((issue) => issue.path.join('.')),
            ruleId: 'generate-result.repair-schema',
        })
    }
    const violations = findGeneratedResultQualityViolations(parsed.data, input)
    if (violations.length > 0) {
        throw new AgentContractError('Agent 输出修复后仍不可发布', {
            validationFieldPaths: violations.map((violation) => violation.path),
            ruleId: 'generate-result.repair-publishable-content',
        })
    }
    return parsed.data
}

function applyScopedRepair<Result>(
    diagnosis: AgentOutputRepairDiagnosis,
    repairOutput: unknown,
    parse: (value: unknown) => Result,
    messages: { patchType: string; patchScope: string; rulePrefix: string },
): Result {
    if (
        !isRecord(repairOutput) ||
        Object.keys(repairOutput).length !== 1 ||
        !Object.hasOwn(repairOutput, 'repairPatch')
    ) {
        throw new AgentContractError(messages.patchType, {
            validationFieldPaths: ['repairPatch'],
            ruleId: `${messages.rulePrefix}.repair-patch-envelope`,
        })
    }
    const repairPatch = repairOutput.repairPatch
    if (diagnosis.mode === 'full') {
        return parse(repairPatch)
    }
    if (!isRecord(repairPatch)) {
        throw new AgentContractError(messages.patchType, {
            validationFieldPaths: diagnosis.fieldPaths,
            ruleId: `${messages.rulePrefix}.repair-patch-type`,
        })
    }
    const disallowed = leafPaths(repairPatch).filter(
        (path) => !isAllowedRepairPath(path, diagnosis.fieldPaths),
    )
    if (disallowed.length > 0) {
        throw new AgentContractError(messages.patchScope, {
            validationFieldPaths: disallowed,
            ruleId: `${messages.rulePrefix}.repair-patch-scope`,
        })
    }
    return parse(
        mergeRepairPatch(
            removeRepairPaths(diagnosis.originalOutput, diagnosis.removePaths),
            repairPatch,
        ),
    )
}

/** 合并一次受限修复；字段模式禁止触碰首次校验未指出的合法字段。 */
export function applyAgentOutputRepair(
    diagnosis: AgentOutputRepairDiagnosis,
    repairOutput: unknown,
    input?: AgentResultGenerationInput,
): AgentGeneratedResult {
    return applyScopedRepair(
        diagnosis,
        repairOutput,
        (value) => parseRepairedResult(value, input),
        {
            patchType: 'Agent 字段修复不是对象',
            patchScope: 'Agent 修复响应改写了合法字段',
            rulePrefix: 'generate-result',
        },
    )
}
