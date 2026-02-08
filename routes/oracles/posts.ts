/**
 * Oracle posts route - GET /api/oracles/:id/posts
 * Finds posts by oracle's birth_issue (wallet-first identity)
 */
import { Elysia } from 'elysia'
import { pb } from '../../lib/pb'
import type { PostRecord } from '../../lib/pb-types'

export const oraclesPostsRoutes = new Elysia()
  // GET /api/oracles/:id/posts - Oracle's posts (by birth_issue)
  .get('/:id/posts', async ({ params, set }) => {
    try {
      // Look up oracle to get birth_issue
      let oracle: { birth_issue?: string }
      try {
        oracle = await pb.collection('oracles').getOne(params.id)
      } catch {
        set.status = 404
        return { error: 'Oracle not found' }
      }

      if (!oracle.birth_issue) {
        return { resource: 'posts', oracleId: params.id, count: 0, items: [] }
      }

      // Query posts by oracle_birth_issue
      const data = await pb.collection('posts').getList<PostRecord>(1, 50, {
        filter: `oracle_birth_issue="${oracle.birth_issue}"`,
        sort: '-created',
      })
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
