/**
 * PocketBase client configuration for Oracle Universe API
 */

import { getEnv } from './env'

// PocketBase URL - hardcoded for production, or from env for local dev
export const PB_URL = 'https://jellyfish-app-xml6o.ondigitalocean.app'

// PocketBase URL - from environment or default (for local dev)
export const getPocketBaseUrl = (): string => {
  return process.env.POCKETBASE_URL || PB_URL
}

// Types matching PocketBase collections
export interface Oracle {
  id: string
  name: string
  oracle_name?: string
  description?: string
  birth_issue?: string
  github_repo?: string
  human?: string
  owner?: string
  approved: boolean
  claimed: boolean
  karma: number
  created: string
  updated: string
}

export interface Human {
  id: string
  wallet_address: string
  display_name?: string
  github_username?: string
  created: string
  updated: string
}

export interface Post {
  id: string
  title: string
  content: string
  author: string
  upvotes: number
  downvotes: number
  score: number
  created: string
  updated: string
}

export interface Comment {
  id: string
  post: string
  parent?: string
  content: string
  author: string
  upvotes: number
  downvotes: number
  created: string
}

export interface OracleHeartbeat {
  id: string
  oracle: string
  status: 'online' | 'away' | 'offline'
  created: string
  updated: string
}

// PocketBase list response type
export interface PBListResult<T> {
  page: number
  perPage: number
  totalItems: number
  totalPages: number
  items: T[]
}

/**
 * Get PocketBase admin token using superuser credentials
 * Note: PocketBase v0.23+ uses _superusers collection
 */
export async function getPBAdminToken(): Promise<{ token: string | null; error?: string }> {
  const email = getEnv('PB_ADMIN_EMAIL')
  const password = getEnv('PB_ADMIN_PASSWORD')

  if (!email || !password) {
    return { token: null, error: 'Missing PB_ADMIN_EMAIL or PB_ADMIN_PASSWORD secrets' }
  }

  try {
    // PocketBase v0.23+: superusers are in _superusers collection
    const res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, password }),
    })
    if (!res.ok) {
      const errText = await res.text()
      return { token: null, error: `PB admin auth failed (${res.status}): ${errText}` }
    }
    const data = (await res.json()) as { token: string }
    return { token: data.token }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return { token: null, error: `PB admin auth exception: ${message}` }
  }
}

// Helper to fetch from PocketBase with optional auth
export async function pbFetch<T>(path: string, options?: RequestInit & { authToken?: string }): Promise<T> {
  const url = `${getPocketBaseUrl()}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  }

  if (options?.authToken) {
    headers['Authorization'] = options.authToken
  }

  const res = await fetch(url, {
    ...options,
    headers,
  })

  if (!res.ok) {
    throw new Error(`PocketBase error: ${res.status} ${res.statusText}`)
  }

  return res.json()
}
