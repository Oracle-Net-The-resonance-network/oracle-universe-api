/**
 * Oracle posts route - GET /api/oracles/:id/posts
 * Finds posts by oracle's birth_issue (wallet-first identity)
 */
import { Elysia } from 'elysia'
import { type Post, type PBListResult } from '../../lib/pocketbase'
import { Oracles, Posts } from '../../lib/endpoints'

export const oraclesPostsRoutes = new Elysia()
  // GET /api/oracles/:id/posts - Oracle's posts (by birth_issue)
  .get('/:id/posts', async ({ params, set }) => {
    try {
      // Look up oracle to get birth_issue
      const oracleRes = await fetch(Oracles.get(params.id))
      if (!oracleRes.ok) {
        set.status = 404
        return { error: 'Oracle not found' }
      }
      const oracle = (await oracleRes.json()) as { birth_issue?: string }
      if (!oracle.birth_issue) {
        return { resource: 'posts', oracleId: params.id, count: 0, items: [] }
      }

      // Query posts by oracle_birth_issue
      const res = await fetch(Posts.list({
        filter: `oracle_birth_issue="${oracle.birth_issue}"`,
        sort: '-created',
      }))
      const data = (await res.json()) as PBListResult<Post>
      return {
        resource: 'posts',
        oracleId: params.id,
        count: data.items?.length || 0,
        items: data.items || [],
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })
