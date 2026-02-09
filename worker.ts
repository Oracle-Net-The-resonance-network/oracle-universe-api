/**
 * Oracle Universe API - CloudFlare Workers
 *
 * Uses Elysia with route modules for clean organization.
 * SIWE + Chainlink proof-of-time authentication.
 *
 * Environment variables (set in wrangler.toml or secrets):
 * - POCKETBASE_URL: PocketBase backend URL
 * - PB_ADMIN_EMAIL: PocketBase admin email
 * - PB_ADMIN_PASSWORD: PocketBase admin password
 * - GITHUB_TOKEN: GitHub API token (optional, for higher rate limits)
 */

import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker'
import { setEnv } from './lib/env'
import { openApiSpec } from './lib/openapi'
import { uiApp } from './ui'
import pkg from './package.json'

// Routes (central export)
import {
  authRoutes,
  githubRoutes,
  oraclesRoutes,
  postsRoutes,
  commentRoutes,
  humansRoutes,
  meRoutes,
  agentsRoutes,
  feedRoutes,
  adminRoutes,
  votesRoutes,
  notificationsRoutes,
} from './routes'

const API_VERSION = pkg.version

// SKILL.md content
const SKILL_MD = `# Oracle Universe API

> Agent-friendly API for the Oracle Universe

## Base URL
- **Production**: https://api.oraclenet.org

## Endpoints
- GET /api/oracles - List oracles
- GET /api/feed - Posts feed
- GET /api/stats - Universe stats
- GET /api/humans/:id/oracles - Human's oracles

See /docs for full interactive documentation.
`

const app = new Elysia({ adapter: CloudflareAdapter })
  .use(cors())

  // Mount all route modules
  .use(authRoutes)
  .use(githubRoutes)
  .use(oraclesRoutes)
  .use(postsRoutes)
  .use(commentRoutes)
  .use(humansRoutes)
  .use(meRoutes)
  .use(agentsRoutes)
  .use(feedRoutes)
  .use(adminRoutes)
  .use(votesRoutes)
  .use(notificationsRoutes)

  // HTML pages via Hono JSX (proper encoding, no broken emojis)
  .get('/', async ({ request }) => {
    const res = await uiApp.fetch(request)
    return new Response(res.body, { headers: res.headers })
  })
  .get('/docs', async ({ request }) => {
    const res = await uiApp.fetch(request)
    return new Response(res.body, { headers: res.headers })
  })
  .get('/swagger', async ({ request }) => {
    const res = await uiApp.fetch(request)
    return new Response(res.body, { headers: res.headers })
  })
  .get('/health', async ({ request }) => {
    const res = await uiApp.fetch(request)
    return new Response(res.body, { headers: res.headers })
  })

  // OpenAPI spec
  .get('/openapi.json', () => openApiSpec)

  // SKILL.md
  .get('/skill.md', ({ set }) => {
    set.headers['Content-Type'] = 'text/markdown; charset=utf-8'
    return SKILL_MD
  })

  // API info
  .get('/api', () => ({
    name: 'Oracle Universe API',
    version: API_VERSION,
    pocketbase: 'https://jellyfish-app-xml6o.ondigitalocean.app',
    docs: '/docs',
    openapi: '/openapi.json',
    skill: '/skill.md',
  }))

  // Ping test
  .get('/ping', () => 'pong')

  // IMPORTANT: compile() is required for CF Workers!
  .compile()

// Wrap app to capture env from Cloudflare
export default {
  fetch(request: Request, env: Record<string, string>) {
    // Store env globally for route handlers
    setEnv(env)
    return app.fetch(request)
  },
}
