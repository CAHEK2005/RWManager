# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**3DP-Manager** — утилита для автогенерации инбаундов в панели 3x-ui, формирования единых подписок и настройки перенаправления трафика с промежуточных серверов.

Стек: NestJS (backend) + React + Vite (frontend) + PostgreSQL, запускается через Docker Compose.

## Commands

### Backend (`server/`)
```bash
npm run start:dev     # Запуск в режиме разработки (watch)
npm run build         # Компиляция TypeScript → dist/
npm run start:prod    # Запуск скомпилированного приложения
npm run lint          # ESLint с автофиксом
npm run test          # Jest unit тесты
npm run test:watch    # Jest в watch режиме
npm run test:cov      # Покрытие кода
npm run test:e2e      # E2E тесты (supertest)
```

### Frontend (`client/`)
```bash
npm run dev           # Vite dev server с HMR
npm run build         # Сборка для продакшна
npm run preview       # Предпросмотр продакшн-сборки
npm run lint          # ESLint проверка
```

### Docker (полный стек)
```bash
docker-compose up --build   # Запуск всех сервисов
```

## Architecture

### Трёхуровневая архитектура
```
React (Nginx :80) → NestJS API (:3000) → PostgreSQL (:5432)
```

- Frontend проксирует `/api/` на `http://server:3000` через Nginx
- Глобальный префикс API: `/api`
- Публичный URL подписки (без аутентификации): `GET /bus/:uuid` и `GET /bus/:uuid/:tunnelId`

### Backend (NestJS, feature-based модули)

Модули в `server/src/`:
- **auth** — JWT-аутентификация через Passport. Глобальный `JwtAuthGuard`, декоратор `@Public()` для публичных маршрутов. Единственный администратор сидируется из ENV при старте через `AuthService.seedAdmin()`.
- **xui** — интеграция с 3x-ui API (логин, добавление/удаление инбаундов, retry при занятых портах)
- **subscriptions** — CRUD подписок; инбаунды хранятся как JSON в поле `inboundsConfig`
- **inbounds** — управление инбаундами в БД (связь с 3x-ui через `xuiId`)
- **rotation** — ротация (пересоздание) всех инбаундов по расписанию
- **domains** — белый список доменов для SNI
- **tunnels** — SSH-туннели (установка форвардинг-скриптов на удалённых серверах через `ssh2`)
- **settings** — конфигурация 3x-ui хранится как key-value в БД (не в .env)

### Frontend (React 19 + MUI)

Структура в `client/src/`:
- **api.ts** — единственный Axios-инстанс с `baseURL` на `/api`
- **auth/** — `AuthContext` (JWT в localStorage), `RequireAuth`, `PublicRoute`, `AxiosInterceptor` (редирект на логин при 401)
- **pages/** — `SubscriptionsPage`, `DomainsPage`, `TunnelsPage`, `SettingsPage`, `LoginPage`
- **components/** — `Layout`, `Header`, `Footer`

Управление состоянием: только React Context + локальный `useState` (нет Redux/Zustand).

### База данных (TypeORM + PostgreSQL)

Сущности:
- **Setting** — key-value хранилище конфигурации (включая URL и credentials 3x-ui)
- **Subscription** — подписка с полем `inboundsConfig: JSON[]` и связью OneToMany с Inbound
- **Inbound** — инбаунд в 3x-ui (`xuiId`, `port`, `protocol`, `link`), ManyToOne к Subscription
- **Domain** — доменное имя для белого списка SNI
- **Tunnel** — SSH-туннель (credentials хранятся с `select: false`)

### Переменные окружения (server/.env)

```
DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_NAME
ADMIN_LOGIN, ADMIN_PASSWORD
JWT_SECRET
```

Настройки подключения к 3x-ui хранятся в БД (таблица settings), а не в .env.
