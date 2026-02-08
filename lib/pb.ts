/**
 * PocketBase SDK client singleton for Oracle Universe API
 */
import PocketBase from 'pocketbase'
import { getEnv } from './env'

export const PB_URL = 'https://jellyfish-app-xml6o.ondigitalocean.app'

const pb = new PocketBase(PB_URL)
pb.autoCancellation(false) // Prevents cancelling concurrent server requests

let lastAuthMs = 0

export async function getAdminPB(): Promise<PocketBase> {
  // Re-auth if token is missing, invalid, or older than 10 minutes
  // (CF Worker isolates can persist across requests with stale tokens)
  const stale = Date.now() - lastAuthMs > 10 * 60 * 1000
  if (pb.authStore.isValid && !stale) return pb

  const email = getEnv('PB_ADMIN_EMAIL')
  const password = getEnv('PB_ADMIN_PASSWORD')
  if (!email || !password) {
    throw new Error('Missing PB_ADMIN_EMAIL or PB_ADMIN_PASSWORD secrets')
  }
  await pb.collection('_superusers').authWithPassword(email, password)
  lastAuthMs = Date.now()
  return pb
}

export { pb }
