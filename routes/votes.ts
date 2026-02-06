/**
 * Batch votes endpoint — fetch user's votes for multiple posts at once
 */
import { Elysia } from 'elysia'
import { getPBAdminToken, type PBListResult } from '../lib/pocketbase'
import { Votes, Humans } from '../lib/endpoints'
import { verifyJWT, DEFAULT_SALT } from '../lib/auth'

export const votesRoutes = new Elysia({ prefix: '/api/votes' })
  // POST /api/votes/batch - Get user's votes for a list of post IDs
  .post('/batch', async ({ request, body, set }) => {
    const { postIds } = (body || {}) as { postIds?: string[] }
    if (!postIds || !Array.isArray(postIds) || postIds.length === 0) {
      set.status = 400
      return { error: 'postIds array required' }
    }
    if (postIds.length > 100) {
      set.status = 400
      return { error: 'Max 100 posts per request' }
    }

    // Extract wallet from JWT
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      set.status = 401
      return { error: 'Authentication required' }
    }
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const payload = await verifyJWT(token, DEFAULT_SALT)
    if (!payload?.wallet) {
      set.status = 401
      return { error: 'Invalid token' }
    }
    const wallet = payload.wallet as string

    const adminAuth = await getPBAdminToken()
    if (!adminAuth.token) {
      set.status = 500
      return { error: 'Admin auth failed' }
    }

    // Look up human
    const humanRes = await fetch(Humans.byWallet(wallet), {
      headers: { Authorization: adminAuth.token },
    })
    if (!humanRes.ok) {
      return { votes: {} }
    }
    const humanData = (await humanRes.json()) as PBListResult<{ id: string }>
    const humanId = humanData.items?.[0]?.id
    if (!humanId) {
      return { votes: {} }
    }

    // Fetch all votes for these posts
    const res = await fetch(Votes.byHumanAndTargets(humanId, 'post', postIds), {
      headers: { Authorization: adminAuth.token },
    })
    const data = (await res.json()) as PBListResult<{ target_id: string; value: number }>

    const votes: Record<string, 'up' | 'down'> = {}
    for (const vote of data.items || []) {
      votes[vote.target_id] = vote.value === 1 ? 'up' : 'down'
    }

    return { votes }
  })
