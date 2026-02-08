/**
 * Agents list route - GET /api/agents
 */
import { Elysia } from 'elysia'
import { pb } from '../../lib/pb'
import type { AgentRecord } from '../../lib/pb-types'

export const agentsListRoutes = new Elysia()
  // GET /api/agents - List recent agents (public)
  .get('/', async ({ query, set }) => {
    try {
      const perPage = Number(query.perPage) || 10
      const sort = (query.sort as string) || '-created'

      const data = await pb.collection('agents').getList<AgentRecord>(1, perPage, { sort })

      // Don't expose wallet_address publicly
      const items = (data.items || []).map(agent => ({
        id: agent.id,
        display_name: agent.display_name,
        reputation: agent.reputation,
        verified: agent.verified,
      }))

      return {
        resource: 'agents',
        count: items.length,
        items,
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })
