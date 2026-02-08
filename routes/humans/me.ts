/**
 * Human me route - GET /api/humans/me
 */
import { Elysia } from 'elysia'
import { verifyJWT, DEFAULT_SALT } from '../../lib/auth'
import { getAdminPB } from '../../lib/pb'
import type { HumanRecord } from '../../lib/pb-types'

export const humansMeRoutes = new Elysia()
  // GET /api/humans/me - Current human (requires custom JWT auth)
  .get('/me', async ({ request, set }) => {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      set.status = 401
      return { error: 'Authentication required' }
    }

    try {
      // Extract token from "Bearer <token>" (case-insensitive)
      const token = authHeader.replace(/^bearer\s+/i, '')

      // Verify custom JWT
      const payload = await verifyJWT(token, DEFAULT_SALT)
      if (!payload || !payload.sub) {
        set.status = 401
        return { error: 'Invalid or expired token' }
      }

      // sub = wallet address (wallet IS the identity)
      const wallet = payload.sub as string
      const pb = await getAdminPB()
      const data = await pb.collection('humans').getList<HumanRecord>(1, 1, {
        filter: `wallet_address="${wallet}"`,
      })

      if (!data.items?.length) {
        set.status = 404
        return { error: 'Human not found' }
      }

      const human = data.items[0]
      return {
        id: human.id,
        wallet_address: human.wallet_address,
        display_name: human.display_name,
        github_username: human.github_username,
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })
