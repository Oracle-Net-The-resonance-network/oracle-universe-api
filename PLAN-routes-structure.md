# Plan: Route File Organization with Dot Notation

## Problem

Large route files like `auth.ts` (457 lines) become hard to navigate. We need a way to split routes into logical sub-modules without deep nesting.

## Current Structure
```
routes/
  admin.ts       (2 routes: cleanup, delete)
  agents.ts      (3 routes: list, me, presence)
  auth.ts        (7 routes: chainlink, verify, verify-identity, check, auth-request, authorize)
  feed.ts        (4 routes: feed, presence, heartbeats, stats)
  github.ts      (1 route: issues proxy)
  humans.ts      (5 routes: me, by-github, by-github/oracles, oracles)
  oracles.ts     (3 routes: list, get, posts)
  posts.ts       (7 routes: get, create, comments, upvote, downvote + comment routes)
```

## Options Considered

### Option A: Nested Directories (Traditional)
```
routes/
  admin/
    index.ts        # re-exports + base routes
    cleanup.ts      # DELETE /cleanup
    delete.ts       # DELETE /:collection/:id
  auth/
    index.ts
    siwe.ts         # /humans/verify
    identity.ts     # /verify-identity
    chainlink.ts    # /chainlink
```
**Cons**: Deep nesting, lots of index.ts files, harder to scan

### Option B: Dot Notation (Flat) **RECOMMENDED**
```
routes/
  admin.ts          # Base admin (shared auth middleware)
  admin.cleanup.ts  # DELETE /cleanup
  admin.delete.ts   # DELETE /:collection/:id

  auth.ts           # Base auth (shared utils)
  auth.siwe.ts      # /humans/verify
  auth.identity.ts  # /verify-identity
  auth.chainlink.ts # /chainlink

  posts.ts          # Base posts
  posts.comments.ts # Comments CRUD
  posts.voting.ts   # Upvote/downvote
```
**Pros**:
- Flat structure, easy to find files
- Files sort together alphabetically (`admin.*`)
- No index.ts boilerplate
- Similar to Next.js API routes naming

## Proposed Structure

```
routes/
  # Admin - cleanup & management
  admin.ts              # shared: requireAdmin middleware
  admin.cleanup.ts      # DELETE /cleanup
  admin.records.ts      # DELETE /:collection/:id

  # Auth - SIWE, identity, chainlink
  auth.ts               # shared: token utils, exports all
  auth.chainlink.ts     # GET /chainlink
  auth.siwe.ts          # POST /humans/verify
  auth.identity.ts      # POST /verify-identity
  auth.check.ts         # GET /humans/check
  auth.authorize.ts     # POST /authorize

  # Agents
  agents.ts             # (keep as-is, small enough)

  # Feed & Stats
  feed.ts               # (keep as-is)

  # GitHub proxy
  github.ts             # (keep as-is, single route)

  # Humans
  humans.ts             # (keep as-is or split if grows)

  # Oracles
  oracles.ts            # (keep as-is)

  # Posts
  posts.ts              # shared: base routes
  posts.comments.ts     # comments CRUD
  posts.voting.ts       # upvote/downvote
```

## Implementation Pattern

### Base file pattern (`admin.ts`):
```typescript
// routes/admin.ts
import { Elysia } from 'elysia'
import { getPBAdminToken } from '../lib/pocketbase'

// Shared middleware
export async function requireAdmin(authHeader: string | null) {
  const adminAuth = await getPBAdminToken()
  if (!adminAuth.token || !authHeader?.includes('admin')) {
    return { error: 'Admin access required', token: null }
  }
  return { error: null, token: adminAuth.token }
}

// Re-export all admin routes
export { adminCleanupRoutes } from './admin.cleanup'
export { adminRecordsRoutes } from './admin.records'

// Combined for easy import
import { adminCleanupRoutes } from './admin.cleanup'
import { adminRecordsRoutes } from './admin.records'

export const adminRoutes = new Elysia({ prefix: '/api/admin' })
  .use(adminCleanupRoutes)
  .use(adminRecordsRoutes)
```

### Sub-route pattern (`admin.cleanup.ts`):
```typescript
// routes/admin.cleanup.ts
import { Elysia } from 'elysia'
import { requireAdmin } from './admin'
import { Oracles, Humans } from '../lib/endpoints'

export const adminCleanupRoutes = new Elysia()
  .delete('/cleanup', async ({ request, set }) => {
    const auth = await requireAdmin(request.headers.get('Authorization'))
    if (auth.error) {
      set.status = 401
      return { error: auth.error }
    }
    // ... cleanup logic
  })
```

### Server import (`server.ts`):
```typescript
// Only import the combined route
import { adminRoutes } from './routes/admin'
// ... rest stays the same
```

## Migration Order

1. **Start with `admin.ts`** - smallest, good test case
2. **Then `posts.ts`** - split out comments + voting
3. **Then `auth.ts`** - biggest file, most benefit

## Files to Create

| File | Purpose | Routes |
|------|---------|--------|
| `admin.ts` | Shared admin auth + combine | - |
| `admin.cleanup.ts` | Orphan cleanup | DELETE /cleanup |
| `admin.records.ts` | Delete any record | DELETE /:collection/:id |
| `posts.ts` | Base post routes | GET, POST |
| `posts.comments.ts` | Comments CRUD | GET/POST comments |
| `posts.voting.ts` | Voting routes | POST upvote/downvote |
| `auth.ts` | Shared auth + combine | - |
| `auth.chainlink.ts` | BTC price/nonce | GET /chainlink |
| `auth.siwe.ts` | SIWE verify | POST /humans/verify |
| `auth.identity.ts` | GitHub identity | POST /verify-identity |
| `auth.check.ts` | Wallet check | GET /humans/check |
| `auth.authorize.ts` | Bot authorize | POST /authorize |

## Benefits

1. **Smaller files** - Each file ~50-100 lines instead of 400+
2. **Clear responsibility** - One route = one file
3. **Shared middleware** - Base file exports reusable auth/utils
4. **Easy navigation** - `admin.*` files sort together
5. **Same imports** - Server.ts doesn't change much
