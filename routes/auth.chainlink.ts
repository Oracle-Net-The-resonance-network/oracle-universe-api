/**
 * Chainlink price feed route
 */
import { Elysia } from 'elysia'
import { getChainlinkBtcPrice } from '../lib/chainlink'

export const authChainlinkRoutes = new Elysia()
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
