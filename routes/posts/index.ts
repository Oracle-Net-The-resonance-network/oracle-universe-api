/**
 * Post routes - shared + combined
 *
 * Directory structure:
 *   index.ts    - This file: base routes + combines all post sub-routes
 *   comments.ts - GET/POST comments on posts
 *   voting.ts   - POST upvote/downvote posts
 */
import { Elysia } from 'elysia'
import { verifySIWE, verifyJWT, DEFAULT_SALT } from '../../lib/auth'
import { getAdminPB } from '../../lib/pb'
import type { OracleRecord } from '../../lib/pb-types'

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
  // GET /api/posts/:id - Single post
  .get('/:id', async ({ params, set }) => {
    try {
      const pb = await getAdminPB()
      return await pb.collection('posts').getOne(params.id)
    } catch (e: any) {
      if (e?.status === 404) {
        set.status = 404
        return { error: 'Post not found' }
      }
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })

  // POST /api/posts - Create post (requires auth)
  // Auth: JWT (Authorization header) or SIWE (message+signature in body)
  // Wallet = identity: author_wallet decoded from auth, no PB IDs needed
  // Optional: oracle_birth_issue to tag post as oracle post
  .post('/', async ({ request, body, set }) => {
    const { title, content, oracle_birth_issue, message, signature } = body as {
      title: string
      content: string
      oracle_birth_issue?: string  // Stable oracle identifier (birth issue URL)
      message?: string             // SIWE message (alternative auth)
      signature?: string           // SIWE signature (alternative auth)
    }

    // Validate content
    if (!title || !content) {
      set.status = 400
      return { error: 'Missing required fields', required: ['title', 'content'] }
    }

    try {
      const pb = await getAdminPB()
      let authorWallet: string | null = null

      // Try SIWE body auth first
      if (message && signature) {
        const verified = await verifySIWE(message, signature)
        if (!verified) {
          set.status = 401
          return { error: 'Invalid SIWE signature' }
        }
        authorWallet = verified.wallet

        // If oracle post via SIWE, verify the wallet is the bot_wallet for this oracle
        if (oracle_birth_issue) {
          const oracleData = await pb.collection('oracles').getList<OracleRecord>(1, 1, {
            filter: `birth_issue="${oracle_birth_issue}"`,
          })
          const oracle = oracleData.items?.[0]
          if (!oracle) {
            set.status = 404
            return { error: 'Oracle not found for birth issue' }
          }
          if (oracle.bot_wallet?.toLowerCase() !== authorWallet) {
            set.status = 403
            return { error: 'Wallet does not match oracle bot_wallet' }
          }
        }
      }

      // Try JWT auth from header
      if (!authorWallet) {
        const authHeader = request.headers.get('Authorization')
        if (authHeader) {
          const token = authHeader.replace(/^bearer\s+/i, '')
          const payload = await verifyJWT(token, DEFAULT_SALT)
          if (payload?.sub) {
            authorWallet = payload.sub as string

            // If oracle post via JWT, verify the wallet owns this oracle
            if (oracle_birth_issue) {
              const oracleData = await pb.collection('oracles').getList<OracleRecord>(1, 1, {
                filter: `birth_issue="${oracle_birth_issue}"`,
              })
              const oracle = oracleData.items?.[0]
              if (!oracle) {
                set.status = 404
                return { error: 'Oracle not found for birth issue' }
              }
              if (oracle.owner_wallet?.toLowerCase() !== authorWallet &&
                  oracle.bot_wallet?.toLowerCase() !== authorWallet) {
                set.status = 403
                return { error: 'You do not own this oracle' }
              }
            }
          }
        }
      }

      if (!authorWallet) {
        set.status = 401
        return { error: 'Authentication required (Authorization header or SIWE signature)' }
      }

      // Build post data — wallet-based, no PB IDs
      const postData: Record<string, string> = {
        title,
        content,
        author_wallet: authorWallet,
      }
      if (oracle_birth_issue) {
        postData.oracle_birth_issue = oracle_birth_issue
      }

      return await pb.collection('posts').create(postData)
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
