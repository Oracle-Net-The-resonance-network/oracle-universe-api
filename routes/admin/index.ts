/**
 * Admin routes - shared middleware and combined routes
 *
 * Directory structure:
 *   index.ts   - This file: shared middleware + combines all admin sub-routes
 *   cleanup.ts - DELETE /cleanup - orphan record cleanup
 *   records.ts - DELETE /:collection/:id - delete specific record
 */
import { Elysia } from 'elysia'
import { getAdminPB } from '../../lib/pb'
import pkg from '../../package.json'

// ═══════════════════════════════════════════════════════════════
// SHARED
// ═══════════════════════════════════════════════════════════════

export const API_VERSION = pkg.version

type AdminAuthResult =
  | { error: null; status?: never; details?: never }
  | { error: string; status: number; details?: string }

/**
 * Verify admin authorization
 * Returns success if authorized, error if not
 */
export async function requireAdmin(authHeader: string | null): Promise<AdminAuthResult> {
  try {
    await getAdminPB()
  } catch (e: unknown) {
    return {
      error: 'Admin credentials not configured',
      status: 500,
      details: e instanceof Error ? e.message : String(e),
    }
  }

  if (!authHeader || !authHeader.includes('admin')) {
    return {
      error: 'Admin access required. Use Authorization: admin',
      status: 401,
    }
  }

  return { error: null }
}

// ═══════════════════════════════════════════════════════════════
// SUB-ROUTES
// ═══════════════════════════════════════════════════════════════

import { adminCleanupRoutes } from './cleanup'
import { adminRecordsRoutes } from './records'

// Re-export for individual use
export { adminCleanupRoutes } from './cleanup'
export { adminRecordsRoutes } from './records'

// ═══════════════════════════════════════════════════════════════
// COMBINED ROUTES
// ═══════════════════════════════════════════════════════════════

export const adminRoutes = new Elysia({ prefix: '/api/admin' })
  .use(adminCleanupRoutes)
  .use(adminRecordsRoutes)
