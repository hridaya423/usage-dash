const { Database } = require("bun:sqlite")
const fs = require("node:fs")
const path = require("node:path")
const { fileURLToPath } = require("node:url")
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
interface TailEntry {
  period: string
  model: string
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}
interface DevinCache {
  lastRowId: number
  rows: DailyRow[]
  tail: Record<string, TailEntry>
}
const databasePath = process.env.DEVIN_DB ?? `${process.env.HOME}/.local/share/devin/cli/sessions.db`
const CACHE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".data", "devin-cache.json")
const TAIL_WINDOW = 5000
function loadCache(): DevinCache {
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as DevinCache
    if (typeof parsed.lastRowId === "number" && Array.isArray(parsed.rows) && parsed.tail) {
      return parsed
    }
  } catch {
  }
  return { lastRowId: 0, rows: [], tail: {} }
}
function addToRow(row: DailyRow, model: string, entry: TailEntry, sign: 1 | -1): void {
  const delta = (entry.input + entry.output + entry.cacheRead + entry.cacheCreation) * sign
  row.inputTokens += entry.input * sign
  row.outputTokens += entry.output * sign
  row.cacheReadTokens += entry.cacheRead * sign
  row.cacheCreationTokens += entry.cacheCreation * sign
  row.totalTokens += delta
  const breakdown = row.modelBreakdowns.find((b) => b.modelName === model) ?? {
    modelName: model,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    cost: 0,
  }
  if (!row.modelBreakdowns.includes(breakdown)) row.modelBreakdowns.push(breakdown)
  breakdown.inputTokens += entry.input * sign
  breakdown.outputTokens += entry.output * sign
  breakdown.cacheReadTokens += entry.cacheRead * sign
  breakdown.cacheCreationTokens += entry.cacheCreation * sign
  breakdown.totalTokens += delta
  if (sign > 0 && !row.modelsUsed.includes(model)) {
    row.modelsUsed.push(model)
    row.modelsUsed.sort()
  }
}
const database = new Database(databasePath, { readonly: true })
const cache = loadCache()
const rows = new Map<string, DailyRow>(cache.rows.map((row) => [row.period, row]))
const maxRowId = (database.query("select max(row_id) as m from message_nodes").get() as { m: number | null }).m ?? 0
// ponytail: only rescans the tail window, so metrics written into rows older than
// TAIL_WINDOW behind the max row_id are missed. Full rebuild: delete .data/devin-cache.json
const scanFrom = Math.max(0, cache.lastRowId - TAIL_WINDOW)
for (const record of database.query(
  "select row_id, chat_message from message_nodes where row_id > ?"
).all(scanFrom) as Array<{ row_id: number; chat_message: string }>) {
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
  const next: TailEntry = {
    period,
    model,
    input: metrics.input_tokens ?? 0,
    output: metrics.output_tokens ?? 0,
    cacheRead: metrics.cache_read_tokens ?? 0,
    cacheCreation: metrics.cache_creation_tokens ?? 0,
  }
  const prev = cache.tail[String(record.row_id)]
  if (
    prev &&
    prev.period === next.period &&
    prev.model === next.model &&
    prev.input === next.input &&
    prev.output === next.output &&
    prev.cacheRead === next.cacheRead &&
    prev.cacheCreation === next.cacheCreation
  ) {
    continue
  }
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
  if (!rows.has(period)) rows.set(period, row)
  if (prev) addToRow(row, prev.model, prev, -1)
  addToRow(row, model, next, 1)
  cache.tail[String(record.row_id)] = next
}
database.close()
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
const tailCutoff = maxRowId - TAIL_WINDOW
for (const key of Object.keys(cache.tail)) {
  if (Number(key) <= tailCutoff) delete cache.tail[key]
}
const out: DevinCache = {
  lastRowId: maxRowId,
  rows: [...rows.values()].sort((a, b) => a.period.localeCompare(b.period)),
  tail: cache.tail,
}
fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true })
fs.writeFileSync(CACHE_PATH, JSON.stringify(out))
console.log(JSON.stringify(out.rows))
