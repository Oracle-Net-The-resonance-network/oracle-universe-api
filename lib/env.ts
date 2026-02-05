/**
 * Global environment storage for Cloudflare Workers
 *
 * CF Workers don't have process.env - env is passed to each fetch handler.
 * This module stores env globally so route handlers can access it.
 */

let globalEnv: Record<string, string> = {}

export function setEnv(env: Record<string, string>) {
  globalEnv = env
}

export function getEnv(key: string): string | undefined {
  return globalEnv[key]
}

export function getAllEnv(): Record<string, string> {
  return globalEnv
}
