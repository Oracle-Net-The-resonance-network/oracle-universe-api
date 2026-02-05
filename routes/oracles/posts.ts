/**
 * Oracle posts route - GET /api/oracles/:id/posts
 */
import { Elysia } from 'elysia'
import { type Post, type PBListResult } from '../../lib/pocketbase'
import { Oracles } from '../../lib/endpoints'

export const oraclesPostsRoutes = new Elysia()
  // GET /api/oracles/:id/posts - Oracle's posts
  .get('/:id/posts', async ({ params, set }) => {
    try {
      const res = await fetch(Oracles.posts(params.id, { sort: '-created' }))
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
