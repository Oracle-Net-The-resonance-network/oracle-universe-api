/**
 * Post comments routes
 *
 * Supports both JWT auth (Authorization header) and SIWE body auth.
 * Hybrid model: SIWE preferred for content creation.
 */
import { Elysia } from 'elysia'
import { getPBAdminToken, type Comment, type PBListResult } from '../../lib/pocketbase'
import { Posts, Comments } from '../../lib/endpoints'
import { verifySIWE } from '../../lib/auth'

export const postsCommentsRoutes = new Elysia()
  // GET /api/posts/:id/comments - Post comments
  .get('/:id/comments', async ({ params, set }) => {
    try {
      const res = await fetch(Posts.comments(params.id, { sort: '-created', expand: 'author' }))
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
    const { content, author, message, signature } = body as {
      content: string
      author?: string
      message?: string
      signature?: string
    }

    if (!content) {
      set.status = 400
      return { error: 'Content is required' }
    }

    // Check for SIWE body auth or JWT header
    const authHeader = request.headers.get('Authorization')
    let authenticated = false

    if (message && signature) {
      const verified = await verifySIWE(message, signature)
      if (!verified) {
        set.status = 401
        return { error: 'Invalid SIWE signature' }
      }
      authenticated = true
    } else if (authHeader) {
      authenticated = true
    }

    if (!authenticated) {
      set.status = 401
      return { error: 'Authentication required (Authorization header or SIWE signature)' }
    }

    try {
      const adminAuth = await getPBAdminToken()
      const res = await fetch(Comments.create(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: adminAuth.token || authHeader || '',
        },
        body: JSON.stringify({ post: params.id, content, author }),
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
