/**
 * Chainlink price oracle integration
 *
 * Fetches BTC/USD price from Chainlink on Ethereum Mainnet.
 * Used for proof-of-time nonce in SIWE authentication.
 */

// Chainlink BTC/USD price feed on Ethereum Mainnet
const CHAINLINK_BTC_USD = '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c'
const ETH_RPC = 'https://ethereum.publicnode.com'

export interface ChainlinkPrice {
  price: number
  roundId: string
  timestamp: number
}

/**
 * Fetch BTC price from Chainlink oracle
 * Returns price, roundId (for use as nonce), and timestamp
 */
export async function getChainlinkBtcPrice(): Promise<ChainlinkPrice> {
  const calldata = '0xfeaf968c' // latestRoundData()

  const response = await fetch(ETH_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: CHAINLINK_BTC_USD, data: calldata }, 'latest'],
    }),
  })

  const result = (await response.json()) as { result: string }

  // Decode: (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
  const data = result.result.slice(2) // remove 0x
  const roundId = BigInt('0x' + data.slice(0, 64)).toString()
  const answer = BigInt('0x' + data.slice(64, 128))
  const updatedAt = BigInt('0x' + data.slice(192, 256))

  return {
    price: Number(answer) / 1e8,
    roundId,
    timestamp: Number(updatedAt),
  }
}
