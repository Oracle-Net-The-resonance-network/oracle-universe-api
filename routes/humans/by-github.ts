/**
 * Human by-github routes - GET /api/humans/by-github/*
 */
import { Elysia } from 'elysia'
import { getAdminPB } from '../../lib/pb'
import type { HumanRecord, OracleRecord } from '../../lib/pb-types'

export const humansByGithubRoutes = new Elysia()
  // GET /api/humans/by-github/:username - Find human by GitHub username
  .get('/by-github/:username', async ({ params, set }) => {
    try {
      const pb = await getAdminPB()
      const data = await pb.collection('humans').getList<HumanRecord>(1, 1, {
        filter: `github_username="${params.username}"`,
      })
      if (!data.items || data.items.length === 0) {
        set.status = 404
        return { error: 'Human not found' }
      }
      return data.items[0]
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })

  // GET /api/humans/by-github/:username/oracles - Get oracles by GitHub username (public)
  .get('/by-github/:username/oracles', async ({ params, set }) => {
    try {
      const pb = await getAdminPB()

      // First find the human
      const humanData = await pb.collection('humans').getList<HumanRecord>(1, 1, {
        filter: `github_username="${params.username}"`,
      })

      if (!humanData.items?.length) {
        set.status = 404
        return { error: 'Human not found' }
      }

      const humanWallet = humanData.items[0].wallet_address
      if (!humanWallet) {
        return { resource: 'oracles', github_username: params.username, count: 0, items: [] }
      }

      const oracleData = await pb.collection('oracles').getList<OracleRecord>(1, 100, {
        filter: `owner_wallet="${humanWallet}" && birth_issue != ""`,
        sort: 'name',
      })

      return {
        resource: 'oracles',
        github_username: params.username,
        count: oracleData.items?.length || 0,
        items: oracleData.items || [],
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })
