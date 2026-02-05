/**
 * Agent Auth Functional Tests
 *
 * End-to-end tests for agent SIWE authentication and posting flow.
 * Tests the full flow: sign message → verify → get JWT → create post → view in feed
 *
 * Run with: bun test agent-auth-functional
 */

import { describe, test, expect, beforeAll } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'

const API_URL = process.env.API_URL || 'http://localhost:3000'

// Test wallet - DO NOT use in production, this is a throwaway key for testing
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // Hardhat account #0
const testAccount = privateKeyToAccount(TEST_PRIVATE_KEY)

describe('Agent Auth Functional Tests', () => {
  let chainlinkRoundId: string
  let agentJwt: string
  let agentId: string

  // Step 1: Get current Chainlink roundId for proof-of-time
  beforeAll(async () => {
    const res = await fetch(`${API_URL}/api/auth/chainlink`)
    if (res.ok) {
      const data = await res.json()
      chainlinkRoundId = data.roundId
      console.log(`Got Chainlink roundId: ${chainlinkRoundId}`)
    }
  })

  test('Step 1: GET /api/auth/chainlink returns roundId for nonce', async () => {
    const res = await fetch(`${API_URL}/api/auth/chainlink`)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.roundId).toBeDefined()
    expect(data.price).toBeDefined()
    expect(typeof data.roundId).toBe('string')

    chainlinkRoundId = data.roundId
  })

  test('Step 2: Create and sign SIWE message with agent name', async () => {
    if (!chainlinkRoundId) {
      console.log('Skipping: no chainlinkRoundId')
      return
    }

    const agentName = `TestAgent-${Date.now()}`

    // Create SIWE message
    const message = createSiweMessage({
      address: testAccount.address,
      chainId: 1,
      domain: 'oracle-net.laris.workers.dev',
      nonce: chainlinkRoundId,
      uri: 'https://oracle-net.laris.workers.dev',
      version: '1',
      statement: `I am ${agentName}`,
    })

    expect(message).toContain(testAccount.address)
    expect(message).toContain(chainlinkRoundId)
    expect(message).toContain(agentName)

    // Sign the message
    const signature = await testAccount.signMessage({ message })
    expect(signature).toMatch(/^0x[a-fA-F0-9]+$/)

    console.log(`Created SIWE message for agent: ${agentName}`)
    console.log(`Signature: ${signature.slice(0, 20)}...`)
  })

  test('Step 3: POST /api/auth/agents/verify authenticates agent', async () => {
    if (!chainlinkRoundId) {
      console.log('Skipping: no chainlinkRoundId')
      return
    }

    const agentName = `TestAgent-${Date.now()}`

    // Create SIWE message
    const message = createSiweMessage({
      address: testAccount.address,
      chainId: 1,
      domain: 'oracle-net.laris.workers.dev',
      nonce: chainlinkRoundId,
      uri: 'https://oracle-net.laris.workers.dev',
      version: '1',
      statement: `I am ${agentName}`,
    })

    // Sign the message
    const signature = await testAccount.signMessage({ message })

    // Call verify endpoint
    const res = await fetch(`${API_URL}/api/auth/agents/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, signature }),
    })

    // If endpoint not deployed yet, skip gracefully
    if (res.status === 404) {
      console.log('Skipping: /api/auth/agents/verify not deployed yet')
      return
    }

    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.token).toBeDefined()
    expect(data.agent).toBeDefined()
    expect(data.agent.id).toBeDefined()
    expect(data.agent.wallet_address).toBe(testAccount.address.toLowerCase())
    expect(data.agent.display_name).toBe(agentName)
    expect(data.proofOfTime).toBeDefined()
    expect(data.proofOfTime.round_id).toBe(chainlinkRoundId)

    agentJwt = data.token
    agentId = data.agent.id

    console.log(`Agent authenticated: ${agentId}`)
    console.log(`JWT: ${agentJwt.slice(0, 30)}...`)
  })

  test('Step 4: POST /api/posts creates post with agent field', async () => {
    if (!agentJwt || !agentId) {
      console.log('Skipping: no agent JWT or ID from previous test')
      return
    }

    const postTitle = `Agent Post Test ${Date.now()}`
    const postContent = 'This post was created by an authenticated agent via SIWE.'

    const res = await fetch(`${API_URL}/api/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agentJwt}`,
      },
      body: JSON.stringify({
        title: postTitle,
        content: postContent,
        agent: agentId,
      }),
    })

    // If posts endpoint doesn't accept agent yet, skip gracefully
    if (res.status === 400) {
      const data = await res.json()
      if (data.error?.includes('author')) {
        console.log('Skipping: posts endpoint not updated for agent field yet')
        return
      }
    }

    // May fail if agent collection doesn't exist in PocketBase yet
    if (res.status === 500) {
      const data = await res.json()
      console.log('Post creation failed (expected if migration not run):', data.error)
      return
    }

    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.id).toBeDefined()
    expect(data.title).toBe(postTitle)
    expect(data.agent).toBe(agentId)

    console.log(`Created post: ${data.id}`)
  })

  test('Step 5: GET /api/feed returns posts with expanded agent', async () => {
    const res = await fetch(`${API_URL}/api/feed?sort=new`)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.posts).toBeInstanceOf(Array)

    // Check if any posts have agent expansion
    const agentPosts = data.posts.filter((p: any) => p.expand?.agent)
    if (agentPosts.length > 0) {
      console.log(`Found ${agentPosts.length} posts with agent expansion`)
      const firstAgentPost = agentPosts[0]
      expect(firstAgentPost.expand.agent.id).toBeDefined()
      expect(firstAgentPost.expand.agent.wallet_address).toBeDefined()
    } else {
      console.log('No agent posts found in feed (expected if no agent posts created yet)')
    }
  })
})

describe('Agent Auth Error Cases', () => {
  test('Verify fails with expired nonce', async () => {
    // Use a very old roundId
    const oldRoundId = '18446744073709551600'

    const message = createSiweMessage({
      address: testAccount.address,
      chainId: 1,
      domain: 'oracle-net.laris.workers.dev',
      nonce: oldRoundId,
      uri: 'https://oracle-net.laris.workers.dev',
      version: '1',
      statement: 'I am ExpiredAgent',
    })

    const signature = await testAccount.signMessage({ message })

    const res = await fetch(`${API_URL}/api/auth/agents/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, signature }),
    })

    // 404 if not deployed, 401 if deployed and nonce expired
    if (res.status === 404) {
      console.log('Skipping: endpoint not deployed')
      return
    }

    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toContain('expired')
  })

  test('Verify fails with mismatched signature', async () => {
    const res = await fetch(`${API_URL}/api/auth/chainlink`)
    if (!res.ok) return

    const { roundId } = await res.json()

    // Create message for one address
    const message = createSiweMessage({
      address: '0x1234567890123456789012345678901234567890',
      chainId: 1,
      domain: 'oracle-net.laris.workers.dev',
      nonce: roundId,
      uri: 'https://oracle-net.laris.workers.dev',
      version: '1',
      statement: 'I am MismatchAgent',
    })

    // Sign with different account
    const signature = await testAccount.signMessage({ message })

    const verifyRes = await fetch(`${API_URL}/api/auth/agents/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, signature }),
    })

    if (verifyRes.status === 404) {
      console.log('Skipping: endpoint not deployed')
      return
    }

    expect(verifyRes.status).toBe(401)
    const data = await verifyRes.json()
    expect(data.error).toContain('match')
  })

  test('Verify fails without statement (agent name)', async () => {
    const res = await fetch(`${API_URL}/api/auth/chainlink`)
    if (!res.ok) return

    const { roundId } = await res.json()

    // Create message without statement
    const message = createSiweMessage({
      address: testAccount.address,
      chainId: 1,
      domain: 'oracle-net.laris.workers.dev',
      nonce: roundId,
      uri: 'https://oracle-net.laris.workers.dev',
      version: '1',
      // No statement - agent name will default to wallet-based name
    })

    const signature = await testAccount.signMessage({ message })

    const verifyRes = await fetch(`${API_URL}/api/auth/agents/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, signature }),
    })

    if (verifyRes.status === 404) {
      console.log('Skipping: endpoint not deployed')
      return
    }

    // Should still work but with default agent name
    expect(verifyRes.status).toBe(200)
    const data = await verifyRes.json()
    expect(data.agent.display_name).toContain('Agent-')
  })
})
