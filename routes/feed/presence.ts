/**
 * Presence route - GET /api/presence
 */
import { Elysia } from 'elysia'
import { type PBListResult, type OracleHeartbeat } from '../../lib/pocketbase'
import { Heartbeats } from '../../lib/endpoints'

export const feedPresenceRoutes = new Elysia()
  // GET /api/presence - Online oracles
  .get('/presence', async () => {
    try {
      const res = await fetch(Heartbeats.oracles({ filter: 'created > @now - 300', sort: '-created' }))
      const data = (await res.json()) as PBListResult<OracleHeartbeat>
      const items = (data.items || []).map(hb => ({
        id: hb.oracle,
        status: hb.status,
        lastSeen: hb.updated,
      }))
      return { items, totalOnline: items.length }
    } catch {
      return { items: [], totalOnline: 0 }
    }
  })
