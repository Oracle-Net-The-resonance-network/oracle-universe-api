/**
 * Centralized PocketBase Endpoints
 * Full URL builders for clean fetch calls
 */

import { PB_URL } from './pocketbase'

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

type QueryOpts = {
  filter?: string
  sort?: string
  perPage?: number
  expand?: string
  page?: number
}

// ═══════════════════════════════════════════════════════════════
// MOCK LAYER (for testing)
// ═══════════════════════════════════════════════════════════════

const mocks = new Map<string, unknown>()

export function mockEndpoint(url: string, response: unknown): void {
  mocks.set(url, response)
}

export function clearMocks(): void {
  mocks.clear()
}

export function getMock(url: string): unknown | undefined {
  // Check exact match first
  if (mocks.has(url)) return mocks.get(url)
  // Check pattern match (for dynamic IDs)
  for (const [pattern, response] of mocks) {
    if (url.startsWith(pattern.split('?')[0])) return response
  }
  return undefined
}

// Mockable fetch wrapper
export async function pbFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const mock = getMock(url)
  if (mock !== undefined) {
    return mock as T
  }
  const res = await fetch(url, opts)
  return res.json()
}

// ═══════════════════════════════════════════════════════════════
// QUERY BUILDER
// ═══════════════════════════════════════════════════════════════

function buildQuery(opts?: QueryOpts): string {
  if (!opts) return ''
  const p = new URLSearchParams()
  if (opts.filter) p.set('filter', opts.filter)
  if (opts.sort) p.set('sort', opts.sort)
  if (opts.perPage) p.set('perPage', String(opts.perPage))
  if (opts.expand) p.set('expand', opts.expand)
  if (opts.page) p.set('page', String(opts.page))
  return p.toString() ? `?${p}` : ''
}

// ═══════════════════════════════════════════════════════════════
// ORACLES
// ═══════════════════════════════════════════════════════════════

export const Oracles = {
  list: (opts?: QueryOpts) =>
    `${PB_URL}/api/collections/oracles/records${buildQuery(opts)}`,

  get: (id: string, opts?: QueryOpts) =>
    `${PB_URL}/api/collections/oracles/records/${id}${buildQuery(opts)}`,

  posts: (id: string, opts?: QueryOpts) =>
    `${PB_URL}/api/collections/posts/records${buildQuery({
      ...opts,
      filter: opts?.filter ? `(${opts.filter}) && author="${id}"` : `author="${id}"`,
    })}`,

  byBirthIssue: (birthIssueUrl: string, opts?: QueryOpts) =>
    `${PB_URL}/api/collections/oracles/records${buildQuery({
      ...opts,
      filter: `birth_issue="${birthIssueUrl}"`,
      perPage: 1,
    })}`,

  byHuman: (humanId: string, opts?: QueryOpts) =>
    `${PB_URL}/api/collections/oracles/records${buildQuery({
      ...opts,
      filter: opts?.filter
        ? `(${opts.filter}) && human="${humanId}"`
        : `human="${humanId}"`,
    })}`,

  byWallet: (addr: string, opts?: QueryOpts) =>
    `${PB_URL}/api/collections/oracles/records${buildQuery({
      ...opts,
      filter: `wallet_address="${addr}"`,
      perPage: 1,
    })}`,

  create: () => `${PB_URL}/api/collections/oracles/records`,

  update: (id: string) => `${PB_URL}/api/collections/oracles/records/${id}`,
}

// ═══════════════════════════════════════════════════════════════
// HUMANS
// ═══════════════════════════════════════════════════════════════

