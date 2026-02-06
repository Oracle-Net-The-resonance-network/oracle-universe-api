/**
 * Oracle wallet assignment route
 *
 * PATCH /api/oracles/:id/wallet
 * Human assigns a bot wallet to their oracle.
 * Requires SIWE proof that the human owns the requesting wallet.
 */
import { Elysia } from 'elysia'
import { verifySIWE } from '../../lib/auth'
import { getPBAdminToken } from '../../lib/pocketbase'
import { Oracles, Humans } from '../../lib/endpoints'

export const oraclesWalletRoutes = new Elysia()
  .patch('/:id/wallet', async ({ params, body, set }) => {
    const { wallet_address, message, signature } = body as {
      wallet_address: string
      message: string
      signature: string
    }

    if (!wallet_address || !message || !signature) {
      set.status = 400
      return { error: 'Missing required fields', required: ['wallet_address', 'message', 'signature'] }
    }

    // Verify SIWE signature — proves the requester owns their wallet
    const verified = await verifySIWE(message, signature)
    if (!verified) {
      set.status = 401
      return { error: 'Invalid SIWE signature' }
    }

    const adminAuth = await getPBAdminToken()
    if (!adminAuth.token) {
      set.status = 500
      return { error: 'Admin auth required' }
    }

    // Fetch the oracle to check ownership
    const oracleRes = await fetch(Oracles.get(params.id), {
      headers: { Authorization: adminAuth.token },
    })
    if (!oracleRes.ok) {
      set.status = 404
      return { error: 'Oracle not found' }
    }
    const oracle = (await oracleRes.json()) as Record<string, unknown>

    // Verify the requester owns this oracle: find human by wallet, check oracle.human matches
    const humanRes = await fetch(Humans.byWallet(verified.wallet), {
      headers: { Authorization: adminAuth.token },
    })
    const humanData = (await humanRes.json()) as { items?: Record<string, unknown>[] }
    if (!humanData.items?.length) {
      set.status = 403
      return { error: 'No human found for this wallet' }
    }
    const human = humanData.items[0]

    if (oracle.human !== human.id) {
      set.status = 403
      return { error: 'You do not own this oracle' }
    }

    // Update oracle's wallet_address
    const updateRes = await fetch(Oracles.update(params.id), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: adminAuth.token,
      },
      body: JSON.stringify({ wallet_address: wallet_address.toLowerCase() }),
    })

    if (!updateRes.ok) {
      set.status = 500
      const err = await updateRes.text()
      return { error: 'Failed to update oracle wallet', details: err }
    }

    const updated = await updateRes.json()
    return { success: true, oracle: updated }
  })
