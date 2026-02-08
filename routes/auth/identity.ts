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

export const authIdentityRoutes = new Elysia()
  // Verify Oracle Identity (GitHub-based, stateless)
  // No auth token needed - GitHub issue proves everything:
  // - Issue author proves GitHub identity
  // - Wallet in issue body proves wallet ownership (they had to know it)
  // - Birth issue author must match verification issue author
  .post('/verify-identity', async ({ body, set }) => {
    const { verificationIssueUrl, birthIssueUrl, oracleName, siweMessage, siweSignature } = body as {
      verificationIssueUrl: string
      birthIssueUrl: string
      oracleName?: string
      siweMessage?: string
      siweSignature?: string
    }

    if (!verificationIssueUrl || !birthIssueUrl) {
      set.status = 400
      return { error: 'Missing required fields', required: ['verificationIssueUrl', 'birthIssueUrl'] }
    }

    try {
      // 1. Parse GitHub URLs
      const verifyMatch = verificationIssueUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/issues\/(\d+)/)
      const birthMatch = birthIssueUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/issues\/(\d+)/)

      if (!verifyMatch || !birthMatch) {
        set.status = 400
        return { error: 'Invalid GitHub issue URLs' }
      }

      const [, verifyOwner, verifyRepo, verifyNum] = verifyMatch
      const [, birthOwner, birthRepo, birthNum] = birthMatch

      // 2. Fetch both GitHub issues
      const ghHeaders: Record<string, string> = { 'User-Agent': 'OracleNet-API' }
      const ghToken = getEnv('GITHUB_TOKEN')
      if (ghToken) {
        ghHeaders['Authorization'] = `Bearer ${ghToken}`
      }

      const [verifyRes, birthRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${verifyOwner}/${verifyRepo}/issues/${verifyNum}`, { headers: ghHeaders }),
        fetch(`https://api.github.com/repos/${birthOwner}/${birthRepo}/issues/${birthNum}`, { headers: ghHeaders }),
      ])

      if (!verifyRes.ok || !birthRes.ok) {
        set.status = 400
        return { error: 'Failed to fetch GitHub issues', details: { verify: verifyRes.status, birth: birthRes.status } }
      }

      const verifyIssue = (await verifyRes.json()) as { user?: { login?: string }; body?: string; title?: string }
      const birthIssue = (await birthRes.json()) as { user?: { login?: string }; title?: string }

      const verifyAuthor = verifyIssue.user?.login?.toLowerCase()
      const birthAuthor = birthIssue.user?.login?.toLowerCase()

      // 3. Verify GitHub usernames match
      if (verifyAuthor !== birthAuthor) {
        set.status = 401
        return { error: 'GitHub username mismatch', debug: { verification_author: verifyAuthor, birth_author: birthAuthor } }
      }

      // 4. Extract wallet address from verification issue body
      const issueBody = verifyIssue.body || ''
      const walletMatch = issueBody.match(/0x[a-fA-F0-9]{40}/)
      if (!walletMatch) {
        set.status = 400
        return { error: 'No wallet address found in verification issue body' }
      }
      const walletAddress = walletMatch[0].toLowerCase()
      const githubUsername = verifyIssue.user?.login

      // Extract optional bot wallet from issue body
      // Supports: "Bot Wallet: 0x..." label OR "bot_wallet": "0x..." in JSON
      const botWalletMatch = issueBody.match(/Bot Wallet:\s*(0x[a-fA-F0-9]{40})/i)
        || issueBody.match(/"bot_wallet":\s*"(0x[a-fA-F0-9]{40})"/i)
      const botWallet = botWalletMatch?.[1]?.toLowerCase()

      const pb = await getAdminPB()

      // Reject duplicate bot_wallet — each oracle must have its own bot wallet
      if (botWallet) {
        const dupData = await pb.collection('oracles').getList<OracleRecord>(1, 10, {
          filter: `bot_wallet="${botWallet}"`,
        })
        const existingOracle = dupData.items?.find(o => o.birth_issue !== birthIssueUrl)
        if (existingOracle) {
          set.status = 400
          return { error: 'Bot wallet already assigned to another oracle', debug: { bot_wallet: botWallet, existing_oracle: existingOracle.name } }
        }
      }

      const finalOracleName =
        oracleName ||
        birthIssue.title
          ?.replace(/^.*?Birth:?\s*/i, '')
          .split(/\s*[—-]\s*/)[0]
          .trim() ||
        'Oracle'

      // 5. Find or create human by wallet
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

      // 6. Find or create oracle, link to human via owner_wallet
      const oracleCheckData = await pb.collection('oracles').getList<OracleRecord>(1, 1, {
        filter: `birth_issue="${birthIssueUrl}"`,
      })

      let oracle: Record<string, unknown>
      if (oracleCheckData.items?.length) {
        // Update existing oracle
        oracle = await pb.collection('oracles').update(oracleCheckData.items[0].id, {
          owner_wallet: walletAddress,
          name: finalOracleName,
          approved: true,
          ...(botWallet && { bot_wallet: botWallet, wallet_verified: false }),
        })
      } else {
        // Create new oracle
        oracle = await pb.collection('oracles').create({
          name: finalOracleName,
          birth_issue: birthIssueUrl,
          owner_wallet: walletAddress,
          approved: true,
          ...(botWallet && { bot_wallet: botWallet, wallet_verified: false }),
        })
      }

      // 7. Re-claim: transfer oracles from old wallets — ONLY if SIWE proves wallet ownership
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

      // 8. Issue token
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
