import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

const PORT = 41300
const FIXTURE_PORT = 41234
const root = process.cwd()
const smokeDbUrl = `file:${resolve(root, '.smoke-db/smoke.db')}`

export default defineConfig({
  testDir: './smoke',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: [
    {
      command: 'node smoke/fixture-server.mjs',
      env: { FIXTURE_PORT: String(FIXTURE_PORT) },
      url: `http://127.0.0.1:${FIXTURE_PORT}`,
      reuseExistingServer: false,
    },
    {
      command: 'npx prisma migrate deploy && next start -p ' + PORT,
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: smokeDbUrl,
        PILLAR_TOKEN_SECRET: 'smoke-pillar-secret',
        APP_AUTH_SECRET: 'smoke-secret',
        APP_AUTH_PASSWORD: 'smoke-pw',
        ALLOW_PASSWORD_LOGIN: 'true',
        NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${PORT}`,
        UPLOADS_DIR: resolve(root, '.smoke-uploads'),
        REPORTS_DIR: resolve(root, '.smoke-reports'),
        CHROMIUM_NETWORK_ISOLATED: 'true',
        CHROME_EXECUTABLE: process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome',
        SMOKE_MODE: 'true',
        SMOKE_LOOPBACK_TARGET: `127.0.0.1:${FIXTURE_PORT}`,
      },
    },
  ],
})
