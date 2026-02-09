#!/usr/bin/env bun
/**
 * E2E test: Notification system + signature enforcement
 *
 * Tests:
 * 1. Signed post creation works
 * 2. Unsigned (JWT-only) comment is REJECTED
 * 3. Signed comment creates notification for post author
 * 4. Self-comment does NOT create notification
 * 5. Unread count increments correctly
 * 6. Mark-read works
 * 7. Mark-all-read works
 *
 * Usage: bun scripts/test-notifications.ts [--api URL]
 */
import { privateKeyToAccount } from 'viem/accounts'
import { createJWT, DEFAULT_SALT } from '../lib/auth'

const API_URL = process.argv.includes('--api')
  ? process.argv[process.argv.indexOf('--api') + 1]
  : 'https://api.oraclenet.org'

// Two test wallets (hardhat default keys — not real funds)
const WALLET_A = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const WALLET_B = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')

let passed = 0
let failed = 0

function ok(name: string) {
  passed++
  console.log(`  ✓ ${name}`)
}
function fail(name: string, reason: string) {
  failed++
  console.log(`  ✗ ${name}: ${reason}`)
}

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API_URL}${path}`, opts)
  const body = await res.json()
  return { status: res.status, body }
}

async function apiAuth(path: string, wallet: string, opts: RequestInit = {}) {
  const token = await createJWT({ sub: wallet, type: 'human' }, DEFAULT_SALT)
  return api(path, {
    ...opts,
    headers: { ...opts.headers as Record<string, string>, authorization: `Bearer ${token}` },
  })
}

async function main() {
  console.log(`\nNotification E2E Tests — ${API_URL}\n`)
  console.log(`Wallet A: ${WALLET_A.address}`)
  console.log(`Wallet B: ${WALLET_B.address}\n`)

  // ── 1. Create signed post from Wallet A ──
  console.log('1. Signed post creation')
  const postPayload = JSON.stringify({ title: 'Notif test', content: 'Testing notifications E2E' })
  const postSig = await WALLET_A.signMessage({ message: postPayload })
  const { status: postStatus, body: post } = await api('/api/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Notif test', content: 'Testing notifications E2E', signature: postSig }),
  })
  if (postStatus === 200 && post.id && post.siwe_signature) {
    ok(`Post created: ${post.id} (signed by ${post.author_wallet})`)
  } else {
    fail('Post creation', JSON.stringify(post))
    console.log('Cannot continue without a post. Aborting.')
    process.exit(1)
  }
  const postId = post.id

  // ── 2. Unsigned comment REJECTED ──
  console.log('\n2. Unsigned (JWT-only) comment rejected')
  const { status: unsignedStatus, body: unsignedBody } = await apiAuth(
    `/api/posts/${postId}/comments`,
    WALLET_B.address.toLowerCase(),
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'no sig' }) },
  )
  if (unsignedStatus === 401 && unsignedBody.error?.includes('Signature required')) {
    ok('JWT-only comment rejected with 401')
  } else {
    fail('Unsigned rejection', `status=${unsignedStatus} body=${JSON.stringify(unsignedBody)}`)
  }

  // ── 3. Signed comment from B → notification for A ──
  console.log('\n3. Signed comment creates notification')
  const commentContent = 'Great E2E test post!'
  const commentPayload = JSON.stringify({ content: commentContent, post: postId })
  const commentSig = await WALLET_B.signMessage({ message: commentPayload })
  const { status: commentStatus, body: comment } = await api(`/api/posts/${postId}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: commentContent, message: commentPayload, signature: commentSig }),
  })
  if (commentStatus === 200 && comment.id && comment.siwe_signature) {
    ok(`Comment created: ${comment.id} (signed by ${comment.author_wallet})`)
  } else {
    fail('Signed comment', JSON.stringify(comment))
  }

  // Check notification for Wallet A
  const { body: notifs } = await apiAuth('/api/notifications', WALLET_A.address.toLowerCase())
  const commentNotif = notifs.items?.find((n: any) => n.type === 'comment' && n.post_id === postId)
  if (commentNotif && commentNotif.actor_wallet === WALLET_B.address.toLowerCase()) {
    ok(`Notification created for post author (id: ${commentNotif.id})`)
  } else {
    fail('Notification creation', `items=${JSON.stringify(notifs.items)}`)
  }

  // ── 4. Self-comment → NO notification ──
  console.log('\n4. Self-comment suppression')
  const selfContent = 'My own reply'
  const selfPayload = JSON.stringify({ content: selfContent, post: postId })
  const selfSig = await WALLET_A.signMessage({ message: selfPayload })
  await api(`/api/posts/${postId}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: selfContent, message: selfPayload, signature: selfSig }),
  })
  const { body: afterSelf } = await apiAuth('/api/notifications/unread-count', WALLET_A.address.toLowerCase())
  // Should still be 1 (from B's comment), not 2
  if (afterSelf.unreadCount === 1) {
    ok('Self-comment did NOT create notification (unread still 1)')
  } else {
    fail('Self-suppression', `unreadCount=${afterSelf.unreadCount} (expected 1)`)
  }

  // ── 5. Unread count ──
  console.log('\n5. Unread count endpoint')
  const { body: countBody } = await apiAuth('/api/notifications/unread-count', WALLET_A.address.toLowerCase())
  if (countBody.unreadCount === 1) {
    ok(`Unread count: ${countBody.unreadCount}`)
  } else {
    fail('Unread count', `got ${countBody.unreadCount}, expected 1`)
  }

  // ── 6. Mark single read ──
  console.log('\n6. Mark notification read')
  if (commentNotif) {
    const { body: readBody } = await apiAuth(
      `/api/notifications/${commentNotif.id}/read`,
      WALLET_A.address.toLowerCase(),
      { method: 'PATCH' },
    )
    if (readBody.success) {
      ok('Mark-read succeeded')
    } else {
      fail('Mark-read', JSON.stringify(readBody))
    }
    const { body: afterRead } = await apiAuth('/api/notifications/unread-count', WALLET_A.address.toLowerCase())
    if (afterRead.unreadCount === 0) {
      ok('Unread count dropped to 0')
    } else {
      fail('After mark-read', `unreadCount=${afterRead.unreadCount}`)
    }
  }

  // ── 7. Mark all read ──
  console.log('\n7. Mark all read')
  // Create another comment to get a new unread
  const c2Content = 'Another comment'
  const c2Payload = JSON.stringify({ content: c2Content, post: postId })
  const c2Sig = await WALLET_B.signMessage({ message: c2Payload })
  await api(`/api/posts/${postId}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: c2Content, message: c2Payload, signature: c2Sig }),
  })
  const { body: beforeAll } = await apiAuth('/api/notifications/unread-count', WALLET_A.address.toLowerCase())
  if (beforeAll.unreadCount >= 1) {
    ok(`New unread: ${beforeAll.unreadCount}`)
  }
  const { body: markAllBody } = await apiAuth(
    '/api/notifications/read-all',
    WALLET_A.address.toLowerCase(),
    { method: 'PATCH' },
  )
  if (markAllBody.success) {
    ok(`Mark-all-read: ${markAllBody.marked} marked`)
  } else {
    fail('Mark-all-read', JSON.stringify(markAllBody))
  }
  const { body: afterAll } = await apiAuth('/api/notifications/unread-count', WALLET_A.address.toLowerCase())
  if (afterAll.unreadCount === 0) {
    ok('All notifications read (count = 0)')
  } else {
    fail('After mark-all', `unreadCount=${afterAll.unreadCount}`)
  }

  // ── Summary ──
  console.log(`\n${'─'.repeat(40)}`)
  console.log(`Results: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
  console.log('All tests passed!\n')
}

main().catch(e => { console.error(e); process.exit(1) })
