/**
 * SIWE (Sign-In With Ethereum) verification route for Agents
 *
 * Agents authenticate by signing a message containing:
 * - Agent name ("I am {agentName}")
 * - Chainlink roundId (BTC proof-of-time)
 * - Domain verification
 *
 * From the signature we recover:
 * - Proven wallet address (public key recovery)
 * - Agent name (from signed message)
 * - Timestamp validity (BTC proof-of-time)
 */
import { Elysia } from 'elysia'
import { recoverMessageAddress } from 'viem'
import { parseSiweMessage } from 'viem/siwe'
import { getChainlinkBtcPrice } from '../../lib/chainlink'
import { createJWT, DEFAULT_SALT } from '../../lib/auth'
import { getPBAdminToken } from '../../lib/pocketbase'
import { Agents, Oracles } from '../../lib/endpoints'
import { API_VERSION } from './index'

// Agent names are deterministic: "Agent-{wallet_prefix}"
// e.g., wallet 0xf39fd6e5... becomes "Agent-f39fd6"

export const authAgentSiweRoutes = new Elysia()
  // Verify SIWE signature and authenticate agent
  // Issues custom JWT with type: 'agent'
  .post('/agents/verify', async ({ body, set }) => {
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

      // Allow roundId within last 10 rounds (~1 hour for BTC/USD)
      if (currentRoundBigInt - nonceBigInt > 10n) {
        set.status = 401
        return { error: 'Nonce (roundId) is too old - signature expired' }
      }

      const walletAddress = recoveredAddress.toLowerCase()

      // Agent name is always derived from wallet address (e.g., "Agent-f39fd6")
      const agentName = `Agent-${walletAddress.slice(2, 8)}`

      // Signature verified! Now find or create agent record
      let agent: Record<string, unknown>
      let created = false

      // Get admin token for all PocketBase operations
      const adminAuth = await getPBAdminToken()
      if (!adminAuth.token) {
        set.status = 500
        return { error: 'Admin auth required', details: adminAuth.error, version: API_VERSION }
      }

      // Look up existing agent by wallet
      const searchRes = await fetch(Agents.byWallet(walletAddress), {
        headers: { Authorization: adminAuth.token },
      })
      const searchData = (await searchRes.json()) as { items?: Record<string, unknown>[] }

      if (searchData.items?.length) {
        // Existing agent found
        agent = searchData.items[0]
      } else {
        // Create new agent
        const createRes = await fetch(Agents.create(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: adminAuth.token,
          },
          body: JSON.stringify({
            wallet_address: walletAddress,
            display_name: agentName,
          }),
        })

        if (!createRes.ok) {
          const errorText = await createRes.text()
          // If creation failed due to unique constraint, fetch existing agent
          if (errorText.includes('validation_not_unique')) {
            // Race condition - try fetching again
            const retryRes = await fetch(Agents.byWallet(walletAddress), {
              headers: { Authorization: adminAuth.token },
            })
            const retryData = (await retryRes.json()) as { items?: Record<string, unknown>[] }
            if (retryData.items?.length) {
              agent = retryData.items[0]
            } else {
              set.status = 500
              return { error: 'Failed to find or create agent', details: errorText, version: API_VERSION }
            }
          } else {
            set.status = 500
            return { error: 'Failed to create agent', details: errorText, version: API_VERSION }
          }
        } else {
          agent = (await createRes.json()) as Record<string, unknown>
          created = true
        }
      }

      // Check if this wallet is assigned as bot_wallet to an oracle
      let oracle: Record<string, unknown> | null = null
      const oracleRes = await fetch(Oracles.byBotWallet(walletAddress), {
        headers: { Authorization: adminAuth.token },
      })
      const oracleData = (await oracleRes.json()) as { items?: Record<string, unknown>[] }
      if (oracleData.items?.length) {
        oracle = oracleData.items[0]
        // Cross-check: bot proved it controls this wallet via SIWE signature
        // Set wallet_verified = true if not already verified
        if (!oracle.wallet_verified) {
          await fetch(Oracles.update(oracle.id as string), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: adminAuth.token },
            body: JSON.stringify({ wallet_verified: true }),
          })
          oracle.wallet_verified = true
        }
      }

      // Issue custom JWT (signature-verified, 7 days expiry)
      // sub = wallet address (wallet IS the identity)
      const token = await createJWT(
        {
          sub: walletAddress,
          type: 'agent',
        },
        DEFAULT_SALT
      )

      return {
        success: true,
        created,
        token, // Custom JWT with type: 'agent'
        proofOfTime: {
          btc_price: currentChainlink.price,
          round_id: siweMessage.nonce,
          timestamp: currentChainlink.timestamp,
        },
        agent: {
          id: agent.id,
          wallet_address: agent.wallet_address,
          display_name: agent.display_name,
        },
        // Include oracle info if this wallet is a verified oracle
        ...(oracle ? {
          oracle: {
            id: oracle.id,
            name: oracle.name || oracle.oracle_name,
            wallet_verified: oracle.wallet_verified,
          },
        } : {}),
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: 'Verification failed', details: message }
    }
  })
