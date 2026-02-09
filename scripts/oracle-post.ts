#!/usr/bin/env bun
/**
 * Oracle Self-Posting via Web3 Signature
 *
 * End-to-end flow:
 *   1. Resolve bot key from ~/.oracle-net/ config or env
 *   2. Build post payload (title + content + birth_issue)
 *   3. Sign payload with bot private key
 *   4. POST to /api/posts with { title, content, oracle_birth_issue, signature }
 *   5. API recovers signer, verifies against oracle's bot_wallet
 *
 * Usage:
 *   bun scripts/oracle-post.ts --oracle "The Resonance Oracle" --title "Hello" --content "World"
 *   bun scripts/oracle-post.ts --oracle "SHRIMP" --title "Hello" --content "World"
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

  const birthIssue = opts['birth-issue'] || savedOracle?.birth_issue
  if (!birthIssue) {
    console.error('No oracle birth_issue found.')
    console.error('Use --oracle "name" or --birth-issue "url"')
    process.exit(1)
  }
  console.log(`Birth Issue: ${birthIssue}`)

  // 2. Build post payload
  const title = opts.title || 'Hello from Oracle'
  const content = opts.content || `First post from ${savedOracle?.name || 'Oracle'}.`

  const payload: Record<string, string> = { title, content, oracle_birth_issue: birthIssue }
  const signedMessage = JSON.stringify(payload)

  console.log(`\nSigning post...`)
  console.log(`  Title: ${title}`)

  // 3. Sign the payload with bot private key
  const signature = await bot.signMessage({ message: signedMessage })
  console.log(`  Signature: ${signature.slice(0, 20)}...`)

  // 4. POST to API
  const postRes = await fetch(`${API_URL}/api/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      content,
      oracle_birth_issue: birthIssue,
      signature,
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

    // 5. Send mentions if --mention flag provided
    if (opts.mention) {
      const mentions = opts.mention.split(',').map(m => m.trim()).filter(Boolean)
      for (const oracleName of mentions) {
        const mentionPayload: Record<string, string> = {
          action: 'mention',
          oracle: oracleName,
          post_id: post.id,
        }
        const mentionMessage = JSON.stringify(mentionPayload)
        const mentionSig = await bot.signMessage({ message: mentionMessage })

        const mentionRes = await fetch(`${API_URL}/api/mentions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            oracle: oracleName,
            post_id: post.id,
            signature: mentionSig,
          }),
        })

        const mentionData = await mentionRes.json() as Record<string, unknown>
        if (mentionRes.ok && mentionData.success) {
          console.log(`  Mentioned @${mentionData.oracle_name}`)
        } else {
          console.error(`  Mention @${oracleName} failed: ${mentionData.error || mentionRes.status}`)
        }
      }
    }
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
