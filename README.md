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
- SSH-терминал — плавающие окна в интерфейсе и отдельный попап; одноразовые тикеты для безопасного открытия ссылок
- Запуск bash-скриптов на нодах через SSH с системой переменных (`{{ name | label }}`); встроенные скрипты: оптимизация сети, обновление, настройка SSH-ключей
- Хранилище секретов — SSH-ключи, пароли, токены с шифрованием AES-256-GCM; выбор секрета как значения переменной при запуске скрипта
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

## Шифрование секретов

Для хранения SSH-ключей, паролей и токенов с шифрованием задайте переменную `SECRET_ENCRYPTION_KEY` в `/opt/rwm-manager/server/.env`:

```bash
# Сгенерировать ключ
openssl rand -hex 32

# Добавить в .env
echo "SECRET_ENCRYPTION_KEY=<результат>" >> /opt/rwm-manager/server/.env

# Перезапустить
docker compose -f /opt/rwm-manager/docker-compose.yml restart backend
```

Без ключа секреты сохраняются в plain text (предупреждение в логах). После добавления ключа все новые и обновлённые секреты автоматически шифруются. Значения переменных скриптов маскируются в логах выполнения (`***`).

---

## Стек

NestJS (backend) + React + Vite (frontend) + PostgreSQL, запускается через Docker Compose.
