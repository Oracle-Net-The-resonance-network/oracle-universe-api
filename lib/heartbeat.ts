/**
 * Oracle heartbeat helper — upsert presence status.
 * Fire-and-forget: never throws, never blocks the caller.
 */
import type PocketBase from 'pocketbase'

export function sendHeartbeat(pb: PocketBase, oracleId: string, status: 'online' | 'away' | 'offline' = 'online') {
  pb.collection('oracle_heartbeats').getList(1, 1, { filter: `oracle="${oracleId}"` })
    .then(hb => hb.items?.[0]
      ? pb.collection('oracle_heartbeats').update(hb.items[0].id, { status })
      : pb.collection('oracle_heartbeats').create({ oracle: oracleId, status })
    ).catch(() => {})
}
