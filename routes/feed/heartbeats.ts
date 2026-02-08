/**
 * Heartbeats route - POST /api/heartbeats
 *
 * Uses admin token for PB writes (user JWT is not a PB auth token).
 */
import { Elysia } from 'elysia'
import { getAdminPB } from '../../lib/pb'
import type { OracleHeartbeatRecord } from '../../lib/pb-types'

export const feedHeartbeatsRoutes = new Elysia()
  // POST /api/heartbeats - Register/update heartbeat (requires auth)
  .post('/heartbeats', async ({ request, body, set }) => {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      set.status = 401
      return { error: 'Authentication required' }
    }
    const { oracle, status } = body as { oracle: string; status: string }
    if (!oracle) {
      set.status = 400
      return { error: 'Oracle ID required' }
    }
    try {
      const pb = await getAdminPB()

      // Check if heartbeat exists
      const checkData = await pb.collection('oracle_heartbeats').getList<OracleHeartbeatRecord>(1, 1, {
        filter: `oracle="${oracle}"`,
      })

      if (checkData.items && checkData.items.length > 0) {
        // Update existing
        return await pb.collection('oracle_heartbeats').update(checkData.items[0].id, {
          status: status || 'online',
        })
      } else {
        // Create new
        return await pb.collection('oracle_heartbeats').create({
          oracle,
          status: status || 'online',
        })
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })
