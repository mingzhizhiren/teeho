import { API_CODES, HTTP_STATUS } from '../../config/constants'

import { MaintenanceGateClosedError } from '../../runtime/task-policy'

import { fail } from '../../utils/response'

import {
    AnalysisAssetExpiredError,
    AnalysisCapabilityRequiredError,
    AnalysisInsufficientPointsError,
    AnalysisPreparationRateError,
    AnalysisQueueCapacityError,
    AnalysisRefundInProgressError,
    AnalysisRollingUsageExhaustedError,
    AnalysisSubmissionConflictError,
    AnalysisTaskStateError,
    AnalysisUploadRateError,
} from '../analysis.errors'

import { AnalysisImageValidationError } from '../media/analysis.media'

import {
    AnalysisConversationBudgetExhaustedError,
    AnalysisConversationBusyError,
    AnalysisConversationCapabilityError,
    AnalysisConversationStaleError,
} from '../conversation/analysis.conversation.service'

import { AnalysisMediaUploadRateLimitError } from '../media/analysis.media-upload-admission'

import { AgentProviderError } from '../providers/analysis.provider'

/** 把领域异常映射为稳定的 HTTP 响应 */
export function domainErrorResponse(error: unknown) {
    if (error instanceof MaintenanceGateClosedError) {
        return {
            status: HTTP_STATUS.SERVICE_UNAVAILABLE,
            response: fail(API_CODES.SERVICE_MAINTENANCE, error.message, {
                reason: error.reason,
            }),
        }
    }
    if (error instanceof AnalysisMediaUploadRateLimitError) {
        return {
            status: HTTP_STATUS.TOO_MANY_REQUESTS,
            response: fail(API_CODES.RATE_LIMITED, error.message, {
                reason: 'analysis_media_upload_rate',
                clearDraftMedia: true,
            }),
        }
    }
    if (error instanceof AnalysisConversationCapabilityError) {
        return {
            status: HTTP_STATUS.FORBIDDEN,
            response: fail(API_CODES.FORBIDDEN, error.message),
        }
    }
    if (
        error instanceof AnalysisConversationBusyError ||
        error instanceof AnalysisConversationStaleError ||
        error instanceof AnalysisConversationBudgetExhaustedError
    ) {
        return { status: 409, response: fail(API_CODES.CONFLICT, error.message) }
    }
    if (error instanceof AnalysisQueueCapacityError) {
        return {
            status: 409,
            response: fail(API_CODES.CONFLICT, error.message, { reason: error.reason }),
        }
    }
    if (error instanceof AnalysisRefundInProgressError) {
        return {
            status: 409,
            response: fail(API_CODES.CONFLICT, error.message, { reason: error.reason }),
        }
    }
    if (error instanceof AnalysisInsufficientPointsError) {
        return {
            status: 409,
            response: fail(API_CODES.CONFLICT, error.message, { reason: error.reason }),
        }
    }
    if (error instanceof AnalysisCapabilityRequiredError) {
        return {
            status: HTTP_STATUS.FORBIDDEN,
            response: fail(API_CODES.FORBIDDEN, error.message, { reason: error.reason }),
        }
    }
    if (error instanceof AnalysisUploadRateError) {
        return {
            status: 429,
            response: fail(API_CODES.RATE_LIMITED, error.message, { reason: error.reason }),
        }
    }
    if (error instanceof AnalysisPreparationRateError) {
        return {
            status: 429,
            headers: {
                'Retry-After': String(error.retryAfterSeconds),
            },
            response: fail(API_CODES.RATE_LIMITED, error.message, {
                reason: error.reason,
                retryAfterSeconds: error.retryAfterSeconds,
                retryAt: error.retryAt,
            }),
        }
    }
    if (error instanceof AnalysisRollingUsageExhaustedError) {
        return {
            status: HTTP_STATUS.TOO_MANY_REQUESTS,
            headers: {
                'Retry-After': String(error.retryAfterSeconds),
            },
            response: fail(API_CODES.RATE_LIMITED, error.message, {
                reason: error.reason,
                retryAfterSeconds: error.retryAfterSeconds,
                retryAt: error.retryAt,
                canUpgrade: error.canUpgrade,
            }),
        }
    }
    if (error instanceof AnalysisImageValidationError) {
        return { status: 400, response: fail(API_CODES.VALIDATION_ERROR, error.message) }
    }
    if (error instanceof AnalysisAssetExpiredError) {
        return {
            status: 410,
            response: fail(API_CODES.CONFLICT, error.message, { reason: error.reason }),
        }
    }
    if (error instanceof AnalysisTaskStateError) {
        return {
            status: 409,
            response: fail(API_CODES.CONFLICT, error.message, { reason: error.reason }),
        }
    }
    if (error instanceof AnalysisSubmissionConflictError) {
        return {
            status: 409,
            response: fail(API_CODES.CONFLICT, error.message, { reason: error.reason }),
        }
    }
    if (error instanceof AgentProviderError) {
        return {
            status: 503,
            response: fail(API_CODES.INTERNAL_ERROR, '服务器功能异常'),
        }
    }
    throw error
}
