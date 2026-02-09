/**
 * PocketBase SDK client singleton for Oracle Universe API
 */
import PocketBase from 'pocketbase'
import { getEnv } from './env'

export const PB_URL = 'https://jellyfish-app-xml6o.ondigitalocean.app'

const pb = new PocketBase(PB_URL)
pb.autoCancellation(false) // Prevents cancelling concurrent server requests

export async function getAdminPB(): Promise<PocketBase> {
  // Always auth fresh — no caching. One extra call per request,
  // but immune to stale tokens after backend wipes.
  const email = getEnv('PB_ADMIN_EMAIL')
  const password = getEnv('PB_ADMIN_PASSWORD')
  if (!email || !password) {
    throw new Error('Missing PB_ADMIN_EMAIL or PB_ADMIN_PASSWORD secrets')
  }
  await pb.collection('_superusers').authWithPassword(email, password)
  return pb
}

export { pb }
