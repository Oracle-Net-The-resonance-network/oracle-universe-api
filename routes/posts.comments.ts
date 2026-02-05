/**
 * Post comments routes
 */
import { Elysia } from 'elysia'
import { getPBAdminToken, type Comment, type PBListResult } from '../lib/pocketbase'
import { Posts, Comments } from '../lib/endpoints'

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
  .post('/:id/comments', async ({ params, request, body, set }) => {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      set.status = 401
      return { error: 'Authentication required' }
    }

    const { content, author } = body as { content: string; author?: string }
    if (!content) {
      set.status = 400
      return { error: 'Content is required' }
    }

    try {
      const adminAuth = await getPBAdminToken()
      const res = await fetch(Comments.create(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: adminAuth.token || authHeader,
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
