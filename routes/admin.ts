/**
 * Admin routes - shared middleware and combined routes
 *
 * Dot-notation pattern:
 *   admin.ts          - This file: shared middleware + combines all admin sub-routes
 *   admin.cleanup.ts  - DELETE /cleanup - orphan record cleanup
 *   admin.records.ts  - DELETE /:collection/:id - delete specific record
 */
import { Elysia } from 'elysia'
import { getPBAdminToken } from '../lib/pocketbase'
import pkg from '../package.json'

// ═══════════════════════════════════════════════════════════════
// SHARED
// ═══════════════════════════════════════════════════════════════

export const API_VERSION = pkg.version

type AdminAuthResult =
  | { error: null; token: string; status?: never; details?: never }
  | { error: string; token?: never; status: number; details?: string }

/**
 * Verify admin authorization
 * Returns token if authorized, error if not
 */
export async function requireAdmin(authHeader: string | null): Promise<AdminAuthResult> {
  const adminAuth = await getPBAdminToken()

  if (!adminAuth.token) {
    return {
      error: 'Admin credentials not configured',
      status: 500,
      details: adminAuth.error,
    }
  }

  if (!authHeader || !authHeader.includes('admin')) {
    return {
      error: 'Admin access required. Use Authorization: admin',
      status: 401,
    }
  }

  return { error: null, token: adminAuth.token }
}

// ═══════════════════════════════════════════════════════════════
// SUB-ROUTES
// ═══════════════════════════════════════════════════════════════

import { adminCleanupRoutes } from './admin.cleanup'
import { adminRecordsRoutes } from './admin.records'

// Re-export for individual use
export { adminCleanupRoutes } from './admin.cleanup'
export { adminRecordsRoutes } from './admin.records'

// ═══════════════════════════════════════════════════════════════
// COMBINED ROUTES
// ═══════════════════════════════════════════════════════════════

export const adminRoutes = new Elysia({ prefix: '/api/admin' })
  .use(adminCleanupRoutes)
  .use(adminRecordsRoutes)
