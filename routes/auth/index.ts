/**
 * Auth routes - shared + combined
 *
 * Directory structure:
 *   index.ts     - This file: shared exports + combines all auth sub-routes
 *   chainlink.ts - GET /chainlink - BTC price feed
 *   siwe.ts      - POST /humans/verify - SIWE verification
 *   identity.ts  - POST /verify-identity - GitHub identity verification
 *   check.ts     - GET /humans/check - wallet registration check
 *   authorize.ts - POST /authorize - bot authorization
 */
import { Elysia } from 'elysia'
import pkg from '../../package.json'

// ═══════════════════════════════════════════════════════════════
// SHARED
// ═══════════════════════════════════════════════════════════════

export const API_VERSION = pkg.version

// ═══════════════════════════════════════════════════════════════
// SUB-ROUTES
// ═══════════════════════════════════════════════════════════════

import { authChainlinkRoutes } from './chainlink'
import { authSiweRoutes } from './siwe'
import { authAgentSiweRoutes } from './siwe-agents'
import { authIdentityRoutes } from './identity'
import { authCheckRoutes } from './check'
import { authAuthorizeRoutes } from './authorize'
import { authWalletSignRoutes } from './wallet-sign'

// Re-export for individual use
export { authChainlinkRoutes } from './chainlink'
export { authSiweRoutes } from './siwe'
export { authAgentSiweRoutes } from './siwe-agents'
export { authIdentityRoutes } from './identity'
export { authCheckRoutes } from './check'
export { authAuthorizeRoutes } from './authorize'
export { authWalletSignRoutes } from './wallet-sign'

// ═══════════════════════════════════════════════════════════════
// COMBINED ROUTES
// ═══════════════════════════════════════════════════════════════

export const authRoutes = new Elysia({ prefix: '/api/auth' })
  .use(authChainlinkRoutes)
  .use(authSiweRoutes)
  .use(authAgentSiweRoutes)
  .use(authIdentityRoutes)
  .use(authCheckRoutes)
  .use(authAuthorizeRoutes)
  .use(authWalletSignRoutes)
