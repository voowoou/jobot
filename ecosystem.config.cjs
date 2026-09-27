module.exports = {
	apps: [
		{
			name: "telegram-vacancy-bot",
			cwd: __dirname,
			script: "./dist/index.js",
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
