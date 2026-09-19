import {
    confirmAnalysisMediaUpload,
    createAnalysisMediaUploadSession,
    getAnalysisMediaStatuses,
    retryAnalysisMedia,
    uploadAnalysisMediaDirectly,
} from '@/api/analysis'
import type { AnalysisMediaTransport } from './analysis.media-upload'

/** 浏览器中的题火 API + Supabase Storage 直传适配器。 */
export const browserAnalysisMediaTransport: AnalysisMediaTransport = {
    createSession: createAnalysisMediaUploadSession,
    directUpload: uploadAnalysisMediaDirectly,
    confirm: confirmAnalysisMediaUpload,
    statuses: getAnalysisMediaStatuses,
    retry: retryAnalysisMedia,
}
