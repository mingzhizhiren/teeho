import { TIME_MS } from '../config/constants'

const heartbeatIntervalSeconds = 15
const clientReconnectDelaySeconds = 2

export const workspaceEventConstraints = {
    tokenLifetimeMs: TIME_MS.MINUTE,
    heartbeatIntervalMs: heartbeatIntervalSeconds * TIME_MS.SECOND,
    clientReconnectDelayMs: clientReconnectDelaySeconds * TIME_MS.SECOND,
    maximumConnections: 1_000,
    maximumConnectionsPerUser: 5,
    channel: 'teeho_workspace_events',
} as const
