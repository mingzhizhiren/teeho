interface AnalysisMediaInput {
    readonly imageReferences: readonly string[]
    readonly coverReference?: string
}

/** 视频封面也使用图片处理链路，图文封面不重复计数。 */
export function requiredAnalysisImageReferences(input: AnalysisMediaInput): string[] {
    return [
        ...new Set([
            ...input.imageReferences,
            ...(input.coverReference && !input.imageReferences.includes(input.coverReference)
                ? [input.coverReference]
                : []),
        ]),
    ]
}
