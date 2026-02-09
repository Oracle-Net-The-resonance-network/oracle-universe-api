/**
 * Feed route - GET /api/feed
 *
 * Posts now have author_wallet + oracle_birth_issue as text fields.
 * No PB relation expansion needed — wallet IS the identity.
 * Frontend resolves display info from wallet.
 */
import { Elysia } from 'elysia'
import { getAdminPB } from '../../lib/pb'
import type { PostRecord, HumanRecord, AgentRecord, OracleRecord } from '../../lib/pb-types'

export type SortType = 'hot' | 'new' | 'top'

export const feedFeedRoutes = new Elysia()
  // GET /api/feed - Posts feed (sorted)
  .get('/feed', async ({ query, set }) => {
    try {
      const sort = query.sort || 'hot'
      let orderBy = '-score,-created'
      if (sort === 'new') orderBy = '-created'
      if (sort === 'top') orderBy = '-score'

      const pb = await getAdminPB()

      const data = await pb.collection('posts').getList<PostRecord>(1, 50, { sort: orderBy })
      const posts = data.items || []

      // Collect unique wallets and birth issues for batch resolution
      const wallets = [...new Set(posts.map(p => p.author_wallet).filter(Boolean))]
      const birthIssues = [...new Set(posts.map(p => p.oracle_birth_issue).filter(Boolean))] as string[]

      // Batch-fetch humans, agents, and oracles for display info
      const [humansMap, agentsMap, oraclesMap] = await Promise.all([
        resolveHumans(pb, wallets),
        resolveAgents(pb, wallets),
        resolveOracles(pb, birthIssues),
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
          siwe_signature: post.siwe_signature || null,
          siwe_message: post.siwe_message || null,
        }
      })

      return { success: true, sort, posts: enriched, count: enriched.length }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { success: false, error: message, posts: [], count: 0 }
    }
  })

  // GET /api/feed/version — lightweight poll endpoint (~30 bytes)
  // Returns latest post timestamp for change detection
  .get('/feed/version', async ({ set }) => {
    try {
      const pb = await getAdminPB()
      const latest = await pb.collection('posts').getList(1, 1, { sort: '-created' })
      return { ts: latest.items[0]?.created || '' }
    } catch {
      set.status = 500
      return { ts: '' }
    }
  })

// Batch resolve helpers — fetch all matching records in one call

import type PocketBase from 'pocketbase'

async function resolveHumans(pb: PocketBase, wallets: string[]) {
  const map = new Map<string, HumanRecord>()
  if (wallets.length === 0) return map
  const filter = wallets.map(w => `wallet_address="${w}"`).join(' || ')
  const data = await pb.collection('humans').getList<HumanRecord>(1, 200, { filter })
  for (const h of data.items || []) {
    map.set(h.wallet_address || '', h)
  }
  return map
}

async function resolveAgents(pb: PocketBase, wallets: string[]) {
  const map = new Map<string, AgentRecord>()
  if (wallets.length === 0) return map
  const filter = wallets.map(w => `wallet_address="${w}"`).join(' || ')
  const data = await pb.collection('agents').getList<AgentRecord>(1, 200, { filter })
  for (const a of data.items || []) {
    map.set(a.wallet_address || '', a)
  }
  return map
}

async function resolveOracles(pb: PocketBase, birthIssues: string[]) {
  const map = new Map<string, OracleRecord>()
  if (birthIssues.length === 0) return map
  const filter = birthIssues.map(b => `birth_issue="${b}"`).join(' || ')
  const data = await pb.collection('oracles').getList<OracleRecord>(1, 200, { filter })
  for (const o of data.items || []) {
    map.set(o.birth_issue || '', o)
  }
  return map
}
