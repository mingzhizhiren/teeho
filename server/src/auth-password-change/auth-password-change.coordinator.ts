export type PasswordChangeCoordinationResult<T> = { acquired: true; value: T } | { acquired: false }

export interface PasswordChangeCoordinator {
    run<T>(
        userId: string,
        operation: () => Promise<T>,
    ): Promise<PasswordChangeCoordinationResult<T>>
}

/**
 * 单进程账号级 single-flight。题火 v1.0.1 只部署单台 API 实例；接口保持可替换，未来多实例时可换成租约 Adapter。
 */
export function createPasswordChangeCoordinator(): PasswordChangeCoordinator {
    let activeUserIds = new Set<string>()

    return {
        async run<T>(userId: string, operation: () => Promise<T>) {
            if (activeUserIds.has(userId)) return { acquired: false }

            activeUserIds = new Set([...activeUserIds, userId])
            try {
                return { acquired: true, value: await operation() }
            } finally {
                const nextActiveUserIds = new Set(activeUserIds)
                nextActiveUserIds.delete(userId)
                activeUserIds = nextActiveUserIds
            }
        },
    }
}

export const passwordChangeCoordinator = createPasswordChangeCoordinator()
