import React, { useEffect, useState } from 'react';
import { Box, TextField, Button, Typography, Paper, Snackbar, Alert, Grid, Divider, InputAdornment, Stack, Chip } from '@mui/material';
import api from '../api';

const ROTATION_PRESETS = [
  { label: 'Сутки', value: 1440 },
  { label: '3 дня', value: 4320 },
  { label: 'Неделя', value: 10080 },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    xui_url: '',
    xui_login: '',
    xui_password: '',
    rotation_interval: '30',
  });

  const [adminProfile, setAdminProfile] = useState({
    login: '',
    password: '',
  });

  const [msg, setMsg] = useState({ open: false, type: 'success' as 'success' | 'error', text: '' });
  const [intervalError, setIntervalError] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    const val = parseInt(settings.rotation_interval, 10);
    if (isNaN(val) || val < 10) {
      setIntervalError('Минимальный интервал — 10 минут');
    } else {
      setIntervalError('');
    }
  }, [settings.rotation_interval]);

  const loadSettings = async () => {
    try {
      const { data } = await api.get('/settings');
      setSettings((prev) => ({ ...prev, ...data }));

      if (data.admin_login) {
        setAdminProfile((prev) => ({ ...prev, login: data.admin_login }));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSettingChange = (prop: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setSettings({ ...settings, [prop]: event.target.value });
  };

  const handlePresetClick = (minutes: number) => {
    setSettings(prev => ({ ...prev, rotation_interval: minutes.toString() }));
  };

  const handleSaveSettings = async () => {
    if (intervalError) {
      setMsg({ open: true, text: 'Исправьте ошибки перед сохранением', type: 'error' });
      return;
    }

    try {
      await api.post('/settings', settings);
      setMsg({ open: true, type: 'success', text: 'Настройки сохранены!' });
    } catch (e) {
      setMsg({ open: true, type: 'error', text: 'Ошибка сохранения' });
    }
  };

  const handleAdminChange = (prop: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setAdminProfile({ ...adminProfile, [prop]: event.target.value });
  };

  const handleSaveAdmin = async () => {
    try {
      await api.post('/auth/update-profile', adminProfile);
      setMsg({ open: true, type: 'success', text: 'Профиль администратора обновлен!' });
      setAdminProfile(prev => ({ ...prev, password: '' }));
    } catch (e) {
      setMsg({ open: true, type: 'error', text: 'Ошибка обновления профиля' });
    }
  };

  const handleForceRotate = async () => {
    if (confirm('ВНИМАНИЕ: Это немедленно обновит конфиги в подписках.\n\nИнтервал автоматической ротации НЕ будет сброшен.\n\nПродолжить?')) {
      try {
        await api.post('/rotation/rotate-all');
        setMsg({ open: true, type: 'success', text: 'Ротация успешно выполнена!' });
      } catch (e) {
        setMsg({ open: true, type: 'error', text: 'Ошибка при запуске ротации' });
      }
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Настройки утилиты</Typography>

      <Grid container spacing={3}>

        <Grid size={{ xs: 12, md: 6 }}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Typography variant="h6" gutterBottom>Панель 3x-ui</Typography>
            <Divider sx={{ mb: 2 }} />

            <TextField
              fullWidth margin="normal" label="URL панели"
              value={settings.xui_url} onChange={handleSettingChange('xui_url')}
              helperText="Например: https://my-vpn.com:2053/panel_path"
            />
            <TextField
              fullWidth margin="normal" label="Логин 3x-ui"
              value={settings.xui_login} onChange={handleSettingChange('xui_login')}
            />
            <TextField
              fullWidth margin="normal" label="Пароль 3x-ui" type="password"
              value={settings.xui_password} onChange={handleSettingChange('xui_password')}
            />

            <Button variant="contained" sx={{ mt: 2 }} onClick={handleSaveSettings}>
              Сохранить подключение
            </Button>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>

            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>Генерация инбаундов</Typography>
              <Divider sx={{ mb: 2 }} />

              <TextField
                fullWidth margin="normal" label="Интервал генерации"
                type="number"
                value={settings.rotation_interval}
                onChange={handleSettingChange('rotation_interval')}
                slotProps={{
                  input: { endAdornment: <InputAdornment position="end">мин</InputAdornment> }
                }}
                helperText="Как часто менять инбаунды (минимум 10 мин)"
              />
              <Stack direction="row" spacing={1} sx={{ mt: 1, mb: 2 }}>
                {ROTATION_PRESETS.map((preset) => (
                  <Chip
                    key={preset.value}
                    label={preset.label}
                    onClick={() => handlePresetClick(preset.value)}
                    color={settings.rotation_interval === preset.value.toString() ? "primary" : "default"}
                    variant={settings.rotation_interval === preset.value.toString() ? "filled" : "outlined"}
                    clickable
                  />
                ))}
              </Stack>
              <Button variant="contained" sx={{ mt: 2 }} onClick={handleSaveSettings}>
                Применить интервал
              </Button>
              <Button
                variant="outlined"
                color="warning"
                onClick={handleForceRotate}
                sx={{ mt: 2, ml: 2 }}
              >
                Сгенерировать сейчас
              </Button>
            </Paper>

            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>Доступ к 3DP-MANAGER</Typography>
              <Divider sx={{ mb: 2 }} />

              <TextField
                fullWidth margin="normal" label="Логин администратора"
                value={adminProfile.login}
                onChange={handleAdminChange('login')}
              />
              <TextField
                fullWidth margin="normal" label="Новый пароль" type="password"
                value={adminProfile.password}
                onChange={handleAdminChange('password')}
                helperText="Оставьте пустым, если не хотите менять"
              />
              <Button variant="contained" color="warning" sx={{ mt: 2 }} onClick={handleSaveAdmin}>
                Обновить профиль
              </Button>
            </Paper>

          </Box>
        </Grid>
      </Grid>

      <Snackbar open={msg.open} autoHideDuration={5000} onClose={() => setMsg({ ...msg, open: false })}>
        <Alert severity={msg.type}>{msg.text}</Alert>
      </Snackbar>
    </Box>
  );
}