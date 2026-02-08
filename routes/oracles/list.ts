/**
 * Oracles list route - GET /api/oracles
 */
import { Elysia } from 'elysia'
import { getAdminPB } from '../../lib/pb'
import type { OracleRecord, HumanRecord } from '../../lib/pb-types'

export const oraclesListRoutes = new Elysia()
  // GET /api/oracles - List all oracles
  .get('/', async ({ query, set }) => {
    try {
      const perPage = Number(query.perPage) || 100
      const pb = await getAdminPB()

      const [data, humansData] = await Promise.all([
        pb.collection('oracles').getList<OracleRecord>(1, perPage, { expand: 'human' }),
        pb.collection('humans').getList<HumanRecord>(1, 200),
      ])

      // Enrich with owner GitHub usernames
      const walletToGithub = new Map<string, string>()
      for (const h of humansData.items || []) {
        if (h.wallet_address && h.github_username) {
          walletToGithub.set(h.wallet_address.toLowerCase(), h.github_username)
        }
      }

      const items = (data.items || []).map(o => ({
        ...o,
        owner_github: walletToGithub.get((o.owner_wallet || '').toLowerCase()) || null,
      }))

      return {
        resource: 'oracles',
        count: items.length,
        totalItems: data.totalItems || 0,
        items,
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })
