/**
 * Oracles list route - GET /api/oracles
 */
import { Elysia } from 'elysia'
import { type Oracle, type PBListResult, getPBAdminToken } from '../../lib/pocketbase'
import { Oracles, Humans } from '../../lib/endpoints'

export const oraclesListRoutes = new Elysia()
  // GET /api/oracles - List all oracles
  .get('/', async ({ query, set }) => {
    try {
      const perPage = Number(query.perPage) || 100
      // Use admin auth - oracles collection requires superuser to read
      const adminAuth = await getPBAdminToken()
      const res = await fetch(Oracles.list({ perPage, expand: 'human' }), {
        headers: adminAuth.token ? { Authorization: adminAuth.token } : {},
      })
      const data = (await res.json()) as PBListResult<Oracle>

      // Enrich with owner GitHub usernames
      const humansRes = await fetch(Humans.list({ perPage: 200 }), {
        headers: adminAuth.token ? { Authorization: adminAuth.token } : {},
      })
      const humansData = (await humansRes.json()) as PBListResult<Record<string, unknown>>
      const walletToGithub = new Map<string, string>()
      for (const h of humansData.items || []) {
        if (h.wallet_address && h.github_username) {
          walletToGithub.set((h.wallet_address as string).toLowerCase(), h.github_username as string)
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
