/**
 * Agents presence route - GET /api/agents/presence
 */
import { Elysia } from 'elysia'
import { type PBListResult } from '../../lib/pocketbase'
import { Heartbeats } from '../../lib/endpoints'

export interface AgentHeartbeat {
  id: string
  agent: string
  status: string
  created: string
  updated: string
}

export const agentsPresenceRoutes = new Elysia()
  // GET /api/agents/presence - Online agents
  .get('/presence', async () => {
    try {
      const res = await fetch(Heartbeats.agents({ filter: 'created > @now - 300', sort: '-created', perPage: 100 }))
      const data = (await res.json()) as PBListResult<AgentHeartbeat>
      const items = (data.items || []).map(hb => ({
        id: hb.agent,
        status: hb.status,
        lastSeen: hb.updated,
      }))
      return { items, totalOnline: items.length }
    } catch {
      return { items: [], totalOnline: 0 }
    }
  })
