/**
 * Authentication utilities - JWT and SIWE
 *
 * Uses Web Crypto API for CF Workers compatibility.
 * All auth is SIWE (wallet signature) + custom JWT. No PocketBase passwords.
 */
import { recoverMessageAddress } from 'viem'
import { parseSiweMessage } from 'viem/siwe'

// Salt for JWT signing (fallback if SECRET_SALT not set)
export const DEFAULT_SALT = 'oracle-universe-dev-salt-change-in-production'

/**
 * Create a JWT token (signature-based, not password-based)
 * Uses HMAC-SHA256 for signing
 */
export async function createJWT(payload: Record<string, unknown>, secret = DEFAULT_SALT): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')

  const headerB64 = encode(header)
  const payloadB64 = encode({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400 * 7, // 7 days
  })

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${headerB64}.${payloadB64}`))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  return `${headerB64}.${payloadB64}.${sigB64}`
}

/**
 * Verify a SIWE (Sign-In With Ethereum) message + signature
 * Returns recovered wallet address and nonce, or null if invalid/expired
 */
export async function verifySIWE(message: string, signature: string): Promise<{
  wallet: string
  nonce: string
} | null> {
  try {
    const siwe = parseSiweMessage(message)
    if (!siwe.address || !siwe.nonce) return null

    // Check expiration if set
    if (siwe.expirationTime && new Date(siwe.expirationTime) < new Date()) return null
    if (siwe.notBefore && new Date(siwe.notBefore) > new Date()) return null

    const recovered = await recoverMessageAddress({
      message,
      signature: signature as `0x${string}`,
    })

    if (recovered.toLowerCase() !== siwe.address.toLowerCase()) return null

    return { wallet: recovered.toLowerCase(), nonce: siwe.nonce }
  } catch {
    return null
  }
}

/**
 * Verify a JWT token and return payload if valid
 * Returns null if invalid or expired
 */
export async function verifyJWT(token: string, secret = DEFAULT_SALT): Promise<Record<string, unknown> | null> {
  try {
    const [headerB64, payloadB64, sigB64] = token.split('.')
    if (!headerB64 || !payloadB64 || !sigB64) return null

    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    // Decode signature (restore base64 padding)
    const sigStr = atob(sigB64.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (sigB64.length % 4)) % 4))
    const sigArray = new Uint8Array([...sigStr].map(c => c.charCodeAt(0)))

    const valid = await crypto.subtle.verify('HMAC', key, sigArray, encoder.encode(`${headerB64}.${payloadB64}`))
    if (!valid) return null

    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null // Expired

    return payload
  } catch {
    return null
  }
}
