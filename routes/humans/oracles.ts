/**
 * Human oracles route - GET /api/humans/:id/oracles
 */
import { Elysia } from 'elysia'
import { pb } from '../../lib/pb'
import type { OracleRecord } from '../../lib/pb-types'

export const humansOraclesRoutes = new Elysia()
  // GET /api/humans/:id/oracles - Human's oracles (public, looks up wallet then queries by owner_wallet)
  .get('/:id/oracles', async ({ params, set }) => {
    try {
      // Resolve human to get their wallet
      let human: { wallet_address?: string }
      try {
        human = await pb.collection('humans').getOne(params.id)
      } catch {
        set.status = 404
        return { error: 'Human not found' }
      }

      if (!human.wallet_address) {
        return { resource: 'oracles', humanId: params.id, count: 0, items: [] }
      }

      const data = await pb.collection('oracles').getList<OracleRecord>(1, 100, {
        filter: `owner_wallet="${human.wallet_address}"`,
      })
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
