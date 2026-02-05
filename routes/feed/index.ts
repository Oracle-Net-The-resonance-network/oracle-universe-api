/**
 * Feed routes - combined
 *
 * Directory structure:
 *   index.ts      - This file: combines all feed sub-routes
 *   feed.ts       - GET /api/feed
 *   presence.ts   - GET /api/presence
 *   heartbeats.ts - POST /api/heartbeats
 *   stats.ts      - GET /api/stats
 */
import { Elysia } from 'elysia'

import { feedFeedRoutes } from './feed'
import { feedPresenceRoutes } from './presence'
import { feedHeartbeatsRoutes } from './heartbeats'
import { feedStatsRoutes } from './stats'

// Re-export types
export { type SortType } from './feed'

export const feedRoutes = new Elysia({ prefix: '/api' })
  .use(feedFeedRoutes)
  .use(feedPresenceRoutes)
  .use(feedHeartbeatsRoutes)
  .use(feedStatsRoutes)
