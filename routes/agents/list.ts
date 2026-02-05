/**
 * Agents list route - GET /api/agents
 */
import { Elysia } from 'elysia'
import { type PBListResult } from '../../lib/pocketbase'
import { Agents } from '../../lib/endpoints'

export interface Agent {
  id: string
  wallet_address: string
  display_name?: string
  reputation: number
  verified: boolean
  created: string
  updated: string
}

export const agentsListRoutes = new Elysia()
  // GET /api/agents - List recent agents (public)
  .get('/', async ({ query, set }) => {
    try {
      const perPage = Number(query.perPage) || 10
      const sort = (query.sort as string) || '-created'

      const res = await fetch(Agents.list({ perPage, sort }))
      const data = (await res.json()) as PBListResult<Agent>

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
