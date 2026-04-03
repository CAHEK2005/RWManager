# RWManager

![Version](https://img.shields.io/badge/version-2.1.0-blue.svg) [![License](https://img.shields.io/badge/license-GPL%20V3-blue.svg?longCache=true)](https://www.gnu.org/licenses/gpl-3.0)

Утилита для автоматической ротации инбаундов в панели [Remnawave](https://github.com/remnawave) (xray-based). Подключается к Remnawave по API-ключу, генерирует случайные инбаунды и обновляет config-профили по расписанию.

## Возможности

- Автоматическая ротация инбаундов в config-профилях Remnawave
- Поддержка VLESS Reality (TCP / XHTTP / gRPC), VLESS WS, Shadowsocks, Trojan
- Три режима расписания: по интервалу, ежедневно в заданное время, по дням недели
- Белый список SNI-доменов для Reality инбаундов (глобальный и на уровне профиля)
- Синхронизация хостов Remnawave после каждой ротации
- Установка нод Remnawave Node прямо из интерфейса по SSH
- Запуск bash-скриптов на нодах через SSH (встроенные: оптимизация сети, обновление, перезапуск)
- Уведомления в Telegram после каждой ротации
- Дашборд с историей ротаций и статусом нод

## Требования

- Ubuntu 20.04+ или Debian 12+
- Docker + Docker Compose v2
- Панель Remnawave с API-ключом

## Установка

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/CAHEK2005/RWManager/main/install.sh)
```

## Обновление

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/CAHEK2005/RWManager/main/update.sh)
```

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

## Стек

NestJS (backend) + React + Vite (frontend) + PostgreSQL, запускается через Docker Compose.
