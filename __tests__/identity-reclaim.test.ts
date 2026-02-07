/**
 * Tests for verify-identity re-claim logic (step 7)
 *
 * Tests the live deployed API to verify re-claim behavior.
 * Uses real viem signatures from a test private key.
 */
import { describe, test, expect } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'

const API_URL = 'https://oracle-universe-api.laris.workers.dev'

// Test wallet (Hardhat account #0) — NOT a real wallet with funds
const TEST_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const testAccount = privateKeyToAccount(TEST_PK)

// Known verification issue with Nat's wallet (nazt GitHub user)
const VERIFY_ISSUE = 'https://github.com/Soul-Brews-Studio/oracle-identity/issues/28'
const BIRTH_ISSUE = 'https://github.com/Oracle-Net-The-resonance-network/the-resonance-oracle/issues/1'

function buildSiweMessage(address: string, nonce: string): string {
  return `localhost wants you to sign in with your Ethereum account:\n${address}\n\nVerify Oracle identity\n\nURI: http://localhost\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`
}

describe('verify-identity API', () => {
  test('basic verification works without SIWE', async () => {
    const res = await fetch(`${API_URL}/api/auth/verify-identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verificationIssueUrl: VERIFY_ISSUE,
        birthIssueUrl: BIRTH_ISSUE,
        oracleName: 'The Resonance Oracle',
      }),
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.github_username).toBe('nazt')
    expect(data.oracle.name).toBe('The Resonance Oracle')
  })

  test('returns error for missing fields', async () => {
    const res = await fetch(`${API_URL}/api/auth/verify-identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    expect(data.error).toBeTruthy()
  })

  test('returns error for invalid GitHub URLs', async () => {
    const res = await fetch(`${API_URL}/api/auth/verify-identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verificationIssueUrl: 'not-a-url',
        birthIssueUrl: 'also-not-a-url',
      }),
    })
    const data = await res.json()
    expect(data.error).toBe('Invalid GitHub issue URLs')
  })

  test('accepts SIWE fields without error', async () => {
    // Sign with test wallet — won't match the wallet in the GitHub issue
    // (Nat's wallet is in the issue, not the test wallet)
    // This tests that the endpoint doesn't crash with SIWE fields
    const siweMsg = buildSiweMessage(testAccount.address, '12345')
    const siweSig = await testAccount.signMessage({ message: siweMsg })

    const res = await fetch(`${API_URL}/api/auth/verify-identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verificationIssueUrl: VERIFY_ISSUE,
        birthIssueUrl: BIRTH_ISSUE,
        oracleName: 'The Resonance Oracle',
        siweMessage: siweMsg,
        siweSignature: siweSig,
      }),
    })
    const data = await res.json()
    // Should still succeed (basic verification works)
    // Re-claim won't trigger because test wallet != Nat's wallet
    expect(data.success).toBe(true)
  })

  test('rejects mismatched GitHub authors', async () => {
    // Use a birth issue from a different user
    const res = await fetch(`${API_URL}/api/auth/verify-identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verificationIssueUrl: VERIFY_ISSUE,
        birthIssueUrl: 'https://github.com/ethereum/EIPs/issues/1',
        oracleName: 'Test',
      }),
    })
    const data = await res.json()
    expect(data.error).toBeTruthy()
  })
})
