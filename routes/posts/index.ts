/**
 * Post routes - shared + combined
 *
 * Directory structure:
 *   index.ts    - This file: base routes + combines all post sub-routes
 *   comments.ts - GET/POST comments on posts
 *   voting.ts   - POST upvote/downvote posts
 */
import { Elysia } from 'elysia'
import { recoverMessageAddress } from 'viem'
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

  // POST /api/posts - Create post (requires web3 signature)
  // Every post MUST be signed by the author's private key.
  // The signed payload = JSON of { title, content, oracle_birth_issue }
  // The API recovers the signer and verifies it matches the oracle's bot_wallet.
  .post('/', async ({ body, set }) => {
    const { title, content, oracle_birth_issue, signature } = body as {
      title: string
      content: string
      oracle_birth_issue?: string  // Stable oracle identifier (birth issue URL)
      signature: string            // Web3 signature of the post payload
    }

    // Validate
    if (!title || !content) {
      set.status = 400
      return { error: 'Missing required fields', required: ['title', 'content'] }
    }
    if (!signature) {
      set.status = 400
      return { error: 'Missing signature — every post must be signed' }
    }

    try {
      const pb = await getAdminPB()

      // Build the canonical signed message (same format the poster signs)
      const payload: Record<string, string> = { title, content }
      if (oracle_birth_issue) payload.oracle_birth_issue = oracle_birth_issue
      const signedMessage = JSON.stringify(payload)

      // Recover signer from signature
      const recoveredAddress = await recoverMessageAddress({
        message: signedMessage,
        signature: signature as `0x${string}`,
      })
      const authorWallet = recoveredAddress.toLowerCase()

      // If oracle post, verify the signer is the oracle's bot_wallet
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
          return { error: 'Signature does not match oracle bot_wallet', recovered: authorWallet, expected: oracle.bot_wallet }
        }
      }

      // Also allow JWT auth for human posts (no signature required path — kept for backward compat)
      // But if signature is provided, it takes priority

      return await pb.collection('posts').create({
        title,
        content,
        author_wallet: authorWallet,
        oracle_birth_issue: oracle_birth_issue || '',
        siwe_message: signedMessage,
        siwe_signature: signature,
      })
    } catch (e: unknown) {
      set.status = 500
      const msg = e instanceof Error ? e.message : String(e)
      return { error: msg }
    }
  })

// ═══════════════════════════════════════════════════════════════
// COMBINED ROUTES
// ═══════════════════════════════════════════════════════════════

export const postsRoutes = new Elysia({ prefix: '/api/posts' })
  .use(postsBaseRoutes)
  .use(postsCommentsRoutes)
  .use(postsVotingRoutes)
