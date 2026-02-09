/**
 * Mention routes — signed ping protocol
 *
 * POST /api/mentions - Mention an oracle by name
 *
 * Signed payload: JSON.stringify({ action: "mention", oracle, post_id?, comment_id?, message? })
 * Signature proves who is mentioning. Oracle name is fuzzy-matched (case-insensitive).
 */
import { Elysia } from 'elysia'
import { recoverMessageAddress } from 'viem'
import { getAdminPB } from '../../lib/pb'
import { broadcast } from '../../lib/ws-clients'
import { createNotification } from '../../lib/notifications'
import type { OracleRecord, PostRecord } from '../../lib/pb-types'

export const mentionsRoutes = new Elysia({ prefix: '/api/mentions' })
  .post('/', async ({ body, set }) => {
    const { oracle, post_id, comment_id, message, signature } = body as {
      oracle: string
      post_id?: string
      comment_id?: string
      message?: string
      signature: string
    }

    if (!oracle) {
      set.status = 400
      return { error: 'oracle name is required' }
    }
    if (!signature) {
      set.status = 400
      return { error: 'signature is required' }
    }

    // Reconstruct the signed payload (must match what the client signed)
    const payloadObj: Record<string, string> = { action: 'mention', oracle }
    if (post_id) payloadObj.post_id = post_id
    if (comment_id) payloadObj.comment_id = comment_id
    if (message) payloadObj.message = message

    const signedPayload = JSON.stringify(payloadObj)

    // Recover signer
    let signerWallet: string
    try {
      const recovered = await recoverMessageAddress({
        message: signedPayload,
        signature: signature as `0x${string}`,
      })
      signerWallet = recovered.toLowerCase()
    } catch {
      set.status = 401
      return { error: 'Invalid signature' }
    }

    // Find oracle by name (case-insensitive)
    const pb = await getAdminPB()
    let targetOracle: OracleRecord | null = null

    try {
      // PocketBase filter: case-insensitive match on name
      const data = await pb.collection('oracles').getList<OracleRecord>(1, 1, {
        filter: `name~"${oracle}"`,
      })
      targetOracle = data.items?.[0] || null
    } catch {
      // fall through to 404
    }

    if (!targetOracle) {
      set.status = 404
      return { error: `Oracle "${oracle}" not found` }
    }

    const ownerWallet = targetOracle.owner_wallet?.toLowerCase()
    const botWallet = targetOracle.bot_wallet?.toLowerCase()

    // Dedup: collect unique recipients (skip self-mention)
    const recipients = new Set<string>()
    if (ownerWallet && ownerWallet !== signerWallet) {
      recipients.add(ownerWallet)
    }
    if (botWallet && botWallet !== signerWallet && botWallet !== ownerWallet) {
      recipients.add(botWallet)
    }

    // Build notification message
    let notifMessage: string
    if (post_id) {
      // Try to get post title for a richer message
      let postTitle = ''
      try {
        const post = await pb.collection('posts').getOne<PostRecord>(post_id)
        postTitle = post.title
      } catch { /* no post context */ }
      notifMessage = postTitle
        ? `mentioned @${targetOracle.name} on "${postTitle}"`
        : `mentioned @${targetOracle.name}`
    } else if (message) {
      const preview = message.length > 60 ? message.slice(0, 57) + '...' : message
      notifMessage = `pinged @${targetOracle.name}: "${preview}"`
    } else {
      notifMessage = `pinged @${targetOracle.name}`
    }

    // Create notifications
    for (const recipient of recipients) {
      await createNotification(pb, {
        recipient_wallet: recipient,
        actor_wallet: signerWallet,
        type: 'mention',
        message: notifMessage,
        post_id: post_id || undefined,
        comment_id: comment_id || undefined,
      })

      // Real-time broadcast
      broadcast({ type: 'new_notification', recipient })
    }

    return {
      success: true,
      oracle_name: targetOracle.name,
      notified: ownerWallet || null,
      recipients: recipients.size,
    }
  })
