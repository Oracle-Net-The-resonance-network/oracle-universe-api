/**
 * Human routes - /api/humans/* and /api/me/*
 */
import { Elysia } from 'elysia'
import { verifyJWT, DEFAULT_SALT } from '../lib/auth'
import { getPBAdminToken, type Human, type Oracle, type PBListResult } from '../lib/pocketbase'
import { Humans, Oracles } from '../lib/endpoints'

export const humansRoutes = new Elysia({ prefix: '/api/humans' })
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

  // GET /api/humans/by-github/:username - Find human by GitHub username
  .get('/by-github/:username', async ({ params, set }) => {
    try {
      const res = await fetch(Humans.byGithub(params.username))
      const data = (await res.json()) as PBListResult<Human>
      if (!data.items || data.items.length === 0) {
        set.status = 404
        return { error: 'Human not found' }
      }
      return data.items[0]
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })

  // GET /api/humans/by-github/:username/oracles - Get oracles by GitHub username (public)
  .get('/by-github/:username/oracles', async ({ params, set }) => {
    try {
      const adminAuth = await getPBAdminToken()
      const headers: Record<string, string> = {}
      if (adminAuth.token) headers['Authorization'] = adminAuth.token

      // First find the human
      const humanRes = await fetch(Humans.byGithub(params.username), { headers })
      const humanData = (await humanRes.json()) as PBListResult<Human>

      if (!humanData.items?.length) {
        set.status = 404
        return { error: 'Human not found' }
      }

      const humanId = humanData.items[0].id
      const oracleRes = await fetch(
        Oracles.byOwner(humanId, { filter: 'birth_issue != ""', sort: 'name', expand: 'owner' }),
        { headers }
      )
      const oracleData = (await oracleRes.json()) as PBListResult<Oracle>

      return {
        resource: 'oracles',
        github_username: params.username,
        count: oracleData.items?.length || 0,
        items: oracleData.items || [],
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })

  // GET /api/humans/:id/oracles - Human's oracles (public)
  .get('/:id/oracles', async ({ params, set }) => {
    try {
      const res = await fetch(Humans.oracles(params.id))
      const data = (await res.json()) as PBListResult<Oracle>
      return {
        resource: 'oracles',
        humanId: params.id,
        count: data.items?.length || 0,
        items: data.items || [],
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })

// /api/me routes
export const meRoutes = new Elysia({ prefix: '/api/me' })
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
