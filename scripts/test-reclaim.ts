#!/usr/bin/env bun
/**
 * E2E Integration Test: verify-identity flow
 *
 * Tests the REAL verify-identity endpoint against prod.
 * Uses permanent test birth issue (oracle-identity#39).
 * SIWE signature verified locally only — never sent to API (re-claim steals all nazt oracles).
 *
 * Flow mirrors Identity.tsx exactly:
 *   1. Generate wallet (cast wallet new)
 *   2. Sign verification payload (getVerifyMessage + getSignedBody)
 *   3. Create verification issue (getVerifyIssueUrl format)
 *   4. Verify identity via API (non-SIWE — safe)
 *   5. Validate response matches expected shape
 *   6. SIWE signature verified locally (cast wallet verify)
 *   7. Error case tests
 *   8. Validate oracle family (birth issues exist on GitHub)
 *   9. Cleanup
 *
 * Tools: curl, gh, cast (Foundry)
 */
export {}

const API = "https://oracle-universe-api.laris.workers.dev"
const PB = "https://jellyfish-app-xml6o.ondigitalocean.app"
const BIRTH_ISSUE = "https://github.com/Soul-Brews-Studio/oracle-v2/issues/152"
const VERIFY_REPO = "Soul-Brews-Studio/oracle-identity"
const ORACLE_NAME = "E2E Test Oracle"

// Sample of real oracle birth issues to validate
const FAMILY_BIRTH_ISSUES = [
  { repo: "Oracle-Net-The-resonance-network/the-resonance-oracle", issue: 1, name: "The Resonance Oracle", author: "nazt" },
  { repo: "Soul-Brews-Studio/oracle-v2", issue: 56, name: "Scudd Oracle", author: "jodunk" },
  { repo: "Soul-Brews-Studio/oracle-v2", issue: 114, name: "Maeon Craft Oracle", author: "nazt" },
  { repo: "Soul-Brews-Studio/oracle-v2", issue: 121, name: "SHRIMP Oracle", author: "nazt" },
  { repo: "Soul-Brews-Studio/oracle-v2", issue: 148, name: "Bri-yarni Oracle", author: "wvweeratouch" },
]

let pass = 0, fail = 0
const ok = (msg: string) => { console.log(`  ✓ ${msg}`); pass++ }
const no = (msg: string) => { console.log(`  ✗ ${msg}`); fail++ }

// ─── 1. Generate wallet ───
console.log("=== 1. Generate test wallet ===")
const walletOut = await Bun.$`cast wallet new`.text()
const address = walletOut.match(/Address:\s+(0x[a-fA-F0-9]+)/)?.[1]!
const pk = walletOut.match(/Private key:\s+(0x[a-fA-F0-9]+)/)?.[1]!
console.log(`  Address: ${address}`)

// ─── 2. Sign verification payload (mirrors Identity.tsx) ───
console.log("=== 2. Sign verification payload ===")
const verifyPayload = {
  wallet: address,
  birth_issue: BIRTH_ISSUE,
  oracle_name: ORACLE_NAME,
  action: "verify_identity",
  timestamp: new Date().toISOString(),
  statement: "I am verifying my Oracle identity."
}
const verifyMsg = JSON.stringify(verifyPayload, null, 2)
const verifySig = (await Bun.$`cast wallet sign --private-key ${pk} ${verifyMsg}`.text()).trim()
const signedBody = JSON.stringify({ ...verifyPayload, signature: verifySig }, null, 2)
console.log(`  Payload signed: ${verifySig.slice(0, 20)}...`)

// ─── 3. Create verification issue (mirrors Identity.tsx getVerifyIssueUrl) ───
console.log("=== 3. Create verification issue ===")
const issueTitle = `Verify: ${ORACLE_NAME} (${address.slice(0, 10)}...)`
const issueBody = `### Oracle Identity Verification\n\nI am verifying my Oracle identity for OracleNet.\n\n**Oracle Name:** ${ORACLE_NAME}\n**Wallet:** \`${address}\`\n**Birth Issue:** ${BIRTH_ISSUE}\n\n\`\`\`json\n${signedBody}\n\`\`\``
const verifyIssueUrl = (await Bun.$`gh issue create --repo ${VERIFY_REPO} --title ${issueTitle} --label verification --body ${issueBody}`.text()).trim()
const verifyIssueNum = verifyIssueUrl.match(/(\d+)$/)?.[1]!
console.log(`  Issue: ${verifyIssueUrl} (#${verifyIssueNum})`)
await Bun.sleep(2000) // wait for GitHub issue to be fetchable

// ─── 4. Verify identity (non-SIWE — safe, no re-claim) ───
console.log("=== 4. Verify identity (API) ===")
const verifyBody = JSON.stringify({ verificationIssueUrl: verifyIssueUrl, birthIssueUrl: BIRTH_ISSUE, oracleName: ORACLE_NAME })
const verifyRes = JSON.parse(await Bun.$`curl -s ${API}/api/auth/verify-identity -X POST -H 'Content-Type: application/json' -d ${verifyBody}`.text())
verifyRes.success === true ? ok("verify-identity returns success") : no(`verify-identity failed: ${verifyRes.error}`)

