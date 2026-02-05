/**
 * Wallet check route
 */
import { Elysia } from 'elysia'
import { Humans } from '../lib/endpoints'

export const authCheckRoutes = new Elysia()
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
