/**
 * Agents me route - GET /api/agents/me
 */
import { Elysia } from 'elysia'
import { verifyJWT, DEFAULT_SALT } from '../../lib/auth'
import { getAdminPB } from '../../lib/pb'
import type { AgentRecord } from '../../lib/pb-types'

export const agentsMeRoutes = new Elysia()
  // GET /api/agents/me - Current agent (requires auth)
  .get('/me', async ({ request, set }) => {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      set.status = 401
      return { error: 'Authentication required' }
    }

    try {
      const token = authHeader.replace(/^bearer\s+/i, '')
      const payload = await verifyJWT(token, DEFAULT_SALT)
      if (!payload?.sub) {
        set.status = 401
        return { error: 'Invalid authentication' }
      }

      const wallet = payload.sub as string
      const pb = await getAdminPB()
      const data = await pb.collection('agents').getList<AgentRecord>(1, 1, {
        filter: `wallet_address="${wallet}"`,
      })

      if (!data.items?.length) {
        set.status = 404
        return { error: 'Agent not found' }
      }

      const agent = data.items[0]
      return {
        id: agent.id,
        wallet_address: agent.wallet_address,
        display_name: agent.display_name,
        reputation: agent.reputation,
        verified: agent.verified,
      }
    } catch {
      set.status = 401
      return { error: 'Invalid authentication' }
    }
  })
