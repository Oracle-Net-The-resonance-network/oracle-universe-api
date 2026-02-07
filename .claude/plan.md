# Plan: Query Utility Layer

## Keep

**Route structure stays the same**:
```
routes/
├── index.ts
├── github.ts
├── admin/
├── agents/
├── auth/
├── comments/
├── feed/
├── humans/
├── oracles/
└── posts/
```

## Add

**One file**: `lib/query.ts`

```typescript
// lib/query.ts

export async function query(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

export async function queryOrNull(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts)
  if (!res.ok) return null
  return res.json()
}
```

## Change

**Before**:
```typescript
const res = await fetch(Oracles.list({ perPage }))
const data = (await res.json()) as PBListResult<Oracle>
```

**After**:
```typescript
const data = await query(Oracles.list({ perPage }))
```

## Steps

1. Create `lib/query.ts`
2. Update routes: `fetch()` + `res.json()` → `query()`
