import type { AnalysisDraftPayload, TaskFieldValue } from './analysis.contract'

const hexadecimalRadix = 16
const hexadecimalByteWidth = 2

/** 把二进制字节转换为十六进制字符串 */
function bytesToHex(bytes: ArrayBuffer) {
    return Array.from(new Uint8Array(bytes), (byte) =>
        byte.toString(hexadecimalRadix).padStart(hexadecimalByteWidth, '0'),
    ).join('')
}

/** 计算字符串内容的 SHA-256 */
async function sha256(value: string) {
    const content = new TextEncoder().encode(value).buffer
    return bytesToHex(await crypto.subtle.digest('SHA-256', content))
}

/** 规范化字段值中的首尾空白和空项 */
function normalizeFieldValue(value: TaskFieldValue) {
    if (typeof value === 'string') {
        return value.trim()
    }
    if (Array.isArray(value)) {
        return value.map((item) => item.trim())
    }
    return value
}

/** 与后端相同地规范化字段和图片内容，得到有效输入指纹。 */
export async function createEffectiveInputFingerprint(
    draft: AnalysisDraftPayload,
    imageHashes: string[],
) {
    const fields = Object.fromEntries(
        Object.entries(draft.fields)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, value]) => [name, normalizeFieldValue(value)]),
    )
    return sha256(
        JSON.stringify({
            rawText: draft.rawText.trim(),
            fields,
            images: imageHashes,
            coverReference: draft.coverReference ?? draft.imageReferences[0] ?? null,
            ...(draft.videoReference ? { videoReference: draft.videoReference } : {}),
        }),
    )
}

/** 用同一份正式笔记的准备身份形成提交指纹，不包含生成偏好。 */
export function createSubmissionInputFingerprint(preparationFingerprint: string) {
    return sha256(
        JSON.stringify({
            preparationFingerprint,
        }),
    )
}
