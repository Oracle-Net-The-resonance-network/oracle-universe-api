/**
 * Human routes - combined
 *
 * Directory structure:
 *   index.ts      - This file: combines all human sub-routes
 *   me.ts         - GET /api/humans/me
 *   by-github.ts  - GET /api/humans/by-github/:username, GET /api/humans/by-github/:username/oracles
 *   oracles.ts    - GET /api/humans/:id/oracles
 *   my-oracles.ts - GET /api/me/oracles
 */
import { Elysia } from 'elysia'

import { humansMeRoutes } from './me'
import { humansByGithubRoutes } from './by-github'
import { humansOraclesRoutes } from './oracles'
import { meOraclesRoutes } from './my-oracles'

export const humansRoutes = new Elysia({ prefix: '/api/humans' })
  .use(humansMeRoutes)
  .use(humansByGithubRoutes)
  .use(humansOraclesRoutes)

export const meRoutes = new Elysia({ prefix: '/api/me' })
  .use(meOraclesRoutes)
