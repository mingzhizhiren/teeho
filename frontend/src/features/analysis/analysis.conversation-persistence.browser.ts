import { z } from 'zod'

import type { IndexedDbFileManager } from '@/utils/indexedDbFiles'
import { getUserEncryption } from '@/utils/userCrypto'
import {
    createAnalysisConversationPersistence,
    type AnalysisConversationChannelEvent,
    type AnalysisConversationChannelPort,
    type AnalysisConversationStoragePort,
    type AnalysisMutationLockPort,
    type AnalysisTurnLockPort,
} from './analysis.conversation-persistence'

const browserInstanceStorageKey = 'teeho.browser-instance.v1'
const conversationRecordId = 'analysis-forming-conversation.v1'
const channelEventSchema = z
    .object({
        sourcePageId: z.string().min(1),
        kind: z.enum(['changed', 'cleared', 'expired', 'unavailable']),
    })
    .strict()

interface BrowserIdentityStorage {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

/** 同一浏览器配置文件共享身份；存储被拒绝时明确标记为不可跨页协调。 */
export function resolveBrowserInstanceIdentity(
    storage: BrowserIdentityStorage,
    createId: () => string = () => crypto.randomUUID(),
) {
    const fallbackId = z.string().uuid().parse(createId())
    try {
        const existing = z.string().uuid().safeParse(storage.getItem(browserInstanceStorageKey))
        if (existing.success) return { id: existing.data, persistent: true }
        storage.removeItem(browserInstanceStorageKey)
        storage.setItem(browserInstanceStorageKey, fallbackId)
        return { id: fallbackId, persistent: true }
    } catch {
        return { id: fallbackId, persistent: false }
    }
}

function createStoragePort(manager: IndexedDbFileManager): AnalysisConversationStoragePort {
    return {
        readRecord: () => manager.getRecord(conversationRecordId, z.unknown()),
        writeRecord: (value) => manager.saveRecord(conversationRecordId, value),
        clearRecord: () => manager.deleteRecord(conversationRecordId),
        writeFile: async (id, file) => {
            await manager.saveFile(file, id)
        },
        readFile: async (id) => {
            const stored = await manager.getFile(id)
            if (!stored) return null
            return new File([stored.content], stored.metadata.name, {
                type: stored.metadata.type,
                lastModified: stored.metadata.lastModified,
            })
        },
        listFileIds: async () => (await manager.listFiles()).map((file) => file.id),
        deleteFile: (id) => manager.deleteFile(id),
    }
}

function createChannel(name: string): AnalysisConversationChannelPort | null {
    if (typeof BroadcastChannel === 'undefined') return null
    const channel = new BroadcastChannel(name)
    const listeners = new Set<(event: AnalysisConversationChannelEvent) => void>()
    channel.addEventListener('message', (message) => {
        const event = channelEventSchema.safeParse(message.data)
        if (!event.success) return
        for (const listener of listeners) listener(event.data)
    })
    return {
        publish: (event) => channel.postMessage(event),
        subscribe: (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        close: () => {
            listeners.clear()
            channel.close()
        },
    }
}

function createTurnLock(name: string): AnalysisTurnLockPort | null {
    if (typeof navigator === 'undefined' || !navigator.locks) return null
    return {
        runIfAvailable: async <T>(operation: () => Promise<T>) =>
            await navigator.locks.request(
                name,
                { mode: 'exclusive', ifAvailable: true },
                async (lock) => {
                    if (!lock) return { status: 'busy' as const }
                    return { status: 'acquired' as const, value: await operation() }
                },
            ),
    }
}

function createMutationLock(name: string): AnalysisMutationLockPort | null {
    if (typeof navigator === 'undefined' || !navigator.locks) return null
    return {
        runExclusive: async <T>(operation: () => Promise<T>) =>
            await navigator.locks.request(name, { mode: 'exclusive' }, operation),
    }
}

interface CreateBrowserPersistenceInput {
    userId: string
    manager: IndexedDbFileManager
}

/** 绑定当前账号密文存储、同配置文件广播频道和浏览器原子锁。 */
export async function createBrowserAnalysisConversationPersistence(
    input: CreateBrowserPersistenceInput,
) {
    const userId = z.string().min(1).parse(input.userId)
    const ownerScope = await getUserEncryption().getUserScope(userId)
    const identity = resolveBrowserInstanceIdentity(window.localStorage)
    const channelName = `teeho.analysis-conversation.v1.${ownerScope}`
    const lockName = `${channelName}.agent-turn`
    const mutationLockName = `${channelName}.result-mutation`
    const channel = identity.persistent ? createChannel(channelName) : null
    const turnLock = identity.persistent ? createTurnLock(lockName) : null
    const mutationLock = identity.persistent ? createMutationLock(mutationLockName) : null
    return createAnalysisConversationPersistence({
        storage: createStoragePort(input.manager),
        channel,
        turnLock,
        mutationLock,
        pageId: crypto.randomUUID(),
        browserInstanceId: identity.id,
    })
}
