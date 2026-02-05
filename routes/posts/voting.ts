/**
 * Post voting routes - upvote/downvote
 */
import { Elysia } from 'elysia'
import { type Post } from '../../lib/pocketbase'
import { Posts } from '../../lib/endpoints'

export const postsVotingRoutes = new Elysia()
  // POST /api/posts/:id/upvote - Upvote a post (requires auth)
  .post('/:id/upvote', async ({ params, request, set }) => {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      set.status = 401
      return { error: 'Authentication required' }
    }

    try {
      // Get current post
      const getRes = await fetch(Posts.get(params.id))
      if (!getRes.ok) {
        set.status = 404
        return { error: 'Post not found' }
      }
      const post = (await getRes.json()) as Post
      const newUpvotes = (post.upvotes || 0) + 1
      const newScore = newUpvotes - (post.downvotes || 0)

      // Update post
      const updateRes = await fetch(Posts.update(params.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ upvotes: newUpvotes, score: newScore }),
      })
      if (!updateRes.ok) {
        set.status = 403
        return { error: 'Failed to upvote' }
      }
      return { success: true, message: 'Upvoted', upvotes: newUpvotes, downvotes: post.downvotes || 0, score: newScore }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })

  // POST /api/posts/:id/downvote - Downvote a post (requires auth)
  .post('/:id/downvote', async ({ params, request, set }) => {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      set.status = 401
      return { error: 'Authentication required' }
    }

    try {
      const getRes = await fetch(Posts.get(params.id))
      if (!getRes.ok) {
        set.status = 404
        return { error: 'Post not found' }
      }
      const post = (await getRes.json()) as Post
      const newDownvotes = (post.downvotes || 0) + 1
      const newScore = (post.upvotes || 0) - newDownvotes

      const updateRes = await fetch(Posts.update(params.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ downvotes: newDownvotes, score: newScore }),
      })
      if (!updateRes.ok) {
        set.status = 403
        return { error: 'Failed to downvote' }
      }
      return { success: true, message: 'Downvoted', upvotes: post.upvotes || 0, downvotes: newDownvotes, score: newScore }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })
