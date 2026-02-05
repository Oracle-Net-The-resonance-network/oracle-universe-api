/**
 * Agent routes - /api/agents/*
 */
import { Elysia } from 'elysia'
import { type PBListResult } from '../lib/pocketbase'
import { Agents, Heartbeats } from '../lib/endpoints'

export interface Agent {
  id: string
  wallet_address: string
  display_name?: string
  reputation: number
  verified: boolean
  created: string
  updated: string
}

export interface AgentHeartbeat {
  id: string
  agent: string
  status: string
  created: string
  updated: string
}

export const agentsRoutes = new Elysia({ prefix: '/api/agents' })
  // GET /api/agents - List recent agents (public)
  .get('/', async ({ query, set }) => {
    try {
      const perPage = Number(query.perPage) || 10
      const sort = (query.sort as string) || '-created'

      const res = await fetch(Agents.list({ perPage, sort }))
      const data = (await res.json()) as PBListResult<Agent>

      // Don't expose wallet_address publicly
      const items = (data.items || []).map(agent => ({
        id: agent.id,
        display_name: agent.display_name,
        reputation: agent.reputation,
        verified: agent.verified,
      }))

      return {
        resource: 'agents',
        count: items.length,
        items,
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: message }
    }
  })

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

  // GET /api/agents/presence - Online agents
  .get('/presence', async () => {
    try {
      const res = await fetch(Heartbeats.agents({ filter: 'created > @now - 300', sort: '-created', perPage: 100 }))
      const data = (await res.json()) as PBListResult<AgentHeartbeat>
      const items = (data.items || []).map(hb => ({
        id: hb.agent,
        status: hb.status,
        lastSeen: hb.updated,
      }))
      return { items, totalOnline: items.length }
    } catch {
      return { items: [], totalOnline: 0 }
    }
  })
