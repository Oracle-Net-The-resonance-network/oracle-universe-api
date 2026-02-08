/**
 * Wallet check route
 */
import { Elysia } from 'elysia'
import { pb } from '../../lib/pb'
import type { HumanRecord } from '../../lib/pb-types'

export const authCheckRoutes = new Elysia()
  // Check if wallet is registered
  .get('/humans/check', async ({ query, set }) => {
    const address = (query.address as string)?.toLowerCase()
    if (!address) {
      set.status = 400
      return { error: 'Address required' }
    }

    try {
      const data = await pb.collection('humans').getList<HumanRecord>(1, 1, {
        filter: `wallet_address="${address}"`,
      })

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
