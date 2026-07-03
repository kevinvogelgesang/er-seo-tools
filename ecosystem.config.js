// Paths derive from APP_HOME / DATA_HOME / LOG_HOME so the same file works
// across hosts. Defaults match the production VPS layout.
const APP_HOME = process.env.APP_HOME || '/home/seo/webapps/seo-tools'
const DATA_HOME = process.env.DATA_HOME || '/home/seo/data/seo-tools'
const LOG_HOME = process.env.LOG_HOME || '/home/seo/logs'

module.exports = {
  apps: [{
    name: 'seo-tools',
    script: 'node_modules/.bin/next',
    args: 'start',
    cwd: APP_HOME,
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '2400M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      DATABASE_URL: `file:${DATA_HOME}/db.sqlite`,
      UPLOADS_DIR: `${DATA_HOME}/uploads`,
      SCREENSHOTS_DIR: `${DATA_HOME}/screenshots`,
      REPORTS_DIR: `${DATA_HOME}/reports`,
      // D0 ops safety. BACKUP_DIR holds daily DB snapshots + alert-state.json.
      // Set ALERT_WEBHOOK_URL in the server .env (a Slack incoming webhook) to
      // enable failure alerts; unset = alerts computed + logged, not sent.
      // Optional tuning (defaults in code): QUEUE_STALL_MINUTES (60),
      // BACKUP_STALE_HOURS (26), BACKUP_RETENTION_COUNT (7), ALERT_COOLDOWN_MINUTES (360).
      BACKUP_DIR: `${DATA_HOME}/backups`,
      NODE_OPTIONS: '--max-old-space-size=2048',
      // Audit-safety knobs are explicit here so `pm2 env <id>` proves
      // what the worker is using. Do not move to .env without that tradeoff.
      BROWSER_POOL_SIZE: '4',
      SITE_AUDIT_CONCURRENCY: '2',
      SITE_AUDIT_BROWSER_RECYCLE_PAGES: '15',
      LIGHTHOUSE_PROVIDER: 'pagespeed',
      PAGESPEED_TIMEOUT_MS: '150000',
      PSI_CONCURRENCY: '15',
      SEO_REPORT_RETENTION_SCHEDULED_DAYS: '730',
      SEO_REPORT_RETENTION_ADHOC_DAYS: '90',
    },

    // Graceful shutdown — 10s for Chrome cleanup before SIGKILL
    kill_timeout: 10000,
    listen_timeout: 15000,

    // Restart behavior
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 2000,

    // Logs
    error_file: `${LOG_HOME}/seo-tools-error.log`,
    out_file: `${LOG_HOME}/seo-tools-out.log`,
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }],
};
