interface BotApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
  };
}

export interface BotIdentity {
  id: number;
  username?: string;
}

export interface BotUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: {
      id: number;
      type: string;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number } };
  };
}

export interface InlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

export class BotApiError extends Error {
  public constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "BotApiError";
  }
}

export class TelegramBotClient {
  public constructor(
    private readonly token: string,
    private readonly chatId?: string,
  ) {}

  public async getMe(): Promise<BotIdentity> {
    return this.call<BotIdentity>("getMe");
  }

  public async getUpdates(offset?: number, timeout = 0, signal?: AbortSignal): Promise<BotUpdate[]> {
    const parameters: Record<string, string> = { allowed_updates: JSON.stringify(["message", "callback_query"]) };
    if (offset !== undefined) parameters.offset = String(offset);
    if (timeout > 0) parameters.timeout = String(timeout);
    return this.call<BotUpdate[]>("getUpdates", parameters, signal);
  }

  public async sendText(chatId: string, text: string, replyMarkup?: InlineKeyboard): Promise<void> {
    const parameters: Record<string, string> = { chat_id: chatId, text };
    if (replyMarkup) parameters.reply_markup = JSON.stringify(replyMarkup);
    await this.call("sendMessage", parameters);
  }

  public async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    const parameters: Record<string, string> = { callback_query_id: callbackQueryId };
    if (text) parameters.text = text;
    await this.call("answerCallbackQuery", parameters);
  }

  public async sendNotification(text: string): Promise<void> {
    if (!this.chatId) {
      throw new Error("TELEGRAM_BOT_CHAT_ID is not configured. Run `pnpm bot:setup`.");
    }

    await this.call("sendMessage", {
      chat_id: this.chatId,
      text,
      parse_mode: "MarkdownV2",
      link_preview_options: JSON.stringify({ is_disabled: true }),
    });
  }

  private async call<T>(method: string, parameters: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(parameters),
        signal,
      });
    } catch {
      // Do not include the underlying fetch error: it may contain the request URL and bot token.
      throw new BotApiError(`Bot API network error while calling ${method}`);
    }

    let payload: BotApiResponse<T>;

    try {
      payload = (await response.json()) as BotApiResponse<T>;
    } catch {
      throw new BotApiError(`Bot API returned a non-JSON response for ${method}`, response.status);
    }

    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new BotApiError(
        payload.description || `Bot API request failed: ${method}`,
        payload.error_code || response.status,
        payload.parameters?.retry_after,
      );
    }

    return payload.result;
  }
}
