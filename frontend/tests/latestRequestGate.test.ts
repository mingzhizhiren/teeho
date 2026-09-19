import { describe, expect, test } from 'bun:test'

import { LatestRequestGate } from '@/utils/latestRequestGate'

describe('LatestRequestGate', () => {
    test('同一时刻只执行一个轮询请求', async () => {
        const gate = new LatestRequestGate()
        let finish!: () => void
        const pending = new Promise<void>((resolve) => {
            finish = resolve
        })
        let executions = 0

        const first = gate.run(async () => {
            executions += 1
            await pending
        })
        const second = gate.run(async () => {
            executions += 1
        })

        expect(executions).toBe(1)
        expect(second).toBe(first)
        finish()
        await first
    })

    test('状态变更后旧请求不能再写入新状态', async () => {
        const gate = new LatestRequestGate()
        let isCurrentAfterMutation = true
        let release!: () => void
        const pending = new Promise<void>((resolve) => {
            release = resolve
        })

        const request = gate.run(async (isCurrent) => {
            await pending
            isCurrentAfterMutation = isCurrent()
        })
        gate.invalidate()
        release()
        await request

        expect(isCurrentAfterMutation).toBe(false)
    })
})
