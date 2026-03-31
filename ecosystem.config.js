module.exports = {
  apps: [{
    name: 'er-seo-tools',
    script: 'node_modules/.bin/next',
    args: 'start',
    cwd: '/home/seotools/webapps/er-seo-tools',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '1200M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      DATABASE_URL: 'file:/home/seotools/data/er-seo-tools/db.sqlite',
      UPLOADS_DIR: '/home/seotools/data/er-seo-tools/uploads',
      NODE_OPTIONS: '--max-old-space-size=1536',
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
    error_file: '/home/seotools/logs/er-seo-tools-error.log',
    out_file: '/home/seotools/logs/er-seo-tools-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }],
};
