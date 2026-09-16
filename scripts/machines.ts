import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
interface Machine {
  id: string
  ssh: string
  shell?: "posix" | "powershell"
  mode?: "ccusage" | "envelope"
  bun?: string
  repo?: string
  key?: string
}
interface MachinesConfig {
  localId?: string
  machines?: Machine[]
}
function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const cfgPath =
  argValue("--config") ??
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "machines.config.json"
  )
let cfg: MachinesConfig = {}
if (existsSync(cfgPath)) {
  try {
    cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as MachinesConfig
  } catch {
    console.error(`machines.config: failed to parse ${cfgPath}`)
    process.exit(2)
  }
}
const localId = cfg.localId ?? "local"
const machines = cfg.machines ?? []
if (process.argv.includes("--local-id")) {
  console.log(localId)
} else {
  for (const m of machines) {
    console.log(
      [
        m.id,
        m.ssh ?? "",
        m.shell ?? "posix",
        m.mode ?? "ccusage",
        m.bun ?? "",
        m.repo ?? "",
        m.key ?? "",
      ].join("|")
    )
  }
}
