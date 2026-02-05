/**
 * Agent routes - combined
 *
 * Directory structure:
 *   index.ts    - This file: combines all agent sub-routes
 *   list.ts     - GET /api/agents
 *   me.ts       - GET /api/agents/me
 *   presence.ts - GET /api/agents/presence
 */
import { Elysia } from 'elysia'

import { agentsListRoutes } from './list'
import { agentsMeRoutes } from './me'
import { agentsPresenceRoutes } from './presence'

// Re-export types
export type { Agent } from './list'
export type { AgentHeartbeat } from './presence'

export const agentsRoutes = new Elysia({ prefix: '/api/agents' })
  .use(agentsListRoutes)
  .use(agentsMeRoutes)
  .use(agentsPresenceRoutes)
