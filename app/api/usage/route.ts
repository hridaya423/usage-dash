import { loadUsage } from "@/lib/usage-cache"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function GET(request: Request) {
  const url = new URL(request.url)
  const force = url.searchParams.get("refresh") === "1"
  const state = await loadUsage(force)
  if (!state.envelope) {
    return Response.json({ error: "initial scan failed" }, { status: 502 })
  }
  return Response.json({
    ...state.envelope,
    stale: state.stale,
    refreshing: state.refreshing,
    etaSeconds: state.etaSeconds,
  })
}
