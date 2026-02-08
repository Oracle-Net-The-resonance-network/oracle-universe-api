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
import { getAdminPB } from '../../lib/pb'
import type { AgentRecord, OracleRecord } from '../../lib/pb-types'
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
      let agent: AgentRecord
      let created = false

      const pb = await getAdminPB()

      // Look up existing agent by wallet
      const searchData = await pb.collection('agents').getList<AgentRecord>(1, 1, {
        filter: `wallet_address="${walletAddress}"`,
      })

      if (searchData.items?.length) {
        // Existing agent found
        agent = searchData.items[0]
      } else {
        // Create new agent
        try {
          agent = await pb.collection('agents').create<AgentRecord>({
            wallet_address: walletAddress,
            display_name: agentName,
          })
          created = true
        } catch (createErr: any) {
          // If creation failed due to unique constraint, fetch existing agent
          if (createErr?.data?.data?.wallet_address?.code === 'validation_not_unique' ||
              String(createErr).includes('validation_not_unique')) {
            const retryData = await pb.collection('agents').getList<AgentRecord>(1, 1, {
              filter: `wallet_address="${walletAddress}"`,
            })
            if (retryData.items?.length) {
              agent = retryData.items[0]
            } else {
              set.status = 500
              return { error: 'Failed to find or create agent', version: API_VERSION }
            }
          } else {
            set.status = 500
            return { error: 'Failed to create agent', details: String(createErr), version: API_VERSION }
          }
        }
      }

      // Check if this wallet is assigned as bot_wallet to an oracle
      let oracle: OracleRecord | null = null
      const oracleData = await pb.collection('oracles').getList<OracleRecord>(1, 1, {
        filter: `bot_wallet="${walletAddress}"`,
      })
      if (oracleData.items?.length) {
        oracle = oracleData.items[0]
        // Cross-check: bot proved it controls this wallet via SIWE signature
        // Set wallet_verified = true if not already verified
        if (!oracle.wallet_verified) {
          await pb.collection('oracles').update(oracle.id, { wallet_verified: true })
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
