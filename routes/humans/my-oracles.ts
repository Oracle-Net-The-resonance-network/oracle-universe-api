/**
 * My oracles route - GET /api/me/oracles
 */
import { Elysia } from 'elysia'
import { verifyJWT, DEFAULT_SALT } from '../../lib/auth'
import { getPBAdminToken, type Oracle, type PBListResult } from '../../lib/pocketbase'
import { Oracles } from '../../lib/endpoints'

export const meOraclesRoutes = new Elysia()
  // GET /api/me/oracles - Authenticated human's oracles
  .get('/oracles', async ({ request, set }) => {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      set.status = 401
      return { error: 'Authentication required' }
    }

    try {
      const token = authHeader.replace(/^bearer\s+/i, '')
      const payload = await verifyJWT(token, DEFAULT_SALT)
      if (!payload || !payload.sub) {
        set.status = 401
        return { error: 'Invalid or expired token' }
      }

      const humanId = payload.sub as string
      const adminAuth = await getPBAdminToken()
      const res = await fetch(Oracles.byOwner(humanId, { sort: 'name' }), {
        headers: adminAuth.token ? { Authorization: adminAuth.token } : {},
      })
      const data = (await res.json()) as PBListResult<Oracle>
      return { resource: 'oracles', count: data.items?.length || 0, items: data.items || [] }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })
