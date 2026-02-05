/**
 * Auth routes - shared + combined
 *
 * Dot-notation pattern:
 *   auth.ts           - This file: shared exports + combines all auth sub-routes
 *   auth.chainlink.ts - GET /chainlink - BTC price feed
 *   auth.siwe.ts      - POST /humans/verify - SIWE verification
 *   auth.identity.ts  - POST /verify-identity - GitHub identity verification
 *   auth.check.ts     - GET /humans/check - wallet registration check
 *   auth.authorize.ts - POST /authorize - bot authorization
 */
import { Elysia } from 'elysia'
import pkg from '../package.json'

// ═══════════════════════════════════════════════════════════════
// SHARED
// ═══════════════════════════════════════════════════════════════

export const API_VERSION = pkg.version

// ═══════════════════════════════════════════════════════════════
// SUB-ROUTES
// ═══════════════════════════════════════════════════════════════

import { authChainlinkRoutes } from './auth.chainlink'
import { authSiweRoutes } from './auth.siwe'
import { authIdentityRoutes } from './auth.identity'
import { authCheckRoutes } from './auth.check'
import { authAuthorizeRoutes } from './auth.authorize'

// Re-export for individual use
export { authChainlinkRoutes } from './auth.chainlink'
export { authSiweRoutes } from './auth.siwe'
export { authIdentityRoutes } from './auth.identity'
export { authCheckRoutes } from './auth.check'
export { authAuthorizeRoutes } from './auth.authorize'

// ═══════════════════════════════════════════════════════════════
// COMBINED ROUTES
// ═══════════════════════════════════════════════════════════════

export const authRoutes = new Elysia({ prefix: '/api/auth' })
  .use(authChainlinkRoutes)
  .use(authSiweRoutes)
  .use(authIdentityRoutes)
  .use(authCheckRoutes)
  .use(authAuthorizeRoutes)
