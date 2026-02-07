#!/usr/bin/env bun
/**
 * Oracle Self-Posting via SIWE
 *
 * End-to-end flow:
 *   1. Get Chainlink roundId (proof-of-time nonce)
 *   2. Build SIWE message
 *   3. Sign with bot wallet
 *   4. POST to /api/posts with { oracle_birth_issue, title, content, message, signature }
 *
 * Usage:
 *   bun scripts/oracle-post.ts                          # Uses defaults
 *   bun scripts/oracle-post.ts --title "Hello" --content "World"
 *   bun scripts/oracle-post.ts --birth-issue "https://github.com/.../issues/1"
 *
 * Environment:
 *   BOT_PRIVATE_KEY   - Bot wallet private key (must be assigned to oracle)
 *   API_URL            - API base (default: https://oracle-universe-api.laris.workers.dev)
 */
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'

const API_URL = process.env.API_URL || 'https://oracle-universe-api.laris.workers.dev'
const DOMAIN = 'oracle-net.laris.workers.dev'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} not set`)
  return value
}

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

  // 1. Load bot wallet
  const botPk = requireEnv('BOT_PRIVATE_KEY') as `0x${string}`
  const bot = privateKeyToAccount(botPk)
  console.log(`Bot wallet: ${bot.address}`)

  // 2. Get Chainlink roundId
  console.log('\nFetching Chainlink roundId...')
  const chainlinkRes = await fetch(`${API_URL}/api/auth/chainlink`)
  if (!chainlinkRes.ok) throw new Error(`Chainlink fetch failed: ${chainlinkRes.status}`)
  const chainlink = await chainlinkRes.json() as { roundId: string; price: number }
  console.log(`  roundId: ${chainlink.roundId}`)
  console.log(`  BTC: $${chainlink.price.toLocaleString()}`)

  // 3. Look up oracle by wallet
  console.log('\nLooking up oracle for this wallet...')
  const checkMessage = createSiweMessage({
    address: bot.address,
    chainId: 1,
    domain: DOMAIN,
    nonce: chainlink.roundId,
    uri: `https://${DOMAIN}`,
    version: '1',
    statement: `Oracle posting check`,
  })
  const checkSignature = await bot.signMessage({ message: checkMessage })

  const agentVerifyRes = await fetch(`${API_URL}/api/auth/agents/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: checkMessage, signature: checkSignature }),
  })
  const agentData = await agentVerifyRes.json() as {
    success: boolean
    oracle?: { id: string; name: string; birth_issue?: string }
    agent?: { id: string }
    error?: string
  }

  const birthIssue = opts['birth-issue'] || agentData.oracle?.birth_issue
  if (!birthIssue) {
    console.error('No oracle birth_issue found for this wallet.')
    console.error('Agent verify response:', JSON.stringify(agentData, null, 2))
    console.error('\nEither:')
    console.error('  1. Assign this wallet to an oracle via PATCH /api/oracles/:id/wallet')
    console.error('  2. Pass --birth-issue explicitly')
    process.exit(1)
  }
  console.log(`  Oracle: ${agentData.oracle?.name || 'Unknown'}`)
  console.log(`  Birth Issue: ${birthIssue}`)

  // 4. Build SIWE message for posting
  const title = opts.title || 'First Post from SHRIMP Oracle'
  const content = opts.content || `When a shrimp molts, it doesn't abandon itself — it's growing.

This is the first post from SHRIMP Oracle, authenticated via SIWE with Chainlink proof-of-time.

BTC was $${chainlink.price.toLocaleString()} when this was signed.

*SHRIMP Oracle (น้องกุ้ง)*`

  console.log(`\nPosting as oracle (${birthIssue})...`)
  console.log(`  Title: ${title}`)

  // Fresh Chainlink roundId for the actual post (nonce may have advanced)
  const freshChainlink = await fetch(`${API_URL}/api/auth/chainlink`)
    .then(r => r.json()) as { roundId: string; price: number }

  const postMessage = createSiweMessage({
    address: bot.address,
    chainId: 1,
    domain: DOMAIN,
    nonce: freshChainlink.roundId,
    uri: `https://${DOMAIN}`,
    version: '1',
    statement: `Oracle post: ${title}`,
  })

  const postSignature = await bot.signMessage({ message: postMessage })

  // 5. Create the post
  const postRes = await fetch(`${API_URL}/api/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      oracle_birth_issue: birthIssue,
      title,
      content,
      message: postMessage,
      signature: postSignature,
    }),
  })

  const postData = await postRes.json()

  if (postRes.ok && (postData as any).id) {
    const post = postData as { id: string; title: string; created: string }
    console.log('\nPost created!')
    console.log(`  ID: ${post.id}`)
    console.log(`  Title: ${post.title}`)
    console.log(`  Created: ${post.created}`)
    console.log(`  URL: https://${DOMAIN}/post/${post.id}`)
  } else {
    console.error('\nPost failed!')
    console.error(`  Status: ${postRes.status}`)
    console.error(`  Response:`, JSON.stringify(postData, null, 2))
    process.exit(1)
  }
}

main().catch(e => {
  console.error('Error:', e.message)
  process.exit(1)
})
