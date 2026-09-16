import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { UsageEnvelope } from "@/lib/ccusage-types"
const CACHE_DIR = path.join(process.cwd(), ".data")
const CACHE_FILE = path.join(CACHE_DIR, "usage-cache.json")
const HISTORY_FILE = path.join(CACHE_DIR, "scan-history.json")
const TTL_MS = 5 * 60 * 1000
const FETCH_SCRIPT = path.join(process.cwd(), "scripts", "fetch-all.sh")
async function runCcusage(): Promise<UsageEnvelope> {
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      "bash",
      [FETCH_SCRIPT],
      { maxBuffer: 256 * 1024 * 1024, timeout: 10 * 60_000 },
      (error, out) => {
        if (error) reject(error)
        else resolve(out)
      }
    )
  })
  const start = stdout.indexOf("{")
  if (start < 0) throw new Error("ccusage produced no JSON object")
  const payload = JSON.parse(stdout.slice(start)) as UsageEnvelope["payload"]
  return { payload, fetchedAt: new Date().toISOString() }
}
async function readCache(): Promise<UsageEnvelope | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf8")
    return JSON.parse(raw) as UsageEnvelope
  } catch {
    return null
  }
}
let refreshInFlight: Promise<void> | null = null
let scanStartedAt = 0
async function readScanHistory(): Promise<number[]> {
  try {
    const raw = await readFile(HISTORY_FILE, "utf8")
    return JSON.parse(raw).samples ?? []
  } catch {
    return []
  }
}
function startBackgroundRefresh(): void {
  if (refreshInFlight) return
  refreshInFlight = (async () => {
    scanStartedAt = Date.now()
    try {
      await mkdir(CACHE_DIR, { recursive: true })
      const envelope = await runCcusage()
      const durationSec = (Date.now() - scanStartedAt) / 1000
      await writeFile(CACHE_FILE, JSON.stringify(envelope))
      const history = await readScanHistory()
      history.push(durationSec)
      while (history.length > 5) history.shift()
      const avg = history.reduce((sum, value) => sum + value, 0) / history.length
      await writeFile(HISTORY_FILE, JSON.stringify({ avg, samples: history }))
    } catch {
    } finally {
      scanStartedAt = 0
      refreshInFlight = null
    }
  })()
}
export interface UsageState {
  envelope: UsageEnvelope | null
  stale: boolean
  refreshing: boolean
  etaSeconds: number | null
}
export async function loadUsage(forceRefresh: boolean): Promise<UsageState> {
  let cached = await readCache()
  const ageMs = cached ? Date.now() - new Date(cached.fetchedAt).getTime() : Infinity
  if (!cached) {
    startBackgroundRefresh()
    await refreshInFlight
    cached = await readCache()
    return { envelope: cached, stale: false, refreshing: false, etaSeconds: null }
  }
  const shouldRevalidate = forceRefresh || ageMs >= TTL_MS
  if (shouldRevalidate && !refreshInFlight) startBackgroundRefresh()
  const refreshing = refreshInFlight !== null
  let etaSeconds: number | null = null
  if (refreshing) {
    const history = await readScanHistory()
    if (history.length > 0) {
      const avg = history.reduce((sum, value) => sum + value, 0) / history.length
      const elapsed = (Date.now() - scanStartedAt) / 1000
      etaSeconds = Math.max(1, Math.round(avg - elapsed))
    }
  }
  return {
    envelope: cached,
    stale: shouldRevalidate,
    refreshing,
    etaSeconds,
  }
}
