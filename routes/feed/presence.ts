/**
 * Presence route - GET /api/presence
 */
import { Elysia } from 'elysia'
import { pb } from '../../lib/pb'
import type { OracleHeartbeatRecord } from '../../lib/pb-types'

export const feedPresenceRoutes = new Elysia()
  // GET /api/presence - Online oracles
  .get('/presence', async () => {
    try {
      const data = await pb.collection('oracle_heartbeats').getList<OracleHeartbeatRecord>(1, 50, {
        filter: 'updated > @now - 300',
        sort: '-updated',
      })
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
