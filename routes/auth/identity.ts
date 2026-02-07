/**
 * Oracle Identity verification route (GitHub-based)
 */
import { Elysia } from 'elysia'
import { recoverMessageAddress } from 'viem'
import { parseSiweMessage } from 'viem/siwe'
import { createJWT, DEFAULT_SALT } from '../../lib/auth'
import { getPBAdminToken } from '../../lib/pocketbase'
import { Humans, Oracles } from '../../lib/endpoints'
import { getEnv } from '../../lib/env'
import { API_VERSION } from './index'

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

      const finalOracleName =
        oracleName ||
        birthIssue.title
          ?.replace(/^.*?Birth:?\s*/i, '')
          .split(/\s*[—-]\s*/)[0]
          .trim() ||
        'Oracle'

      // 5. Find or create human by wallet
      // Get admin token first - needed for search (collection may require auth)
      const adminAuthForHuman = await getPBAdminToken()
      const humanSearchRes = await fetch(Humans.byWallet(walletAddress), {
        headers: adminAuthForHuman.token ? { Authorization: adminAuthForHuman.token } : {},
      })
      const humanSearchData = (await humanSearchRes.json()) as { items?: Record<string, unknown>[] }

      let human: Record<string, unknown>
      if (humanSearchData.items?.length) {
        // Update existing human with GitHub username
        human = humanSearchData.items[0]
        if (adminAuthForHuman.token) {
          const updateHumanRes = await fetch(Humans.get(human.id as string), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: adminAuthForHuman.token },
            body: JSON.stringify({ github_username: githubUsername, display_name: githubUsername }),
          })
          if (updateHumanRes.ok) {
            human = (await updateHumanRes.json()) as Record<string, unknown>
          }
        }
      } else {
        // Create new human
        if (!adminAuthForHuman.token) {
          set.status = 500
          return { error: 'Admin auth not configured - cannot create human', details: adminAuthForHuman.error, version: API_VERSION }
        }
        const createHumanRes = await fetch(Humans.create(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: adminAuthForHuman.token },
          body: JSON.stringify({
            wallet_address: walletAddress,
            github_username: githubUsername,
            display_name: githubUsername,
          }),
        })
        if (!createHumanRes.ok) {
          const err = await createHumanRes.text()
          set.status = 500
          return { error: 'Failed to create human', details: err, version: API_VERSION }
        }
        human = (await createHumanRes.json()) as Record<string, unknown>
      }

      // 6. Find or create oracle, link to human via owner_wallet
      // Use admin auth for search (collection may require auth to read)
      const oracleCheckRes = await fetch(Oracles.byBirthIssue(birthIssueUrl), {
        headers: adminAuthForHuman.token ? { Authorization: adminAuthForHuman.token } : {},
      })
      const oracleCheckData = (await oracleCheckRes.json()) as { items?: Record<string, unknown>[] }

      let oracle: Record<string, unknown>
      if (oracleCheckData.items?.length) {
        // Update existing oracle (reuse admin auth)
        oracle = oracleCheckData.items[0]
        const adminAuthForUpdate = adminAuthForHuman
        if (adminAuthForUpdate.token) {
          const updateOracleRes = await fetch(Oracles.get(oracle.id as string), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: adminAuthForUpdate.token },
            body: JSON.stringify({ owner_wallet: walletAddress, name: finalOracleName, approved: true }),
          })
          if (updateOracleRes.ok) {
            oracle = (await updateOracleRes.json()) as Record<string, unknown>
          }
        }
      } else {
        // Create new oracle
        const adminAuthForOracle = await getPBAdminToken()
        if (!adminAuthForOracle.token) {
          set.status = 500
          return { error: 'Admin auth not configured - cannot create oracle', details: adminAuthForOracle.error, version: API_VERSION }
        }
        const createOracleRes = await fetch(Oracles.create(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: adminAuthForOracle.token },
          body: JSON.stringify({
            name: finalOracleName,
            birth_issue: birthIssueUrl,
            owner_wallet: walletAddress,
            approved: true,
          }),
        })
        if (!createOracleRes.ok) {
          const err = await createOracleRes.text()
          set.status = 500
          return { error: 'Failed to create oracle', details: err }
        }
        oracle = (await createOracleRes.json()) as Record<string, unknown>
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

      if (walletVerified && adminAuthForHuman.token && githubUsername) {
        const allHumansRes = await fetch(
          Humans.list({ filter: `github_username="${githubUsername}"`, perPage: 200 }),
          { headers: { Authorization: adminAuthForHuman.token } }
        )
        const allHumansData = (await allHumansRes.json()) as { items?: Record<string, unknown>[] }
        const oldWallets = (allHumansData.items || [])
          .map((h) => h.wallet_address as string)
          .filter((w) => w && w !== walletAddress)

        if (oldWallets.length > 0) {
          const ownerFilter = oldWallets.map((w) => `owner_wallet="${w}"`).join(' || ')
          const oldOraclesRes = await fetch(
            Oracles.list({ filter: ownerFilter, perPage: 200 }),
            { headers: { Authorization: adminAuthForHuman.token } }
          )
          const oldOraclesData = (await oldOraclesRes.json()) as { items?: Record<string, unknown>[] }

          for (const o of oldOraclesData.items || []) {
            await fetch(Oracles.update(o.id as string), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', Authorization: adminAuthForHuman.token },
              body: JSON.stringify({ owner_wallet: walletAddress }),
            })
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
