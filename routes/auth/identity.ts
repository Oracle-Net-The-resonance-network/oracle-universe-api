/**
 * Oracle Identity verification route (GitHub-based)
 */
import { Elysia } from 'elysia'
import { hashWalletPassword, createJWT, DEFAULT_SALT } from '../../lib/auth'
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
    const { verificationIssueUrl, birthIssueUrl, oracleName } = body as {
      verificationIssueUrl: string
      birthIssueUrl: string
      oracleName?: string
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
      const humanSearchRes = await fetch(Humans.byWallet(walletAddress))
      const humanSearchData = (await humanSearchRes.json()) as { items?: Record<string, unknown>[] }

      // Get admin token for human operations
      const adminAuthForHuman = await getPBAdminToken()

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
        const email = `${walletAddress}@human.oracle.universe`
        const password = await hashWalletPassword(walletAddress, DEFAULT_SALT)
        const createHumanRes = await fetch(Humans.create(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: adminAuthForHuman.token },
          body: JSON.stringify({
            email,
            password,
            passwordConfirm: password,
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

      // 6. Find or create oracle, link to human
      const oracleCheckRes = await fetch(Oracles.byBirthIssue(birthIssueUrl))
      const oracleCheckData = (await oracleCheckRes.json()) as { items?: Record<string, unknown>[] }

      let oracle: Record<string, unknown>
      if (oracleCheckData.items?.length) {
        // Update existing oracle (requires admin auth)
        oracle = oracleCheckData.items[0]
        const adminAuthForUpdate = await getPBAdminToken()
        if (adminAuthForUpdate.token) {
          const updateOracleRes = await fetch(Oracles.get(oracle.id as string), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: adminAuthForUpdate.token },
            body: JSON.stringify({ human: human.id, oracle_name: finalOracleName, claimed: true }),
          })
          if (updateOracleRes.ok) {
            oracle = (await updateOracleRes.json()) as Record<string, unknown>
          }
        }
      } else {
        // Create new oracle (requires admin auth since it's an auth collection)
        const adminAuthForOracle = await getPBAdminToken()
        if (!adminAuthForOracle.token) {
          set.status = 500
          return { error: 'Admin auth not configured - cannot create oracle', details: adminAuthForOracle.error, version: API_VERSION }
        }
        const oraclePassword = await hashWalletPassword(birthIssueUrl, DEFAULT_SALT)
        const createOracleRes = await fetch(Oracles.create(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: adminAuthForOracle.token },
          body: JSON.stringify({
            name: githubUsername,
            oracle_name: finalOracleName,
            birth_issue: birthIssueUrl,
            human: human.id,
            claimed: true,
            approved: true,
            password: oraclePassword,
            passwordConfirm: oraclePassword,
          }),
        })
        if (!createOracleRes.ok) {
          const err = await createOracleRes.text()
          set.status = 500
          return { error: 'Failed to create oracle', details: err }
        }
        oracle = (await createOracleRes.json()) as Record<string, unknown>
      }

      // 7. Issue token
      const token = await createJWT(
        {
          sub: human.id,
          wallet: walletAddress,
          type: 'human',
        },
        DEFAULT_SALT
      )

      return {
        success: true,
        token, // Custom JWT
        github_username: githubUsername,
        oracle_name: finalOracleName,
        human: { id: human.id, wallet_address: human.wallet_address, github_username: human.github_username },
        oracle: { id: oracle.id, name: oracle.name, oracle_name: oracle.oracle_name, birth_issue: oracle.birth_issue },
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: 'Verification failed', details: message }
    }
  })
