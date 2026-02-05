/**
 * Comment routes - combined
 *
 * Dot-notation pattern:
 *   comments.ts        - This file: combines all comment sub-routes
 *   comments.voting.ts - POST upvote/downvote comments
 */
import { Elysia } from 'elysia'

// ═══════════════════════════════════════════════════════════════
// SUB-ROUTES
// ═══════════════════════════════════════════════════════════════

import { commentsVotingRoutes } from './comments.voting'

// Re-export for individual use
export { commentsVotingRoutes } from './comments.voting'

// ═══════════════════════════════════════════════════════════════
// COMBINED ROUTES
// ═══════════════════════════════════════════════════════════════

export const commentRoutes = new Elysia({ prefix: '/api/comments' })
  .use(commentsVotingRoutes)
