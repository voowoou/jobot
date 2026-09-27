import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const RETENTION_DAYS = 30;
const DEFAULT_DATABASE_PATH = resolve(process.cwd(), "data", "app.db");

interface ProcessedMessageRow {
  chat_id: string;
}

export class DeduplicationStorage {
  private readonly database: Database.Database;

  private readonly findProcessed;
  private readonly insertProcessed;
  private readonly deleteExpired;

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

  public close(): void {
    if (this.database.open) {
      this.database.close();
    }
  }
}

export const db = new DeduplicationStorage();
