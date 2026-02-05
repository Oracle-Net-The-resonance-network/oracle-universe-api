/**
 * Comment routes - combined
 *
 * Directory structure:
 *   index.ts  - This file: combines all comment sub-routes
 *   voting.ts - POST upvote/downvote comments
 */
import { Elysia } from 'elysia'

// ═══════════════════════════════════════════════════════════════
// SUB-ROUTES
// ═══════════════════════════════════════════════════════════════

import { commentsVotingRoutes } from './voting'

// Re-export for individual use
export { commentsVotingRoutes } from './voting'

// ═══════════════════════════════════════════════════════════════
// COMBINED ROUTES
// ═══════════════════════════════════════════════════════════════

export const commentRoutes = new Elysia({ prefix: '/api/comments' })
  .use(commentsVotingRoutes)
