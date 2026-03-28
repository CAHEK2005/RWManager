# RWManager

![Version](https://img.shields.io/badge/version-2.0.2-blue.svg) [![License](https://img.shields.io/badge/license-GPL%20V3-blue.svg?longCache=true)](https://www.gnu.org/licenses/gpl-3.0)

Утилита для автоматического обновления config-profile в панели [Remnawave](https://github.com/remnawave) случайными инбаундами по расписанию.

## Возможности

- Автоматическая ротация инбаундов в выбранном config-profile Remnawave с заданным интервалом
- Поддержка VLESS Reality (TCP / XHTTP / gRPC), VLESS WS, Shadowsocks, Trojan
- Белый список SNI-доменов для Reality инбаундов (выбираются случайно)
- Синхронизация хостов Remnawave после каждой ротации
- Веб-интерфейс с настройками, маппингом хостов и выбором ноды

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

---

