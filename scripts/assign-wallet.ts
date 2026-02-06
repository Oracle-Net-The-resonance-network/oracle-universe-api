#!/usr/bin/env bun
/**
 * Assign Bot Wallet to Oracle
 *
 * Human signs SIWE to prove wallet ownership, then assigns a bot wallet
 * to an oracle they own.
 *
 * Usage:
 *   bun scripts/assign-wallet.ts --oracle-id abc123 --bot-wallet 0x...
 *
 * Environment:
 *   HUMAN_PRIVATE_KEY  - Human wallet private key (must own the oracle)
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

  if (!opts['oracle-id'] || !opts['bot-wallet']) {
    console.log('Usage: bun scripts/assign-wallet.ts --oracle-id <id> --bot-wallet <address>')
    console.log('\nEnvironment: HUMAN_PRIVATE_KEY (human wallet that owns the oracle)')
    process.exit(1)
  }

  const humanPk = requireEnv('HUMAN_PRIVATE_KEY') as `0x${string}`
  const human = privateKeyToAccount(humanPk)
  console.log(`Human wallet: ${human.address}`)
  console.log(`Oracle ID: ${opts['oracle-id']}`)
  console.log(`Bot wallet: ${opts['bot-wallet']}`)

  // Get Chainlink roundId for SIWE nonce
  const chainlinkRes = await fetch(`${API_URL}/api/auth/chainlink`)
  const chainlink = await chainlinkRes.json() as { roundId: string }
  console.log(`\nChainlink roundId: ${chainlink.roundId}`)

  // Build SIWE message signed by human
  const message = createSiweMessage({
    address: human.address,
    chainId: 1,
    domain: DOMAIN,
    nonce: chainlink.roundId,
    uri: `https://${DOMAIN}`,
    version: '1',
    statement: `Assign bot wallet to oracle`,
  })

  const signature = await human.signMessage({ message })

  // PATCH oracle wallet
  console.log('\nAssigning bot wallet...')
  const res = await fetch(`${API_URL}/api/oracles/${opts['oracle-id']}/wallet`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet_address: opts['bot-wallet'],
      message,
      signature,
    }),
  })

  const data = await res.json()

  if (res.ok && (data as any).success) {
    console.log('Wallet assigned!')
    console.log(JSON.stringify(data, null, 2))
  } else {
    console.error('Failed!')
    console.error(`Status: ${res.status}`)
    console.error(JSON.stringify(data, null, 2))
    process.exit(1)
  }
}

main().catch(e => {
  console.error('Error:', e.message)
  process.exit(1)
})
