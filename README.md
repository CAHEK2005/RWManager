# RWManager

![Version](https://img.shields.io/badge/version-2.2.0-blue.svg) [![License](https://img.shields.io/badge/license-GPL%20V3-blue.svg?longCache=true)](https://www.gnu.org/licenses/gpl-3.0)

Утилита для автоматической ротации инбаундов в панели [Remnawave](https://github.com/remnawave) (xray-based). Подключается к Remnawave по API-ключу, генерирует случайные инбаунды и обновляет config-профили по расписанию.

## Возможности

- Автоматическая ротация инбаундов в config-профилях Remnawave
- Поддержка VLESS Reality (TCP / XHTTP / gRPC), VLESS WS, Shadowsocks, Trojan
- Три режима расписания: по интервалу, ежедневно в заданное время, по дням недели
- Белый список SNI-доменов для Reality инбаундов (глобальный и на уровне профиля)
- Синхронизация хостов Remnawave после каждой ротации
- Установка нод Remnawave Node прямо из интерфейса по SSH
- SSH-терминал — плавающие окна в интерфейсе и отдельный попап; одноразовые тикеты для безопасного открытия ссылок
- Запуск bash-скриптов на нодах через SSH с системой переменных (`{{ name | label }}`); встроенные скрипты: оптимизация сети, обновление, настройка SSH-ключей
- Хранилище секретов — SSH-ключи, пароли, токены с шифрованием AES-256-GCM; выбор секрета как значения переменной при запуске скрипта
- Уведомления в Telegram после каждой ротации
- Дашборд с историей ротаций и статусом нод

## Требования

- Ubuntu 20.04+ или Debian 12+
- Docker + Docker Compose v2
- Панель Remnawave с API-ключом (интеграция проверена с API v3.2.3)

Для scoped API-токена Remnawave разрешите config profiles, nodes, hosts,
keygen и system tools; токен со scope `*` покрывает все функции RWManager.

## Установка

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/CAHEK2005/RWManager/main/install.sh)
```

Скрипт автоматически:
- устанавливает Docker если нужно
- генерирует случайные пароли и ключи (`JWT_SECRET`, `SECRET_ENCRYPTION_KEY`)
- запускает контейнеры

## Обновление

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/CAHEK2005/RWManager/main/update.sh)
```

Скрипт сохраняет конфигурацию и данные, добавляет недостающие переменные окружения (включая `SECRET_ENCRYPTION_KEY` для старых установок).

## Удаление

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/CAHEK2005/RWManager/main/delete.sh)
```

---

## Посмотреть логин и пароль

```bash
grep -E "ADMIN_LOGIN|ADMIN_PASSWORD" /opt/rwm-manager/server/.env
```

---

## Переменные окружения

Все обязательные переменные перечислены в `.env.example`. При ручной установке скопируйте его в `.env` и заполните значения:

```bash
cp .env.example .env
```

| Переменная | Описание |
|---|---|
| `POSTGRES_USER` | Пользователь PostgreSQL |
| `POSTGRES_PASSWORD` | Пароль PostgreSQL |
| `POSTGRES_DB` | Имя базы данных |
| `JWT_SECRET` | Секрет для подписи JWT-токенов (мин. 32 байта, hex) |
| `ADMIN_LOGIN` | Логин администратора при первом запуске |
| `ADMIN_PASSWORD` | Пароль администратора при первом запуске |
| `SECRET_ENCRYPTION_KEY` | Ключ шифрования хранилища секретов — 64 hex-символа (32 байта) |
| `CORS_ORIGIN` | Разрешённый origin для CORS (например `https://rwm.example.com`) |
| `PORT` | Внешний порт фронтенда (по умолчанию `80`) |

---

## Шифрование секретов

Ключ `SECRET_ENCRYPTION_KEY` генерируется автоматически при установке через `install.sh`.

Для ручной установки или добавления ключа к существующей инсталляции:

```bash
# Сгенерировать ключ
openssl rand -hex 32

# Добавить в .env
echo "SECRET_ENCRYPTION_KEY=<результат>" >> /opt/rwm-manager/server/.env

# Перезапустить
docker compose -f /opt/rwm-manager/docker-compose.yml restart backend
```

Без ключа секреты сохраняются в plain text (предупреждение в логах бэкенда). После добавления ключа все новые и обновлённые секреты автоматически шифруются. Значения переменных скриптов маскируются в логах выполнения (`***`).

---

## Безопасность

- **Rate limiting** — не более 5 попыток входа в минуту на `/auth/login`; глобальный лимит 60 запросов/мин
- **CORS** — разрешён только origin из `CORS_ORIGIN`; без wildcard
- **Валидация** — глобальный `ValidationPipe` с `whitelist: true` отбрасывает лишние поля на всех endpoint-ах
- **Изоляция контейнеров** — backend и postgres не имеют открытых портов наружу; общаются только внутри `app-network`
- **Non-root** — оба контейнера (`backend`, `frontend`) запускаются от непривилегированного пользователя
- **Security headers** — nginx отдаёт `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`
- **Healthchecks** — postgres и backend проверяются перед стартом зависимых сервисов
- **Одноразовые тикеты** — SSH-терминал в popup-режиме открывается только по тикету, который действует 60 секунд и уничтожается после использования

---

## Стек

NestJS (backend) + React + Vite + MUI (frontend) + PostgreSQL, запускается через Docker Compose.
