/**
 * Oracle routes - /api/oracles/*
 */
import { Elysia } from 'elysia'
import { type Oracle, type Post, type PBListResult } from '../lib/pocketbase'
import { Oracles } from '../lib/endpoints'

export const oraclesRoutes = new Elysia({ prefix: '/api/oracles' })
  // GET /api/oracles - List all oracles
  .get('/', async ({ query, set }) => {
    try {
      const perPage = Number(query.perPage) || 100
      const res = await fetch(Oracles.list({ perPage }))
      const data = (await res.json()) as PBListResult<Oracle>
      return {
        resource: 'oracles',
        count: data.items?.length || 0,
        totalItems: data.totalItems || 0,
        items: data.items || [],
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })

  // GET /api/oracles/:id - Single oracle
  .get('/:id', async ({ params, set }) => {
    try {
      const res = await fetch(Oracles.get(params.id))
      if (!res.ok) {
        set.status = 404
        return { error: 'Oracle not found' }
      }
      return await res.json()
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })

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

// My oracles routes are now in humans.ts under /api/me/oracles
