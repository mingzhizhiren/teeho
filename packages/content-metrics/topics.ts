/** 统一话题名称清洗；保留原顺序和重复项，忽略没有文字的名称。 */
export function normalizeTopicNames(topics: readonly string[]): string[] {
    return topics
        .map((topic) =>
            topic
                .normalize('NFKC')
                .trim()
                .replace(/^#+|#+$/gu, '')
                .trim(),
        )
        .filter(Boolean)
}
