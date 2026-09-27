import input from "input";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

import { telegramEnv } from "../config/env.js";

async function authenticate(): Promise<void> {
  const session = new StringSession("");
  const client = new TelegramClient(session, telegramEnv.telegramApiId, telegramEnv.telegramApiHash, {
    connectionRetries: Infinity,
  });

  try {
    await client.start({
      phoneNumber: () => input.text("Phone number (international format):"),
      phoneCode: () => input.text("Telegram confirmation code:"),
      password: (hint) => input.password(`2FA password${hint ? ` (${hint})` : ""}:`),
      onError: async (error) => {
        console.error("Telegram authorization error:", error.message);
        return false;
      },
    });

    console.log("Authorization successful.");
    console.log("Copy the value below into TELEGRAM_STRING_SESSION in your .env file:");
    console.log(session.save());
  } finally {
    await client.disconnect();
  }
}

authenticate().catch((error: unknown) => {
  console.error("Authorization failed:", error);
  process.exitCode = 1;
});
