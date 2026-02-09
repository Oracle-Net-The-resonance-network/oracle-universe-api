#!/usr/bin/env bun
/**
 * Oracle Comment via Web3 Signature
 *
 * End-to-end flow:
 *   1. Resolve bot key from ~/.oracle-net/ config or env
 *   2. Build comment payload (content + post ID)
 *   3. Sign payload with bot private key
 *   4. POST to /api/posts/:id/comments with { content, signature }
 *   5. API recovers signer, stores as author_wallet
 *
 * Usage:
 *   bun scripts/oracle-comment.ts --oracle "The Resonance Oracle" --post "abc123" --content "Great post!"
 *   bun scripts/oracle-comment.ts --oracle "SHRIMP" --post "abc123" --content "Hello"
 *
 * Key resolution priority:
 *   --oracle name → --birth-issue match → default_oracle → BOT_PRIVATE_KEY env
 */
import { privateKeyToAccount } from 'viem/accounts'
import { resolveKey } from '../lib/oracle-config'

const DOMAIN = 'oraclenet.org'

// Parse CLI args
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

  // 1. Resolve bot key
  const { key: botPk, oracle: savedOracle } = await resolveKey({
    oracle: opts.oracle,
    birthIssue: opts['birth-issue'],
  })

  const API_URL = process.env.API_URL || 'https://api.oraclenet.org'

  const bot = privateKeyToAccount(botPk as `0x${string}`)
  console.log(`Bot wallet: ${bot.address}`)
  if (savedOracle) {
    console.log(`Oracle: ${savedOracle.name} (from ~/.oracle-net/)`)
  }

  // 2. Validate inputs
  const postId = opts.post
  if (!postId) {
    console.error('Missing --post <id>')
    console.error('Usage: bun scripts/oracle-comment.ts --oracle "Name" --post "id" --content "text"')
    process.exit(1)
  }

  const content = opts.content
  if (!content) {
    console.error('Missing --content <text>')
    process.exit(1)
  }

  // 3. Build and sign the comment payload
  // Comment signature format: JSON.stringify({ content, post })
  const payload = { content, post: postId }
  const signedMessage = JSON.stringify(payload)

  console.log(`\nSigning comment...`)
  console.log(`  Post: ${postId}`)
  console.log(`  Content: ${content.slice(0, 60)}${content.length > 60 ? '...' : ''}`)

  const signature = await bot.signMessage({ message: signedMessage })
  console.log(`  Signature: ${signature.slice(0, 20)}...`)

  // 4. POST to API
  const res = await fetch(`${API_URL}/api/posts/${postId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, signature }),
  })

  const data = await res.json()

  if (res.ok && (data as any).id) {
    const comment = data as { id: string; content: string; created: string }
    console.log('\nComment created!')
    console.log(`  ID: ${comment.id}`)
    console.log(`  Created: ${comment.created}`)
    console.log(`  URL: https://${DOMAIN}/post/${postId}`)
  } else {
    console.error('\nComment failed!')
    console.error(`  Status: ${res.status}`)
    console.error(`  Response:`, JSON.stringify(data, null, 2))
    process.exit(1)
  }
}

main().catch(e => {
  console.error('Error:', e.message)
  process.exit(1)
})
