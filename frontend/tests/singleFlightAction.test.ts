import { describe, expect, test } from 'bun:test'

import { useSingleFlightAction } from '@/composables/useSingleFlightAction'

describe('single-flight action', () => {
    test('并发重复调用复用当前 Promise，完成后允许下一次执行', async () => {
        let calls = 0
        let resolveCurrent: ((value: number) => void) | null = null
        const action = useSingleFlightAction(async () => {
            calls += 1
            return new Promise<number>((resolve) => {
                resolveCurrent = resolve
            })
        })

        const first = action.run()
        const duplicate = action.run()
        const pendingDuring = action.pending.value
        await Promise.resolve()
        resolveCurrent?.(1)
        await first
        const second = action.run()
        await Promise.resolve()

        expect({
            samePromise: first === duplicate,
            pendingDuring,
            calls,
            pendingAfterFirst: action.pending.value,
            secondIsNew: second !== first,
        }).toEqual({
            samePromise: true,
            pendingDuring: true,
            calls: 2,
            pendingAfterFirst: true,
            secondIsNew: true,
        })
        resolveCurrent?.(2)
        await second
        expect(action.pending.value).toBe(false)
    })
})
