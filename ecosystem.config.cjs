module.exports = {
  apps: [
    {
      name: "telegram-vacancy-bot",
      cwd: __dirname,
      script: "./node_modules/tsx/dist/cli.mjs",
      args: "src/index.ts",
      interpreter: "node",
      autorestart: true,
      stop_signal: "SIGTERM",
      kill_timeout: 10000,
      max_memory_restart: "200M",
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
