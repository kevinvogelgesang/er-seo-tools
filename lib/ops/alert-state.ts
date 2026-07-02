// lib/ops/alert-state.ts
//
// D0 ops safety — dedup state for the failure-alert job. Persisted as an
// atomic JSON file under BACKUP_DIR (temp file + rename) so a crash mid-write
// never leaves corrupt JSON. Single PM2 fork + health-alert concurrency 1
// makes a file (vs a table) sufficient and migration-free.
import { promises as fs } from 'fs'
import path from 'path'
import { backupDir } from './backup'

export interface AlertState {
  lastCheckAt: number
  cooldowns: Record<string, number>
}

const DEFAULT_STATE: AlertState = { lastCheckAt: 0, cooldowns: {} }

function statePath(): string {
  return path.join(backupDir(), 'alert-state.json')
}

export async function readAlertState(): Promise<AlertState> {
  try {
    const raw = await fs.readFile(statePath(), 'utf8')
    const parsed = JSON.parse(raw)
    return {
      lastCheckAt: typeof parsed.lastCheckAt === 'number' ? parsed.lastCheckAt : 0,
      cooldowns: parsed.cooldowns && typeof parsed.cooldowns === 'object' ? parsed.cooldowns : {},
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export async function writeAlertState(s: AlertState): Promise<void> {
  const dir = backupDir()
  await fs.mkdir(dir, { recursive: true })
  const rand = Math.floor(Math.random() * 1e9).toString(36)
  const tmp = path.join(dir, `alert-state.json.${process.pid}.${rand}.tmp`)
  await fs.writeFile(tmp, JSON.stringify(s), 'utf8')
  await fs.rename(tmp, statePath())
}
