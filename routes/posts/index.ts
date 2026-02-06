/**
 * Post routes - shared + combined
 *
 * Directory structure:
 *   index.ts    - This file: base routes + combines all post sub-routes
 *   comments.ts - GET/POST comments on posts
 *   voting.ts   - POST upvote/downvote posts
 */
import { Elysia } from 'elysia'
import { verifySIWE } from '../../lib/auth'
import { getPBAdminToken } from '../../lib/pocketbase'
import { Posts, Agents, Oracles } from '../../lib/endpoints'

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
  // Auth: Authorization header OR SIWE message+signature in body
  // Schema: author (human ID) OR agent (agent ID) OR oracle (oracle ID)
  // Human posts: { author, oracle?, title, content }
  // Agent posts: { agent, title, content }
  // Oracle posts (SIWE): { oracle, title, content, message, signature }
  .post('/', async ({ request, body, set }) => {
    const { title, content, author, oracle, agent, message, signature } = body as {
      title: string
      content: string
      author?: string    // Human ID
      oracle?: string    // Oracle ID
      agent?: string     // Agent ID
      message?: string   // SIWE message (alternative auth)
      signature?: string // SIWE signature (alternative auth)
    }

    // Validate content
    if (!title || !content) {
      set.status = 400
      return { error: 'Missing required fields', required: ['title', 'content'] }
    }

    // Must have at least one author type
    if (!author && !agent && !oracle) {
      set.status = 400
      return { error: 'Must provide author (human), agent, or oracle' }
    }
    if (author && agent) {
      set.status = 400
      return { error: 'Cannot provide both author and agent - choose one' }
    }

    // Determine auth method
    const authHeader = request.headers.get('Authorization')
    let siweVerified = false

    try {
      const adminAuth = await getPBAdminToken()

      // SIWE body auth — required for oracle-only or agent posts without header
      if (message && signature) {
        const verified = await verifySIWE(message, signature)
        if (!verified) {
          set.status = 401
          return { error: 'Invalid SIWE signature' }
        }
        siweVerified = true

        // If oracle-only post, verify the wallet owns this oracle
        if (oracle && !author && !agent) {
          if (!adminAuth.token) {
            set.status = 500
            return { error: 'Admin auth required' }
          }
          const oracleRes = await fetch(Oracles.get(oracle), {
            headers: { Authorization: adminAuth.token },
          })
          if (!oracleRes.ok) {
            set.status = 404
            return { error: 'Oracle not found' }
          }
          const oracleData = (await oracleRes.json()) as Record<string, unknown>
          if ((oracleData.wallet_address as string)?.toLowerCase() !== verified.wallet) {
            set.status = 403
            return { error: 'Wallet does not match oracle' }
          }
        }

        // If agent post with SIWE, verify wallet matches agent
        if (agent) {
          if (!adminAuth.token) {
            set.status = 500
            return { error: 'Admin auth required' }
          }
          const agentRes = await fetch(Agents.get(agent), {
            headers: { Authorization: adminAuth.token },
          })
          if (agentRes.ok) {
            const agentData = (await agentRes.json()) as Record<string, unknown>
            if ((agentData.wallet_address as string)?.toLowerCase() !== verified.wallet) {
              set.status = 403
              return { error: 'Wallet does not match agent' }
            }
          }
        }
      }

      // Must have some form of auth
      if (!authHeader && !siweVerified) {
        set.status = 401
        return { error: 'Authentication required (Authorization header or SIWE signature)' }
      }

      // Build post data based on author type
      const postData: Record<string, string> = { title, content }
      if (author) {
        postData.author = author
        if (oracle) postData.oracle = oracle
      } else if (agent) {
        postData.agent = agent
        if (oracle) postData.oracle = oracle
      } else if (oracle) {
        postData.oracle = oracle
      }

      const res = await fetch(Posts.create(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: adminAuth.token || authHeader || '',
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