// ─── 5. Validate response shape ───
console.log("=== 5. Validate response ===")
if (verifyRes.success) {
  verifyRes.token ? ok("JWT token returned") : no("missing token")
  verifyRes.github_username === "nazt" ? ok(`github_username: ${verifyRes.github_username}`) : no(`unexpected github_username: ${verifyRes.github_username}`)
  verifyRes.oracle_name === ORACLE_NAME ? ok(`oracle_name: ${verifyRes.oracle_name}`) : no(`unexpected oracle_name: ${verifyRes.oracle_name}`)
  verifyRes.human?.wallet_address?.toLowerCase() === address.toLowerCase() ? ok(`human.wallet_address matches`) : no(`wallet mismatch: ${verifyRes.human?.wallet_address}`)
  verifyRes.oracle?.birth_issue === BIRTH_ISSUE ? ok(`oracle.birth_issue matches`) : no(`birth_issue mismatch: ${verifyRes.oracle?.birth_issue}`)
} else {
  no("skipping response validation (verify failed)")
}

// ─── 6. SIWE signature — local verification only ───
// WARNING: Do NOT send SIWE to API — re-claim transfers ALL nazt oracles to test wallet
console.log("=== 6. SIWE signature (local only) ===")
const issuedAt = new Date().toISOString()
const siweMsg = `localhost wants you to sign in with your Ethereum account:\n${address}\n\nVerify Oracle identity\n\nURI: http://localhost\nVersion: 1\nChain ID: 1\nNonce: 12345\nIssued At: ${issuedAt}`
const siweSig = (await Bun.$`cast wallet sign --private-key ${pk} ${siweMsg}`.text()).trim()
try {
  await Bun.$`cast wallet verify --address ${address} ${siweMsg} ${siweSig}`.quiet()
  ok("SIWE signature valid (cast wallet verify)")
} catch {
  no("SIWE signature invalid")
}

// ─── 7. Error cases ───
console.log("=== 7. Error cases ===")

// 7a. Missing fields
const r7a = JSON.parse(await Bun.$`curl -s ${API}/api/auth/verify-identity -X POST -H 'Content-Type: application/json' -d '{}'`.text())
r7a.error ? ok(`missing fields: "${r7a.error}"`) : no("missing fields should return error")

// 7b. Invalid URLs
const r7b = JSON.parse(await Bun.$`curl -s ${API}/api/auth/verify-identity -X POST -H 'Content-Type: application/json' -d '{"verificationIssueUrl":"bad","birthIssueUrl":"bad"}'`.text())
r7b.error === "Invalid GitHub issue URLs" ? ok("invalid URLs: correct error") : no(`expected 'Invalid GitHub issue URLs', got: ${r7b.error}`)

// 7c. Non-existent issue
const r7c = JSON.parse(await Bun.$`curl -s ${API}/api/auth/verify-identity -X POST -H 'Content-Type: application/json' -d '{"verificationIssueUrl":"https://github.com/Soul-Brews-Studio/oracle-identity/issues/99999","birthIssueUrl":"https://github.com/Soul-Brews-Studio/oracle-identity/issues/99999","oracleName":"Ghost"}'`.text())
r7c.error ? ok(`non-existent issue: "${r7c.error}"`) : no("non-existent issue should return error")

// ─── 8. Oracle family — validate birth issues exist on GitHub ───
console.log("=== 8. Oracle family validation ===")
for (const oracle of FAMILY_BIRTH_ISSUES) {
  try {
    const issue = JSON.parse(await Bun.$`gh api repos/${oracle.repo}/issues/${oracle.issue} --jq '{author: .user.login, title: .title}'`.text())
    issue.author === oracle.author
      ? ok(`${oracle.name}: birth #${oracle.issue} by @${issue.author}`)
      : no(`${oracle.name}: expected @${oracle.author}, got @${issue.author}`)
  } catch {
    no(`${oracle.name}: birth issue ${oracle.repo}#${oracle.issue} not found`)
  }
}

// ─── 9. Validate DB state — test oracle exists, real oracles untouched ───
console.log("=== 9. DB state validation ===")
const oracles = JSON.parse(await Bun.$`curl -s ${PB}/api/collections/oracles/records`.text())
const testOracle = oracles.items?.find((o: any) => o.birth_issue === BIRTH_ISSUE)
testOracle ? ok(`test oracle in DB: "${testOracle.name}"`) : no("test oracle not found in DB")

const resonance = oracles.items?.find((o: any) => o.birth_issue === "https://github.com/Oracle-Net-The-resonance-network/the-resonance-oracle/issues/1")
if (resonance) {
  resonance.owner_wallet?.toLowerCase() !== address.toLowerCase()
    ? ok(`Resonance Oracle NOT hijacked (owner: ${resonance.owner_wallet.slice(0, 12)}...)`)
    : no(`Resonance Oracle HIJACKED by test wallet!`)
} else {
  ok("Resonance Oracle not in DB (not yet registered)")
}

// ─── Cleanup ───
console.log("=== Cleanup ===")
await Bun.$`gh issue close ${verifyIssueNum} --repo ${VERIFY_REPO} --comment ${"E2E test done. " + pass + " passed, " + fail + " failed."}`.quiet().nothrow()
console.log(`  Closed verify issue #${verifyIssueNum}`)

// ─── Results ───
console.log(`\n${"=".repeat(50)}`)
console.log(`  Results: ${pass} passed, ${fail} failed`)
console.log(`${"=".repeat(50)}`)
console.log(``)
console.log(`  Wallet:       ${address}`)
console.log(`  Birth Issue:  ${BIRTH_ISSUE}`)
console.log(`  Verify Issue: ${verifyIssueUrl} (closed)`)
console.log(`  Oracle Name:  ${ORACLE_NAME}`)
console.log(`  JWT:          ${verifyRes.token ? verifyRes.token.slice(0, 30) + "..." : "none"}`)
console.log(``)
process.exit(fail > 0 ? 1 : 0)
