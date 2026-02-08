/**
 * Oracle get route - GET /api/oracles/:id
 */
import { Elysia } from 'elysia'
import { getAdminPB } from '../../lib/pb'

export const oraclesGetRoutes = new Elysia()
  // GET /api/oracles/:id - Single oracle
  .get('/:id', async ({ params, set }) => {
    try {
      const pb = await getAdminPB()
      return await pb.collection('oracles').getOne(params.id)
    } catch (e: any) {
      if (e?.status === 404) {
        set.status = 404
        return { error: 'Oracle not found' }
      }
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })
