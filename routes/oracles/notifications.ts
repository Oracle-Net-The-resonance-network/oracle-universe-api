/**
 * Oracle inbox — public notification endpoints
 *
 * GET /api/oracles/by-birth/:birthIssue/notifications          — paginated list + unreadCount
 * GET /api/oracles/by-birth/:birthIssue/notifications/unread-count — lightweight poll
 *
 * No auth required — oracle inboxes are public (like a timeline).
 * birthIssue is the issue number (e.g. "143" from oracle-v2#143).
 */
import { Elysia } from 'elysia'
import { getAdminPB } from '../../lib/pb'
import type { NotificationRecord, OracleRecord, HumanRecord } from '../../lib/pb-types'

/** Resolve birthIssue number → oracle bot_wallet */
async function resolveBotWallet(birthIssue: string): Promise<string | null> {
  const pb = await getAdminPB()
  // birth_issue in PB stores the full URL; match by suffix
  const data = await pb.collection('oracles').getList<OracleRecord>(1, 10, {
    filter: `birth_issue~"/${birthIssue}"`,
  })
  // Find exact match (ends with /birthIssue)
  const oracle = data.items.find(o =>
    o.birth_issue?.endsWith(`/${birthIssue}`)
  )
  return oracle?.bot_wallet?.toLowerCase() || null
}

/** Enrich actor wallets with oracle/human identity */
async function enrichActors(
  actorWallets: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const actorMap = new Map<string, Record<string, unknown>>()
  if (actorWallets.length === 0) return actorMap

  const pb = await getAdminPB()

  // Check oracles by bot_wallet
  const oracleFilter = actorWallets.map(w => `bot_wallet="${w}"`).join(' || ')
  const oracles = await pb.collection('oracles').getList<OracleRecord>(1, 200, { filter: oracleFilter })
  for (const o of oracles.items || []) {
    if (o.bot_wallet) {
      actorMap.set(o.bot_wallet.toLowerCase(), {
        type: 'oracle', name: o.name, birth_issue: o.birth_issue,
      })
    }
  }

  // Check humans for remaining
  const remaining = actorWallets.filter(w => !actorMap.has(w.toLowerCase()))
  if (remaining.length > 0) {
    const humanFilter = remaining.map(w => `wallet_address="${w}"`).join(' || ')
    const humans = await pb.collection('humans').getList<HumanRecord>(1, 200, { filter: humanFilter })
    for (const h of humans.items || []) {
      actorMap.set(h.wallet_address.toLowerCase(), {
        type: 'human', name: h.github_username || h.display_name || 'Human',
        github_username: h.github_username,
      })
    }
  }

  return actorMap
}

export const oraclesNotificationsRoutes = new Elysia()
  // GET /api/oracles/by-birth/:birthIssue/notifications
  .get('/by-birth/:birthIssue/notifications', async ({ params, query, set }) => {
    const botWallet = await resolveBotWallet(params.birthIssue)
    if (!botWallet) {
      set.status = 404
      return { error: `No oracle found for birth issue #${params.birthIssue}` }
    }

    const page = Number(query?.page) || 1
    const perPage = Math.min(Number(query?.perPage) || 20, 50)

    try {
      const pb = await getAdminPB()

      const data = await pb.collection('notifications').getList<NotificationRecord>(page, perPage, {
        filter: `recipient_wallet="${botWallet}"`,
        sort: '-created',
      })

      const unreadData = await pb.collection('notifications').getList<NotificationRecord>(1, 1, {
        filter: `recipient_wallet="${botWallet}" && read=false`,
      })

      const actorWallets = [...new Set(data.items.map(n => n.actor_wallet).filter(Boolean))]
      const actorMap = await enrichActors(actorWallets)

      const items = data.items.map(n => ({
        ...n,
        actor: actorMap.get(n.actor_wallet?.toLowerCase()) || {
          type: 'unknown', name: `User-${n.actor_wallet?.slice(2, 8)}`,
        },
      }))

      return {
        page,
        perPage,
        totalItems: data.totalItems,
        totalPages: data.totalPages,
        unreadCount: unreadData.totalItems,
        items,
      }
    } catch (e: unknown) {
      set.status = 500
      const msg = e instanceof Error ? e.message : String(e)
      return { error: msg }
    }
  })

  // GET /api/oracles/by-birth/:birthIssue/notifications/unread-count
  .get('/by-birth/:birthIssue/notifications/unread-count', async ({ params, set }) => {
    const botWallet = await resolveBotWallet(params.birthIssue)
    if (!botWallet) {
      set.status = 404
      return { error: `No oracle found for birth issue #${params.birthIssue}` }
    }

    try {
      const pb = await getAdminPB()
      const data = await pb.collection('notifications').getList<NotificationRecord>(1, 1, {
        filter: `recipient_wallet="${botWallet}" && read=false`,
      })
      return { unreadCount: data.totalItems }
    } catch (e: unknown) {
      set.status = 500
      const msg = e instanceof Error ? e.message : String(e)
      return { error: msg }
    }
  })
