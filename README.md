# Jobot

Jobot отслеживает новые сообщения в Telegram-каналах и чатах от имени вашего аккаунта, находит подходящие вакансии и отправляет карточки в личный чат с Telegram-ботом.

Сейчас включён профиль Frontend: React, Next.js, JavaScript, Frontend; вакансии уровня Senior и Lead исключаются. Профили находятся в `src/config/profiles.ts`.

## Требования

- Node.js 20 или новее (рекомендуется актуальный LTS);
- pnpm;
- Telegram API ID и API hash.
- Бот, созданный через @BotFather.

Для `better-sqlite3` на Linux может потребоваться компилятор C/C++ и Python 3, если для вашей версии Node.js нет готового бинарника.

## Установка

```bash
pnpm install
cp .env.example .env
```

В PowerShell вместо `cp`:

```powershell
Copy-Item .env.example .env
```

Откройте `.env` и заполните:

```dotenv
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_BOT_TOKEN=123456:bot_token
TELEGRAM_BOT_CHAT_ID=
LOG_LEVEL=info
```

`TELEGRAM_API_ID` и `TELEGRAM_API_HASH` создаются на [my.telegram.org/apps](https://my.telegram.org/apps). Не передавайте их и `TELEGRAM_STRING_SESSION` другим людям.

## Авторизация

Запустите интерактивную авторизацию:

```bash
pnpm auth
```

Скрипт спросит номер телефона, код Telegram и пароль двухфакторной аутентификации, если он включён. По завершении он выведет `StringSession`. Вставьте это значение в `.env`:

```dotenv
TELEGRAM_STRING_SESSION=your_string_session
```

После этого повторная авторизация не требуется, пока сессия действительна.

## Настройка бота

Создайте бота через @BotFather, откройте с ним личный чат и отправьте `/start`. Добавьте token в `TELEGRAM_BOT_TOKEN`, затем выполните:

```bash
pnpm bot:setup
```

Команда проверит token и выведет строку для `TELEGRAM_BOT_CHAT_ID`. Добавьте её в `.env`.

## Запуск

Для обычного запуска:

```bash
pnpm start
```

Для разработки с перезапуском при изменениях:

```bash
pnpm dev
```

При запуске Jobot проверяет сессию и bot token, затем начинает слушать только входящие сообщения. Подходящая вакансия сохраняется в `data/app.db` после успешной отправки уведомления. Одна и та же пара чат/сообщение не будет отправлена повторно в течение 30 дней.

## PM2 / VPS

Установите PM2 на сервере:

```bash
pnpm add -g pm2
pm2 start ecosystem.config.cjs
pm2 logs telegram-vacancy-bot
```

Чтобы процесс пережил перезагрузку сервера:

```bash
pm2 save
pm2 startup
```

Выполните команду, которую выведет `pm2 startup`, от пользователя, запускающего приложение. Для обновления кода на сервере: установите зависимости, затем выполните `pm2 restart telegram-vacancy-bot`.

## Полезные команды

```bash
pnpm typecheck
pm2 status
pm2 restart telegram-vacancy-bot
pm2 logs telegram-vacancy-bot
```

`.env`, база `data/app.db`, сессии и `node_modules` исключены из Git.
