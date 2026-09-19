/** 可复核的候选表达意图；没有明确词项时保留未知，避免过度过滤。 */
export function inferNoteIntent(
    title: string,
    body: string,
): 'daily' | 'guide' | 'story' | 'review' | 'other' {
    const text = [title, body].join(' ')
    if (/测评|评测|实测|review|comparison/iu.test(text)) return 'review'
    if (/教程|步骤|攻略|做法|指南|清单|技巧|如何|how to|tutorial|guide/iu.test(text)) return 'guide'
    if (/故事|经历|没想到|后来|story/iu.test(text)) return 'story'
    if (/日常|今天|给大家看看|daily|my dog/iu.test(text)) return 'daily'
    return 'other'
}

/** 意图未知仍可比较，明确不相容的意图不得占用取样名额。 */
export function hasComparableIntent(
    title: string,
    body: string,
    expected?: ReturnType<typeof inferNoteIntent>,
): boolean {
    const actual = inferNoteIntent(title, body)
    return !expected || expected === 'other' || actual === 'other' || actual === expected
}
