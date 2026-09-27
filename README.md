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

Начните с `/start`: бот подскажет создать первый профиль (`/profiles add`), посмотреть список (`/profiles`) и прислать тестовую карточку (`/test`). Если пользовательских профилей ещё нет, `/profiles` также прямо предложит `/profiles add`; до этого действует встроенный Frontend-профиль. Полная встроенная инструкция с аргументами и примерами доступна по `/help`.

Профилями также можно управлять командами `/profiles edit <id>`, `/profiles toggle <id>` и `/profiles remove <id>`. В мастере профиля обязательные поля нужно заполнить; в необязательных полях `-` означает «пропустить».

`/sources mode <all|allowlist|denylist>` меняет режим источников, а `/sources add <chat_id>` и `/sources remove <chat_id>` управляют списком. Режим `all` обрабатывает все группы и каналы и не требует списка; `allowlist` — только источники из списка; `denylist` — все, кроме списка. Чтобы не менять режим по ошибке, переключение на `allowlist` бот просит подтвердить. `CROSS_CHANNEL_DEDUP_ENABLED=true` включает подавление идентичных перепостов между каналами; по умолчанию функция выключена.

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

## Локальная разработка и проверка

```bash
pnpm dev
```

`pnpm dev` запускает TypeScript через `tsx` и перезапускается при изменениях. Для однократного локального запуска используйте `pnpm start`.

Проверить код без Telegram-ключей:

```bash
pnpm typecheck
pnpm test
```

После JSON-лога `application.started` отправьте **с другого аккаунта** новое сообщение в группу или канал, например:

```text
Вакансия: ищем React middle разработчика, remote.
```

Подходящая вакансия отправляется в личный чат с ботом и только затем отмечается обработанной в `data/app.db`. Одинаковая пара чат/сообщение не отправляется повторно 30 дней. История до запуска не обрабатывается.

Production-сборка создаёт JavaScript в `dist/`:

```bash
pnpm build
pnpm start:prod
```

`pnpm start:prod` предназначен для VPS и не требует `tsx` в runtime. Не запускайте одновременно `pnpm start`, `pnpm dev` или `pnpm start:prod`: Bot API допускает только один long polling consumer.

## PM2 / VPS

```bash
pnpm add -g pm2
pnpm install --frozen-lockfile
pnpm build
pnpm prune --prod
pm2 start ecosystem.config.cjs
pm2 logs telegram-vacancy-bot
pm2 save
pm2 startup
```

PM2 запускает собранный `dist/index.js` обычным Node.js в одном экземпляре; cluster mode использовать нельзя, потому что Bot API допускает только один long polling consumer. Выполните команду, которую напечатает `pm2 startup`, от пользователя, запускающего процесс. PM2 отправляет `SIGTERM`; Jobot прекращает приём новых сообщений, отключает Telegram-клиент и закрывает SQLite.

### Память и логи на VPS

В `ecosystem.config.cjs` явно задан один процесс в fork mode. Node получает лимит old space 128 MiB, а PM2 перезапускает процесс при RSS 192 MiB. Это не замена поиску утечек: PM2 фиксирует memory restart в собственных логах. Меняйте лимит только после замера RSS через `pm2 monit`; после изменения `ecosystem.config.cjs` примените его командой `pm2 reload telegram-vacancy-bot`.

Ограничьте рост PM2-логов модулем ротации:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateModule true
pm2 conf
```

Такая настройка хранит текущий лог и не более семи сжатых архивов для каждого лога. Регулярно проверяйте процесс, логи и данные:

```bash
pm2 status
pm2 monit
pm2 logs telegram-vacancy-bot --lines 100
du -sh data ~/.pm2/logs
```

Не включайте `LOG_LEVEL=debug` надолго на VPS: логи не содержат токены, StringSession и текст вакансий, но высокий уровень всё равно создаёт лишний объём. Для изменения memory limit сначала посмотрите RSS в `pm2 monit`, затем поменяйте `node_args` и `max_memory_restart` вместе, сохраняя небольшой запас у restart-порога.

### Обновление без потери данных

На сервере не удаляйте `.env` и каталог `data/`: в нём находятся SQLite и пользовательские профили.

```bash
git pull
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm prune --prod
pm2 reload telegram-vacancy-bot
```

После `pnpm prune --prod` для диагностики и разработки снова выполните обычный `pnpm install`, чтобы вернуть dev dependencies.

### Backup, restore и миграция

Перед переносом или обновлением сохраните `.env` и весь каталог `data/` — в нём находятся `app.db`, очередь доставок и `profiles.yaml`. Для согласованной копии сначала остановите процесс: `pm2 stop telegram-vacancy-bot`. При штатной остановке Jobot делает SQLite WAL checkpoint; никогда не удаляйте `app.db-wal` или `app.db-shm` файловыми командами, пока процесс работает. При restore верните эти файлы на место до запуска процесса.

Fingerprint перепостов между каналами хранится не дольше 30 дней и автоматически очищается. После пяти неудачных попыток задача доставки логируется и удаляется из outbox, чтобы не расти бесконечно; исходное сообщение при этом не становится processed и не считается доставленным.

Существующий `data/profiles.yaml` и команды `pnpm profiles:*` продолжают работать без миграции. Профили, созданные ботом, сразу видны CLI, и наоборот.

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
