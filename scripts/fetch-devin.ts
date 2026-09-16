const { Database } = require("bun:sqlite")
interface DevinMessage {
  role?: string
  metadata?: {
    metrics?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_tokens?: number
      cache_creation_tokens?: number | null
    }
    generation_model?: string
    created_at?: string
  }
}
interface ModelBreakdown {
  modelName: string
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalTokens: number
  cost: number
}
interface DailyRow {
  period: string
  agent: string
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalTokens: number
  totalCost: number
  modelsUsed: string[]
  modelBreakdowns: ModelBreakdown[]
  agents: Array<{
    agent: string
    inputTokens: number
    outputTokens: number
    cacheCreationTokens: number
    cacheReadTokens: number
    totalTokens: number
    totalCost: number
    modelsUsed: string[]
    modelBreakdowns: ModelBreakdown[]
  }>
}
const databasePath = process.env.DEVIN_DB ?? `${process.env.HOME}/.local/share/devin/cli/sessions.db`
const database = new Database(databasePath, { readonly: true })
const rows = new Map<string, DailyRow>()
for (const record of database.query("select chat_message from message_nodes").all() as Array<{ chat_message: string }>) {
  let message: DevinMessage
  try {
    message = JSON.parse(record.chat_message) as DevinMessage
  } catch {
    continue
  }
  if (message.role !== "assistant" || !message.metadata?.metrics) continue
  const metrics = message.metadata.metrics
  const model = message.metadata.generation_model ?? "unknown"
  const period = (message.metadata.created_at ?? "").slice(0, 10)
  if (!period) continue
  const row = rows.get(period) ?? {
    period,
    agent: "devin",
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    modelsUsed: [],
    modelBreakdowns: [],
    agents: [],
  }
  const breakdown = row.modelBreakdowns.find((entry) => entry.modelName === model) ?? {
    modelName: model,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    cost: 0,
  }
  if (!row.modelBreakdowns.includes(breakdown)) row.modelBreakdowns.push(breakdown)
  const input = metrics.input_tokens ?? 0
  const output = metrics.output_tokens ?? 0
  const cacheRead = metrics.cache_read_tokens ?? 0
  const cacheCreation = metrics.cache_creation_tokens ?? 0
  breakdown.inputTokens += input
  breakdown.outputTokens += output
  breakdown.cacheReadTokens += cacheRead
  breakdown.cacheCreationTokens += cacheCreation
  breakdown.totalTokens += input + output + cacheRead + cacheCreation
  row.inputTokens += input
  row.outputTokens += output
  row.cacheReadTokens += cacheRead
  row.cacheCreationTokens += cacheCreation
  row.totalTokens += input + output + cacheRead + cacheCreation
  if (!row.modelsUsed.includes(model)) row.modelsUsed.push(model)
  rows.set(period, row)
}
for (const row of rows.values()) {
  row.agents = [{
    agent: "devin",
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    cacheReadTokens: row.cacheReadTokens,
    totalTokens: row.totalTokens,
    totalCost: 0,
    modelsUsed: row.modelsUsed,
    modelBreakdowns: row.modelBreakdowns,
  }]
}
database.close()
console.log(JSON.stringify([...rows.values()].sort((a, b) => a.period.localeCompare(b.period))))
