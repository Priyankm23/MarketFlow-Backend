// ecosystem.config.js
module.exports = {
  apps: [
    {
      // ── Web Server (port 5001) ───────────────────────────
      name: 'web-server-5000',
      script: 'dist/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env : {
        NODE_ENV: 'production',
        PORT: 5000,
      },
    },
    // {
    //   // ── Web Server (port 5002) ───────────────────────────
    //   name: 'web-server-5002',
    //   script: 'dist/server.js',
    //   instances: 1,
    //   autorestart: true,
    //   watch: false,
    //   max_memory_restart: '500M',
    //   node_args: '--dns-result-order=ipv4first',
    //   env : {
    //     NODE_ENV: 'production',
    //     PORT: 5002,
    //   },
    // },
    // {
    //   // ── Web Server (port 5003) ───────────────────────────
    //   name: 'web-server-5003',
    //   script: 'dist/server.js',
    //   instances: 1,
    //   autorestart: true,
    //   watch: false,
    //   max_memory_restart: '500M',
    //   node_args: '--dns-result-order=ipv4first',
    //   env : {
    //     NODE_ENV: 'production',
    //     PORT: 5003,
    //   },
    // },
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