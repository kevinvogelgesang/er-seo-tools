// lib/ops/alert-state.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { readAlertState, writeAlertState } from './alert-state'

let tmpDir: string
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'as-'))
  vi.stubEnv('BACKUP_DIR', tmpDir)
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('alert-state', () => {
  it('round-trips', async () => {
    await writeAlertState({ lastCheckAt: 123, cooldowns: { 'queue-stalled': 99 } })
    expect(await readAlertState()).toEqual({ lastCheckAt: 123, cooldowns: { 'queue-stalled': 99 } })
  })
  it('missing file → default', async () => {
    expect(await readAlertState()).toEqual({ lastCheckAt: 0, cooldowns: {} })
  })
  it('corrupt JSON → default', async () => {
    await fs.writeFile(path.join(tmpDir, 'alert-state.json'), '{not json')
    expect(await readAlertState()).toEqual({ lastCheckAt: 0, cooldowns: {} })
  })
})
