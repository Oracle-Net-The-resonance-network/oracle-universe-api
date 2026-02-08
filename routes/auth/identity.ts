/**
 * Oracle Identity verification route (GitHub-based)
 */
import { Elysia } from 'elysia'
import { recoverMessageAddress } from 'viem'
import { parseSiweMessage } from 'viem/siwe'
import { createJWT, DEFAULT_SALT } from '../../lib/auth'
import { getAdminPB } from '../../lib/pb'
import type { HumanRecord, OracleRecord } from '../../lib/pb-types'
import { getEnv } from '../../lib/env'
import { getChainlinkRoundData } from '../../lib/chainlink'

export const authIdentityRoutes = new Elysia()
  // Verify Oracle Identity (GitHub-based, stateless)
  // No auth token needed - GitHub issue proves everything:
  // - Issue author proves GitHub identity
  // - Wallet in issue body proves wallet ownership (they had to know it)
  // - Birth issue author must match verification issue author
  .post('/verify-identity', async ({ body, set }) => {
    const { verificationIssueUrl, birthIssueUrl, oracleName, siweMessage, siweSignature } = body as {
      verificationIssueUrl: string
      birthIssueUrl?: string   // optional — extracted from verification issue body if missing
      oracleName?: string      // optional — extracted from verification issue body if missing
      siweMessage?: string
      siweSignature?: string
    }

    if (!verificationIssueUrl) {
      set.status = 400
      return { error: 'Missing required field', required: ['verificationIssueUrl'] }
    }

    try {
      // 1. Parse verification issue URL
      const verifyMatch = verificationIssueUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/issues\/(\d+)/)
      if (!verifyMatch) {
        set.status = 400
        return { error: 'Invalid GitHub issue URL' }
      }

      const [, verifyOwner, verifyRepo, verifyNum] = verifyMatch

      // 2. Fetch verification issue
      const ghHeaders: Record<string, string> = { 'User-Agent': 'OracleNet-API' }
      const ghToken = getEnv('GITHUB_TOKEN')
      if (ghToken) {
        ghHeaders['Authorization'] = `Bearer ${ghToken}`
      }

      const verifyRes = await fetch(`https://api.github.com/repos/${verifyOwner}/${verifyRepo}/issues/${verifyNum}`, { headers: ghHeaders })
      if (!verifyRes.ok) {
        set.status = 400
        return { error: 'Failed to fetch verification issue', details: { status: verifyRes.status } }
      }

      const verifyIssue = (await verifyRes.json()) as { user?: { login?: string }; body?: string; title?: string }
      const issueBody = verifyIssue.body || ''
      const githubUsername = verifyIssue.user?.login

      // 3. Extract structured data from verification issue body (JSON block or labels)
      // Try JSON in code block first
      let bodyData: Record<string, string> = {}
      const jsonMatch = issueBody.match(/```json\s*([\s\S]*?)```/)
      if (jsonMatch) {
        try { bodyData = JSON.parse(jsonMatch[1]) } catch {}
      }
      // Fallback: try parsing entire body as JSON
      if (!Object.keys(bodyData).length) {
        try { bodyData = JSON.parse(issueBody) } catch {}
      }

      // Extract wallet — from JSON data or first 0x match in body
      const walletFromBody = bodyData.wallet || issueBody.match(/\*\*Wallet:\*\*\s*`?(0x[a-fA-F0-9]{40})`?/i)?.[1] || issueBody.match(/0x[a-fA-F0-9]{40}/)?.[0]
      if (!walletFromBody) {
        set.status = 400
        return { error: 'No wallet address found in verification issue body' }
      }
      const walletAddress = walletFromBody.toLowerCase()

      // Extract birth issue URL — from JSON data, markdown label, or request body fallback
      const birthIssueFromBody = bodyData.birth_issue || issueBody.match(/\*\*Birth Issue:\*\*\s*(https:\/\/github\.com\/[^\s]+)/i)?.[1]
      const resolvedBirthIssue = birthIssueUrl || birthIssueFromBody
      if (!resolvedBirthIssue) {
        set.status = 400
        return { error: 'No birth issue URL found in verification issue body' }
      }

      // Extract oracle name — from JSON data or request body fallback
      const resolvedOracleName = oracleName || bodyData.oracle_name

      // Extract bot wallet — from JSON data or markdown label
      const botWalletMatch = issueBody.match(/Bot Wallet:\s*(0x[a-fA-F0-9]{40})/i)
        || issueBody.match(/"bot_wallet":\s*"(0x[a-fA-F0-9]{40})"/i)
      const botWallet = (bodyData.bot_wallet || botWalletMatch?.[1])?.toLowerCase()

      // 3b. Verify cryptographic signature if present in issue body
      // The signature proves the wallet owner authorized this claim
      if (bodyData.signature) {
        try {
          // Reconstruct the original signed message (everything except signature)
          const { signature: _sig, ...messageFields } = bodyData
          const originalMessage = JSON.stringify(messageFields, null, 2)

          const recoveredAddress = await recoverMessageAddress({
            message: originalMessage,
            signature: bodyData.signature as `0x${string}`,
          })

          if (recoveredAddress.toLowerCase() !== walletAddress) {
            set.status = 401
            return {
              error: 'Signature does not match wallet address',
              debug: { recovered: recoveredAddress.toLowerCase(), claimed: walletAddress },
            }
          }
        } catch (e: unknown) {
          set.status = 400
          const message = e instanceof Error ? e.message : String(e)
          return { error: 'Invalid signature in verification issue', details: message }
        }
      }

      // 3c. Verify chainlink_round freshness (proof-of-time) — REQUIRED
      // Fetch the claimed round's timestamp from the contract — must be within 1 hour
      if (!bodyData.chainlink_round) {
        set.status = 400
        return { error: 'Missing chainlink_round in verification payload (required for proof-of-time)' }
      }
      {
        const roundData = await getChainlinkRoundData(bodyData.chainlink_round)
        const nowSec = Math.floor(Date.now() / 1000)
        const ageSec = nowSec - roundData.timestamp
        if (ageSec > 3600) {
          set.status = 401
          return { error: 'Verification signature expired (older than 1 hour)', debug: { claimed_round: bodyData.chainlink_round, round_timestamp: roundData.timestamp, age_seconds: ageSec } }
        }
      }

      // 4. Parse birth issue URL and fetch it
      const birthMatch = resolvedBirthIssue.match(/github\.com\/([^\/]+)\/([^\/]+)\/issues\/(\d+)/)
      if (!birthMatch) {
        set.status = 400
        return { error: 'Invalid birth issue URL', debug: { birth_issue: resolvedBirthIssue } }
      }

      const [, birthOwner, birthRepo, birthNum] = birthMatch

      const birthRes = await fetch(`https://api.github.com/repos/${birthOwner}/${birthRepo}/issues/${birthNum}`, { headers: ghHeaders })
      if (!birthRes.ok) {
        set.status = 400
        return { error: 'Failed to fetch birth issue', details: { status: birthRes.status } }
      }

      const birthIssue = (await birthRes.json()) as { user?: { login?: string }; title?: string }

      const verifyAuthor = verifyIssue.user?.login?.toLowerCase()
      const birthAuthor = birthIssue.user?.login?.toLowerCase()

      // 5. Verify GitHub usernames match
      if (verifyAuthor !== birthAuthor) {
        set.status = 401
        return { error: 'GitHub username mismatch', debug: { verification_author: verifyAuthor, birth_author: birthAuthor } }
      }

      const pb = await getAdminPB()

      // Reject duplicate bot_wallet — each oracle must have its own bot wallet
      if (botWallet) {
        const dupData = await pb.collection('oracles').getList<OracleRecord>(1, 10, {
          filter: `bot_wallet="${botWallet}"`,
        })
        const existingOracle = dupData.items.find(o => o.birth_issue !== resolvedBirthIssue)
        if (existingOracle) {
          set.status = 400
          return { error: 'Bot wallet already assigned to another oracle', debug: { bot_wallet: botWallet, existing_oracle: existingOracle.name } }
        }
      }

      const finalOracleName =
        resolvedOracleName ||
        birthIssue.title
          ?.replace(/^.*?Birth:?\s*/i, '')
          .split(/\s*[—-]\s*/)[0]
          .trim() ||
        'Oracle'

      // 6. Find or create human by wallet
      const humanSearchData = await pb.collection('humans').getList<HumanRecord>(1, 1, {
        filter: `wallet_address="${walletAddress}"`,
      })

      let human: Record<string, unknown>
      if (humanSearchData.items?.length) {
        // Update existing human with GitHub username
        human = await pb.collection('humans').update(humanSearchData.items[0].id, {
          github_username: githubUsername,
          display_name: githubUsername,
        })
      } else {
        // Create new human
        human = await pb.collection('humans').create({
          wallet_address: walletAddress,
          github_username: githubUsername,
          display_name: githubUsername,
        })
      }

      // 7. Find or create oracle, link to human via owner_wallet
      const oracleCheckData = await pb.collection('oracles').getList<OracleRecord>(1, 1, {
        filter: `birth_issue="${resolvedBirthIssue}"`,
      })

      let oracle: Record<string, unknown>
      if (oracleCheckData.items?.length) {
        // Update existing oracle
        oracle = await pb.collection('oracles').update(oracleCheckData.items[0].id, {
          owner_wallet: walletAddress,
          name: finalOracleName,
          approved: true,
          verification_issue: verificationIssueUrl,
          ...(botWallet && { bot_wallet: botWallet, wallet_verified: false }),
        })
      } else {
        // Create new oracle
        oracle = await pb.collection('oracles').create({
          name: finalOracleName,
          birth_issue: resolvedBirthIssue,
          owner_wallet: walletAddress,
          approved: true,
          verification_issue: verificationIssueUrl,
          ...(botWallet && { bot_wallet: botWallet, wallet_verified: false }),
        })
      }

      // 8. Re-claim: transfer oracles from old wallets — ONLY if SIWE proves wallet ownership
      let walletVerified = false
      if (siweMessage && siweSignature) {
        const parsed = parseSiweMessage(siweMessage)
        if (parsed.address && parsed.nonce) {
          const recoveredAddress = await recoverMessageAddress({
            message: siweMessage,
            signature: siweSignature as `0x${string}`,
          })
          if (recoveredAddress.toLowerCase() === walletAddress) {
            walletVerified = true
          }
        }
      }

      if (walletVerified && githubUsername) {
        // Bot wallet guard: skip re-claim if this wallet is a bot_wallet
        const botWalletCheck = await pb.collection('oracles').getList<OracleRecord>(1, 1, {
          filter: `bot_wallet="${walletAddress}"`,
        })
        if (botWalletCheck.items.length > 0) {
          // Don't re-claim — this wallet belongs to an oracle bot
        } else {
          const allHumansData = await pb.collection('humans').getList<HumanRecord>(1, 200, {
            filter: `github_username="${githubUsername}"`,
          })
          const oldWallets = (allHumansData.items || [])
            .map((h) => h.wallet_address)
            .filter((w) => w && w !== walletAddress)

          if (oldWallets.length > 0) {
            const ownerFilter = oldWallets.map((w) => `owner_wallet="${w}"`).join(' || ')
            const oldOraclesData = await pb.collection('oracles').getList<OracleRecord>(1, 200, {
              filter: ownerFilter,
            })

            for (const o of oldOraclesData.items || []) {
              await pb.collection('oracles').update(o.id, { owner_wallet: walletAddress })
            }
          }
        }
      }

      // 9. Issue token
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
        token, // Custom JWT (sub = wallet address)
        github_username: githubUsername,
        oracle_name: finalOracleName,
        human: { wallet: human.wallet_address as string, github_username: human.github_username },
        oracle: { wallet: (oracle.bot_wallet || '') as string, name: oracle.name, birth_issue: oracle.birth_issue },
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: 'Verification failed', details: message }
    }
  })
