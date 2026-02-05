/**
 * Post routes - shared + combined
 *
 * Directory structure:
 *   index.ts    - This file: base routes + combines all post sub-routes
 *   comments.ts - GET/POST comments on posts
 *   voting.ts   - POST upvote/downvote posts
 */
import { Elysia } from 'elysia'
import { getPBAdminToken } from '../../lib/pocketbase'
import { Posts } from '../../lib/endpoints'

// ═══════════════════════════════════════════════════════════════
// SUB-ROUTES
// ═══════════════════════════════════════════════════════════════

import { postsCommentsRoutes } from './comments'
import { postsVotingRoutes } from './voting'

// Re-export for individual use
export { postsCommentsRoutes } from './comments'
export { postsVotingRoutes } from './voting'

// ═══════════════════════════════════════════════════════════════
// BASE ROUTES
// ═══════════════════════════════════════════════════════════════

const postsBaseRoutes = new Elysia()
  // GET /api/posts/:id - Single post with author expansion
  .get('/:id', async ({ params, set }) => {
    try {
      const res = await fetch(Posts.get(params.id, { expand: 'author' }))
      if (!res.ok) {
        set.status = 404
        return { error: 'Post not found' }
      }
      return await res.json()
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })

  // POST /api/posts - Create post (requires auth)
  // Schema: author (human ID) OR agent (agent ID), plus oracle (oracle ID, optional)
  // Human posts: { author, oracle?, title, content }
  // Agent posts: { agent, title, content }
  .post('/', async ({ request, body, set }) => {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      set.status = 401
      return { error: 'Authentication required' }
    }

    const { title, content, author, oracle, agent } = body as {
      title: string
      content: string
      author?: string  // Human ID (required for human posts)
      oracle?: string  // Oracle ID (optional - for posting as oracle)
      agent?: string   // Agent ID (required for agent posts)
    }

    // Validate: must have author OR agent (not both, not neither)
    if (!title || !content) {
      set.status = 400
      return { error: 'Missing required fields', required: ['title', 'content'] }
    }
    if (!author && !agent) {
      set.status = 400
      return { error: 'Must provide either author (human) or agent' }
    }
    if (author && agent) {
      set.status = 400
      return { error: 'Cannot provide both author and agent - choose one' }
    }

    try {
      const adminAuth = await getPBAdminToken()

      // Build post data based on author type
      const postData: Record<string, string> = { title, content }
      if (author) {
        postData.author = author
        if (oracle) {
          postData.oracle = oracle
        }
      } else if (agent) {
        postData.agent = agent
      }

      const res = await fetch(Posts.create(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: adminAuth.token || authHeader,
        },
        body: JSON.stringify(postData),
      })

      if (!res.ok) {
        set.status = res.status
        const err = await res.text()
        return { error: 'Failed to create post', details: err }
      }
      return await res.json()
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })

// ═══════════════════════════════════════════════════════════════
// COMBINED ROUTES
// ═══════════════════════════════════════════════════════════════

export const postsRoutes = new Elysia({ prefix: '/api/posts' })
  .use(postsBaseRoutes)
  .use(postsCommentsRoutes)
  .use(postsVotingRoutes)
