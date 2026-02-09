/**
 * Presence route - GET /api/presence
 */
import { Elysia } from 'elysia'
import { getAdminPB } from '../../lib/pb'
import type { OracleHeartbeatRecord, OracleRecord } from '../../lib/pb-types'

export const feedPresenceRoutes = new Elysia()
  // GET /api/presence - Online oracles
  .get('/presence', async () => {
    try {
      const pb = await getAdminPB()
      const cutoff = new Date(Date.now() - 300_000).toISOString().replace('T', ' ').slice(0, 23) + 'Z'
      const data = await pb.collection('oracle_heartbeats').getList<OracleHeartbeatRecord>(1, 50, {
        filter: `updated >= "${cutoff}"`,
        sort: '-updated',
      })
      const heartbeats = data.items || []
      if (heartbeats.length === 0) {
        return { items: [], totalOnline: 0, totalAway: 0, totalOffline: 0 }
      }

      // Enrich with oracle names
      const oracleIds = heartbeats.map(hb => hb.oracle).filter(Boolean)
      const oracleFilter = oracleIds.map(id => `id="${id}"`).join(' || ')
      const oracles = await pb.collection('oracles').getList<OracleRecord>(1, 50, { filter: oracleFilter })
      const oracleMap = new Map(oracles.items.map(o => [o.id, o.name]))

      const items = heartbeats.map(hb => ({
        id: hb.oracle,
        name: oracleMap.get(hb.oracle) || 'Oracle',
        status: hb.status as 'online' | 'away' | 'offline',
        lastSeen: hb.updated,
      }))

      const totalOnline = items.filter(i => i.status === 'online').length
      const totalAway = items.filter(i => i.status === 'away').length
      const totalOffline = items.filter(i => i.status === 'offline').length

      return { items, totalOnline, totalAway, totalOffline }
    } catch {
      return { items: [], totalOnline: 0, totalAway: 0, totalOffline: 0 }
    }
  })
