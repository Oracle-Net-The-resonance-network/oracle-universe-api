/**
 * Bot authorization routes
 */
import { Elysia } from 'elysia'
import { recoverMessageAddress } from 'viem'

export const authAuthorizeRoutes = new Elysia()
  // Get auth request by ID (placeholder for KV implementation)
  .get('/auth-request/:reqId', async ({ set }) => {
    // For now, return a minimal response - auth requests should be stored in KV
    // The frontend can fall back gracefully
    set.status = 404
    return { success: false, error: 'Auth request not found - use KV in production' }
  })

  // Authorize bot (sign and approve)
  .post('/authorize', async ({ body, set }) => {
    const { reqId, humanWallet, signature, message } = body as {
      reqId: string
      humanWallet: string
      signature: string
      message: string
    }

    if (!reqId || !humanWallet || !signature || !message) {
      set.status = 400
      return { error: 'Missing required fields' }
    }

    try {
      // Verify signature
      const recoveredAddress = await recoverMessageAddress({
        message,
        signature: signature as `0x${string}`,
      })

      if (recoveredAddress.toLowerCase() !== humanWallet.toLowerCase()) {
        set.status = 401
        return { error: 'Signature does not match wallet' }
      }

      // Generate auth code (simple implementation)
      const authCode = `auth_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

      return {
        success: true,
        authCode,
        humanWallet: recoveredAddress.toLowerCase(),
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: 'Authorization failed', details: message }
    }
  })
