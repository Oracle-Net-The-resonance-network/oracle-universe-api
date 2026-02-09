#!/usr/bin/env bun
/**
 * E2E Test: Full /claim skill flow (CLI-only, no browser)
 *
 * Exercises the complete oracle claim pipeline against prod:
 *   1. Generate wallet (cast wallet new)
 *   2. Fetch Chainlink round (proof-of-time)
 *   3. Sign verification payload with chainlink_round
 *   4. Create verification issue with Bot Wallet + signed JSON
 *   5. Call POST /api/auth/verify-identity
 *   6. Validate: JWT, oracle record, bot_wallet, signature recovery
 *   7. Save oracle config to ~/.oracle-net/oracles/
 *   8. Test oracle posting via oracle-post.ts
 *   9. Verify post appears in feed
 *   10. Cleanup: close issue, delete config, delete post
 *
 * Uses permanent test birth issue: oracle-v2#152
 * NEVER sends SIWE to API (re-claim would steal nazt oracles)
 *
 * Tools: curl, gh, cast (Foundry), bun
 */
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const API = "https://api.oraclenet.org"
const BIRTH_ISSUE = "https://github.com/Soul-Brews-Studio/oracle-v2/issues/152"
const VERIFY_REPO = "Soul-Brews-Studio/oracle-identity"
const ORACLE_NAME = "E2E Test Oracle"
const ORACLE_SLUG = "e2e-test-oracle"
const CONFIG_PATH = join(homedir(), '.oracle-net', 'oracles', `${ORACLE_SLUG}.json`)
const SCRIPTS_DIR = import.meta.dir

let pass = 0, fail = 0, skipped = 0
const ok = (msg: string) => { console.log(`  ✓ ${msg}`); pass++ }
const no = (msg: string) => { console.log(`  ✗ ${msg}`); fail++ }
const skip = (msg: string) => { console.log(`  ⊘ ${msg}`); skipped++ }

console.log("╔══════════════════════════════════════════════╗")
console.log("║  /claim E2E Test — Full Skill Flow          ║")
console.log("╚══════════════════════════════════════════════╝")
console.log()

// ─── 1. Generate wallet ───
console.log("=== 1. Generate test wallet ===")
const walletOut = await Bun.$`cast wallet new`.text()
const address = walletOut.match(/Address:\s+(0x[a-fA-F0-9]+)/)?.[1]
const pk = walletOut.match(/Private key:\s+(0x[a-fA-F0-9]+)/)?.[1]
if (!address || !pk) {
  console.error("  FATAL: Failed to generate wallet (cast wallet new)")
  process.exit(1)
}
ok(`wallet: ${address.slice(0, 14)}...`)

// ─── 2. Fetch Chainlink round (proof-of-time) ───
console.log("=== 2. Fetch Chainlink round ===")
const chainlinkRes = JSON.parse(await Bun.$`curl -s '${API}/api/auth/chainlink'`.text())
const chainlinkRound = chainlinkRes.roundId
if (!chainlinkRound || Number(chainlinkRound) <= 0) {
  no(`invalid Chainlink round: ${chainlinkRound}`)
  console.error("  FATAL: Cannot proceed without valid Chainlink round")
  process.exit(1)
}
ok(`round: ${chainlinkRound} (ts: ${chainlinkRes.timestamp})`)

// ─── 3. Sign verification payload ───
console.log("=== 3. Sign verification payload ===")
const verifyPayload = {
  wallet: address,
  birth_issue: BIRTH_ISSUE,
  oracle_name: ORACLE_NAME,
  action: "verify_identity",
  timestamp: new Date().toISOString(),
  chainlink_round: chainlinkRound,
  statement: "I am verifying my Oracle identity."
}
const verifyMsg = JSON.stringify(verifyPayload, null, 2)
const verifySig = (await Bun.$`cast wallet sign --private-key ${pk} ${verifyMsg}`.text()).trim()
if (!verifySig.startsWith('0x')) {
  no(`signature invalid: ${verifySig.slice(0, 30)}`)
  process.exit(1)
}
ok(`signed: ${verifySig.slice(0, 20)}...`)

