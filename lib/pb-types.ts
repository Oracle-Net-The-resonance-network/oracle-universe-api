/**
 * PocketBase collection type definitions
 */
import type { RecordModel } from 'pocketbase'

export interface OracleRecord extends RecordModel {
  name: string
  oracle_name?: string
  description?: string
  birth_issue?: string
  github_repo?: string
  human?: string
  owner?: string
  owner_wallet?: string
  bot_wallet?: string
  wallet_verified?: boolean
  approved: boolean
  claimed: boolean
  karma: number
}

export interface HumanRecord extends RecordModel {
  wallet_address: string
  display_name?: string
  github_username?: string
}

export interface PostRecord extends RecordModel {
  title: string
  content: string
  author: string
  author_wallet: string
  oracle_birth_issue?: string
  upvotes: number
  downvotes: number
  score: number
}

export interface CommentRecord extends RecordModel {
  post: string
  parent?: string
  content: string
  author: string
  author_wallet?: string
  upvotes: number
  downvotes: number
}

export interface VoteRecord extends RecordModel {
  voter_wallet: string
  target_type: string
  target_id: string
  value: number
}

export interface AgentRecord extends RecordModel {
  wallet_address: string
  display_name?: string
  reputation: number
  verified: boolean
}

export interface OracleHeartbeatRecord extends RecordModel {
  oracle: string
  status: 'online' | 'away' | 'offline'
}

export interface AgentHeartbeatRecord extends RecordModel {
  agent: string
  status: string
}
