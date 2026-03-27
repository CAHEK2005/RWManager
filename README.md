# RW Profile Manager

![Version](https://img.shields.io/badge/version-2.0.2-blue.svg) [![License](https://img.shields.io/badge/license-GPL%20V3-blue.svg?longCache=true)](https://www.gnu.org/licenses/gpl-3.0) [![Telegram](https://img.shields.io/badge/Telegram-26A5E4?style=flat&logo=telegram&logoColor=white)](https://t.me/denpiligrim_web) [![YouTube Channel Subscribers](https://img.shields.io/youtube/channel/subscribers/UCOv2tFFYDY4mXOM60PVz8zw)](https://www.youtube.com/@denpiligrim)

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
bash <(curl -fsSL https://raw.githubusercontent.com/CAHEK2005/3dp-manager-remna/main/install.sh)
```

## Обновление

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/CAHEK2005/3dp-manager-remna/main/update.sh)
```

## Удаление

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/CAHEK2005/3dp-manager-remna/main/delete.sh)
```

---

## Посмотреть логин и пароль

```bash
grep -E "ADMIN_LOGIN|ADMIN_PASSWORD" /opt/rw-manager/server/.env
```

---

## Стек

NestJS (backend) + React + Vite (frontend) + PostgreSQL, запускается через Docker Compose.

---

## Обсуждение

- Телеграм: [@denpiligrim_web](https://t.me/denpiligrim_web)
- Issues: [github.com/CAHEK2005/3dp-manager-remna/issues](https://github.com/CAHEK2005/3dp-manager-remna/issues)
