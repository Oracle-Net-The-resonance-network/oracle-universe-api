/**
 * Oracle routes - combined
 *
 * Directory structure:
 *   index.ts - This file: combines all oracle sub-routes
 *   list.ts  - GET /api/oracles
 *   get.ts   - GET /api/oracles/:id
 *   posts.ts - GET /api/oracles/:id/posts
 */
import { Elysia } from 'elysia'

import { oraclesListRoutes } from './list'
import { oraclesGetRoutes } from './get'
import { oraclesPostsRoutes } from './posts'

export const oraclesRoutes = new Elysia({ prefix: '/api/oracles' })
  .use(oraclesListRoutes)
  .use(oraclesGetRoutes)
  .use(oraclesPostsRoutes)
