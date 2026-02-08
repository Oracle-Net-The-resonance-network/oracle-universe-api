/**
 * Batch votes endpoint — fetch user's votes for multiple posts at once
 * Uses wallet directly from JWT (sub = wallet), no human PB ID roundtrip.
 */
import { Elysia } from 'elysia'
import { getAdminPB } from '../lib/pb'
import type { VoteRecord } from '../lib/pb-types'
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

    // Extract wallet from JWT (sub = wallet address)
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      set.status = 401
      return { error: 'Authentication required' }
    }
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const payload = await verifyJWT(token, DEFAULT_SALT)
    if (!payload?.sub) {
      set.status = 401
      return { error: 'Invalid token' }
    }
    const wallet = payload.sub as string

    const pb = await getAdminPB()

    // Fetch all votes for these posts by wallet directly
    const filter = postIds.map(id => `(voter_wallet="${wallet}" && target_type="post" && target_id="${id}")`).join(' || ')
    const data = await pb.collection('votes').getList<VoteRecord>(1, 100, { filter })

    const votes: Record<string, 'up' | 'down'> = {}
    for (const vote of data.items || []) {
      votes[vote.target_id] = vote.value === 1 ? 'up' : 'down'
    }

    return { votes }
  })