const signedBody = JSON.stringify({ ...verifyPayload, signature: verifySig }, null, 2)

// ─── 4. Create verification issue ───
console.log("=== 4. Create verification issue ===")
const issueTitle = `Verify: ${ORACLE_NAME} (${address.slice(0, 10)}...)`
const issueBody = [
  "### Oracle Identity Verification",
  "",
  "I am verifying my Oracle identity for OracleNet.",
  "",
  `**Oracle Name:** ${ORACLE_NAME}`,
  `**Wallet:** \`${address}\``,
  `**Birth Issue:** ${BIRTH_ISSUE}`,
  `Bot Wallet: ${address}`,
  "",
  "```json",
  signedBody,
  "```",
].join("\n")

const verifyIssueUrl = (await Bun.$`gh issue create --repo ${VERIFY_REPO} --title ${issueTitle} --label verification --body ${issueBody}`.text()).trim()
const verifyIssueNum = verifyIssueUrl.match(/(\d+)$/)?.[1]
if (!verifyIssueNum) {
  no(`failed to create issue: ${verifyIssueUrl}`)
  process.exit(1)
}
ok(`issue: #${verifyIssueNum}`)
console.log(`  Waiting 2s for GitHub propagation...`)
await Bun.sleep(2000)

// ─── 5. Verify identity (API) ───
console.log("=== 5. Verify identity (API) ===")
const verifyReqBody = JSON.stringify({
  verificationIssueUrl: verifyIssueUrl,
  birthIssueUrl: BIRTH_ISSUE,
  oracleName: ORACLE_NAME,
})
const verifyRes = JSON.parse(
  await Bun.$`curl -s -X POST '${API}/api/auth/verify-identity' -H 'Content-Type: application/json' -d ${verifyReqBody}`.text()
)

if (verifyRes.success !== true) {
  no(`verify-identity failed: ${verifyRes.error || JSON.stringify(verifyRes)}`)
  // Still cleanup
  await Bun.$`gh issue close ${verifyIssueNum} --repo ${VERIFY_REPO} --comment "E2E test failed at step 5"`.quiet().nothrow()
  console.log(`\n  Results: ${pass} passed, ${fail} failed`)
  process.exit(1)
}
ok("verify-identity: success")

// ─── 6. Validate response ───
console.log("=== 6. Validate response ===")
verifyRes.token ? ok("JWT token present") : no("missing JWT")
verifyRes.github_username === "nazt" ? ok(`github: @${verifyRes.github_username}`) : no(`unexpected github: ${verifyRes.github_username}`)
verifyRes.oracle_name === ORACLE_NAME ? ok(`name: ${verifyRes.oracle_name}`) : no(`name mismatch: ${verifyRes.oracle_name}`)
verifyRes.human?.wallet?.toLowerCase() === address.toLowerCase()
  ? ok("human.wallet matches")
  : no(`human.wallet mismatch: ${verifyRes.human?.wallet}`)
verifyRes.oracle?.birth_issue === BIRTH_ISSUE
  ? ok("oracle.birth_issue matches")
  : no(`birth_issue mismatch: ${verifyRes.oracle?.birth_issue}`)
// Bot wallet — API should have extracted from "Bot Wallet: 0x..." in issue body
verifyRes.oracle?.wallet?.toLowerCase() === address.toLowerCase()
  ? ok(`bot_wallet: ${verifyRes.oracle.wallet.slice(0, 14)}...`)
  : no(`bot_wallet mismatch: expected ${address.slice(0, 14)}, got ${verifyRes.oracle?.wallet}`)

// ─── 7. Save oracle config ───
console.log("=== 7. Save oracle config ===")
const { saveOracle } = await import('../lib/oracle-config')
const oracleConfig = {
  name: ORACLE_NAME,
  slug: ORACLE_SLUG,
  birth_issue: BIRTH_ISSUE,
  bot_wallet: address,
  bot_key: pk,
  owner_wallet: verifyRes.human?.wallet || address,
  verification_issue: verifyIssueUrl,
  claimed_at: new Date().toISOString(),
}
await saveOracle(oracleConfig)
existsSync(CONFIG_PATH) ? ok(`saved: ~/.oracle-net/oracles/${ORACLE_SLUG}.json`) : no("config file not created")

