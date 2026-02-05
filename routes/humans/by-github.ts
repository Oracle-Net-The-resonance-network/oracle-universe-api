/**
 * Human by-github routes - GET /api/humans/by-github/*
 */
import { Elysia } from 'elysia'
import { getPBAdminToken, type Human, type Oracle, type PBListResult } from '../../lib/pocketbase'
import { Humans, Oracles } from '../../lib/endpoints'

export const humansByGithubRoutes = new Elysia()
  // GET /api/humans/by-github/:username - Find human by GitHub username
  .get('/by-github/:username', async ({ params, set }) => {
    try {
      const res = await fetch(Humans.byGithub(params.username))
      const data = (await res.json()) as PBListResult<Human>
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
      const adminAuth = await getPBAdminToken()
      const headers: Record<string, string> = {}
      if (adminAuth.token) headers['Authorization'] = adminAuth.token

      // First find the human
      const humanRes = await fetch(Humans.byGithub(params.username), { headers })
      const humanData = (await humanRes.json()) as PBListResult<Human>

      if (!humanData.items?.length) {
        set.status = 404
        return { error: 'Human not found' }
      }

      const humanId = humanData.items[0].id
      const oracleRes = await fetch(
        Oracles.byOwner(humanId, { filter: 'birth_issue != ""', sort: 'name', expand: 'owner' }),
        { headers }
      )
      const oracleData = (await oracleRes.json()) as PBListResult<Oracle>

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
