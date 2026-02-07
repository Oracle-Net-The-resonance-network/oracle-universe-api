/**
 * Post comments routes
 *
 * Supports both JWT auth (Authorization header) and SIWE body auth.
 * Wallet = identity: author_wallet decoded from auth, no PB IDs needed.
 */
import { Elysia } from 'elysia'
import { getPBAdminToken, type Comment, type PBListResult } from '../../lib/pocketbase'
import { Posts, Comments } from '../../lib/endpoints'
import { verifySIWE, verifyJWT, DEFAULT_SALT } from '../../lib/auth'

export const postsCommentsRoutes = new Elysia()
  // GET /api/posts/:id/comments - Post comments
  .get('/:id/comments', async ({ params, set }) => {
    try {
      const res = await fetch(Posts.comments(params.id, { sort: '-created' }))
      const data = (await res.json()) as PBListResult<Comment>
      return {
        resource: 'comments',
        postId: params.id,
        count: data.items?.length || 0,
        items: data.items || [],
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })

  // POST /api/posts/:id/comments - Create comment (requires auth)
  // Auth: Authorization header (JWT) OR SIWE message+signature in body
  .post('/:id/comments', async ({ params, request, body, set }) => {
    const { content, message, signature } = body as {
      content: string
      message?: string
      signature?: string
    }

    if (!content) {
      set.status = 400
      return { error: 'Content is required' }
    }

    let authorWallet: string | null = null

    // Try SIWE body auth first
    if (message && signature) {
      const verified = await verifySIWE(message, signature)
      if (!verified) {
        set.status = 401
        return { error: 'Invalid SIWE signature' }
      }
      authorWallet = verified.wallet
    }

    // Try JWT auth from header
    if (!authorWallet) {
      const authHeader = request.headers.get('Authorization')
      if (authHeader) {
        const token = authHeader.replace(/^bearer\s+/i, '')
        const payload = await verifyJWT(token, DEFAULT_SALT)
        if (payload?.sub) {
          authorWallet = payload.sub as string
        }
      }
    }

    if (!authorWallet) {
      set.status = 401
      return { error: 'Authentication required (Authorization header or SIWE signature)' }
    }

    try {
      const adminAuth = await getPBAdminToken()
      const res = await fetch(Comments.create(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: adminAuth.token || '',
        },
        body: JSON.stringify({ post: params.id, content, author_wallet: authorWallet }),
      })

      if (!res.ok) {
        set.status = res.status
        const err = await res.text()
        return { error: 'Failed to create comment', details: err }
      }
      return await res.json()
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })
