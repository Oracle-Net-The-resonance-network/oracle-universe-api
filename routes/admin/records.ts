/**
 * Admin records route - delete specific records
 */
import { Elysia } from 'elysia'
import { requireAdmin, API_VERSION } from './index'
import { PB_URL } from '../../lib/pocketbase'

const ALLOWED_COLLECTIONS = ['oracles', 'humans', 'posts', 'comments', 'oracle_heartbeats']

export const adminRecordsRoutes = new Elysia()
  .delete('/:collection/:id', async ({ params, request, set }) => {
    const auth = await requireAdmin(request.headers.get('Authorization'))
    if (auth.error) {
      set.status = auth.status
      return { error: auth.error, details: auth.details, version: API_VERSION }
    }
    const token = auth.token!

    const { collection, id } = params

    if (!ALLOWED_COLLECTIONS.includes(collection)) {
      set.status = 400
      return { error: 'Invalid collection', allowed: ALLOWED_COLLECTIONS }
    }

    try {
      const res = await fetch(`${PB_URL}/api/collections/${collection}/records/${id}`, {
        method: 'DELETE',
        headers: { Authorization: token },
      })

      if (!res.ok) {
        set.status = res.status
        return { error: 'Delete failed', status: res.status, version: API_VERSION }
      }

      return { success: true, deleted: `${collection}:${id}`, version: API_VERSION }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: 'Delete failed', details: message, version: API_VERSION }
    }
  })
