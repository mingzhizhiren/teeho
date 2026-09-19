import { isPublicWebResearchUrl, isSafeWebResearchQuery } from './analysis.web-research'

interface CodexWebSearchValidationResult {
    debugDetails: Record<string, unknown>
    isAllowed: boolean
}

function toRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
}

function nonEmptyString(value: unknown): boolean {
    return typeof value === 'string' && Boolean(value.trim())
}

function safeQuery(value: unknown): boolean {
    return typeof value === 'string' && isSafeWebResearchQuery(value)
}

function validateSearchAction(
    item: Record<string, unknown>,
    action: Record<string, unknown>,
): boolean {
    if (action.queries !== undefined && action.queries !== null) {
        return (
            Array.isArray(action.queries) &&
            action.queries.length > 0 &&
            action.queries.every(safeQuery)
        )
    }
    return safeQuery(action.query) || safeQuery(item.query)
}

/** 校验一次联网事件；允许自由查询，但拒绝空查询、私网页面和未知操作。 */
export function validateCodexWebSearchItem(
    item: Record<string, unknown>,
    allowEmptyStartedPlaceholder: boolean,
): CodexWebSearchValidationResult {
    const action = toRecord(item.action)
    const actionType = typeof action?.type === 'string' ? action.type : null
    const itemUrl = typeof item.url === 'string' ? item.url : null
    const actionUrl = typeof action?.url === 'string' ? action.url : null
    let isAllowed = false
    if (action && actionType === 'search') {
        isAllowed = validateSearchAction(item, action) || allowEmptyStartedPlaceholder
    } else if (action && (actionType === 'openPage' || actionType === 'findInPage')) {
        const url = actionUrl ?? itemUrl
        isAllowed = url ? isPublicWebResearchUrl(url) : allowEmptyStartedPlaceholder
    } else if (action && actionType === 'other') {
        isAllowed =
            !nonEmptyString(item.query) &&
            !nonEmptyString(action.query) &&
            !itemUrl &&
            !actionUrl &&
            action.queries === undefined
    } else if (actionType === null) {
        isAllowed = safeQuery(item.query)
            ? true
            : itemUrl
              ? isPublicWebResearchUrl(itemUrl)
              : allowEmptyStartedPlaceholder
    }
    const actionQueries = action?.queries
    return {
        isAllowed,
        debugDetails: {
            actionType,
            itemQueryPresent: nonEmptyString(item.query),
            itemQuerySafe: safeQuery(item.query),
            actionQueryPresent: nonEmptyString(action?.query),
            actionQuerySafe: safeQuery(action?.query),
            actionQueryCount: Array.isArray(actionQueries) ? actionQueries.length : null,
            itemUrlIsPublic: itemUrl ? isPublicWebResearchUrl(itemUrl) : null,
            actionUrlIsPublic: actionUrl ? isPublicWebResearchUrl(actionUrl) : null,
        },
    }
}
