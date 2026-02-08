/**
 * Admin cleanup route - remove orphan records
 */
import { Elysia } from 'elysia'
import { requireAdmin, API_VERSION } from './index'
import { getAdminPB } from '../../lib/pb'
import type { OracleRecord, HumanRecord } from '../../lib/pb-types'

export const adminCleanupRoutes = new Elysia()
  .delete('/cleanup', async ({ request, set }) => {
    const auth = await requireAdmin(request.headers.get('Authorization'))
    if (auth.error) {
      set.status = auth.status
      return { error: auth.error, details: auth.details, version: API_VERSION }
    }

    const deleted: string[] = []

    try {
      const pb = await getAdminPB()

      // Delete orphan oracles (no birth_issue)
      const oraclesData = await pb.collection('oracles').getList<OracleRecord>(1, 100)

      for (const oracle of oraclesData.items || []) {
        if (!oracle.birth_issue) {
          try {
            await pb.collection('oracles').delete(oracle.id)
            deleted.push(`oracle:${oracle.id}`)
          } catch { /* skip failures */ }
        }
      }

      // Delete orphan humans (no wallet_address)
      const humansData = await pb.collection('humans').getList<HumanRecord>(1, 100)

      for (const human of humansData.items || []) {
        if (!human.wallet_address) {
          try {
            await pb.collection('humans').delete(human.id)
            deleted.push(`human:${human.id}`)
          } catch { /* skip failures */ }
        }
      }

      return { success: true, deleted, count: deleted.length, version: API_VERSION }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: 'Cleanup failed', details: message, version: API_VERSION }
    }
  })
