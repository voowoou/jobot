module.exports = {
	apps: [
		{
			name: "telegram-vacancy-bot",
			cwd: __dirname,
			script: "./dist/index.js",
			interpreter: "node",
			instances: 1,
			exec_mode: "fork",
			node_args: "--max-old-space-size=128",
			autorestart: true,
			stop_signal: "SIGTERM",
			kill_timeout: 10000,
			max_memory_restart: "192M",
			time: true,
			env: {
				NODE_ENV: "production",
			},
		},
	],
};
