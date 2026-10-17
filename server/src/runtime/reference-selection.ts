import { z } from 'zod'

const referenceSelectionModeSchema = z.enum(['standard', 'engagement_priority'])
export type ReferenceSelectionMode = z.infer<typeof referenceSelectionModeSchema>
type ReferenceSelectionResolver = (userId: string) => Promise<ReferenceSelectionMode>

let resolver: ReferenceSelectionResolver = async () => 'standard'

/** 部署启动时注入选样策略；社区默认不查询订阅或数据库。 */
export function configureReferenceSelection(value: ReferenceSelectionResolver): void {
    resolver = value
}

/** 首次准备证据时解析可信策略，结果随证据冻结。 */
export async function resolveReferenceSelection(userId: string): Promise<ReferenceSelectionMode> {
    return referenceSelectionModeSchema.parse(await resolver(userId))
}
