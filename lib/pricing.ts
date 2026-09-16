import type { TokenFields } from "./ccusage-types"
const RATES: ReadonlyArray<readonly [prefix: string, fullUSD: number, cachedUSD: number]> = [
  ["claude-opus", 15, 1.5],
  ["claude-fable", 10, 1],
  ["claude-sonnet", 3, 0.3],
  ["claude-haiku", 0.8, 0.08],
  ["gpt-5", 1.25, 0.125],
  ["codex", 1.25, 0.125],
  ["o3", 2, 0.2],
  ["o4-mini", 1.1, 0.275],
  ["gpt-4.1", 2, 0.2],
  ["gpt-4o", 2.5, 1.25],
]
interface CustomPricing {
  inputUSDPerMillion: number
  outputUSDPerMillion: number
  cacheUSDPerMillion: number
}
const CUSTOM_RATES: ReadonlyArray<readonly [prefix: string, pricing: CustomPricing]> = [
  ["swe-2", { inputUSDPerMillion: 3, outputUSDPerMillion: 15, cacheUSDPerMillion: 0.3 }],
  ["x-preview", { inputUSDPerMillion: 0.15, outputUSDPerMillion: 0.5, cacheUSDPerMillion: 0.03 }],
  ["ox-alpha", { inputUSDPerMillion: 0.15, outputUSDPerMillion: 0.5, cacheUSDPerMillion: 0.03 }],
  ["stealth/ox-alpha", { inputUSDPerMillion: 0.15, outputUSDPerMillion: 0.5, cacheUSDPerMillion: 0.03 }],
]
function customPricing(modelName: string): CustomPricing | null {
  const name = modelName.toLowerCase()
  for (const [prefix, pricing] of CUSTOM_RATES) {
    if (name.startsWith(prefix)) return pricing
  }
  return null
}
export function customModelCost(modelName: string, tokens: TokenFields): number | null {
  const pricing = customPricing(modelName)
  if (!pricing) return null
  return (
    tokens.inputTokens * pricing.inputUSDPerMillion +
    tokens.outputTokens * pricing.outputUSDPerMillion +
    (tokens.cacheCreationTokens + tokens.cacheReadTokens) * pricing.cacheUSDPerMillion
  ) / 1e6
}
export function cachedReadDiscount(modelName: string): number {
  const custom = customPricing(modelName)
  if (custom) return custom.inputUSDPerMillion - custom.cacheUSDPerMillion
  const name = modelName.toLowerCase()
  for (const [prefix, full, cached] of RATES) {
    if (name.startsWith(prefix)) return full - cached
  }
  return 0
}
