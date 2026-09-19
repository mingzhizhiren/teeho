import { createClient } from 'npm:@supabase/supabase-js@2.110.7'
import {
    parseCleanupCandidates,
    runAnalysisMediaCleanup,
} from '../_shared/analysis-media-cleanup.ts'
import { analysisMediaCleanupConstraints } from '../_shared/analysis-media.constants.ts'

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
    })
}

function secretsEqual(left: string, right: string): boolean {
    if (left.length !== right.length) return false
    let difference = 0
    for (let index = 0; index < left.length; index += 1) {
        difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
    }
    return difference === 0
}

Deno.serve(async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return jsonResponse({ code: 'method_not_allowed' }, 405)
    const expectedSecret = Deno.env.get('TEEHO_MEDIA_CLEANUP_SECRET') ?? ''
    const receivedSecret = request.headers.get('x-teeho-cron-secret') ?? ''
    if (expectedSecret.length < analysisMediaCleanupConstraints.minimumSecretLength) {
        console.error({ event: 'analysis_media_cleanup_configuration_missing' })
        return jsonResponse({ code: 'cleanup_unavailable' }, 503)
    }
    if (!secretsEqual(receivedSecret, expectedSecret)) {
        return jsonResponse({ code: 'unauthorized' }, 401)
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRoleKey) {
        console.error({ event: 'analysis_media_cleanup_configuration_missing' })
        return jsonResponse({ code: 'cleanup_unavailable' }, 503)
    }
    const client = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    })
    try {
        const summary = await runAnalysisMediaCleanup({
            async claim(batchSize, leaseSeconds) {
                const { data, error } = await client.rpc('claim_analysis_media_cleanup', {
                    p_batch_size: batchSize,
                    p_lease_seconds: leaseSeconds,
                })
                if (error) throw error
                return parseCleanupCandidates(data)
            },
            async remove(paths) {
                const { error } = await client.storage
                    .from(analysisMediaCleanupConstraints.storageBucket)
                    .remove(paths)
                if (error) throw error
            },
            async complete(assetId, succeeded, errorCode) {
                const { data, error } = await client.rpc('complete_analysis_media_cleanup', {
                    p_asset_id: assetId,
                    p_succeeded: succeeded,
                    p_error_code: errorCode,
                })
                if (error || data !== true) throw new Error('cleanup_completion_failed')
            },
        })
        console.info({ ...summary, event: 'analysis_media_cleanup_completed' })
        return jsonResponse({ code: 'ok', data: summary })
    } catch {
        console.error({ event: 'analysis_media_cleanup_failed' })
        return jsonResponse({ code: 'cleanup_failed' }, 500)
    }
})
