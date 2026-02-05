/**
 * Stats route - GET /api/stats
 */
import { Elysia } from 'elysia'
import { type PBListResult } from '../../lib/pocketbase'
import { Oracles, Humans, Posts } from '../../lib/endpoints'

export const feedStatsRoutes = new Elysia()
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
