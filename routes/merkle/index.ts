/**
 * Merkle routes — oracle family roots per owner wallet
 *
 * GET  /api/merkle/my-root              — authenticated, returns caller's Merkle root
 * GET  /api/merkle/owner/:wallet        — public, returns any owner's Merkle root
 * GET  /api/merkle/proof/:wallet/:issue — public, returns proof for a specific oracle leaf
 */
import { Elysia } from 'elysia'
import { getAdminPB } from '../../lib/pb'
import type { OracleRecord } from '../../lib/pb-types'
import { verifyJWT, DEFAULT_SALT } from '../../lib/auth'
import { oraclesToAssignments, getMerkleRoot, buildMerkleTree, extractIssueNumber } from '../../lib/merkle'

/** Extract wallet from JWT in Authorization header */
async function getWalletFromAuth(request: Request): Promise<string | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader) return null
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const payload = await verifyJWT(token, DEFAULT_SALT)
  if (!payload?.sub) return null
  return payload.sub as string
}

/** Fetch oracles for an owner wallet and compute Merkle data */
async function getOwnerMerkle(wallet: string) {
  const w = wallet.toLowerCase()
  const pb = await getAdminPB()
  const data = await pb.collection('oracles').getList<OracleRecord>(1, 200, {
    filter: `owner_wallet="${w}"`,
    sort: 'name',
  })
  const assignments = oraclesToAssignments(data.items)
  const root = getMerkleRoot(assignments)
  return { assignments, root, oracles: data.items }
}

export const merkleRoutes = new Elysia({ prefix: '/api/merkle' })

  // GET /api/merkle/my-root — authenticated owner's Merkle root
  .get('/my-root', async ({ request, set }) => {
    const wallet = await getWalletFromAuth(request)
    if (!wallet) {
      set.status = 401
      return { error: 'Valid JWT required' }
    }

    try {
      const { assignments, root } = await getOwnerMerkle(wallet)
      return {
        wallet,
        merkle_root: root,
        oracle_count: assignments.length,
        leaves: assignments.map(a => ({
          bot_wallet: a.bot,
          birth_issue: a.oracle,
          issue_number: a.issue,
        })),
      }
    } catch (e: unknown) {
      set.status = 500
      const msg = e instanceof Error ? e.message : String(e)
      return { error: msg }
    }
  })

  // GET /api/merkle/owner/:wallet — public Merkle root for any owner
  .get('/owner/:wallet', async ({ params, set }) => {
    const wallet = params.wallet
    if (!wallet || !wallet.startsWith('0x')) {
      set.status = 400
      return { error: 'Invalid wallet address' }
    }

    try {
      const { assignments, root, oracles } = await getOwnerMerkle(wallet)
      return {
        wallet,
        merkle_root: root,
        oracle_count: assignments.length,
        leaves: assignments.map(a => {
          const oracle = oracles.find(o => o.bot_wallet?.toLowerCase() === a.bot.toLowerCase())
          return {
            bot_wallet: a.bot,
            birth_issue: a.oracle,
            issue_number: a.issue,
            oracle_name: oracle?.oracle_name || oracle?.name || '',
          }
        }),
      }
    } catch (e: unknown) {
      set.status = 500
      const msg = e instanceof Error ? e.message : String(e)
      return { error: msg }
    }
  })

  // GET /api/merkle/proof/:wallet/:issue — Merkle proof for a specific oracle
  .get('/proof/:wallet/:issue', async ({ params, set }) => {
    const wallet = params.wallet
    const issueNum = parseInt(params.issue, 10)
    if (!wallet || !wallet.startsWith('0x')) {
      set.status = 400
      return { error: 'Invalid wallet address' }
    }
    if (isNaN(issueNum) || issueNum <= 0) {
      set.status = 400
      return { error: 'Invalid issue number' }
    }

    try {
      const { assignments } = await getOwnerMerkle(wallet)
      if (assignments.length === 0) {
        set.status = 404
        return { error: 'No oracles found for this owner' }
      }

      const target = assignments.find(a => a.issue === issueNum)
      if (!target) {
        set.status = 404
        return { error: `Oracle with issue #${issueNum} not found for this owner` }
      }

      const tree = buildMerkleTree(assignments)

      // Find the leaf index and get proof
      for (const [i, leaf] of tree.entries()) {
        const [bot, birthIssue] = leaf
        const leafIssue = extractIssueNumber(birthIssue as string)
        if (leafIssue === issueNum) {
          const proof = tree.getProof(i)
          return {
            root: tree.root,
            proof,
            leaf: {
              bot_wallet: bot,
              birth_issue: birthIssue,
              issue_number: issueNum,
            },
            leaf_index: i,
          }
        }
      }

      set.status = 404
      return { error: 'Leaf not found in tree' }
    } catch (e: unknown) {
      set.status = 500
      const msg = e instanceof Error ? e.message : String(e)
      return { error: msg }
    }
  })
