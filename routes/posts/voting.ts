/**
 * Post voting routes - per-user vote tracking via PocketBase votes collection
 *
 * Uses JWT auth to identify the voter (sub = wallet address).
 * Votes stored in PB `votes` collection with unique constraint per wallet+target.
 * Toggle logic: no vote->create, same direction->delete, different->update.
 */
import { Elysia } from 'elysia'
import { getAdminPB } from '../../lib/pb'
import type { PostRecord, VoteRecord } from '../../lib/pb-types'
import { verifyJWT, DEFAULT_SALT } from '../../lib/auth'

/** Extract wallet from JWT in Authorization header (sub = wallet) */
async function getWalletFromAuth(request: Request): Promise<string | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader) return null
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const payload = await verifyJWT(token, DEFAULT_SALT)
  if (!payload?.sub) return null
  return payload.sub as string
}

/** Core vote logic — shared by new and legacy endpoints */
async function handleVote(
  postId: string,
  direction: 'up' | 'down',
  request: Request,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const wallet = await getWalletFromAuth(request)
  if (!wallet) {
    return { status: 401, body: { error: 'Valid JWT required' } }
  }

  const pb = await getAdminPB()

  // Get current post
  let post: PostRecord
  try {
    post = await pb.collection('posts').getOne<PostRecord>(postId)
  } catch {
    return { status: 404, body: { error: 'Post not found' } }
  }

  const newValue = direction === 'up' ? 1 : -1
  let upvotes = post.upvotes || 0
  let downvotes = post.downvotes || 0
  let userVote: 'up' | 'down' | null = null

  // Check existing vote (by wallet directly, no human lookup needed)
  const existingData = await pb.collection('votes').getList<VoteRecord>(1, 1, {
    filter: `voter_wallet="${wallet}" && target_type="post" && target_id="${postId}"`,
  })
  const existing = existingData.items?.[0]

  if (!existing) {
    // No existing vote -> create
    await pb.collection('votes').create({
      voter_wallet: wallet,
      target_type: 'post',
      target_id: postId,
      value: newValue,
    })
    if (direction === 'up') upvotes++
    else downvotes++
    userVote = direction
  } else if (existing.value === newValue) {
    // Same direction -> toggle off (delete)
    await pb.collection('votes').delete(existing.id)
    if (direction === 'up') upvotes = Math.max(0, upvotes - 1)
    else downvotes = Math.max(0, downvotes - 1)
    userVote = null
  } else {
    // Different direction -> switch
    await pb.collection('votes').update(existing.id, { value: newValue })
    if (direction === 'up') {
      upvotes++
      downvotes = Math.max(0, downvotes - 1)
    } else {
      downvotes++
      upvotes = Math.max(0, upvotes - 1)
    }
    userVote = direction
  }

  const score = upvotes - downvotes

  // Update post counts
  await pb.collection('posts').update(postId, { upvotes, downvotes, score })

  return {
    status: 200,
    body: { success: true, upvotes, downvotes, score, user_vote: userVote },
  }
}

export const postsVotingRoutes = new Elysia()
  // POST /api/posts/:id/vote - Cast/toggle/switch vote (new endpoint)
  .post('/:id/vote', async ({ params, request, body, set }) => {
    const { direction } = (body || {}) as { direction?: string }
    if (direction !== 'up' && direction !== 'down') {
      set.status = 400
      return { error: 'direction must be "up" or "down"' }
    }
    const result = await handleVote(params.id, direction, request)
    set.status = result.status
    return result.body
  })

  // GET /api/posts/:id/my-vote - Get current user's vote on a post
  .get('/:id/my-vote', async ({ params, request, set }) => {
    const wallet = await getWalletFromAuth(request)
    if (!wallet) {
      set.status = 401
      return { error: 'Valid JWT required' }
    }

    const pb = await getAdminPB()
    const data = await pb.collection('votes').getList<VoteRecord>(1, 1, {
      filter: `voter_wallet="${wallet}" && target_type="post" && target_id="${params.id}"`,
    })
    const vote = data.items?.[0]

    return { user_vote: vote ? (vote.value === 1 ? 'up' : 'down') : null }
  })

  // Legacy endpoints — thin wrappers for backwards compat
  .post('/:id/upvote', async ({ params, request, set }) => {
    const result = await handleVote(params.id, 'up', request)
    set.status = result.status
    return result.body
  })

  .post('/:id/downvote', async ({ params, request, set }) => {
    const result = await handleVote(params.id, 'down', request)
    set.status = result.status
    return result.body
  })
