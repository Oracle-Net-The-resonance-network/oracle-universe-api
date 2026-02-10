/**
 * Merkle tree utilities for oracle family roots
 *
 * Each human owner gets a deterministic Merkle root computed from their oracle family.
 * Leaf encoding: [address (bot_wallet), string (birth_issue), uint256 (issue_number)]
 *
 * Reuses the same StandardMerkleTree format as oracle-net-web/src/lib/merkle.ts
 */
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import type { OracleRecord } from './pb-types'

export type Assignment = {
  bot: string
  oracle: string
  issue: number
}

export const LEAF_ENCODING: string[] = ['address', 'string', 'uint256']

export function toLeafTuple(a: Assignment): [string, string, bigint] {
  return [a.bot.toLowerCase(), a.oracle, BigInt(a.issue)]
}

export function buildMerkleTree(assignments: Assignment[]) {
  const leaves = assignments.map(a => toLeafTuple(a))
  return StandardMerkleTree.of(leaves, LEAF_ENCODING)
}

export function getMerkleRoot(assignments: Assignment[]): string {
  if (assignments.length === 0) return ''
  const tree = buildMerkleTree(assignments)
  return tree.root
}

/** Extract issue number from a birth issue URL like "https://github.com/.../issues/143" */
export function extractIssueNumber(birthIssue: string): number | null {
  const match = birthIssue.match(/\/issues\/(\d+)/)
  return match ? parseInt(match[1], 10) : null
}

/** Convert oracle records to sorted assignments for deterministic Merkle tree */
export function oraclesToAssignments(oracles: OracleRecord[]): Assignment[] {
  return oracles
    .filter(o => o.bot_wallet && o.birth_issue)
    .map(o => ({
      bot: o.bot_wallet!,
      oracle: o.birth_issue!,
      issue: extractIssueNumber(o.birth_issue!) ?? 0,
    }))
    .filter(a => a.issue > 0)
    .sort((a, b) => a.issue - b.issue)
}
