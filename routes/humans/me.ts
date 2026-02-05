/**
 * Human me route - GET /api/humans/me
 */
import { Elysia } from 'elysia'
import { verifyJWT, DEFAULT_SALT } from '../../lib/auth'
import { getPBAdminToken, type Human } from '../../lib/pocketbase'
import { Humans } from '../../lib/endpoints'

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

      // Fetch human by ID from token (use admin auth for collection access)
      const humanId = payload.sub as string
      const adminAuth = await getPBAdminToken()
      const headers: Record<string, string> = {}
      if (adminAuth.token) {
        headers['Authorization'] = adminAuth.token
      }
      const res = await fetch(Humans.get(humanId), { headers })

      if (!res.ok) {
        set.status = 404
        return { error: 'Human not found' }
      }

      const human = (await res.json()) as Human
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
