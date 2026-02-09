/**
 * Notification routes — inbox for wallet owners
 *
 * GET  /api/notifications           — paginated list + unreadCount
 * GET  /api/notifications/unread-count — lightweight poll endpoint
 * PATCH /api/notifications/:id/read  — mark one as read
 * PATCH /api/notifications/read-all  — mark all as read
 */
import { Elysia } from 'elysia'
import { getAdminPB } from '../../lib/pb'
import type { NotificationRecord, OracleRecord, HumanRecord } from '../../lib/pb-types'
import { verifyJWT, DEFAULT_SALT } from '../../lib/auth'

/** Extract wallet from JWT in Authorization header */
async function getWalletFromAuth(request: Request): Promise<string | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader) return null
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const payload = await verifyJWT(token, DEFAULT_SALT)
  if (!payload?.sub) return null
  return payload.sub as string
}

export const notificationsRoutes = new Elysia({ prefix: '/api/notifications' })
  // GET /api/notifications — paginated list for authenticated wallet
  .get('/', async ({ request, query, set }) => {
    const wallet = await getWalletFromAuth(request)
    if (!wallet) {
      set.status = 401
      return { error: 'Valid JWT required' }
    }

    const page = Number(query?.page) || 1
    const perPage = Math.min(Number(query?.perPage) || 20, 50)

    try {
      const pb = await getAdminPB()

      const data = await pb.collection('notifications').getList<NotificationRecord>(page, perPage, {
        filter: `recipient_wallet="${wallet}"`,
        sort: '-created',
      })

      // Count unread
      const unreadData = await pb.collection('notifications').getList<NotificationRecord>(1, 1, {
        filter: `recipient_wallet="${wallet}" && read=false`,
      })

      // Enrich actor info
      const actorWallets = [...new Set(data.items.map(n => n.actor_wallet).filter(Boolean))]
      const actorMap = new Map<string, Record<string, unknown>>()

      if (actorWallets.length > 0) {
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
      }

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

  // GET /api/notifications/unread-count — lightweight poll
  .get('/unread-count', async ({ request, set }) => {
    const wallet = await getWalletFromAuth(request)
    if (!wallet) {
      set.status = 401
      return { error: 'Valid JWT required' }
    }

    try {
      const pb = await getAdminPB()
      const data = await pb.collection('notifications').getList<NotificationRecord>(1, 1, {
        filter: `recipient_wallet="${wallet}" && read=false`,
      })
      return { unreadCount: data.totalItems }
    } catch (e: unknown) {
      set.status = 500
      const msg = e instanceof Error ? e.message : String(e)
      return { error: msg }
    }
  })

  // PATCH /api/notifications/:id/read — mark one as read
  .patch('/:id/read', async ({ params, request, set }) => {
    const wallet = await getWalletFromAuth(request)
    if (!wallet) {
      set.status = 401
      return { error: 'Valid JWT required' }
    }

    try {
      const pb = await getAdminPB()
      const notification = await pb.collection('notifications').getOne<NotificationRecord>(params.id)

      // Ownership check
      if (notification.recipient_wallet?.toLowerCase() !== wallet.toLowerCase()) {
        set.status = 403
        return { error: 'Not your notification' }
      }

      await pb.collection('notifications').update(params.id, { read: true })
      return { success: true }
    } catch (e: unknown) {
      set.status = 500
      const msg = e instanceof Error ? e.message : String(e)
      return { error: msg }
    }
  })

  // PATCH /api/notifications/read-all — mark all as read for wallet
  .patch('/read-all', async ({ request, set }) => {
    const wallet = await getWalletFromAuth(request)
    if (!wallet) {
      set.status = 401
      return { error: 'Valid JWT required' }
    }

    try {
      const pb = await getAdminPB()
      const unread = await pb.collection('notifications').getList<NotificationRecord>(1, 200, {
        filter: `recipient_wallet="${wallet}" && read=false`,
      })

      let marked = 0
      for (const n of unread.items) {
        await pb.collection('notifications').update(n.id, { read: true })
        marked++
      }

      return { success: true, marked }
    } catch (e: unknown) {
      set.status = 500
      const msg = e instanceof Error ? e.message : String(e)
      return { error: msg }
    }
  })
