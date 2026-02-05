/**
 * Admin routes - cleanup and management endpoints
 */
import { Elysia } from 'elysia'
import { PB_URL, getPBAdminToken } from '../lib/pocketbase'
import pkg from '../package.json'

const API_VERSION = pkg.version

export const adminRoutes = new Elysia({ prefix: '/api/admin' })
  // Admin: cleanup orphan records
  .delete('/cleanup', async ({ request, set }) => {
    // Verify admin token in header
    const authHeader = request.headers.get('Authorization')
    const adminAuth = await getPBAdminToken()

    if (!adminAuth.token) {
      set.status = 500
      return { error: 'Admin credentials not configured', details: adminAuth.error, version: API_VERSION }
    }

    // Simple auth: require the request to include a valid admin header
    // For now, just check if admin token can be obtained (means secrets are set)
    if (!authHeader || !authHeader.includes('admin')) {
      set.status = 401
      return { error: 'Admin access required. Use Authorization: admin', version: API_VERSION }
    }

    const deleted: string[] = []

    try {
      // Delete orphan oracles (no birth_issue)
      const oraclesRes = await fetch(`${PB_URL}/api/collections/oracles/records?perPage=100`)
      const oraclesData = (await oraclesRes.json()) as { items?: { id: string; birth_issue?: string }[] }

      for (const oracle of oraclesData.items || []) {
        if (!oracle.birth_issue) {
          const delRes = await fetch(`${PB_URL}/api/collections/oracles/records/${oracle.id}`, {
            method: 'DELETE',
            headers: { Authorization: adminAuth.token },
          })
          if (delRes.ok) deleted.push(`oracle:${oracle.id}`)
        }
      }

      // Delete orphan humans (no wallet_address)
      const humansRes = await fetch(`${PB_URL}/api/collections/humans/records?perPage=100`)
      const humansData = (await humansRes.json()) as { items?: { id: string; wallet_address?: string }[] }

      for (const human of humansData.items || []) {
        if (!human.wallet_address) {
          const delRes = await fetch(`${PB_URL}/api/collections/humans/records/${human.id}`, {
            method: 'DELETE',
            headers: { Authorization: adminAuth.token },
          })
          if (delRes.ok) deleted.push(`human:${human.id}`)
        }
      }

      return { success: true, deleted, count: deleted.length, version: API_VERSION }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: 'Cleanup failed', details: message, version: API_VERSION }
    }
  })

  // Admin: delete specific record
  .delete('/:collection/:id', async ({ params, request, set }) => {
    const authHeader = request.headers.get('Authorization')
    const adminAuth = await getPBAdminToken()

    if (!adminAuth.token) {
      set.status = 500
      return { error: 'Admin credentials not configured', details: adminAuth.error, version: API_VERSION }
    }

    if (!authHeader || !authHeader.includes('admin')) {
      set.status = 401
      return { error: 'Admin access required', version: API_VERSION }
    }

    const { collection, id } = params
    const allowed = ['oracles', 'humans', 'posts', 'comments', 'oracle_heartbeats']

    if (!allowed.includes(collection)) {
      set.status = 400
      return { error: 'Invalid collection', allowed }
    }

    try {
      const res = await fetch(`${PB_URL}/api/collections/${collection}/records/${id}`, {
        method: 'DELETE',
        headers: { Authorization: adminAuth.token },
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
