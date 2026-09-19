import { describe, expect, it, vi } from 'vitest'

import {
    WorkspaceEventConnectionLimitError,
    WorkspaceEventHub,
    workspaceEventSchema,
} from '@teeho/community-server/workspace-events/workspace-event'

const userA = '00000000-0000-4000-8000-000000000001'
const userB = '00000000-0000-4000-8000-000000000002'
const taskId = '00000000-0000-4000-8000-000000000003'

function taskEvent(userId = userA) {
    return workspaceEventSchema.parse({
        id: '101',
        type: 'task.changed',
        userId,
        resourceId: taskId,
        status: 'processing',
        version: null,
        occurredAt: '2026-08-02T10:00:00.000Z',
    })
}

describe('workspace event contract and hub', () => {
    it('accepts only lightweight versioned event fields', () => {
        expect(taskEvent()).toMatchObject({ id: '101', type: 'task.changed' })
        expect(() =>
            workspaceEventSchema.parse({
                ...taskEvent(),
                result: { body: 'must not enter an event' },
            }),
        ).toThrow()
    })

    it('publishes only to subscribers of the verified account and releases connections', () => {
        const hub = new WorkspaceEventHub({ maximumConnections: 4, maximumPerUser: 2 })
        const receiveA = vi.fn()
        const receiveB = vi.fn()
        const unsubscribeA = hub.subscribe(userA, receiveA)
        const unsubscribeB = hub.subscribe(userB, receiveB)

        hub.publish(taskEvent(userA))

        expect(receiveA).toHaveBeenCalledOnce()
        expect(receiveB).not.toHaveBeenCalled()
        expect(hub.connectionCount).toBe(2)
        unsubscribeA()
        unsubscribeB()
        expect(hub.connectionCount).toBe(0)
    })

    it('enforces a per-account connection ceiling', () => {
        const hub = new WorkspaceEventHub({ maximumConnections: 2, maximumPerUser: 1 })
        hub.subscribe(userA, vi.fn())

        expect(() => hub.subscribe(userA, vi.fn())).toThrow(WorkspaceEventConnectionLimitError)
    })

    it('视频事件只允许状态提示，不接受证据、Base64 或签名地址', () => {
        const videoEvent = {
            ...taskEvent(),
            type: 'video.changed' as const,
            status: 'ready' as const,
        }

        expect(workspaceEventSchema.parse(videoEvent)).toEqual(videoEvent)
        expect(() =>
            workspaceEventSchema.parse({
                ...videoEvent,
                evidence: { frames: ['base64-private-frame'] },
            }),
        ).toThrow()
        expect(() =>
            workspaceEventSchema.parse({
                ...videoEvent,
                signedUrl: 'https://storage.example/private',
            }),
        ).toThrow()
    })

    it('会话事件只携带身份、代数与状态，不携带聊天正文', () => {
        const conversationEvent = {
            ...taskEvent(),
            type: 'conversation.changed' as const,
            status: 'active' as const,
            version: 3,
        }
        expect(workspaceEventSchema.parse(conversationEvent)).toEqual(conversationEvent)
        expect(() =>
            workspaceEventSchema.parse({ ...conversationEvent, messages: ['private'] }),
        ).toThrow()
    })
})
