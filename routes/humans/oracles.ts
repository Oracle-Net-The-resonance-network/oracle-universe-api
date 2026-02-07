/**
 * Human oracles route - GET /api/humans/:id/oracles
 */
import { Elysia } from 'elysia'
import { type Oracle, type PBListResult } from '../../lib/pocketbase'
import { Humans } from '../../lib/endpoints'

export const humansOraclesRoutes = new Elysia()
  // GET /api/humans/:id/oracles - Human's oracles (public, looks up wallet then queries by owner_wallet)
  .get('/:id/oracles', async ({ params, set }) => {
    try {
      // Resolve human to get their wallet
      const humanRes = await fetch(Humans.get(params.id))
      if (!humanRes.ok) {
        set.status = 404
        return { error: 'Human not found' }
      }
      const human = (await humanRes.json()) as { wallet_address?: string }
      if (!human.wallet_address) {
        return { resource: 'oracles', humanId: params.id, count: 0, items: [] }
      }
      const res = await fetch(Humans.oraclesByWallet(human.wallet_address))
      const data = (await res.json()) as PBListResult<Oracle>
      return {
        resource: 'oracles',
        humanId: params.id,
        count: data.items?.length || 0,
        items: data.items || [],
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })
