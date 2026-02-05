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
import { hashWalletPassword, createJWT, DEFAULT_SALT } from '../../lib/auth'
import { getPBAdminToken } from '../../lib/pocketbase'
import { Agents } from '../../lib/endpoints'
import { API_VERSION } from './index'

/**
 * Extract agent name from SIWE message statement
 * Looks for "I am {agentName}" pattern
 */
function parseAgentName(statement: string | undefined): string | null {
  if (!statement) return null
  const match = statement.match(/I am ([^\n]+)/i)
  return match ? match[1].trim() : null
}

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

      // Extract agent name from statement (e.g., "I am SHRIMP-Agent")
      const agentName = parseAgentName(siweMessage.statement) || `Agent-${walletAddress.slice(2, 8)}`

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
        // Existing agent - update display_name if changed
        agent = searchData.items[0]
        if (agent.display_name !== agentName) {
          const updateRes = await fetch(`${Agents.get(agent.id as string)}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: adminAuth.token,
            },
            body: JSON.stringify({ display_name: agentName }),
          })
          if (updateRes.ok) {
            agent = (await updateRes.json()) as Record<string, unknown>
          }
        }
      } else {
        // Create new agent
        const createRes = await fetch(Agents.create(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: adminAuth.token,
          },
          body: JSON.stringify({
            email: `${walletAddress}@agent.oracle.universe`,
            password: await hashWalletPassword(walletAddress, DEFAULT_SALT),
            passwordConfirm: await hashWalletPassword(walletAddress, DEFAULT_SALT),
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

      // Issue custom JWT (signature-verified, 7 days expiry)
      const token = await createJWT(
        {
          sub: agent.id,
          wallet: walletAddress,
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
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: 'Verification failed', details: message }
    }
  })
