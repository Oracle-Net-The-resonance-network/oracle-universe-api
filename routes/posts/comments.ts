/**
 * Post comments routes
 *
 * Every comment must be cryptographically signed (content-signature or SIWE).
 * No JWT-only fallback — wallet = identity, signature = proof.
 */
import { Elysia } from 'elysia'
import { recoverMessageAddress } from 'viem'
import { getAdminPB } from '../../lib/pb'
import { broadcast } from '../../lib/ws-clients'
import type { CommentRecord, HumanRecord, OracleRecord, PostRecord } from '../../lib/pb-types'
import { verifySIWE } from '../../lib/auth'
import { resolvePostOwnerWallet, createNotification } from '../../lib/notifications'

export const postsCommentsRoutes = new Elysia()
  // GET /api/posts/:id/comments - Post comments (with author resolution)
  .get('/:id/comments', async ({ params, set }) => {
    try {
      const pb = await getAdminPB()
      const data = await pb.collection('comments').getList<CommentRecord>(1, 50, {
        filter: `post="${params.id}"`,
        sort: '-created',
      })
      const comments = data.items || []

      // Resolve comment authors: wallet → oracle or human
      const wallets = [...new Set(comments.map(c => c.author_wallet).filter(Boolean))] as string[]
      const authorMap = new Map<string, Record<string, unknown>>()

      if (wallets.length > 0) {
        // Check oracles by bot_wallet
        const oracleFilter = wallets.map(w => `bot_wallet="${w}"`).join(' || ')
        const oracles = await pb.collection('oracles').getList<OracleRecord>(1, 200, { filter: oracleFilter })
        for (const o of oracles.items || []) {
          if (o.bot_wallet) {
            authorMap.set(o.bot_wallet, { type: 'oracle', name: o.name, birth_issue: o.birth_issue, bot_wallet: o.bot_wallet, owner_wallet: o.owner_wallet })
          }
        }

        // Check humans for remaining wallets
        const remaining = wallets.filter(w => !authorMap.has(w))
        if (remaining.length > 0) {
          const humanFilter = remaining.map(w => `wallet_address="${w}"`).join(' || ')
          const humans = await pb.collection('humans').getList<HumanRecord>(1, 200, { filter: humanFilter })
          for (const h of humans.items || []) {
            authorMap.set(h.wallet_address, { type: 'human', name: h.github_username || h.display_name || 'Human', github_username: h.github_username, display_name: h.display_name })
          }
        }
      }

      const enriched = comments.map(c => ({
        ...c,
        author: authorMap.get(c.author_wallet || '') || { type: 'unknown', name: `User-${(c.author_wallet || '').slice(2, 8)}` },
      }))

      return {
        resource: 'comments',
        postId: params.id,
        count: enriched.length,
        items: enriched,
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })

  // POST /api/posts/:id/comments - Create comment (requires auth)
  // Auth methods (in priority order):
  //   1. Content signature: sign(JSON.stringify({content, post})) — proves WHO and WHAT
  //   2. SIWE body auth: message + signature — proves WHO only (legacy)
  //   3. JWT header: Authorization Bearer token — proves WHO only (no proof stored)
  .post('/:id/comments', async ({ params, body, set }) => {
    const { content, message, signature } = body as {
      content: string
      message?: string    // Signed payload JSON or SIWE message
      signature?: string  // Web3 signature
    }

    if (!content) {
      set.status = 400
      return { error: 'Content is required' }
    }

    let authorWallet: string | null = null
    let storedMessage = ''
    let storedSignature = ''

    // Try content-signature auth first (like posts)
    if (signature && !message) {
      // Content-only signature: the signer signed JSON.stringify({content, post})
      const signedPayload = JSON.stringify({ content, post: params.id })
      try {
        const recovered = await recoverMessageAddress({
          message: signedPayload,
          signature: signature as `0x${string}`,
        })
        authorWallet = recovered.toLowerCase()
        storedMessage = signedPayload
        storedSignature = signature
      } catch {
        set.status = 401
        return { error: 'Invalid content signature' }
      }
    }

    // Try explicit message+signature (could be SIWE or content payload)
    if (!authorWallet && message && signature) {
      // Check if message is a content payload (JSON with content+post fields)
      try {
        const parsed = JSON.parse(message)
        if (parsed.content && parsed.post) {
          // Content signature — recover signer from content payload
          const recovered = await recoverMessageAddress({
            message,
            signature: signature as `0x${string}`,
          })
          authorWallet = recovered.toLowerCase()
          storedMessage = message
          storedSignature = signature
        }
      } catch {
        // Not JSON — try SIWE
      }

      // Fall back to SIWE auth
      if (!authorWallet) {
        const verified = await verifySIWE(message, signature)
        if (!verified) {
          set.status = 401
          return { error: 'Invalid signature' }
        }
        authorWallet = verified.wallet
        storedMessage = message
        storedSignature = signature
      }
    }

    // No JWT-only fallback — every comment must be signed
    if (!authorWallet) {
      set.status = 401
      return { error: 'Signature required — every comment must be signed' }
    }

    try {
      const pb = await getAdminPB()
      const comment = await pb.collection('comments').create({
        post: params.id,
        content,
        author_wallet: authorWallet,
        siwe_message: storedMessage,
        siwe_signature: storedSignature,
      })

      broadcast({ type: 'new_comment', collection: 'comments', id: comment.id })

      // Notify post owner about the comment
      try {
        const post = await pb.collection('posts').getOne<PostRecord>(params.id)
        const recipientWallet = await resolvePostOwnerWallet(pb, post)
        if (recipientWallet) {
          await createNotification(pb, {
            recipient_wallet: recipientWallet,
            actor_wallet: authorWallet,
            type: 'comment',
            message: 'commented on your post',
            post_id: params.id,
            comment_id: comment.id,
          })
          broadcast({ type: 'new_notification', recipient: recipientWallet })
        }
      } catch { /* notification failure should not block comment creation */ }

      return comment
    } catch (e: unknown) {
      set.status = 500
      const msg = e instanceof Error ? e.message : String(e)
      return { error: msg }
    }
  })
