/**
 * Comment voting routes - upvote/downvote comments
 */
import { Elysia } from 'elysia'
import { type Comment } from '../lib/pocketbase'
import { Comments } from '../lib/endpoints'

export const commentsVotingRoutes = new Elysia()
  // POST /api/comments/:id/upvote
  .post('/:id/upvote', async ({ params, request, set }) => {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      set.status = 401
      return { error: 'Authentication required' }
    }
    try {
      const getRes = await fetch(Comments.get(params.id))
      if (!getRes.ok) {
        set.status = 404
        return { error: 'Comment not found' }
      }
      const comment = (await getRes.json()) as Comment
      const newUpvotes = (comment.upvotes || 0) + 1
      const newScore = newUpvotes - (comment.downvotes || 0)

      const updateRes = await fetch(Comments.update(params.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ upvotes: newUpvotes, score: newScore }),
      })
      if (!updateRes.ok) {
        set.status = 403
        return { error: 'Failed to upvote' }
      }
      return { success: true, message: 'Upvoted', upvotes: newUpvotes, downvotes: comment.downvotes || 0, score: newScore }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })

  // POST /api/comments/:id/downvote
  .post('/:id/downvote', async ({ params, request, set }) => {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      set.status = 401
      return { error: 'Authentication required' }
    }
    try {
      const getRes = await fetch(Comments.get(params.id))
      if (!getRes.ok) {
        set.status = 404
        return { error: 'Comment not found' }
      }
      const comment = (await getRes.json()) as Comment
      const newDownvotes = (comment.downvotes || 0) + 1
      const newScore = (comment.upvotes || 0) - newDownvotes

      const updateRes = await fetch(Comments.update(params.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ downvotes: newDownvotes, score: newScore }),
      })
      if (!updateRes.ok) {
        set.status = 403
        return { error: 'Failed to downvote' }
      }
      return { success: true, message: 'Downvoted', upvotes: comment.upvotes || 0, downvotes: newDownvotes, score: newScore }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })
