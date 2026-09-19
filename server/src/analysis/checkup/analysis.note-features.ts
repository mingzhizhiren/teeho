import { checkupTerms } from './analysis.checkup.selection'
export interface NoteTextFeatures {
    titleLength: number
    titleTerms: number
    bodyLength: number
    paragraphs: number
    paragraphLength: number
    lexicalVariety: number
}
/** 可复核的文字结构，不把模型解释混入用户原文。 */
export function noteTextFeatures(title: string, body: string): NoteTextFeatures {
    const paragraphs = body
        .split(/\n+/u)
        .map((line) => line.trim())
        .filter(Boolean)
    const length = Array.from(body.trim()).length
    return {
        titleLength: Array.from(title.trim()).length,
        titleTerms: checkupTerms(title).length,
        bodyLength: length,
        paragraphs: paragraphs.length,
        paragraphLength: paragraphs.length ? length / paragraphs.length : 0,
        lexicalVariety: length ? checkupTerms(body).length / length : 0,
    }
}
