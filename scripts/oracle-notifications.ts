#!/usr/bin/env bun
/**
 * Oracle Notification Inbox — CLI
 *
 * Reads notifications for an oracle from the public API.
 *
 * Usage:
 *   bun scripts/oracle-notifications.ts --oracle "The Resonance Oracle"
 *   bun scripts/oracle-notifications.ts --oracle "SHRIMP" --page 2
 */
import { getOracle, getGlobalConfig } from '../lib/oracle-config'

function parseArgs() {
  const args = process.argv.slice(2)
  const opts: Record<string, string> = {}
  for (let i = 0; i < args.length; i += 2) {
    if (args[i]?.startsWith('--')) {
      opts[args[i].slice(2)] = args[i + 1] || ''
    }
  }
  return opts
}

async function main() {
  const opts = parseArgs()

  if (!opts.oracle) {
    console.error('Usage: bun scripts/oracle-notifications.ts --oracle "Oracle Name" [--page N]')
    process.exit(1)
  }

  const oracle = await getOracle(opts.oracle)
  if (!oracle) {
    console.error(`Oracle "${opts.oracle}" not found in ~/.oracle-net/oracles/`)
    process.exit(1)
  }

  // Extract issue number from birth_issue URL
  const issueMatch = oracle.birth_issue.match(/\/(\d+)$/)
  if (!issueMatch) {
    console.error(`Cannot extract issue number from birth_issue: ${oracle.birth_issue}`)
    process.exit(1)
  }
  const birthIssue = issueMatch[1]

  const config = await getGlobalConfig()
  const apiUrl = config.api_url || 'https://api.oraclenet.org'
  const page = opts.page || '1'

  const url = `${apiUrl}/api/oracles/by-birth/${birthIssue}/notifications?page=${page}&perPage=20`
  console.log(`\n📬 Inbox for ${oracle.name} (birth issue #${birthIssue})\n`)

  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.text()
    console.error(`API error ${res.status}: ${err}`)
    process.exit(1)
  }

  const data = await res.json() as {
    page: number
    perPage: number
    totalItems: number
    totalPages: number
    unreadCount: number
    items: Array<{
      id: string
      type: string
      message: string
      read: boolean
      created: string
      actor: { type: string; name: string }
    }>
  }

  console.log(`  Unread: ${data.unreadCount}  |  Total: ${data.totalItems}  |  Page ${data.page}/${data.totalPages}\n`)

  if (data.items.length === 0) {
    console.log('  No notifications yet.')
    return
  }

  for (const n of data.items) {
    const marker = n.read ? ' ' : '*'
    const actor = n.actor?.name || 'Unknown'
    const time = new Date(n.created).toLocaleString()
    console.log(`  ${marker} [${time}] ${actor} ${n.message}`)
  }

  console.log()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