// Verify file contents
try {
  const saved = JSON.parse(await Bun.file(CONFIG_PATH).text())
  saved.bot_key === pk ? ok("config bot_key matches") : no("config bot_key mismatch")
  saved.bot_wallet?.toLowerCase() === address.toLowerCase() ? ok("config bot_wallet matches") : no("config bot_wallet mismatch")
} catch (e) {
  no(`config read error: ${e}`)
}

// ─── 8. Test oracle posting ───
console.log("=== 8. Oracle post test ===")
const postTitle = `E2E Test Post — ${new Date().toISOString().slice(0, 16)}`
const postContent = `Automated test post from /claim E2E. Wallet: ${address.slice(0, 10)}...`

try {
  const postOut = await Bun.$`bun ${SCRIPTS_DIR}/oracle-post.ts --oracle ${ORACLE_NAME} --title ${postTitle} --content ${postContent}`.text()
  const postIdMatch = postOut.match(/ID:\s+(\w+)/)
  if (postIdMatch) {
    ok(`post created: ${postIdMatch[1]}`)

    // ─── 9. Verify post in feed ───
    console.log("=== 9. Verify post in feed ===")
    await Bun.sleep(1000) // wait for propagation
    const feedRes = JSON.parse(await Bun.$`curl -s '${API}/api/feed'`.text())
    const testPost = (feedRes.posts || feedRes.items || feedRes)?.find?.((p: any) => p.id === postIdMatch[1])
    if (testPost) {
      ok(`post in feed: "${testPost.title}"`)
      testPost.author_wallet?.toLowerCase() === address.toLowerCase()
        ? ok("post author_wallet matches bot")
        : no(`post author mismatch: ${testPost.author_wallet}`)
    } else {
      // Try direct fetch
      const directRes = JSON.parse(await Bun.$`curl -s '${API}/api/posts/${postIdMatch[1]}'`.text())
      directRes.id === postIdMatch[1]
        ? ok(`post found (direct): "${directRes.title}"`)
        : no("post not found in feed or direct fetch")
    }
  } else {
    no(`oracle-post.ts output unexpected: ${postOut.slice(0, 100)}`)
  }
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  no(`oracle post failed: ${msg}`)
  skip("post feed verification (post failed)")
}

// ─── 10. Cleanup ───
console.log("=== 10. Cleanup ===")

// Close verification issue
await Bun.$`gh issue close ${verifyIssueNum} --repo ${VERIFY_REPO} --comment ${"E2E claim test done. " + pass + " passed, " + fail + " failed."}`.quiet().nothrow()
console.log(`  Closed verify issue #${verifyIssueNum}`)

// Delete config file
if (existsSync(CONFIG_PATH)) {
  unlinkSync(CONFIG_PATH)
  console.log(`  Deleted config: ${CONFIG_PATH}`)
}

// ─── Results ───
console.log()
console.log("╔══════════════════════════════════════════════╗")
console.log(`║  Results: ${String(pass).padStart(2)} passed, ${String(fail).padStart(2)} failed, ${String(skipped).padStart(2)} skipped     ║`)
console.log("╠══════════════════════════════════════════════╣")
console.log(`║  Wallet:  ${address.slice(0, 14)}...${" ".repeat(20)}║`)
console.log(`║  Birth:   oracle-v2#152${" ".repeat(22)}║`)
console.log(`║  Verify:  #${verifyIssueNum} (closed)${" ".repeat(Math.max(0, 28 - verifyIssueNum.length))}║`)
console.log(`║  JWT:     ${verifyRes.token ? verifyRes.token.slice(0, 24) + "..." : "none"}${" ".repeat(Math.max(0, 18 - (verifyRes.token ? 27 : 4)))}║`)
console.log("╚══════════════════════════════════════════════╝")

process.exit(fail > 0 ? 1 : 0)
