const MAX_SOURCE_LENGTH = 48
const SOURCE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const RESERVED_SOURCE_PATTERN = /^(?:unknown|con|prn|aux|nul|com[1-9]|lpt[1-9])$/

/** 校验可安全用于包目录与内部常量的渠道标识。 */
export function assertSkillSource(source: unknown): asserts source is string {
    if (
        typeof source !== 'string' ||
        source.length > MAX_SOURCE_LENGTH ||
        !SOURCE_PATTERN.test(source) ||
        RESERVED_SOURCE_PATTERN.test(source)
    ) {
        throw new Error('Invalid skill channel source')
    }
}
