# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**RWManager** — утилита для автоматической ротации инбаундов в Remnawave (xray-based панель). Подключается к Remnawave по API-ключу, генерирует случайные инбаунды и обновляет config-профили по расписанию.

Стек: NestJS (backend) + React + Vite (frontend) + PostgreSQL, запускается через Docker Compose.

## Commands

### Backend (`server/`)
```bash
npm run start:dev     # Запуск в режиме разработки (watch)
npm run build         # Компиляция TypeScript → dist/
npm run lint          # ESLint с автофиксом
npm run format        # Prettier форматирование
npm run test          # Jest unit тесты
npm run test:watch    # Jest в watch-режиме
npm run test:cov      # Jest с покрытием
npm run test:e2e      # E2E тесты (supertest)
# Запуск одного теста:
npx jest --testPathPattern=rotation.service
```

### Frontend (`client/`)
```bash
npm run dev           # Vite dev server с HMR
npm run build         # Сборка для продакшна
npm run lint          # ESLint проверка
```

### Docker (полный стек)
```bash
docker-compose up --build
```

## Architecture

### Трёхуровневая архитектура
```
React (Nginx :80) → NestJS API (:3000) → PostgreSQL (:5432)
```

- Frontend проксирует `/api/` на `http://server:3000` через Nginx
- Глобальный префикс API: `/api`

### Backend (NestJS, feature-based модули)

