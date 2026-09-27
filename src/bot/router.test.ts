import assert from "node:assert/strict";
import test from "node:test";

import { BotCommandRouter, isOwner, parseCommand } from "./router.js";

test("parses bot commands and compares owner IDs as strings", () => {
  assert.equal(parseCommand(" /START@jobot hello"), "start");
  assert.equal(parseCommand("plain text"), undefined);
  assert.equal(isOwner("-100123", "-100123"), true);
  assert.equal(isOwner("-100123", "100123"), false);
});

test("router denies non-owner and cancels only the owner's active dialog", async () => {
  const replies: Array<{ chatId: string; text: string }> = [];
  const cleared: string[] = [];
  const router = new BotCommandRouter(
    { sendText: async (chatId, text) => { replies.push({ chatId, text }); } },
    {
      clearBotDialog: (chatId) => { cleared.push(chatId); return true; },
      getBotDialog: () => undefined,
    },
    "-1005",
  );

  await router.handle({ chatId: "42", text: "/cancel" });
  assert.match(replies[0].text, /нет доступа/i);
  assert.deepEqual(cleared, []);

  await router.handle({ chatId: "-1005", text: "/cancel" });
  assert.deepEqual(cleared, ["-1005"]);
  assert.match(replies[1].text, /отменена/i);
});

test("start gives setup guidance only while owner is unconfigured", async () => {
  const replies: string[] = [];
  const router = new BotCommandRouter(
    { sendText: async (_chatId, text) => { replies.push(text); } },
    { clearBotDialog: () => false, getBotDialog: () => undefined },
  );
  await router.handle({ chatId: "55", text: "/start" });
  assert.match(replies[0], /TELEGRAM_BOT_CHAT_ID/);
});
