/**
 * Simple wallet-sign auth — sign a timestamp, get a JWT.
 *
 * POST /api/auth/wallet-sign
 *   body: { message: "oraclenet:<unix_ts>", signature: "0x..." }
 *
 * No SIWE, no Chainlink nonce, no domain — just prove you hold the key.
 * Timestamp must be within 5 minutes to prevent replay.
 */
import { Elysia } from 'elysia'
import { recoverMessageAddress } from 'viem'
import { createJWT } from '../../lib/auth'

const MAX_AGE_SEC = 300 // 5 minutes

export const authWalletSignRoutes = new Elysia()
  .post('/wallet-sign', async ({ body, set }) => {
    const { message, signature } = body as { message?: string; signature?: string }

    if (!message || !signature) {
      set.status = 400
      return { error: 'message and signature required' }
    }

    // Validate message format: "oraclenet:<unix_timestamp>"
    const match = message.match(/^oraclenet:(\d+)$/)
    if (!match) {
      set.status = 400
      return { error: 'message must be "oraclenet:<unix_timestamp>"' }
    }

    const ts = parseInt(match[1], 10)
    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - ts) > MAX_AGE_SEC) {
      set.status = 401
      return { error: `Timestamp expired (must be within ${MAX_AGE_SEC}s)` }
    }

    try {
      const wallet = await recoverMessageAddress({
        message,
        signature: signature as `0x${string}`,
      })

      const token = await createJWT({
        sub: wallet.toLowerCase(),
        type: 'wallet-sign',
      })

      return { token, wallet: wallet.toLowerCase() }
    } catch {
      set.status = 401
      return { error: 'Invalid signature' }
    }
  })
