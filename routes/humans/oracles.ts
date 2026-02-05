/**
 * Human oracles route - GET /api/humans/:id/oracles
 */
import { Elysia } from 'elysia'
import { type Oracle, type PBListResult } from '../../lib/pocketbase'
import { Humans } from '../../lib/endpoints'

export const humansOraclesRoutes = new Elysia()
  // GET /api/humans/:id/oracles - Human's oracles (public)
  .get('/:id/oracles', async ({ params, set }) => {
    try {
      const res = await fetch(Humans.oracles(params.id))
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
