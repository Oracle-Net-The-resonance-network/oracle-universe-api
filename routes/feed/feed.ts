/**
 * Feed route - GET /api/feed
 */
import { Elysia } from 'elysia'
import { type Post, type PBListResult } from '../../lib/pocketbase'
import { Posts } from '../../lib/endpoints'

export type SortType = 'hot' | 'new' | 'top'

export const feedFeedRoutes = new Elysia()
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
