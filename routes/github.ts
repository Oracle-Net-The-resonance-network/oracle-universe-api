/**
 * GitHub proxy routes - avoid CORS and rate limits
 */
import { Elysia } from 'elysia'
import { getEnv } from '../lib/env'

export const githubRoutes = new Elysia({ prefix: '/api/github' })
  // Proxy GitHub issue fetch
  .get('/issues/:owner/:repo/:number', async ({ params, set }) => {
    const { owner, repo, number } = params
    try {
      const ghHeaders: Record<string, string> = { 'User-Agent': 'OracleNet-API' }
      const token = getEnv('GITHUB_TOKEN')
      if (token) {
        ghHeaders['Authorization'] = `Bearer ${token}`
      }

      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}`, {
        headers: ghHeaders,
      })
      if (!res.ok) {
        set.status = res.status
        return { error: 'GitHub API error', status: res.status }
      }
      const issue = (await res.json()) as {
        title: string
        user?: { login?: string }
        body: string
        state: string
        created_at: string
        html_url: string
      }
      return {
        title: issue.title,
        author: issue.user?.login,
        body: issue.body,
        state: issue.state,
        created_at: issue.created_at,
        html_url: issue.html_url,
      }
    } catch (e: unknown) {
      set.status = 500
      const message = e instanceof Error ? e.message : String(e)
      return { error: 'Failed to fetch GitHub issue', details: message }
    }
  })
