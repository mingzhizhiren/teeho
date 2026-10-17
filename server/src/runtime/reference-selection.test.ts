import { afterEach, expect, it, vi } from 'vitest'
import {
    configureReferenceSelection,
    resolveReferenceSelection,
    type ReferenceSelectionMode,
} from './reference-selection'

vi.mock('../db/database', () => {
    throw new Error('Community selection must not load the database')
})

afterEach(() => configureReferenceSelection(async () => 'standard'))

it('社区默认无需数据库即可解析标准策略', async () => {
    expect(await resolveReferenceSelection('community-user')).toBe('standard')
})

it('传递身份给部署策略并校验返回模式', async () => {
    const resolver = vi.fn(async (): Promise<ReferenceSelectionMode> => 'engagement_priority')
    configureReferenceSelection(resolver)
    expect(await resolveReferenceSelection('member')).toBe('engagement_priority')
    expect(resolver).toHaveBeenCalledWith('member')
    // 模拟部署适配器在运行时违反类型契约，边界仍必须拒绝。
    configureReferenceSelection(async () => 'invalid' as ReferenceSelectionMode)
    await expect(resolveReferenceSelection('member')).rejects.toThrow()
})

it('部署查询失败向上传播，不静默切换选样模式', async () => {
    const failure = new Error('subscription unavailable')
    configureReferenceSelection(async () => {
        throw failure
    })
    await expect(resolveReferenceSelection('member')).rejects.toBe(failure)
})
