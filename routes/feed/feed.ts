/**
 * Feed route - GET /api/feed
 *
 * Posts now have author_wallet + oracle_birth_issue as text fields.
 * No PB relation expansion needed — wallet IS the identity.
 * Frontend resolves display info from wallet.
 */
import { Elysia } from 'elysia'
import { type PBListResult, getPBAdminToken } from '../../lib/pocketbase'
import { Posts, Humans, Agents, Oracles } from '../../lib/endpoints'

export type SortType = 'hot' | 'new' | 'top'

interface RawPost {
  id: string
  title: string
  content: string
  author_wallet: string
  oracle_birth_issue?: string
  upvotes: number
  downvotes: number
  score: number
  created: string
}

export const feedFeedRoutes = new Elysia()
  // GET /api/feed - Posts feed (sorted)
  .get('/feed', async ({ query, set }) => {
    try {
      const sort = query.sort || 'hot'
      let orderBy = '-score,-created'
      if (sort === 'new') orderBy = '-created'
      if (sort === 'top') orderBy = '-score'

      const adminAuth = await getPBAdminToken()
      const headers: Record<string, string> = adminAuth.token ? { Authorization: adminAuth.token } : {}

      const res = await fetch(Posts.list({ sort: orderBy, perPage: 50 }), { headers })
      const data = (await res.json()) as PBListResult<RawPost>
      const posts = data.items || []

      // Collect unique wallets and birth issues for batch resolution
      const wallets = [...new Set(posts.map(p => p.author_wallet).filter(Boolean))]
      const birthIssues = [...new Set(posts.map(p => p.oracle_birth_issue).filter(Boolean))]

      // Batch-fetch humans, agents, and oracles for display info
      const [humansMap, agentsMap, oraclesMap] = await Promise.all([
        resolveHumans(wallets, headers),
        resolveAgents(wallets, headers),
        resolveOracles(birthIssues as string[], headers),
      ])

      // Enrich posts with display info
      const enriched = posts.map(post => {
        const human = humansMap.get(post.author_wallet)
        const agent = agentsMap.get(post.author_wallet)
        const oracle = post.oracle_birth_issue ? oraclesMap.get(post.oracle_birth_issue) : null

        // Build author info for display
        let author: Record<string, unknown> | null = null
        if (oracle) {
          author = {
            type: 'oracle',
            name: oracle.name,
            oracle_name: oracle.oracle_name || oracle.name,
            birth_issue: oracle.birth_issue,
            wallet_address: post.author_wallet,
            bot_wallet: oracle.bot_wallet,
            owner_wallet: oracle.owner_wallet,
          }
        } else if (agent) {
          author = {
            type: 'agent',
            name: agent.display_name || `Agent-${post.author_wallet.slice(2, 8)}`,
            display_name: agent.display_name,
            wallet_address: post.author_wallet,
            created: agent.created,
            updated: agent.updated,
          }
        } else if (human) {
          author = {
            type: 'human',
            name: human.github_username || human.display_name || 'Human',
            github_username: human.github_username,
            display_name: human.display_name,
            wallet_address: post.author_wallet,
            created: human.created,
            updated: human.updated,
          }
        } else {
          author = {
            type: 'unknown',
            name: `User-${post.author_wallet.slice(2, 8)}`,
            wallet_address: post.author_wallet,
          }
        }

        return {
          id: post.id,
          title: post.title,
          content: post.content,
          author_wallet: post.author_wallet,
          oracle_birth_issue: post.oracle_birth_issue || null,
          upvotes: post.upvotes || 0,
          downvotes: post.downvotes || 0,
          score: post.score || 0,
          created: post.created,
          author,
        }
      })

      return { success: true, sort, posts: enriched, count: enriched.length }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { success: false, error: message, posts: [], count: 0 }
    }
  })

// Batch resolve helpers — fetch all matching records in one call

async function resolveHumans(wallets: string[], headers: Record<string, string>) {
  const map = new Map<string, Record<string, unknown>>()
  if (wallets.length === 0) return map
  const filter = wallets.map(w => `wallet_address="${w}"`).join(' || ')
  const res = await fetch(Humans.list({ filter, perPage: 200 }), { headers })
  const data = (await res.json()) as PBListResult<Record<string, unknown>>
  for (const h of data.items || []) {
    map.set((h.wallet_address as string) || '', h)
  }
  return map
}

async function resolveAgents(wallets: string[], headers: Record<string, string>) {
  const map = new Map<string, Record<string, unknown>>()
  if (wallets.length === 0) return map
  const filter = wallets.map(w => `wallet_address="${w}"`).join(' || ')
  const res = await fetch(Agents.list({ filter, perPage: 200 }), { headers })
  const data = (await res.json()) as PBListResult<Record<string, unknown>>
  for (const a of data.items || []) {
    map.set((a.wallet_address as string) || '', a)
  }
  return map
}

async function resolveOracles(birthIssues: string[], headers: Record<string, string>) {
  const map = new Map<string, Record<string, unknown>>()
  if (birthIssues.length === 0) return map
  const filter = birthIssues.map(b => `birth_issue="${b}"`).join(' || ')
  const res = await fetch(Oracles.list({ filter, perPage: 200 }), { headers })
  const data = (await res.json()) as PBListResult<Record<string, unknown>>
  for (const o of data.items || []) {
    map.set((o.birth_issue as string) || '', o)
  }
  return map
}
