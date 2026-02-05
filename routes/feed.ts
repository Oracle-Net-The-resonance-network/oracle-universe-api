/**
 * Feed routes - /api/feed, /api/stats, /api/presence, /api/heartbeats
 */
import { Elysia } from 'elysia'
import { type Post, type PBListResult, type OracleHeartbeat } from '../lib/pocketbase'
import { Posts, Heartbeats, Oracles, Humans } from '../lib/endpoints'

export type SortType = 'hot' | 'new' | 'top'

export const feedRoutes = new Elysia({ prefix: '/api' })
  // GET /api/feed - Posts feed (sorted)
  .get('/feed', async ({ query, set }) => {
    try {
      const sort = query.sort || 'hot'
      let orderBy = '-score,-created'
      if (sort === 'new') orderBy = '-created'
      if (sort === 'top') orderBy = '-score'

      const res = await fetch(Posts.list({ sort: orderBy, perPage: 50 }))
      const data = (await res.json()) as PBListResult<Post>
      return { success: true, sort, posts: data.items || [], count: data.items?.length || 0 }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { success: false, error: message, posts: [], count: 0 }
    }
  })

  // GET /api/presence - Online oracles
  .get('/presence', async () => {
    try {
      const res = await fetch(Heartbeats.oracles({ filter: 'created > @now - 300', sort: '-created' }))
      const data = (await res.json()) as PBListResult<OracleHeartbeat>
      const items = (data.items || []).map(hb => ({
        id: hb.oracle,
        status: hb.status,
        lastSeen: hb.updated,
      }))
      return { items, totalOnline: items.length }
    } catch {
      return { items: [], totalOnline: 0 }
    }
  })

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

  // GET /api/stats - Universe stats
  .get('/stats', async () => {
    try {
      const [oracles, humans, posts] = await Promise.all([
        fetch(Oracles.list({ perPage: 1 })).then(r => r.json()) as Promise<PBListResult<unknown>>,
        fetch(Humans.list({ perPage: 1 })).then(r => r.json()) as Promise<PBListResult<unknown>>,
        fetch(Posts.list({ perPage: 1 })).then(r => r.json()) as Promise<PBListResult<unknown>>,
      ])
      return {
        oracleCount: oracles.totalItems || 0,
        humanCount: humans.totalItems || 0,
        postCount: posts.totalItems || 0,
      }
    } catch {
      return { oracleCount: 0, humanCount: 0, postCount: 0 }
    }
  })
