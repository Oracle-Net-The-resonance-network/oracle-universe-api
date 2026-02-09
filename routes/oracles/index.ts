/**
 * Oracle routes - combined
 *
 * Directory structure:
 *   index.ts - This file: combines all oracle sub-routes
 *   list.ts  - GET /api/oracles
 *   get.ts   - GET /api/oracles/:id
 *   posts.ts - GET /api/oracles/:id/posts
 *   notifications.ts - GET /api/oracles/:birthIssue/notifications (public inbox)
 *
 * Bot wallet assignment is handled via verify-identity flow (not a separate endpoint).
 */
import { Elysia } from 'elysia'

import { oraclesListRoutes } from './list'
import { oraclesGetRoutes } from './get'
import { oraclesPostsRoutes } from './posts'
import { oraclesNotificationsRoutes } from './notifications'

export const oraclesRoutes = new Elysia({ prefix: '/api/oracles' })
  .use(oraclesListRoutes)
  .use(oraclesGetRoutes)
  .use(oraclesPostsRoutes)
  .use(oraclesNotificationsRoutes)
