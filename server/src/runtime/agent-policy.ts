import { env } from '../config/env'

/** 模型资源约束。这里不包含价格、订阅档位或商业能力目录。 */
export interface AgentResourcePolicy {
    interactionMode: 'guided' | 'conversation'
    sendWindowSeconds: number
    sendLimit: number
    sessionTokenBudget: number | null
    finalDraftTokenReserve: number
    sessionProgressThresholds: { yellow: number; red: number; exhausted: number }
    rollingWindowSeconds: number
    rollingTokenLimit: number
}

/** 一个账号本次调用使用的已验证资源策略。 */
export interface AgentAccessSnapshot {
    capabilities: { 'agent.conversation': boolean }
    agentPolicy: AgentResourcePolicy
    canUpgrade?: boolean
}

export interface AgentPolicyProvider {
    resolve(userId: string): Promise<AgentAccessSnapshot>
    limitsEnabled(): boolean
    imageMaximumEdge(profile?: string): number
}

let agentPolicy: AgentPolicyProvider = {
    async resolve() {
        return {
            capabilities: { 'agent.conversation': true },
            agentPolicy: {
                interactionMode: 'conversation',
                sendWindowSeconds: env.TEEHO_AGENT_SEND_WINDOW_SECONDS,
                sendLimit: env.TEEHO_AGENT_SEND_LIMIT,
                sessionTokenBudget: env.TEEHO_AGENT_SESSION_TOKEN_BUDGET,
                finalDraftTokenReserve: 0,
                sessionProgressThresholds: { yellow: 60, red: 85, exhausted: 100 },
                rollingWindowSeconds: env.TEEHO_AGENT_ROLLING_WINDOW_SECONDS,
                rollingTokenLimit: env.TEEHO_AGENT_ROLLING_TOKEN_LIMIT,
            },
            canUpgrade: false,
        }
    },
    limitsEnabled: () => true,
    imageMaximumEdge: () => env.TEEHO_AGENT_IMAGE_MAXIMUM_EDGE,
}

/** 在创建 HTTP 与 Worker 之前装配账号资源策略。 */
export function configureAgentPolicy(policy: AgentPolicyProvider): void {
    agentPolicy = policy
}

export function getAgentPolicy(): AgentPolicyProvider {
    return agentPolicy
}

/** 只检查已解析能力，不依据客户端传入的名称推断权限。 */
export function canUseConversation(snapshot: AgentAccessSnapshot): boolean {
    return snapshot.capabilities['agent.conversation']
}
