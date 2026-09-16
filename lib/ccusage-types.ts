export interface TokenFields {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalTokens: number
}
export interface AgentSplit extends TokenFields {
  agent: string
  totalCost: number
  modelsUsed: string[]
  modelBreakdowns: ModelBreakdown[]
}
export interface ModelBreakdown extends TokenFields {
  modelName: string
  cost: number
}
export interface DailyRow extends TokenFields {
  period: string
  agent: string
  totalCost: number
  modelsUsed: string[]
  modelBreakdowns: ModelBreakdown[]
  agents?: AgentSplit[]
  metadata?: { agents?: string[]; machine?: string; machines?: string[] }
}
export interface PeriodRow extends TokenFields {
  period: string
  totalCost: number
  modelsUsed: string[]
  modelBreakdowns: ModelBreakdown[]
  agents?: AgentSplit[]
  metadata?: { machine?: string; machines?: string[]; lastActivity?: string }
}
export interface SessionRow extends PeriodRow {
  agent: string
  metadata: { lastActivity?: string; reasoningOutputTokens?: number; machine?: string }
}
export interface UnifiedTotals extends TokenFields {
  totalCost: number
}
export interface UnifiedPayload {
  daily?: DailyRow[]
  weekly?: PeriodRow[]
  monthly?: PeriodRow[]
  session?: SessionRow[]
  totals?: UnifiedTotals
}
export interface UsageEnvelope {
  payload: UnifiedPayload
  fetchedAt: string
}
