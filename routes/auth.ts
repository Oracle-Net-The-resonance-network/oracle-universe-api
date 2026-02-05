/**
 * Auth routes - SIWE + Chainlink proof-of-time + GitHub verification
 */
import { Elysia } from 'elysia'
import { recoverMessageAddress } from 'viem'
import { parseSiweMessage } from 'viem/siwe'
import { getChainlinkBtcPrice } from '../lib/chainlink'
import { hashWalletPassword, createJWT, DEFAULT_SALT } from '../lib/auth'
import { getPBAdminToken } from '../lib/pocketbase'
import { Humans, Oracles } from '../lib/endpoints'
import { getEnv } from '../lib/env'
import pkg from '../package.json'

const API_VERSION = pkg.version

export const authRoutes = new Elysia({ prefix: '/api/auth' })
  // Get Chainlink BTC price (nonce = roundId)
  .get('/chainlink', async ({ set }) => {
    try {
      const data = await getChainlinkBtcPrice()
      return {
        price: data.price,
        roundId: data.roundId,
        timestamp: data.timestamp,
        message: `Use roundId as nonce in SIWE message`,
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: 'Failed to fetch Chainlink price', details: message }
    }
  })

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
            email: `${walletAddress}@human.oracle.universe`,
            password: await hashWalletPassword(walletAddress, DEFAULT_SALT),
            passwordConfirm: await hashWalletPassword(walletAddress, DEFAULT_SALT),
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

  // Check if wallet is registered
  .get('/humans/check', async ({ query, set }) => {
    const address = (query.address as string)?.toLowerCase()
    if (!address) {
      set.status = 400
      return { error: 'Address required' }
    }

    try {
      const res = await fetch(Humans.byWallet(address))
      const data = (await res.json()) as { items: Record<string, unknown>[] }

      if (data.items && data.items.length > 0) {
        return {
          registered: true,
          human: {
            id: data.items[0].id,
            wallet_address: data.items[0].wallet_address,
            display_name: data.items[0].display_name,
          },
        }
      }
      return { registered: false }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })

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