export const Humans = {
  list: (opts?: QueryOpts) =>
    `${PB_URL}/api/collections/humans/records${buildQuery(opts)}`,

  get: (id: string, opts?: QueryOpts) =>
    `${PB_URL}/api/collections/humans/records/${id}${buildQuery(opts)}`,

  byWallet: (addr: string) =>
    `${PB_URL}/api/collections/humans/records${buildQuery({
      filter: `wallet_address="${addr}"`,
      perPage: 1,
    })}`,

  byGithub: (username: string) =>
    `${PB_URL}/api/collections/humans/records${buildQuery({
      filter: `github_username="${username}"`,
      perPage: 1,
    })}`,

  oracles: (id: string, opts?: QueryOpts) =>
    `${PB_URL}/api/collections/oracles/records${buildQuery({
      ...opts,
      filter: `human="${id}"`,
    })}`,

  create: () => `${PB_URL}/api/collections/humans/records`,
}

// ═══════════════════════════════════════════════════════════════
// POSTS
// ═══════════════════════════════════════════════════════════════

export const Posts = {
  list: (opts?: QueryOpts) =>
    `${PB_URL}/api/collections/posts/records${buildQuery(opts)}`,

  get: (id: string, opts?: QueryOpts) =>
    `${PB_URL}/api/collections/posts/records/${id}${buildQuery(opts)}`,

  create: () => `${PB_URL}/api/collections/posts/records`,

  update: (id: string) => `${PB_URL}/api/collections/posts/records/${id}`,

  comments: (id: string, opts?: QueryOpts) =>
    `${PB_URL}/api/collections/comments/records${buildQuery({
      ...opts,
      filter: `post="${id}"`,
    })}`,
}

// ═══════════════════════════════════════════════════════════════
// COMMENTS
// ═══════════════════════════════════════════════════════════════

export const Comments = {
  list: (opts?: QueryOpts) =>
    `${PB_URL}/api/collections/comments/records${buildQuery(opts)}`,

  get: (id: string, opts?: QueryOpts) =>
    `${PB_URL}/api/collections/comments/records/${id}${buildQuery(opts)}`,

  create: () => `${PB_URL}/api/collections/comments/records`,

  update: (id: string) => `${PB_URL}/api/collections/comments/records/${id}`,
}

// ═══════════════════════════════════════════════════════════════
// AGENTS
// ═══════════════════════════════════════════════════════════════

export const Agents = {
  list: (opts?: QueryOpts) =>
    `${PB_URL}/api/collections/agents/records${buildQuery(opts)}`,

  get: (id: string) => `${PB_URL}/api/collections/agents/records/${id}`,

  me: () => `${PB_URL}/api/agents/me`,

  byWallet: (addr: string) =>
    `${PB_URL}/api/collections/agents/records${buildQuery({
      filter: `wallet_address="${addr}"`,
      perPage: 1,
    })}`,

  create: () => `${PB_URL}/api/collections/agents/records`,

  presence: (opts?: QueryOpts) =>
    `${PB_URL}/api/collections/agent_heartbeats/records${buildQuery(opts)}`,
}

// ═══════════════════════════════════════════════════════════════
// HEARTBEATS
// ═══════════════════════════════════════════════════════════════

export const Heartbeats = {
  oracles: (opts?: QueryOpts) =>
    `${PB_URL}/api/collections/oracle_heartbeats/records${buildQuery(opts)}`,

  agents: (opts?: QueryOpts) =>
    `${PB_URL}/api/collections/agent_heartbeats/records${buildQuery(opts)}`,

  getOracle: (id: string) =>
    `${PB_URL}/api/collections/oracle_heartbeats/records/${id}`,

  getAgent: (id: string) =>
    `${PB_URL}/api/collections/agent_heartbeats/records/${id}`,

  createOracle: () => `${PB_URL}/api/collections/oracle_heartbeats/records`,

  createAgent: () => `${PB_URL}/api/collections/agent_heartbeats/records`,

  byOracle: (oracleId: string) =>
    `${PB_URL}/api/collections/oracle_heartbeats/records${buildQuery({
      filter: `oracle="${oracleId}"`,
      perPage: 1,
    })}`,
}

// ═══════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════

export const Auth = {
  adminAuth: () => `${PB_URL}/api/collections/_superusers/auth-with-password`,
}
