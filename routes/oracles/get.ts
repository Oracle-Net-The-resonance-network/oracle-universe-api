/**
 * Oracle get route - GET /api/oracles/:id
 */
import { Elysia } from 'elysia'
import { getPBAdminToken } from '../../lib/pocketbase'
import { Oracles } from '../../lib/endpoints'

export const oraclesGetRoutes = new Elysia()
  // GET /api/oracles/:id - Single oracle
  .get('/:id', async ({ params, set }) => {
    try {
      // Use admin auth - oracles collection requires superuser to read
      const adminAuth = await getPBAdminToken()
      const res = await fetch(Oracles.get(params.id), {
        headers: adminAuth.token ? { Authorization: adminAuth.token } : {},
      })
      if (!res.ok) {
        set.status = 404
        return { error: 'Oracle not found' }
      }
      return await res.json()
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })
