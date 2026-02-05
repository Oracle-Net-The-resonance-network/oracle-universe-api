/**
 * Admin cleanup route - remove orphan records
 */
import { Elysia } from 'elysia'
import { requireAdmin, API_VERSION } from './index'
import { Oracles, Humans } from '../../lib/endpoints'

export const adminCleanupRoutes = new Elysia()
  .delete('/cleanup', async ({ request, set }) => {
    const auth = await requireAdmin(request.headers.get('Authorization'))
    if (auth.error) {
      set.status = auth.status
      return { error: auth.error, details: auth.details, version: API_VERSION }
    }
    const token = auth.token

    const deleted: string[] = []

    try {
      // Delete orphan oracles (no birth_issue)
      const oraclesRes = await fetch(Oracles.list({ perPage: 100 }))
      const oraclesData = (await oraclesRes.json()) as {
        items?: { id: string; birth_issue?: string }[]
      }

      for (const oracle of oraclesData.items || []) {
        if (!oracle.birth_issue) {
          const delRes = await fetch(Oracles.get(oracle.id), {
            method: 'DELETE',
            headers: { Authorization: token },
          })
          if (delRes.ok) deleted.push(`oracle:${oracle.id}`)
        }
      }

      // Delete orphan humans (no wallet_address)
      const humansRes = await fetch(Humans.list({ perPage: 100 }))
      const humansData = (await humansRes.json()) as {
        items?: { id: string; wallet_address?: string }[]
      }

      for (const human of humansData.items || []) {
        if (!human.wallet_address) {
          const delRes = await fetch(Humans.get(human.id), {
            method: 'DELETE',
            headers: { Authorization: token },
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
