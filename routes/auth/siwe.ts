/**
 * SIWE (Sign-In With Ethereum) verification route
 */
import { Elysia } from 'elysia'
import { recoverMessageAddress } from 'viem'
import { parseSiweMessage } from 'viem/siwe'
import { getChainlinkBtcPrice } from '../../lib/chainlink'
import { createJWT, DEFAULT_SALT } from '../../lib/auth'
import { getPBAdminToken } from '../../lib/pocketbase'
import { Humans } from '../../lib/endpoints'
import { API_VERSION } from './index'

export const authSiweRoutes = new Elysia()
  // Verify SIWE signature and authenticate human
  // Uses signature-based auth: verified wallet = authenticated
  // Issues custom JWT, no PocketBase passwords needed
  .post('/humans/verify', async ({ body, set }) => {
    const { message, signature } = body as { message: string; signature: string }

    if (!message || !signature) {
      set.status = 400
      return { error: 'Missing message or signature' }
    }

    try {
      // Parse SIWE message
      const siweMessage = parseSiweMessage(message)
      if (!siweMessage.address || !siweMessage.nonce) {
        set.status = 400
        return { error: 'Invalid SIWE message' }
      }

      // Recover address from signature
      const recoveredAddress = await recoverMessageAddress({
        message,
        signature: signature as `0x${string}`,
      })

      // Verify signature matches claimed address
      if (recoveredAddress.toLowerCase() !== siweMessage.address.toLowerCase()) {
        set.status = 401
        return { error: 'Signature does not match address' }
      }

      // Verify proof-of-time: nonce should be a recent Chainlink roundId
      const currentChainlink = await getChainlinkBtcPrice()
      const nonceBigInt = BigInt(siweMessage.nonce)
      const currentRoundBigInt = BigInt(currentChainlink.roundId)

      // Allow roundId within last 10 rounds (~1 hour for BTC/USD which updates ~every 1hr)
      if (currentRoundBigInt - nonceBigInt > 10n) {
        set.status = 401
        return { error: 'Nonce (roundId) is too old - signature expired' }
      }

      const walletAddress = recoveredAddress.toLowerCase()

      // Signature verified! Now find or create human record
      let human: Record<string, unknown>
      let created = false

      // Get admin token for all PocketBase operations
      const adminAuth = await getPBAdminToken()
      if (!adminAuth.token) {
        set.status = 500
        return { error: 'Admin auth required', details: adminAuth.error, version: API_VERSION }
      }

      // Look up existing user by wallet (use admin auth for reliable access)
      const searchRes = await fetch(Humans.byWallet(walletAddress), {
        headers: { Authorization: adminAuth.token },
      })
      const searchData = (await searchRes.json()) as { items?: Record<string, unknown>[] }

      if (searchData.items?.length) {
        // Existing user - use their record
        human = searchData.items[0]
      } else {
        // Create new user
        const createRes = await fetch(Humans.create(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: adminAuth.token,
          },
          body: JSON.stringify({
            wallet_address: walletAddress,
            display_name: `Human-${walletAddress.slice(2, 8)}`,
          }),
        })

        if (!createRes.ok) {
          const errorText = await createRes.text()
          // If creation failed due to unique constraint, fetch existing user
          if (errorText.includes('validation_not_unique')) {
            // Race condition or case mismatch - try fetching again
            const retryRes = await fetch(Humans.byWallet(walletAddress), {
              headers: { Authorization: adminAuth.token },
            })
            const retryData = (await retryRes.json()) as { items?: Record<string, unknown>[] }
            if (retryData.items?.length) {
              human = retryData.items[0]
            } else {
              set.status = 500
              return { error: 'Failed to find or create human', details: errorText, version: API_VERSION }
            }
          } else {
            set.status = 500
            return { error: 'Failed to create human', details: errorText, version: API_VERSION }
          }
        } else {
          human = (await createRes.json()) as Record<string, unknown>
          created = true
        }
      }

      // Issue custom JWT (signature-verified, 7 days expiry)
      // sub = wallet address (wallet IS the identity)
      const token = await createJWT(
        {
          sub: walletAddress,
          type: 'human',
        },
        DEFAULT_SALT
      )

      return {
        success: true,
        created,
        token, // Custom JWT (not PocketBase token)
        proofOfTime: {
          btc_price: currentChainlink.price,
          round_id: siweMessage.nonce,
          timestamp: currentChainlink.timestamp,
        },
        human: {
          id: human.id,
          wallet_address: human.wallet_address,
          display_name: human.display_name,
          github_username: human.github_username,
        },
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: 'Verification failed', details: message }
    }
  })
