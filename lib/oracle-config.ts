/**
 * Oracle Key Management — ~/.oracle-net/
 *
 * Local config directory for persisting oracle keys and settings.
 * Each oracle gets its own JSON file at ~/.oracle-net/oracles/{slug}.json
 */
import { readdir, readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'

const CONFIG_DIR = join(homedir(), '.oracle-net')
const ORACLES_DIR = join(CONFIG_DIR, 'oracles')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')
const AGE_KEY_FILE = join(CONFIG_DIR, 'age-key.txt')

export interface OracleConfig {
  name: string
  slug: string
  birth_issue: string
  bot_wallet: string
  bot_key?: string
  bot_key_encrypted?: string
  owner_wallet?: string
  verification_issue?: string
  claimed_at?: string
}

export interface GlobalConfig {
  api_url: string
  encryption: 'age' | null
  age_recipient?: string       // age public key (age1...)
  default_oracle: string | null
}

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  api_url: 'https://api.oraclenet.org',
  encryption: null,
  default_oracle: null,
}

/** Slugify oracle name: lowercase, spaces→hyphens, strip special chars */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Get config directory path */
export function getConfigDir(): string {
  return CONFIG_DIR
}

/** Ensure ~/.oracle-net/oracles/ exists */
export async function ensureConfigDir(): Promise<void> {
  if (!existsSync(ORACLES_DIR)) {
    await mkdir(ORACLES_DIR, { recursive: true })
  }
}

/** Read global config */
export async function getGlobalConfig(): Promise<GlobalConfig> {
  try {
    const raw = await readFile(CONFIG_FILE, 'utf-8')
    return { ...DEFAULT_GLOBAL_CONFIG, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_GLOBAL_CONFIG }
  }
}

/** Save global config */
export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
  await ensureConfigDir()
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n')
}

/** List all saved oracles */
export async function listOracles(): Promise<OracleConfig[]> {
  await ensureConfigDir()
  const oracles: OracleConfig[] = []
  try {
    const files = await readdir(ORACLES_DIR)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const raw = await readFile(join(ORACLES_DIR, file), 'utf-8')
        oracles.push(JSON.parse(raw))
      } catch {
        // skip malformed files
      }
    }
  } catch {
    // oracles dir doesn't exist yet
  }
  return oracles
}

/** Find oracle by name or slug (case-insensitive partial match) */
export async function getOracle(nameOrSlug: string): Promise<OracleConfig | null> {
  const oracles = await listOracles()
  const lower = nameOrSlug.toLowerCase()
  // Exact slug match first
  const exact = oracles.find(o => o.slug === lower)
  if (exact) return exact
  // Exact name match (case-insensitive)
  const byName = oracles.find(o => o.name.toLowerCase() === lower)
  if (byName) return byName
  // Partial match on name or slug
  const partial = oracles.find(
    o => o.name.toLowerCase().includes(lower) || o.slug.includes(lower)
  )
  return partial || null
}

/** Find oracle by birth issue URL */
export async function getOracleByBirthIssue(url: string): Promise<OracleConfig | null> {
  const oracles = await listOracles()
  return oracles.find(o => o.birth_issue === url) || null
}

/** Ensure age identity exists at ~/.oracle-net/age-key.txt. Creates one if missing.
 *  Returns the public key (age1...). */
export async function ensureAgeIdentity(): Promise<string> {
  if (existsSync(AGE_KEY_FILE)) {
    const contents = await readFile(AGE_KEY_FILE, 'utf-8')
    const match = contents.match(/public key: (age1\w+)/)
    if (match) return match[1]
  }
  // Generate new identity
  const output = execSync('age-keygen', { encoding: 'utf-8' })
  await writeFile(AGE_KEY_FILE, output)
  await chmod(AGE_KEY_FILE, 0o600)
  const match = output.match(/public key: (age1\w+)/)
  if (!match) throw new Error('age-keygen did not return a public key')
  return match[1]
}

/** Save oracle config to ~/.oracle-net/oracles/{slug}.json with chmod 600.
 *  If config.json has encryption: "age", adds bot_key_encrypted alongside bot_key. */
export async function saveOracle(data: OracleConfig): Promise<string> {
  await ensureConfigDir()
  const config = await getGlobalConfig()
  const toSave = { ...data }

  // Add encrypted copy if age encryption is enabled (keeps plaintext too)
  if (config.encryption === 'age' && toSave.bot_key) {
    const recipient = config.age_recipient || await ensureAgeIdentity()
    try {
      const encrypted = execFileSync('age', ['-e', '-r', recipient, '-a'], {
        input: toSave.bot_key,
        encoding: 'utf-8',
      }).trim()
      toSave.bot_key_encrypted = encrypted
    } catch {
      throw new Error('Failed to encrypt bot_key with age. Is age installed? (brew install age)')
    }
  }

  const filePath = join(ORACLES_DIR, `${toSave.slug}.json`)
  await writeFile(filePath, JSON.stringify(toSave, null, 2) + '\n')
  await chmod(filePath, 0o600)
  return filePath
}

/** Get decrypted bot key for an oracle */
export async function getKey(oracle: OracleConfig): Promise<string | null> {
  if (oracle.bot_key) return oracle.bot_key
  if (oracle.bot_key_encrypted) {
    try {
      const decrypted = execFileSync('age', ['-d', '-i', AGE_KEY_FILE], {
        input: oracle.bot_key_encrypted,
        encoding: 'utf-8',
      }).trim()
      return decrypted
    } catch {
      throw new Error(
        `Failed to decrypt key for ${oracle.name}. Check ~/.oracle-net/age-key.txt exists and matches the key used to encrypt.`
      )
    }
  }
  return null
}

/** Resolve bot private key with priority: --oracle → --birth-issue → default_oracle → BOT_PRIVATE_KEY env */
export async function resolveKey(opts: {
  oracle?: string
  birthIssue?: string
}): Promise<{ key: string; oracle: OracleConfig | null }> {
  // 1. --oracle name lookup
  if (opts.oracle) {
    const found = await getOracle(opts.oracle)
    if (!found) throw new Error(`Oracle "${opts.oracle}" not found in ~/.oracle-net/oracles/`)
    const key = await getKey(found)
    if (!key) throw new Error(`No bot_key saved for ${found.name}`)
    return { key, oracle: found }
  }

  // 2. --birth-issue lookup
  if (opts.birthIssue) {
    const found = await getOracleByBirthIssue(opts.birthIssue)
    if (found) {
      const key = await getKey(found)
      if (key) return { key, oracle: found }
    }
  }

  // 3. default_oracle from config
  const config = await getGlobalConfig()
  if (config.default_oracle) {
    const found = await getOracle(config.default_oracle)
    if (found) {
      const key = await getKey(found)
      if (key) return { key, oracle: found }
    }
  }

  // 4. BOT_PRIVATE_KEY env var (backward compat)
  const envKey = process.env.BOT_PRIVATE_KEY
  if (envKey) return { key: envKey, oracle: null }

  throw new Error(
    'No bot key found. Use --oracle "name", --birth-issue "url", set default_oracle in ~/.oracle-net/config.json, or set BOT_PRIVATE_KEY env var.'
  )
}
