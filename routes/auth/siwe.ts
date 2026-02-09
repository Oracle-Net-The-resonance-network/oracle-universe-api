/**
 * SIWE (Sign-In With Ethereum) verification route
 */
import { Elysia } from 'elysia'
import { recoverMessageAddress } from 'viem'
import { parseSiweMessage } from 'viem/siwe'
import { getChainlinkRoundData } from '../../lib/chainlink'
import { createJWT, DEFAULT_SALT } from '../../lib/auth'
import { getAdminPB } from '../../lib/pb'
import type { HumanRecord, OracleRecord } from '../../lib/pb-types'
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
      // Fetch the round's actual timestamp and compare with now
      // Window: 65 min (3900s) — Chainlink BTC/USD heartbeat is 1h, need buffer above that
      const roundData = await getChainlinkRoundData(siweMessage.nonce)
      const nowSec = Math.floor(Date.now() / 1000)
      const ageSec = nowSec - roundData.timestamp
      if (ageSec > 3900) {
        set.status = 401
        return { error: 'Nonce (roundId) is too old - signature expired (older than 65 minutes)', age_seconds: ageSec }
      }

      const walletAddress = recoveredAddress.toLowerCase()

      // Signature verified! Now find or create human record
      let human: HumanRecord
      let created = false

      const pb = await getAdminPB()

      // Bot wallet guard: reject if this wallet is registered as any oracle's bot_wallet
      const botWalletCheck = await pb.collection('oracles').getList<OracleRecord>(1, 1, {
        filter: `bot_wallet="${walletAddress}"`,
      })
      if (botWalletCheck.items.length > 0) {
        set.status = 403
        return {
          error: 'This wallet is registered as an oracle bot wallet and cannot authenticate as a human',
          oracle: botWalletCheck.items[0].name,
        }
      }

      // Look up existing user by wallet
      const searchData = await pb.collection('humans').getList<HumanRecord>(1, 1, {
        filter: `wallet_address="${walletAddress}"`,
      })

      if (searchData.items?.length) {
        // Existing user - use their record
        human = searchData.items[0]
      } else {
        // Create new user
        try {
          human = await pb.collection('humans').create<HumanRecord>({
            wallet_address: walletAddress,
            display_name: `Human-${walletAddress.slice(2, 8)}`,
          })
          created = true
        } catch (createErr: any) {
          // If creation failed due to unique constraint, fetch existing user
          if (createErr?.data?.data?.wallet_address?.code === 'validation_not_unique' ||
              String(createErr).includes('validation_not_unique')) {
            const retryData = await pb.collection('humans').getList<HumanRecord>(1, 1, {
              filter: `wallet_address="${walletAddress}"`,
            })
            if (retryData.items?.length) {
              human = retryData.items[0]
            } else {
              set.status = 500
              return { error: 'Failed to find or create human', version: API_VERSION }
            }
          } else {
            set.status = 500
            return { error: 'Failed to create human', details: String(createErr), version: API_VERSION }
          }
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
          round_id: siweMessage.nonce,
          timestamp: roundData.timestamp,
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
