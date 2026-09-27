# Jobot

Jobot отслеживает новые сообщения в группах, супергруппах и каналах, доступных вашему личному Telegram-аккаунту, находит подходящие вакансии и отправляет карточки в личный чат с Telegram-ботом.

Личные диалоги и ваши собственные исходящие сообщения не обрабатываются. Источники читает личный аккаунт через GramJS; бот используется только для доставки уведомлений.

## Требования

- Node.js 20+ (рекомендуется актуальный LTS);
- pnpm;
- Telegram API ID и API hash;
- бот, созданный через @BotFather.

Для `better-sqlite3` на Linux могут потребоваться C/C++ compiler и Python 3, если для вашей версии Node.js нет готового бинарника.

## Установка и авторизация

```bash
pnpm install
cp .env.example .env
pnpm auth
```

В PowerShell вместо `cp` используйте:

```powershell
Copy-Item .env.example .env
```

Заполните в `.env`:

```dotenv
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_STRING_SESSION= # значение, выведенное pnpm auth
TELEGRAM_BOT_TOKEN=123456:bot_token
TELEGRAM_BOT_CHAT_ID=
LOG_LEVEL=info
```

`pnpm auth` спросит номер, код Telegram и пароль двухфакторной аутентификации, если он включён. Не передавайте `.env` и `TELEGRAM_STRING_SESSION` другим людям.

## Настройка доставки ботом

1. Создайте бота через @BotFather.
2. Откройте личный чат с ним и отправьте `/start`.
3. Добавьте token в `TELEGRAM_BOT_TOKEN`.
4. Выполните:

   ```bash
   pnpm bot:setup
   ```

5. Скопируйте выведенное значение в `TELEGRAM_BOT_CHAT_ID`.

## Профили поиска

## Управление через бота

Команды Bot API принимаются через long polling: публичный HTTPS endpoint не нужен. Не запускайте одновременно `pnpm bot:setup` и `pnpm start`, поскольку оба читают updates.

Только владелец из `TELEGRAM_BOT_CHAT_ID` может использовать `/profiles`, `/sources`, `/pause`, `/resume`, `/status`, `/test` и `/cancel`. Профиль создаётся через `/profiles add`, а CLI остаётся резервным способом управления. Незавершённый мастер переживает рестарт.

`/sources mode <all|allowlist|denylist>` меняет режим источников, а `/sources add <chat_id>` и `/sources remove <chat_id>` управляют списком. `CROSS_CHANNEL_DEDUP_ENABLED=true` включает подавление идентичных перепостов между каналами; по умолчанию функция выключена.

Профили хранятся в `data/profiles.yaml`. Файл создаётся через CLI и исключён из Git. Строки — обычные слова и фразы, не regexp.

```bash
pnpm profiles:list
pnpm profiles:add
pnpm profiles:edit <id>
pnpm profiles:remove <id>
pnpm profiles:validate
```

Перед изменением CLI показывает итоговый профиль и просит подтверждение. Изменения применяются после перезапуска Jobot.

Если `data/profiles.yaml` отсутствует или пуст, используется встроенный Frontend-профиль. Пример структуры доступен в [data/profiles.example.yaml](data/profiles.example.yaml).

## Запуск и проверка

```bash
pnpm start
```

Для разработки:

```bash
pnpm dev
```

После JSON-лога `application.started` отправьте **с другого аккаунта** новое сообщение в группу или канал, например:

```text
Вакансия: ищем React middle разработчика, remote.
```

Подходящая вакансия отправляется в личный чат с ботом и только затем отмечается обработанной в `data/app.db`. Одинаковая пара чат/сообщение не отправляется повторно 30 дней. История до запуска не обрабатывается.

Проверить код без Telegram-ключей:

```bash
pnpm typecheck
pnpm test
```

## PM2 / VPS

```bash
pnpm add -g pm2
pm2 start ecosystem.config.cjs
pm2 logs telegram-vacancy-bot
pm2 save
pm2 startup
```

Выполните команду, которую напечатает `pm2 startup`, от пользователя, запускающего процесс. PM2 отправляет `SIGTERM`; Jobot прекращает приём новых сообщений, отключает Telegram-клиент и закрывает SQLite.

### Обновление без потери данных

На сервере не удаляйте `.env` и каталог `data/`: в нём находятся SQLite и пользовательские профили.

```bash
git pull
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pm2 reload telegram-vacancy-bot
```

## Troubleshooting

| Симптом | Что проверить |
| --- | --- |
| Бот не присылает сообщения | Бот должен получить `/start`; проверьте `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_CHAT_ID` и логи `vacancy.delivery_failed`. |
| `bot was blocked by the user` | Откройте чат с ботом, отправьте `/start`, затем перезапустите Jobot. |
| `chat not found` | Повторно выполните `pnpm bot:setup` и обновите `TELEGRAM_BOT_CHAT_ID`. |
| Нет реакции на тестовую вакансию | Сообщение должно быть новым, из группы/супергруппы/канала и от другого аккаунта; личные чаты и ваши сообщения игнорируются. |
| Сессия не авторизована | Повторите `pnpm auth` и замените `TELEGRAM_STRING_SESSION` в `.env`. |
| Ошибка SQLite | Убедитесь, что процесс может писать в `data/`, что на диске есть место и база не открыта несколькими экземплярами Jobot. |

`.env`, сессии, `data/app.db` и `data/profiles.yaml` не попадают в Git.
