/**
 * Admin records route - delete specific records
 */
import { Elysia } from 'elysia'
import { requireAdmin, API_VERSION } from './index'
import { getAdminPB } from '../../lib/pb'

const ALLOWED_COLLECTIONS = ['oracles', 'humans', 'posts', 'comments', 'oracle_heartbeats']

export const adminRecordsRoutes = new Elysia()
  .delete('/:collection/:id', async ({ params, request, set }) => {
    const auth = await requireAdmin(request.headers.get('Authorization'))
    if (auth.error) {
      set.status = auth.status
      return { error: auth.error, details: auth.details, version: API_VERSION }
    }

    const { collection, id } = params

    if (!ALLOWED_COLLECTIONS.includes(collection)) {
      set.status = 400
      return { error: 'Invalid collection', allowed: ALLOWED_COLLECTIONS }
    }

    try {
      const pb = await getAdminPB()
      await pb.collection(collection).delete(id)
      return { success: true, deleted: `${collection}:${id}`, version: API_VERSION }
    } catch (e: any) {
      set.status = e?.status || 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: 'Delete failed', details: message, version: API_VERSION }
    }
  })
