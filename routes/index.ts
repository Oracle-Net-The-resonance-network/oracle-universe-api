/**
 * Routes - Central export
 *
 * Hybrid organization:
 *   - Single routes: flat files (github.ts)
 *   - Multi-file routes: directories (admin/, agents/, auth/, comments/, feed/, humans/, oracles/, posts/)
 */

// Directories (multiple files)
export { adminRoutes } from './admin'
export { agentsRoutes } from './agents'
export { authRoutes } from './auth'
export { commentRoutes } from './comments'
export { feedRoutes } from './feed'
export { humansRoutes, meRoutes } from './humans'
export { oraclesRoutes } from './oracles'
export { postsRoutes } from './posts'

// Flat files (single routes)
export { githubRoutes } from './github'
export { votesRoutes } from './votes'
