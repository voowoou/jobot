import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

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

export type SourceMode = "all" | "allowlist" | "denylist";
export interface SourceSettings {
	mode: SourceMode;
	chatIds: string[];
	paused: boolean;
}
interface SourceRow {
	chat_id: string;
	title: string | null;
}

export interface DeliveryTask {
	id: number;
	chatId: string;
	messageId: number;
	profileId: string;
	notification: string;
	attempts: number;
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
	private readonly findSourceMode;
	private readonly writeSourceMode;
	private readonly listSources;
	private readonly addSource;
	private readonly removeSource;
	private readonly findPaused;
	private readonly writePaused;
	private readonly enqueueOutbox;
	private readonly findDueOutbox;
	private readonly deleteOutbox;
	private readonly rescheduleOutbox;
	private readonly countOutbox;
	private readonly markDeliveredTransaction;
	private readonly incrementCounterStatement;
	private readonly readCounters;
	private readonly getFingerprintFlag;
	private readonly setFingerprintFlagStatement;
	private readonly findFingerprint;
	private readonly insertFingerprint;

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
      CREATE TABLE IF NOT EXISTS source_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        mode TEXT NOT NULL DEFAULT 'all' CHECK (mode IN ('all', 'allowlist', 'denylist')),
        paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS source_chats (
        chat_id TEXT PRIMARY KEY,
        title TEXT
      );
      CREATE TABLE IF NOT EXISTS delivery_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        message_id INTEGER NOT NULL,
        profile_id TEXT NOT NULL,
        notification TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(chat_id, message_id, profile_id)
      );
      CREATE TABLE IF NOT EXISTS app_counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS delivery_settings (id INTEGER PRIMARY KEY CHECK (id = 1), cross_channel_dedup INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS message_fingerprints (fingerprint TEXT PRIMARY KEY, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
    `);

		this.findProcessed = this.database.prepare<
			[string, number],
			ProcessedMessageRow
		>(`
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
		this.upsertBotDialog = this.database.prepare<
			[string, string, string, string]
		>(`
      INSERT INTO bot_dialogs (chat_id, command, step, draft_json, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(chat_id) DO UPDATE SET
        command = excluded.command, step = excluded.step, draft_json = excluded.draft_json,
        updated_at = CURRENT_TIMESTAMP
    `);
		this.deleteBotDialog = this.database.prepare<[string]>(
			`DELETE FROM bot_dialogs WHERE chat_id = ?`,
		);
		this.findSourceMode = this.database.prepare<[], { mode: SourceMode }>(
			`SELECT mode FROM source_settings WHERE id = 1`,
		);
		this.writeSourceMode = this.database.prepare<[SourceMode]>(
			`INSERT INTO source_settings (id, mode) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET mode = excluded.mode`,
		);
		this.listSources = this.database.prepare<[], SourceRow>(
			`SELECT chat_id, title FROM source_chats ORDER BY chat_id`,
		);
		this.addSource = this.database.prepare<[string, string | null]>(
			`INSERT INTO source_chats (chat_id, title) VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET title = COALESCE(excluded.title, source_chats.title)`,
		);
		this.removeSource = this.database.prepare<[string]>(
			`DELETE FROM source_chats WHERE chat_id = ?`,
		);
		this.findPaused = this.database.prepare<[], { paused: number }>(
			`SELECT paused FROM source_settings WHERE id = 1`,
		);
		this.writePaused = this.database.prepare<[number]>(
			`INSERT INTO source_settings (id, paused) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET paused = excluded.paused`,
		);
		this.enqueueOutbox = this.database.prepare<[string, number, string, string, number]>(`INSERT OR IGNORE INTO delivery_outbox (chat_id, message_id, profile_id, notification, next_attempt_at) VALUES (?, ?, ?, ?, ?)`);
		this.findDueOutbox = this.database.prepare<[number], { id: number; chat_id: string; message_id: number; profile_id: string; notification: string; attempts: number }>(`SELECT id, chat_id, message_id, profile_id, notification, attempts FROM delivery_outbox WHERE next_attempt_at <= ? ORDER BY id LIMIT 20`);
		this.deleteOutbox = this.database.prepare<[number]>(`DELETE FROM delivery_outbox WHERE id = ?`);
		this.rescheduleOutbox = this.database.prepare<[number, number]>(`UPDATE delivery_outbox SET attempts = attempts + 1, next_attempt_at = ? WHERE id = ?`);
		this.countOutbox = this.database.prepare<[], { count: number }>(`SELECT count(*) AS count FROM delivery_outbox`);
		this.markDeliveredTransaction = this.database.transaction((taskId: number, chatId: string, messageId: number) => { this.insertProcessed.run(chatId, messageId); this.deleteOutbox.run(taskId); });
		this.incrementCounterStatement = this.database.prepare<[string]>(`INSERT INTO app_counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1`);
		this.readCounters = this.database.prepare<[], { name: string; value: number }>(`SELECT name, value FROM app_counters`);
		this.getFingerprintFlag = this.database.prepare<[], { enabled: number }>(`SELECT cross_channel_dedup AS enabled FROM delivery_settings WHERE id = 1`);
		this.setFingerprintFlagStatement = this.database.prepare<[number]>(`INSERT INTO delivery_settings (id, cross_channel_dedup) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET cross_channel_dedup = excluded.cross_channel_dedup`);
		this.findFingerprint = this.database.prepare<[string], { fingerprint: string }>(`SELECT fingerprint FROM message_fingerprints WHERE fingerprint = ?`);
		this.insertFingerprint = this.database.prepare<[string]>(`INSERT OR IGNORE INTO message_fingerprints (fingerprint) VALUES (?)`);

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
		return {
			chatId: row.chat_id,
			command: row.command,
			step: row.step,
			draft: JSON.parse(row.draft_json),
			updatedAt: row.updated_at,
		};
	}

	public saveBotDialog(
		chatId: string,
		command: string,
		step: string,
		draft: unknown,
	): void {
		this.upsertBotDialog.run(chatId, command, step, JSON.stringify(draft));
	}

	public clearBotDialog(chatId: string): boolean {
		return this.deleteBotDialog.run(chatId).changes > 0;
	}

	public getSourceSettings(): SourceSettings {
		const mode = this.findSourceMode.get()?.mode ?? "all";
		const paused = this.findPaused.get()?.paused === 1;
		return {
			mode,
			paused,
			chatIds: this.listSources.all().map((row) => row.chat_id),
		};
	}

	public listSourceChats(): SourceRow[] {
		return this.listSources.all();
	}
	public setSourceMode(mode: SourceMode): void {
		this.writeSourceMode.run(mode);
	}
	public addSourceChat(chatId: string, title?: string): void {
		this.addSource.run(chatId, title ?? null);
	}
	public removeSourceChat(chatId: string): boolean {
		return this.removeSource.run(chatId).changes > 0;
	}
	public setNotificationsPaused(paused: boolean): void {
		this.writePaused.run(paused ? 1 : 0);
	}

	public enqueueDelivery(chatId: string, messageId: number, profileId: string, notification: string): void {
		this.enqueueOutbox.run(chatId, messageId, profileId, notification, Date.now());
	}
	public getDueDeliveries(): DeliveryTask[] {
		return this.findDueOutbox.all(Date.now()).map((task) => ({ id: task.id, chatId: task.chat_id, messageId: task.message_id, profileId: task.profile_id, notification: task.notification, attempts: task.attempts }));
	}
	public markDeliverySucceeded(task: DeliveryTask): void { this.markDeliveredTransaction(task.id, task.chatId, task.messageId); this.cleanupExpired(); }
	public rescheduleDelivery(task: DeliveryTask, nextAttemptAt: number): void { this.rescheduleOutbox.run(nextAttemptAt, task.id); }
	public getOutboxCount(): number { return this.countOutbox.get()?.count ?? 0; }
	public incrementCounter(name: string): void { this.incrementCounterStatement.run(name); }
	public getCounters(): Record<string, number> { return Object.fromEntries(this.readCounters.all().map((row) => [row.name, row.value])); }
	public isCrossChannelDedupEnabled(): boolean { return this.getFingerprintFlag.get()?.enabled === 1; }
	public setCrossChannelDedupEnabled(enabled: boolean): void { this.setFingerprintFlagStatement.run(enabled ? 1 : 0); }
	public hasFingerprint(fingerprint: string): boolean { return this.findFingerprint.get(fingerprint) !== undefined; }
	public saveFingerprint(fingerprint: string): void { this.insertFingerprint.run(fingerprint); }

	public close(): void {
		if (this.database.open) {
			this.database.close();
		}
	}
}

export const db = new DeduplicationStorage();
