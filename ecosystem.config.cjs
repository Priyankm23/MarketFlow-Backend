// ecosystem.config.js
module.exports = {
  apps: [
    {
      // ── Web Server ──────────────────────────────────────
      name: 'web-server',
      script: 'dist/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env : {
        NODE_ENV: 'production',
      },
    },
    {
      // ── Email Worker ────────────────────────────────────
      name: 'email-worker',
      script: 'dist/jobs/workers/emailWorker.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env : {
        NODE_ENV: 'production',
      },
    },
  ],
};