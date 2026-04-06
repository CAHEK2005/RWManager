import React, { useEffect, useState } from 'react';
import {
  Box, TextField, Button, Typography, Paper, Snackbar, Alert,
  Stack, Tabs, Tab, Switch, FormControlLabel,
  IconButton, MenuItem, Tooltip, Dialog, DialogTitle, DialogContent,
} from '@mui/material';
import { LockOpen, VpnKey } from '@mui/icons-material';
import api from '../api';
import { useAlert } from '../hooks/useAlert';

interface TabPanelProps { children?: React.ReactNode; index: number; value: number; }
function TabPanel({ children, value, index }: TabPanelProps) {
  return value === index ? <Box>{children}</Box> : null;
}

export default function SettingsPage() {
  const [tab, setTab] = useState(0);

  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  const [adminLogin, setAdminLogin] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  const [tgToken, setTgToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  const [tgTopicId, setTgTopicId] = useState('');
  const [tgOnError, setTgOnError] = useState(true);
  const [tgOnSuccess, setTgOnSuccess] = useState(false);
  const [tgOnScriptError, setTgOnScriptError] = useState(false);

  const [healthEnabled, setHealthEnabled] = useState(false);
  const [healthInterval, setHealthInterval] = useState('5');

  const { msg, showMsg, closeMsg } = useAlert();

  const [secrets, setSecrets] = useState<{ id: string; name: string; type: string }[]>([]);
  const [secretPickerOpen, setSecretPickerOpen] = useState(false);
  const [secretPickerCallback, setSecretPickerCallback] = useState<((v: string) => void) | null>(null);

  const openSecretPicker = (onPick: (v: string) => void) => {
    setSecretPickerCallback(() => onPick);
    setSecretPickerOpen(true);
  };

  const handlePickSecret = async (id: string) => {
    setSecretPickerOpen(false);
    if (!secretPickerCallback) return;
    try {
      const { data } = await api.get(`/secrets/${id}/value`);
      secretPickerCallback(data.value);
    } catch { /* silent */ }
  };

  useEffect(() => {
    api.get('/secrets').then(r => setSecrets(r.data)).catch(() => {});
    api.get('/settings').then(({ data }) => {
      if (data.remnawave_url) setUrl(data.remnawave_url);
      if (data.remnawave_api_key) setApiKey(data.remnawave_api_key);
      if (data.admin_login) setAdminLogin(data.admin_login);
      if (data.telegram_bot_token) setTgToken(data.telegram_bot_token);
      if (data.telegram_chat_id) setTgChatId(data.telegram_chat_id);
      if (data.telegram_topic_id) setTgTopicId(data.telegram_topic_id);
      if (data.telegram_notify_on_error !== undefined) setTgOnError(data.telegram_notify_on_error === 'true');
      if (data.telegram_notify_on_success !== undefined) setTgOnSuccess(data.telegram_notify_on_success === 'true');
      if (data.telegram_notify_on_script_error !== undefined) setTgOnScriptError(data.telegram_notify_on_script_error === 'true');
      if (data.health_check_enabled !== undefined) setHealthEnabled(data.health_check_enabled === 'true');
      if (data.health_check_interval) setHealthInterval(data.health_check_interval);
    }).catch(console.error);
  }, []);

  const handleSaveConnection = async () => {
    const cleanedUrl = url.replace(/\/+$/, '').trim();
    const cleanedKey = apiKey.trim();
    try {
      await api.post('/settings', { remnawave_url: cleanedUrl, remnawave_api_key: cleanedKey });
      setUrl(cleanedUrl);
      setApiKey(cleanedKey);
      showMsg('success', 'Настройки подключения сохранены');
    } catch {
      showMsg('error', 'Ошибка сохранения');
    }
  };

  const handleCheckConnection = async () => {
    const cleanedUrl = url.replace(/\/+$/, '').trim();
    const cleanedKey = apiKey.trim();
    try {
      showMsg('success', 'Проверка...');
      const res = await api.post('/settings/check', { remnawave_url: cleanedUrl, remnawave_api_key: cleanedKey });
      if (res.data.success) {
        showMsg('success', 'Подключение успешно');
      } else {
        showMsg('error', 'Ошибка: неверные данные или нет доступа');
      }
    } catch {
      showMsg('error', 'Ошибка сети при проверке');
    }
  };

  const handleSaveTelegram = async () => {
    try {
      await api.post('/settings', {
        telegram_bot_token: tgToken.trim(),
        telegram_chat_id: tgChatId.trim(),
        telegram_topic_id: tgTopicId.trim(),
        telegram_notify_on_error: String(tgOnError),
        telegram_notify_on_success: String(tgOnSuccess),
        telegram_notify_on_script_error: String(tgOnScriptError),
        health_check_enabled: String(healthEnabled),
        health_check_interval: healthInterval,
      });
      showMsg('success', 'Настройки Telegram сохранены');
    } catch {
      showMsg('error', 'Ошибка сохранения');
    }
  };

  const handleTestTelegram = async () => {
    try {
      await api.post('/settings/telegram/test');
      showMsg('success', 'Тестовое сообщение отправлено');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      showMsg('error', err?.response?.data?.message || 'Ошибка отправки');
    }
  };

  const handleSaveAdmin = async () => {
    try {
      await api.post('/auth/update-profile', { login: adminLogin, password: adminPassword });
      showMsg('success', 'Профиль администратора обновлён');
      setAdminPassword('');
    } catch {
      showMsg('error', 'Ошибка обновления профиля');
    }
  };

  return (
    <Box>
      {/* Page header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>Настройки</Typography>
        <Typography variant="body2" color="text.secondary">Конфигурация системы и интеграций</Typography>
      </Box>

      <Paper variant="outlined">
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
          <Tab label="Подключение" />
          <Tab label="Система" />
          <Tab label="Уведомления" />
        </Tabs>

        {/* Tab 0: Connection */}
        <TabPanel value={tab} index={0}>
          <Box sx={{ p: { xs: 2, md: 3 } }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>Подключение к Remnawave</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              URL панели и API-ключ для управления профилями
            </Typography>
            <Stack spacing={2}>
              <TextField
                fullWidth size="small" label="URL панели Remnawave"
                value={url} onChange={e => setUrl(e.target.value)}
                helperText="Например: https://panel.example.com"
              />
              <TextField
                fullWidth size="small" label="API ключ (Bearer token)" type="password"
                value={apiKey} onChange={e => setApiKey(e.target.value)}
                slotProps={{ input: { endAdornment: secrets.length > 0 ? (
                  <Tooltip title="Вставить из секретов">
                    <IconButton size="small" edge="end" onClick={() => openSecretPicker(setApiKey)}>
                      <LockOpen fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ) : undefined }}}
              />
            </Stack>
            <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 3 }}>
              {url && apiKey && (
                <Button variant="outlined" onClick={handleCheckConnection}>Проверить подключение</Button>
              )}
              <Button variant="contained" onClick={handleSaveConnection}>Сохранить</Button>
            </Stack>
          </Box>
        </TabPanel>

        {/* Tab 1: System */}
        <TabPanel value={tab} index={1}>
          <Box sx={{ p: { xs: 2, md: 3 } }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>Доступ к RWManager</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Учётные данные администратора
            </Typography>
            <Stack spacing={2}>
              <TextField
                fullWidth size="small" label="Логин администратора"
                value={adminLogin} onChange={e => setAdminLogin(e.target.value)}
              />
              <TextField
                fullWidth size="small" label="Новый пароль" type="password"
                value={adminPassword} onChange={e => setAdminPassword(e.target.value)}
                helperText="Оставьте пустым, если не хотите менять"
              />
            </Stack>
            <Stack direction="row" justifyContent="flex-end" sx={{ mt: 3 }}>
              <Button variant="contained" onClick={handleSaveAdmin}>Сохранить</Button>
            </Stack>

            <Box sx={{ mt: 4, pt: 3, borderTop: 1, borderColor: 'divider' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>Резервное копирование</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Экспорт и импорт конфигурации (профили, ноды, домены, скрипты). Секреты и API-ключи не включаются.
              </Typography>
              <Stack direction="row" spacing={1.5}>
                <Button
                  variant="outlined"
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/settings/backup', {
                        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
                      });
                      if (!res.ok) throw new Error('Ошибка');
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'backup.json';
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch { alert('Ошибка при скачивании бэкапа'); }
                  }}
                >
                  Скачать бэкап
                </Button>
                <Button
                  variant="outlined"
                  color="warning"
                  component="label"
                >
                  Восстановить из файла
                  <input type="file" accept=".json" hidden onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const text = await file.text();
                      const body = JSON.parse(text);
                      const { default: api } = await import('../api');
                      await api.post('/settings/restore', body);
                      alert('Конфигурация успешно восстановлена. Перезагрузите страницу.');
                    } catch { alert('Ошибка: некорректный файл бэкапа'); }
                    e.target.value = '';
                  }} />
                </Button>
              </Stack>
            </Box>
          </Box>
        </TabPanel>

        {/* Tab 2: Telegram */}
        <TabPanel value={tab} index={2}>
          <Box sx={{ p: { xs: 2, md: 3 } }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>Telegram-уведомления</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Отправка уведомлений о результатах ротации
            </Typography>
            <Stack spacing={2}>
              <TextField
                fullWidth size="small" label="Bot Token" type="password"
                value={tgToken} onChange={e => setTgToken(e.target.value)}
                helperText="Получить у @BotFather"
                slotProps={{ input: { endAdornment: secrets.length > 0 ? (
                  <Tooltip title="Вставить из секретов">
                    <IconButton size="small" edge="end" onClick={() => openSecretPicker(setTgToken)}>
                      <LockOpen fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ) : undefined }}}
              />
              <TextField
                fullWidth size="small" label="Chat ID"
                value={tgChatId} onChange={e => setTgChatId(e.target.value)}
                helperText="ID чата или @username канала"
              />
              <TextField
                fullWidth size="small" label="Topic ID (опционально)"
                value={tgTopicId} onChange={e => setTgTopicId(e.target.value)}
                helperText="ID топика в супергруппе (message_thread_id)"
              />
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Ротация</Typography>
                <FormControlLabel
                  control={<Switch checked={tgOnError} onChange={e => setTgOnError(e.target.checked)} />}
                  label="Уведомлять об ошибках ротации"
                />
                <FormControlLabel
                  control={<Switch checked={tgOnSuccess} onChange={e => setTgOnSuccess(e.target.checked)} />}
                  label="Уведомлять об успешных ротациях"
                />
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Скрипты</Typography>
                <FormControlLabel
                  control={<Switch checked={tgOnScriptError} onChange={e => setTgOnScriptError(e.target.checked)} />}
                  label="Уведомлять об ошибках выполнения скриптов"
                />
              </Box>
              <Box sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Мониторинг нод</Typography>
                <FormControlLabel
                  control={<Switch checked={healthEnabled} onChange={e => setHealthEnabled(e.target.checked)} />}
                  label="Уведомлять при недоступности ноды"
                />
                {healthEnabled && (
                  <TextField
                    size="small"
                    label="Интервал проверки (минуты)"
                    type="number"
                    value={healthInterval}
                    onChange={e => setHealthInterval(e.target.value)}
                    slotProps={{ htmlInput: { min: 1, max: 60 } }}
                    sx={{ mt: 1, maxWidth: 220 }}
                  />
                )}
              </Box>
            </Stack>
            <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 3 }}>
              <Button variant="outlined" onClick={handleTestTelegram} disabled={!tgToken || !tgChatId}>
                Отправить тест
              </Button>
              <Button variant="contained" onClick={handleSaveTelegram}>Сохранить</Button>
            </Stack>
          </Box>
        </TabPanel>
      </Paper>

      <Snackbar open={msg.open} autoHideDuration={5000} onClose={closeMsg}>
        <Alert severity={msg.type}>{msg.text}</Alert>
      </Snackbar>

      <Dialog open={secretPickerOpen} onClose={() => setSecretPickerOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Выбрать секрет</DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {secrets.map(s => (
            <MenuItem key={s.id} onClick={() => handlePickSecret(s.id)}>
              <Stack direction="row" spacing={1} alignItems="center">
                <VpnKey fontSize="small" color="action" />
                <Box>
                  <Typography variant="body2">{s.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {s.type === 'ssh-key' ? 'SSH-ключ' : s.type === 'password' ? 'Пароль' : s.type === 'token' ? 'Токен' : 'Другое'}
                  </Typography>
                </Box>
              </Stack>
            </MenuItem>
          ))}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
