import { describe, expect, it } from 'vitest'

import { createPasswordChangeCoordinator } from './auth-password-change.coordinator'

describe('密码修改账号级协调器', () => {
    it('同一账号只接受一个进行中的操作，并在完成后释放', async () => {
        const coordinator = createPasswordChangeCoordinator()
        let releaseFirst!: () => void
        const first = coordinator.run(
            'account-1',
            () =>
                new Promise<string>((resolve) => {
                    releaseFirst = () => resolve('changed')
                }),
        )

        await expect(coordinator.run('account-1', async () => 'duplicate')).resolves.toEqual({
            acquired: false,
        })

        releaseFirst()
        await expect(first).resolves.toEqual({ acquired: true, value: 'changed' })
        await expect(coordinator.run('account-1', async () => 'next')).resolves.toEqual({
            acquired: true,
            value: 'next',
        })
    })

    it('操作抛错后也释放账号，不形成永久锁', async () => {
        const coordinator = createPasswordChangeCoordinator()

        await expect(
            coordinator.run('account-1', async () => {
                throw new Error('provider unavailable')
            }),
        ).rejects.toThrow('provider unavailable')
        await expect(coordinator.run('account-1', async () => 'recovered')).resolves.toEqual({
            acquired: true,
            value: 'recovered',
        })
    })
})
