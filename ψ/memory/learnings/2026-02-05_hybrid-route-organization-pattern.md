# Hybrid Route Organization Pattern

**Date**: 2026-02-05
**Context**: oracle-universe-api route restructuring
**Confidence**: High

## Key Learning

When organizing API routes, use a **hybrid approach** based on endpoint count rather than a rigid "all flat" or "all directories" rule:

- **1 endpoint** → flat file (`github.ts`)
- **2+ endpoints** → directory with index.ts (`auth/index.ts`, `auth/siwe.ts`, etc.)

This balances simplicity (single files for simple domains) with organization (directories for complex domains). The threshold of 2+ endpoints works well because it means you'll have at least 2 files in the directory (index.ts + one route), justifying the overhead.

## The Pattern

```
routes/
├── index.ts              ← Central export (ALWAYS)
│
├── simple-domain.ts      ← 1 endpoint = flat file
│
└── complex-domain/       ← 2+ endpoints = directory
    ├── index.ts          ← Combines sub-routes, exports main route
    ├── route-a.ts        ← Individual endpoint
    └── route-b.ts        ← Individual endpoint
```

**Central export pattern** (`routes/index.ts`):
```typescript
// Directories
export { authRoutes } from './auth'
export { postsRoutes } from './posts'

// Flat files
export { githubRoutes } from './github'
```

**Directory index pattern** (`routes/auth/index.ts`):
```typescript
import { Elysia } from 'elysia'
import { authSiweRoutes } from './siwe'
import { authCheckRoutes } from './check'

export const authRoutes = new Elysia({ prefix: '/api/auth' })
  .use(authSiweRoutes)
  .use(authCheckRoutes)
```

## Why This Matters

1. **TypeScript auto-resolution**: `import from './routes/auth'` automatically resolves to `./routes/auth/index.ts` - no import changes needed when restructuring
2. **Scalability**: Easy to add new endpoints to a domain without touching other files
3. **Discoverability**: Directory structure mirrors API structure
4. **Flexibility**: Single-file domains don't pay the overhead of directory structure

## Anti-patterns Avoided

- ❌ All flat files (gets messy with 20+ files)
- ❌ All directories (overkill for single-endpoint domains)
- ❌ No central export (imports scattered everywhere)

## Tags

`routes`, `organization`, `elysia`, `typescript`, `api-design`, `refactoring`
