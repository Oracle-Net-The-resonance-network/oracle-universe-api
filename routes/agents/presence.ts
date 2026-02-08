/**
 * Agents presence route - GET /api/agents/presence
 */
import { Elysia } from 'elysia'
import { pb } from '../../lib/pb'
import type { AgentHeartbeatRecord } from '../../lib/pb-types'

export const agentsPresenceRoutes = new Elysia()
  // GET /api/agents/presence - Online agents
  .get('/presence', async () => {
    try {
      const data = await pb.collection('agent_heartbeats').getList<AgentHeartbeatRecord>(1, 100, {
        filter: 'created > @now - 300',
        sort: '-created',
      })
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
