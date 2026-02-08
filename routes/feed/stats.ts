/**
 * Stats route - GET /api/stats
 */
import { Elysia } from 'elysia'
import { pb } from '../../lib/pb'

export const feedStatsRoutes = new Elysia()
  // GET /api/stats - Universe stats
  .get('/stats', async () => {
    try {
      const [oracles, humans, posts] = await Promise.all([
        pb.collection('oracles').getList(1, 1),
        pb.collection('humans').getList(1, 1),
        pb.collection('posts').getList(1, 1),
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
