import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const RETENTION_DAYS = 30;
const DEFAULT_DATABASE_PATH = resolve(process.cwd(), "data", "app.db");

interface ProcessedMessageRow {
  chat_id: string;
}

interface OffsetRow {
  next_update_id: number;
}

interface BotDialogRow {
  chat_id: string;
  command: string;
  step: string;
  draft_json: string;
  updated_at: string;
}

export interface BotDialogState {
  chatId: string;
  command: string;
  step: string;
  draft: unknown;
  updatedAt: string;
}

export class DeduplicationStorage {
  private readonly database: Database.Database;

  private readonly findProcessed;
  private readonly insertProcessed;
  private readonly deleteExpired;
  private readonly getBotUpdateOffset;
  private readonly setBotUpdateOffset;
  private readonly findBotDialog;
  private readonly upsertBotDialog;
  private readonly deleteBotDialog;

  public constructor(databasePath = DEFAULT_DATABASE_PATH) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS processed_messages (
        chat_id TEXT NOT NULL,
        message_id INTEGER NOT NULL,
        processed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chat_id, message_id)
      );
      CREATE TABLE IF NOT EXISTS bot_update_cursor (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        next_update_id INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bot_dialogs (
        chat_id TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        step TEXT NOT NULL,
        draft_json TEXT NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    this.findProcessed = this.database.prepare<[string, number], ProcessedMessageRow>(`
      SELECT chat_id
      FROM processed_messages
      WHERE chat_id = ? AND message_id = ?
    `);
    this.insertProcessed = this.database.prepare<[string, number]>(`
      INSERT OR IGNORE INTO processed_messages (chat_id, message_id)
      VALUES (?, ?)
    `);
    this.deleteExpired = this.database.prepare(`
      DELETE FROM processed_messages
      WHERE processed_at < datetime('now', '-${RETENTION_DAYS} days')
    `);
    this.getBotUpdateOffset = this.database.prepare<[], OffsetRow>(`
      SELECT next_update_id FROM bot_update_cursor WHERE id = 1
    `);
    this.setBotUpdateOffset = this.database.prepare<[number]>(`
      INSERT INTO bot_update_cursor (id, next_update_id) VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET next_update_id = excluded.next_update_id
    `);
    this.findBotDialog = this.database.prepare<[string], BotDialogRow>(`
      SELECT chat_id, command, step, draft_json, updated_at FROM bot_dialogs WHERE chat_id = ?
    `);
    this.upsertBotDialog = this.database.prepare<[string, string, string, string]>(`
      INSERT INTO bot_dialogs (chat_id, command, step, draft_json, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(chat_id) DO UPDATE SET
        command = excluded.command, step = excluded.step, draft_json = excluded.draft_json,
        updated_at = CURRENT_TIMESTAMP
    `);
    this.deleteBotDialog = this.database.prepare<[string]>(`DELETE FROM bot_dialogs WHERE chat_id = ?`);

    this.cleanupExpired();
  }

  public isProcessed(chatId: string, messageId: number): boolean {
    return this.findProcessed.get(chatId, messageId) !== undefined;
  }

  public markProcessed(chatId: string, messageId: number): void {
    this.insertProcessed.run(chatId, messageId);
    this.cleanupExpired();
  }

  public cleanupExpired(): number {
    return this.deleteExpired.run().changes;
  }

  public getNextBotUpdateId(): number | undefined {
    return this.getBotUpdateOffset.get()?.next_update_id;
  }

  public setNextBotUpdateId(nextUpdateId: number): void {
    this.setBotUpdateOffset.run(nextUpdateId);
  }

  public getBotDialog(chatId: string): BotDialogState | undefined {
    const row = this.findBotDialog.get(chatId);
    if (!row) return undefined;
    return { chatId: row.chat_id, command: row.command, step: row.step, draft: JSON.parse(row.draft_json), updatedAt: row.updated_at };
  }

  public saveBotDialog(chatId: string, command: string, step: string, draft: unknown): void {
    this.upsertBotDialog.run(chatId, command, step, JSON.stringify(draft));
  }

  public clearBotDialog(chatId: string): boolean {
    return this.deleteBotDialog.run(chatId).changes > 0;
  }

  public close(): void {
    if (this.database.open) {
      this.database.close();
    }
  }
}

export const db = new DeduplicationStorage();
