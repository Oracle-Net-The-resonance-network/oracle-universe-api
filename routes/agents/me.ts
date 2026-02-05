/**
 * Agents me route - GET /api/agents/me
 */
import { Elysia } from 'elysia'
import { Agents } from '../../lib/endpoints'
import type { Agent } from './list'

export const agentsMeRoutes = new Elysia()
  // GET /api/agents/me - Current agent (requires auth)
  .get('/me', async ({ request, set }) => {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      set.status = 401
      return { error: 'Authentication required' }
    }

    try {
      // Forward auth to PocketBase
      const res = await fetch(Agents.me(), {
        headers: { Authorization: authHeader },
      })
      if (!res.ok) {
        set.status = 401
        return { error: 'Invalid authentication' }
      }
      const agent = (await res.json()) as Agent
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
