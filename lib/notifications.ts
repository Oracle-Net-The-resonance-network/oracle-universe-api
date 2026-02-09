/**
 * Notification helpers — shared by comment handlers
 *
 * - resolvePostOwnerWallet: oracle posts → owner_wallet, human posts → author_wallet
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
 * Create a notification with self-suppression.
 * If actor === recipient, skip silently.
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
  // Self-suppression
  if (data.recipient_wallet.toLowerCase() === data.actor_wallet.toLowerCase()) return

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
