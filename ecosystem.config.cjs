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
      node_args: '--dns-result-order=ipv4first',
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
      node_args: '--dns-result-order=ipv4first',
      env : {
        NODE_ENV: 'production',
      },
    },
  ],
};