Модули в `server/src/`:
- **auth** — JWT-аутентификация через Passport. Глобальный `JwtAuthGuard`, декоратор `@Public()` для публичных маршрутов. Единственный администратор сидируется из ENV при старте через `AuthService.seedAdmin()`.
- **remnawave** — HTTP-клиент к Remnawave API (Bearer токен). Все запросы читают `remnawave_url` и `remnawave_api_key` из БД при каждом вызове. Методы: `getConfigProfiles`, `updateConfigProfile`, `createConfigProfile`, `deleteConfigProfile`, `renameConfigProfile`, `getNodes`, `getAllHosts`, `createHost`, `updateHost`, `getX25519Keys`, `applyProfileToNode`, `checkConnection`.
- **inbounds** — `InboundBuilderService` строит JSON-объекты инбаундов для xray-core (vless-reality-tcp/xhttp/grpc, vless-ws, shadowsocks-tcp, trojan-reality-tcp). Также генерирует share-ссылки (vless://, vmess://, ss://, trojan://).
- **rotation** — `RotationService` хранит список `ManagedProfile[]` как JSON в `Setting.key = 'managed_profiles'`. Cron каждую минуту проверяет, какие профили пора ротировать. Поддерживает два режима: `interval` (минуты) и `schedule` (HH:MM + timezone). `performRotation`: генерирует инбаунды → обновляет профиль в Remnawave → `syncHosts` → `applyProfileToNode`.
- **settings** — CRUD key-value настроек в БД + прокси к Remnawave API (profiles, nodes, hosts). Нет отдельного `SettingsService` — `SettingsController` напрямую инжектирует репозиторий. При сохранении `remnawave_url` автоматически определяет GeoIP страны через `ip-api.com`.
- **domains** — CRUD белого списка доменов для SNI (используются при `sni: 'random'` в inboundsConfig). Поддерживает пагинацию `?page=&limit=`, bulk-загрузку через `POST /domains/upload`, превью по URL через `POST /domains/preview-url` (возвращает категории доменов), получение всех без пагинации `GET /domains/all`, удаление всех `DELETE /domains/all`.

### ManagedProfile (ключевой тип)

```typescript
interface ManagedProfile {
  uuid: string;              // UUID профиля в Remnawave
  name: string;
  inboundsConfig: any[];     // [{type, port, sni}, ...] — конфигурация генерации
  excludedPorts: number[];   // порты, исключённые из случайной генерации
  nodeUuid: string;          // UUID ноды Remnawave
  nodeAddress: string;
  applyToNode: boolean;      // применять профиль к ноде после ротации
  hostMappings: { tag: string; hostUuid: string }[];  // UUID хостов для syncHosts (tag = полный тег инбаунда, напр. 'vless-tcp-reality-rwm')
  hostTemplate: string;      // шаблон remark: '{countryCode} {nodeName} - {inboundType}'
  rotationEnabled: boolean;
  rotationMode: 'interval' | 'schedule';
  rotationInterval: number;  // минуты
  rotationScheduleTime: string; // 'HH:MM'
  rotationTimezone: string;
  lastRotationTimestamp: number;
  lastRotationStatus: 'success' | 'error' | null;
  lastRotationError: string;
  profileDomains?: string[];  // список доменов для SNI конкретного профиля (переопределяет глобальный список из БД)
}
```

Теги инбаундов в xray-конфиге имеют суффикс `-rwm` (например, `vless-tcp-reality-rwm`). `syncHosts` ищет инбаунд по точному совпадению `tag`, с fallback на `tag.startsWith(legacyInboundType)` для старых `hostMappings`.

Поле `inboundsConfig[].tag` позволяет задать кастомный тег инбаунда вместо сгенерированного по умолчанию.

Поддерживаемые типы инбаундов (`CONNECTION_TYPES` в `inbounds.constants.ts`): `vless-tcp-reality`, `vless-xhttp-reality`, `vless-grpc-reality`, `vless-ws`, `shadowsocks-tcp`, `trojan-tcp-reality`. Тип `custom` в `inboundsConfig` пропускается при генерации. Случайные порты выбираются из диапазона 10000–60000.

Шаблон `hostTemplate` поддерживает плейсхолдеры: `{countryCode}`, `{nodeName}`, `{nodeAddress}`, `{inboundType}`, `{index}` (remark обрезается до 40 символов).

### Remnawave API endpoints (используемые)

- `GET /api/config-profiles` — список профилей; ответ: `{ response: { configProfiles: [] } }`
- `POST /api/config-profiles` — создание; `PATCH /api/config-profiles` body: `{ uuid, config }` или `{ uuid, name }` — обновление конфига/имени
- `DELETE /api/config-profiles/:uuid`
- `GET /api/nodes`; `POST /api/nodes/bulk-actions/profile-modification`
- `GET /api/hosts`; `POST /api/hosts`; `PATCH /api/hosts` body: `{ uuid, ...fields }`
- `GET /api/system/tools/x25519/generate` — ответ: `{ response: { keypairs: [{ publicKey, privateKey }] } }`

### Локальные API endpoints (NestJS, префикс `/api`)

**settings:**
- `GET /settings` — все настройки key-value объектом
- `POST /settings` — сохранить настройки; при `remnawave_url` автоматически резолвит IP и запрашивает GeoIP через `ip-api.com`
- `POST /settings/check` — проверить соединение с Remnawave; body: `{ remnawave_url, remnawave_api_key }`
- `GET /settings/profiles` — список профилей Remnawave (прокси)
- `GET /settings/nodes` — список нод Remnawave (прокси)
- `GET /settings/hosts` — список хостов Remnawave (прокси)
- `GET /settings/profiles/managed` — список управляемых профилей
- `POST /settings/profiles/managed` — добавить профиль; body: `{ uuid?, name, createNew? }` (при `createNew: true` создаёт профиль в Remnawave)
- `PATCH /settings/profiles/managed/:uuid` — обновить поля профиля
- `PATCH /settings/profiles/managed/:uuid/name` — переименовать (синхронно переименовывает в Remnawave)
- `DELETE /settings/profiles/managed/:uuid?deleteFromRemnawave=true` — удалить; опциональный query-параметр удаляет из Remnawave
- `POST /settings/profiles/managed/:uuid/rotate` — немедленная ротация одного профиля
- `POST /settings/profiles/managed/:uuid/hosts/create` — создать хосты для инбаундов профиля и сохранить `hostMappings`

**rotation:**
- `POST /rotation/rotate-all` — ротация всех профилей с `rotationEnabled: true`

### База данных (TypeORM + PostgreSQL)

Сущности:
- **Setting** — key-value хранилище всей конфигурации. Ключевые записи: `remnawave_url`, `remnawave_api_key`, `managed_profiles` (JSON), `remnawave_geo_flag`, `remnawave_geo_country`.
- **Domain** — доменное имя для белого списка SNI (`name`, `isEnabled`).

`synchronize: true` — TypeORM автоматически синхронизирует схему (только две сущности: Setting, Domain).

### Frontend (React 19 + MUI)

Структура `client/src/`:
- **api.ts** — единственный Axios-инстанс с `baseURL: '/api'`
- **auth/** — `AuthContext` (JWT в localStorage), `RequireAuth`, `PublicRoute`, `AxiosInterceptor` (редирект на `/login` при 401)
- **ThemeContext.tsx** — переключение светлой/тёмной темы MUI
- **pages/**:
  - `ProfilesPage` — главная страница, управление ManagedProfiles (CRUD, ротация, создание хостов)
  - `SettingsPage` — настройки подключения к Remnawave + общие параметры
  - `DomainsPage` — белый список доменов SNI
  - `LoginPage`, `NotFoundPage`
- **components/** — `Layout` (Outlet + nav), `Header`, `Footer`, `UrlImportDialog` (диалог импорта доменов из URL с выбором категорий, используется в `DomainsPage`)

Управление состоянием: только React Context + локальный `useState`.

### Переменные окружения (`server/.env`)

Пример в `server/.env.example`. Обязательные переменные:

```
DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_NAME
ADMIN_LOGIN, ADMIN_PASSWORD
JWT_SECRET
COUNTRY_FLAG   # Emoji-флаг по умолчанию для share-ссылок (например, 🇷🇺), иначе 💯
```

Настройки подключения к Remnawave хранятся в БД (таблица `settings`), не в `.env`. Учётные данные администратора сидируются из ENV в таблицу `settings` при старте — после этого `.env` значения `ADMIN_LOGIN`/`ADMIN_PASSWORD` не используются напрямую. Смена пароля через UI обновляет только запись в БД.

### Ключевые детали реализации

- **Слияние конфигов:** `performRotation` обновляет `inbounds`, `outbounds` и `routing` в профиле Remnawave, сохраняя остальные секции (`log`, `dns` и т.д.) из текущего конфига. `outbounds` всегда заменяется хардкодом (`DIRECT`+`BLOCK`), `routing` — правилами блокировки приватных адресов и bittorrent.
- **Дедупликация тегов:** если два инбаунда одного типа — второй получает суффикс `-2`, `-3` и т.д.
- **Миграция:** `RotationService` автоматически мигрирует устаревший формат `remnawave_profile_uuid` в `managed_profiles` при старте.
- **GeoIP:** страна/флаг для Remnawave URL резолвится только в момент сохранения URL в настройках (через `ip-api.com`).
