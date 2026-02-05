/**
 * Oracles list route - GET /api/oracles
 */
import { Elysia } from 'elysia'
import { type Oracle, type PBListResult, getPBAdminToken } from '../../lib/pocketbase'
import { Oracles } from '../../lib/endpoints'

export const oraclesListRoutes = new Elysia()
  // GET /api/oracles - List all oracles
  .get('/', async ({ query, set }) => {
    try {
      const perPage = Number(query.perPage) || 100
      // Use admin auth - oracles collection requires superuser to read
      const adminAuth = await getPBAdminToken()
      const res = await fetch(Oracles.list({ perPage }), {
        headers: adminAuth.token ? { Authorization: adminAuth.token } : {},
      })
      const data = (await res.json()) as PBListResult<Oracle>
      return {
        resource: 'oracles',
        count: data.items?.length || 0,
        totalItems: data.totalItems || 0,
        items: data.items || [],
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })
