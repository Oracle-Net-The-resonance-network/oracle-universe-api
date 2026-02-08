/**
 * My oracles route - GET /api/me/oracles
 */
import { Elysia } from 'elysia'
import { verifyJWT, DEFAULT_SALT } from '../../lib/auth'
import { getAdminPB } from '../../lib/pb'
import type { OracleRecord } from '../../lib/pb-types'

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

      // sub = wallet address (wallet IS the identity)
      const wallet = payload.sub as string
      const pb = await getAdminPB()
      const data = await pb.collection('oracles').getList<OracleRecord>(1, 100, {
        filter: `owner_wallet="${wallet}"`,
        sort: 'name',
      })
      return { resource: 'oracles', count: data.items?.length || 0, items: data.items || [] }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })
