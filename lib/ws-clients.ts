/**
 * WebSocket client tracking + broadcast for real-time events.
 *
 * Global Set<WebSocket> scoped to CF Worker isolate.
 * Routes call broadcast() after mutations → all connected clients get notified.
 */

const clients = new Set<WebSocket>()

export function addClient(ws: WebSocket) {
  clients.add(ws)
}

export function removeClient(ws: WebSocket) {
  clients.delete(ws)
}

/** Broadcast an event to all connected WebSocket clients */
export function broadcast(event: { type: string; collection?: string; id?: string; recipient?: string }) {
  const msg = JSON.stringify(event)
  for (const ws of clients) {
    try {
      ws.send(msg)
    } catch {
      clients.delete(ws)
    }
  }
}
