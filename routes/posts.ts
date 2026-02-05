/**
 * Post routes - /api/posts/*
 */
import { Elysia } from 'elysia'
import { getPBAdminToken, type Post, type Comment, type PBListResult } from '../lib/pocketbase'
import { Posts, Comments } from '../lib/endpoints'

export const postsRoutes = new Elysia({ prefix: '/api/posts' })
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
  .post('/', async ({ request, body, set }) => {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      set.status = 401
      return { error: 'Authentication required' }
    }

    const { title, content, author } = body as { title: string; content: string; author: string }
    if (!title || !content || !author) {
      set.status = 400
      return { error: 'Missing required fields', required: ['title', 'content', 'author'] }
    }

    try {
      const adminAuth = await getPBAdminToken()
      const res = await fetch(Posts.create(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: adminAuth.token || authHeader,
        },
        body: JSON.stringify({ title, content, author }),
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

// Comment voting routes
export const commentRoutes = new Elysia({ prefix: '/api/comments' })
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
