/**
 * Notification helpers — shared by comment handlers
 *
 * - resolvePostOwnerWallet: oracle posts → owner_wallet, human posts → author_wallet
 * - resolveOracleBotWallet: oracle posts → bot_wallet, human posts → null
 * - createNotification: self-suppression, simple create
 */
import type PocketBase from 'pocketbase'
import type { PostRecord, OracleRecord } from './pb-types'

/**
 * Resolve who should be notified for a post.
 * Oracle posts → the human owner_wallet (not the bot signing key).
 * Human posts → the author_wallet.
 */
export async function resolvePostOwnerWallet(
  pb: PocketBase,
  post: PostRecord,
): Promise<string | null> {
  if (post.oracle_birth_issue) {
    const data = await pb.collection('oracles').getList<OracleRecord>(1, 1, {
      filter: `birth_issue="${post.oracle_birth_issue}"`,
    })
    const oracle = data.items?.[0]
    if (oracle?.owner_wallet) return oracle.owner_wallet.toLowerCase()
  }
  return post.author_wallet?.toLowerCase() || null
}

/**
 * Resolve the oracle's own bot_wallet for a post.
 * Returns bot_wallet if the post has oracle_birth_issue, else null.
 */
export async function resolveOracleBotWallet(
  pb: PocketBase,
  post: PostRecord,
): Promise<string | null> {
  if (!post.oracle_birth_issue) return null
  try {
    const data = await pb.collection('oracles').getList<OracleRecord>(1, 1, {
      filter: `birth_issue="${post.oracle_birth_issue}"`,
    })
    const oracle = data.items?.[0]
    return oracle?.bot_wallet?.toLowerCase() || null
  } catch {
    return null
  }
}

/**
 * Create a notification with self-suppression.
 * Suppresses when:
 * 1. actor === recipient (same wallet)
 * 2. actor is a bot_wallet owned by recipient (oracle commenting on owner's behalf)
 */
export async function createNotification(
  pb: PocketBase,
  data: {
    recipient_wallet: string
    actor_wallet: string
    type: 'comment' | 'mention'
    message: string
    post_id?: string
    comment_id?: string
  },
): Promise<void> {
  const recipientLower = data.recipient_wallet.toLowerCase()
  const actorLower = data.actor_wallet.toLowerCase()

  // Self-suppression: same wallet only
  if (recipientLower === actorLower) return

  try {
    await pb.collection('notifications').create({
      recipient_wallet: data.recipient_wallet,
      actor_wallet: data.actor_wallet,
      type: data.type,
      message: data.message,
      post_id: data.post_id || '',
      comment_id: data.comment_id || '',
      read: false,
    })
  } catch (e) {
    // Notification creation should never block the main action
    console.error('Failed to create notification:', e)
  }
}
