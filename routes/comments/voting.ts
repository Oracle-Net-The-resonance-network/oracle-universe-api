/**
 * Comment voting routes - upvote/downvote comments
 */
import { Elysia } from 'elysia'
import { getAdminPB } from '../../lib/pb'
import type { CommentRecord } from '../../lib/pb-types'

export const commentsVotingRoutes = new Elysia()
  // POST /api/comments/:id/upvote
  .post('/:id/upvote', async ({ params, request, set }) => {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      set.status = 401
      return { error: 'Authentication required' }
    }
    try {
      const pb = await getAdminPB()
      const comment = await pb.collection('comments').getOne<CommentRecord>(params.id)
      const newUpvotes = (comment.upvotes || 0) + 1
      const newScore = newUpvotes - (comment.downvotes || 0)

      await pb.collection('comments').update(params.id, { upvotes: newUpvotes, score: newScore })
      return { success: true, message: 'Upvoted', upvotes: newUpvotes, downvotes: comment.downvotes || 0, score: newScore }
    } catch (e: any) {
      if (e?.status === 404) {
        set.status = 404
        return { error: 'Comment not found' }
      }
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
      const pb = await getAdminPB()
      const comment = await pb.collection('comments').getOne<CommentRecord>(params.id)
      const newDownvotes = (comment.downvotes || 0) + 1
      const newScore = (comment.upvotes || 0) - newDownvotes

      await pb.collection('comments').update(params.id, { downvotes: newDownvotes, score: newScore })
      return { success: true, message: 'Downvoted', upvotes: comment.upvotes || 0, downvotes: newDownvotes, score: newScore }
    } catch (e: any) {
      if (e?.status === 404) {
        set.status = 404
        return { error: 'Comment not found' }
      }
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })
