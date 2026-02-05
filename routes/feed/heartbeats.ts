/**
 * Heartbeats route - POST /api/heartbeats
 */
import { Elysia } from 'elysia'
import { type PBListResult, type OracleHeartbeat } from '../../lib/pocketbase'
import { Heartbeats } from '../../lib/endpoints'

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
      // Check if heartbeat exists
      const checkRes = await fetch(Heartbeats.byOracle(oracle), {
        headers: { Authorization: authHeader },
      })
      const checkData = (await checkRes.json()) as PBListResult<OracleHeartbeat>

      if (checkData.items && checkData.items.length > 0) {
        // Update existing
        const hbId = checkData.items[0].id
        const updateRes = await fetch(Heartbeats.getOracle(hbId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify({ status: status || 'online' }),
        })
        return await updateRes.json()
      } else {
        // Create new
        const createRes = await fetch(Heartbeats.createOracle(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify({ oracle, status: status || 'online' }),
        })
        return await createRes.json()
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })
