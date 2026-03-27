import React, { useEffect, useState } from 'react';
import {
  Box, TextField, Button, Typography, Paper, Snackbar, Alert, Grid, Divider,
  InputAdornment, Stack, Chip, Tooltip, IconButton, useTheme, useMediaQuery,
  Select, MenuItem, FormControl, InputLabel,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import { CheckCircle, PauseCircleFilled, PlayCircleFilled, Add, Delete } from '@mui/icons-material';
import api from '../api';

const ROTATION_PRESETS = [
  { label: 'Сутки', value: 1440 },
  { label: '3 дня', value: 4320 },
  { label: 'Неделя', value: 10080 },
];

const CONNECTION_TYPES = [
  'vless-tcp-reality',
  'vless-xhttp-reality',
  'vless-grpc-reality',
  'vless-ws',
  'shadowsocks-tcp',
  'trojan-tcp-reality',
] as const;

const SNI_TYPES = new Set([
  'vless-tcp-reality',
  'vless-xhttp-reality',
  'vless-grpc-reality',
  'vless-ws',
  'trojan-tcp-reality',
]);

interface InboundConfigItem {
  type: string;
  port: string;
  sni?: string;
}

interface Profile {
  uuid: string;
  name: string;
}

interface RwNode {
  uuid: string;
  name: string;
  address: string;
  countryCode: string;
}

interface RwHost {
  uuid: string;
  remark: string;
  address: string;
  port: number;
}

interface HostMapping {
  inboundIndex: number;
  hostUuid: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    remnawave_url: '',
    remnawave_api_key: '',
    remnawave_profile_uuid: '',
    remnawave_node_uuid: '',
    rotation_interval: '30',
    rotation_status: 'active',
    last_rotation_timestamp: '',
  });

  const [adminProfile, setAdminProfile] = useState({ login: '', password: '' });
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [nodes, setNodes] = useState<RwNode[]>([]);
  const [hosts, setHosts] = useState<RwHost[]>([]);
  const [hostMappings, setHostMappings] = useState<HostMapping[]>([]);
  const [inboundsConfig, setInboundsConfig] = useState<InboundConfigItem[]>([]);
  const [msg, setMsg] = useState({ open: false, type: 'success' as 'success' | 'error', text: '' });
  const [intervalError, setIntervalError] = useState('');
  const [loadingRotate, setLoadingRotate] = useState(false);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  useEffect(() => { loadSettings(); }, []);

  useEffect(() => {
    const val = parseInt(settings.rotation_interval, 10);
    setIntervalError(isNaN(val) || val < 10 ? 'Минимальный интервал — 10 минут' : '');
  }, [settings.rotation_interval]);

  useEffect(() => {
    setHostMappings(prev => prev.filter(m => m.inboundIndex < inboundsConfig.length));
  }, [inboundsConfig.length]);

  const loadSettings = async () => {
    try {
      const { data } = await api.get('/settings');
      setSettings(prev => ({ ...prev, ...data }));
      if (data.admin_login) setAdminProfile(prev => ({ ...prev, login: data.admin_login }));
      if (data.inbounds_config) {
        try {
          const parsed = JSON.parse(data.inbounds_config);
          setInboundsConfig(parsed);
        } catch {}
      }
      if (data.host_mappings) {
        try { setHostMappings(JSON.parse(data.host_mappings)); } catch {}
      }
      if (data.remnawave_url && data.remnawave_api_key) {
        loadProfiles();
        loadNodes();
        loadHosts();
      }
    } catch (e) { console.error(e); }
  };

  const loadProfiles = async () => {
    try {
      const { data } = await api.get('/settings/profiles');
      setProfiles(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setProfiles([]);
      const msg = e?.response?.data?.message || 'Ошибка загрузки профилей';
      setMsg({ open: true, type: 'error', text: msg });
    }
  };

  const loadNodes = async () => {
    try {
      const { data } = await api.get('/settings/nodes');
      setNodes(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setNodes([]);
    }
  };

  const loadHosts = async () => {
    try {
      const { data } = await api.get('/settings/hosts');
      setHosts(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setHosts([]);
    }
  };

  const handleSettingChange = (prop: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSettings(s => ({ ...s, [prop]: e.target.value }));
  };

  const handleCheckConnection = async () => {
    const url = settings.remnawave_url.replace(/\/+$/, '');
    const apiKey = settings.remnawave_api_key.trim();
    try {
      setMsg({ open: true, type: 'success', text: 'Проверка...' });
      const res = await api.post('/settings/check', { remnawave_url: url, remnawave_api_key: apiKey });
      if (res.data.success) {
        // Сохраняем credentials в БД чтобы loadProfiles мог их прочитать
        await api.post('/settings', { remnawave_url: url, remnawave_api_key: apiKey });
        setSettings(s => ({ ...s, remnawave_url: url, remnawave_api_key: apiKey }));
        setMsg({ open: true, type: 'success', text: 'Подключение успешно! Загружаю профили...' });
        await Promise.all([loadProfiles(), loadNodes(), loadHosts()]);
      } else {
        setMsg({ open: true, type: 'error', text: 'Ошибка: неверные данные или нет доступа' });
      }
    } catch {
      setMsg({ open: true, type: 'error', text: 'Ошибка сети при проверке' });
    }
  };

  const handleSaveNode = async (nodeUuid: string) => {
    const node = nodes.find(n => n.uuid === nodeUuid);
    if (!node) return;
    try {
      await api.post('/settings', {
        remnawave_node_uuid: node.uuid,
        remnawave_node_address: node.address,
      });
      setSettings(s => ({ ...s, remnawave_node_uuid: node.uuid }));
      setMsg({ open: true, type: 'success', text: `Нода сохранена: ${node.name}` });
    } catch {
      setMsg({ open: true, type: 'error', text: 'Ошибка сохранения ноды' });
    }
  };

  const handleSaveHostMappings = async () => {
    try {
      await api.post('/settings', { host_mappings: JSON.stringify(hostMappings) });
      setMsg({ open: true, type: 'success', text: 'Маппинг хостов сохранён!' });
    } catch {
      setMsg({ open: true, type: 'error', text: 'Ошибка сохранения маппинга' });
    }
  };

  const updateHostMapping = (inboundIndex: number, hostUuid: string) => {
    setHostMappings(prev => {
      const existing = prev.find(m => m.inboundIndex === inboundIndex);
      if (existing) {
        return prev.map(m => m.inboundIndex === inboundIndex ? { ...m, hostUuid } : m);
      }
      return [...prev, { inboundIndex, hostUuid }];
    });
  };

  const handleSaveConnection = async () => {
    const cleaned = {
      ...settings,
      remnawave_url: settings.remnawave_url.replace(/\/+$/, ''),
      remnawave_api_key: settings.remnawave_api_key.trim(),
    };
    setSettings(cleaned);
    try {
      await api.post('/settings', {
        remnawave_url: cleaned.remnawave_url,
        remnawave_api_key: cleaned.remnawave_api_key,
      });
      setMsg({ open: true, type: 'success', text: 'Настройки подключения сохранены!' });
      loadProfiles();
    } catch {
      setMsg({ open: true, type: 'error', text: 'Ошибка сохранения' });
    }
  };

  const handleSaveProfile = async () => {
    try {
      await api.post('/settings', { remnawave_profile_uuid: settings.remnawave_profile_uuid });
      setMsg({ open: true, type: 'success', text: 'Профиль сохранён!' });
    } catch {
      setMsg({ open: true, type: 'error', text: 'Ошибка сохранения профиля' });
    }
  };

  const handleSaveInbounds = async () => {
    try {
      await api.post('/settings', { inbounds_config: JSON.stringify(inboundsConfig) });
      setMsg({ open: true, type: 'success', text: 'Конфиг инбаундов сохранён!' });
    } catch {
      setMsg({ open: true, type: 'error', text: 'Ошибка сохранения инбаундов' });
    }
  };

  const handleSaveRotation = async () => {
    if (intervalError) {
      setMsg({ open: true, type: 'error', text: 'Исправьте ошибки перед сохранением' });
      return;
    }
    try {
      await api.post('/settings', {
        rotation_interval: settings.rotation_interval,
        rotation_status: settings.rotation_status,
      });
      setMsg({ open: true, type: 'success', text: 'Настройки ротации сохранены!' });
    } catch {
      setMsg({ open: true, type: 'error', text: 'Ошибка сохранения' });
    }
  };

  const handleSaveAdmin = async () => {
    try {
      await api.post('/auth/update-profile', adminProfile);
      setMsg({ open: true, type: 'success', text: 'Профиль администратора обновлён!' });
      setAdminProfile(prev => ({ ...prev, password: '' }));
    } catch {
      setMsg({ open: true, type: 'error', text: 'Ошибка обновления профиля' });
    }
  };

  const togglePause = async () => {
    const newStatus = settings.rotation_status === 'active' ? 'stopped' : 'active';
    setSettings(s => ({ ...s, rotation_status: newStatus }));
    try {
      await api.post('/settings', { rotation_status: newStatus });
    } catch {
      setSettings(s => ({ ...s, rotation_status: settings.rotation_status }));
      setMsg({ open: true, type: 'error', text: 'Не удалось изменить статус' });
    }
  };

  const handleForceRotate = async () => {
    if (!confirm('Немедленно обновить инбаунды в Remnawave?\n\nИнтервал автоматической ротации НЕ будет сброшен.')) return;
    try {
      setLoadingRotate(true);
      const res = await api.post('/rotation/rotate-all');
      if (res.data?.success) {
        setMsg({ open: true, type: 'success', text: res.data.message || 'Ротация выполнена!' });
        loadSettings();
      } else {
        setMsg({ open: true, type: 'error', text: res.data?.message || 'Ошибка ротации' });
      }
    } catch {
      setMsg({ open: true, type: 'error', text: 'Ошибка сети или сервера' });
    } finally {
      setLoadingRotate(false);
    }
  };

  const addInbound = () => {
    setInboundsConfig(prev => [...prev, { type: 'vless-tcp-reality', port: 'random', sni: 'random' }]);
  };

  const removeInbound = (idx: number) => {
    setInboundsConfig(prev => prev.filter((_, i) => i !== idx));
  };

  const updateInbound = (idx: number, field: string, value: string) => {
    setInboundsConfig(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const handleInboundTypeChange = (idx: number, newType: string) => {
    const hasSni = SNI_TYPES.has(newType);
    setInboundsConfig(prev => prev.map((item, i) =>
      i === idx ? { type: newType, port: item.port, ...(hasSni ? { sni: item.sni || 'random' } : {}) } : item
    ));
  };

  const formatDate = (ts: string) => {
    if (!ts) return 'Нет данных';
    return new Date(+ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getNextRotationDate = () => {
    if (settings.rotation_status === 'stopped') return 'Пауза';
    if (!settings.last_rotation_timestamp) return 'Ожидание...';
    const last = new Date(+settings.last_rotation_timestamp);
    const next = new Date(last.getTime() + parseInt(settings.rotation_interval || '30') * 60000);
    return next.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const isPaused = settings.rotation_status === 'stopped';

  return (
    <Box>
      <Typography variant={isMobile ? 'h5' : 'h4'} gutterBottom>Настройки</Typography>

      {/* Статус */}
      <Grid container spacing={1} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Typography variant="subtitle2" color="textSecondary" gutterBottom>Статус сервиса</Typography>
          {isPaused
            ? <Chip icon={<PauseCircleFilled />} label="Остановлен" color="warning" size="small" variant="outlined" />
            : <Chip icon={<CheckCircle />} label="Активен" color="success" size="small" variant="outlined" />
          }
          <Tooltip title={isPaused ? 'Возобновить ротацию' : 'Поставить на паузу'}>
            <IconButton onClick={togglePause} size="small" sx={{ ml: 1, bgcolor: 'background.paper', boxShadow: 2 }}>
              {isPaused ? <PlayCircleFilled fontSize="large" /> : <PauseCircleFilled fontSize="large" />}
            </IconButton>
          </Tooltip>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Typography variant="subtitle2" color="textSecondary">Последняя генерация</Typography>
          <Typography variant="body1" sx={{ fontWeight: 500, mt: 2 }}>{formatDate(settings.last_rotation_timestamp)}</Typography>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Typography variant="subtitle2" color="textSecondary">Следующая генерация</Typography>
          <Typography variant="body1" sx={{ fontWeight: 500, mt: 2 }}>{getNextRotationDate()}</Typography>
        </Grid>
      </Grid>

      <Grid container spacing={3}>

        {/* Подключение к Remnawave */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Typography variant="h6" gutterBottom>Подключение к Remnawave</Typography>
            <Divider sx={{ mb: 2 }} />
            <TextField
              fullWidth margin="normal" label="URL панели Remnawave"
              value={settings.remnawave_url} onChange={handleSettingChange('remnawave_url')}
              helperText="Например: https://panel.example.com"
            />
            <TextField
              fullWidth margin="normal" label="API ключ (Bearer token)" type="password"
              value={settings.remnawave_api_key} onChange={handleSettingChange('remnawave_api_key')}
            />
            <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
              <Button variant="contained" onClick={handleSaveConnection}>Сохранить</Button>
              {settings.remnawave_url && settings.remnawave_api_key && (
                <Button variant="outlined" color="info" onClick={handleCheckConnection}>Проверить</Button>
              )}
            </Stack>
          </Paper>
        </Grid>

        {/* Профиль и ротация */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>

            {/* Профиль */}
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>Config-Profile</Typography>
              <Divider sx={{ mb: 2 }} />
              <FormControl fullWidth margin="normal">
                <InputLabel>Выберите профиль</InputLabel>
                <Select
                  value={settings.remnawave_profile_uuid}
                  label="Выберите профиль"
                  onChange={(e: SelectChangeEvent) =>
                    setSettings(s => ({ ...s, remnawave_profile_uuid: e.target.value }))
                  }
                >
                  {profiles.length === 0 && (
                    <MenuItem value="" disabled>Профили не загружены</MenuItem>
                  )}
                  {profiles.map(p => (
                    <MenuItem key={p.uuid} value={p.uuid}>{p.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
                <Button variant="contained" onClick={handleSaveProfile} disabled={!settings.remnawave_profile_uuid}>
                  Сохранить профиль
                </Button>
                <Button variant="outlined" onClick={loadProfiles} disabled={!settings.remnawave_url}>
                  Обновить список
                </Button>
              </Stack>

              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle1" gutterBottom>Сервер (нода)</Typography>
              <FormControl fullWidth margin="normal">
                <InputLabel>Выберите ноду</InputLabel>
                <Select
                  value={settings.remnawave_node_uuid}
                  label="Выберите ноду"
                  onChange={(e: SelectChangeEvent) => handleSaveNode(e.target.value)}
                >
                  {nodes.length === 0 && (
                    <MenuItem value="" disabled>Ноды не загружены</MenuItem>
                  )}
                  {nodes.map(n => (
                    <MenuItem key={n.uuid} value={n.uuid}>
                      {n.countryCode} {n.name} ({n.address})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button variant="outlined" size="small" sx={{ mt: 1 }} onClick={loadNodes} disabled={!settings.remnawave_url}>
                Обновить список нод
              </Button>
            </Paper>

            {/* Интервал ротации */}
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>Интервал ротации</Typography>
              <Divider sx={{ mb: 2 }} />
              <TextField
                fullWidth margin="normal" label="Интервал генерации" type="number"
                value={settings.rotation_interval} onChange={handleSettingChange('rotation_interval')}
                error={!!intervalError} helperText={intervalError || 'Минимум 10 минут'}
                slotProps={{ input: { endAdornment: <InputAdornment position="end">мин</InputAdornment> } }}
              />
              <Stack direction="row" spacing={1} sx={{ mt: 1, mb: 2 }}>
                {ROTATION_PRESETS.map(p => (
                  <Chip
                    key={p.value} label={p.label} clickable
                    onClick={() => setSettings(s => ({ ...s, rotation_interval: p.value.toString() }))}
                    color={settings.rotation_interval === p.value.toString() ? 'primary' : 'default'}
                    variant={settings.rotation_interval === p.value.toString() ? 'filled' : 'outlined'}
                  />
                ))}
              </Stack>
              <Stack direction={isMobile ? 'column' : 'row'} spacing={2}>
                <Button variant="contained" onClick={handleSaveRotation}>Применить интервал</Button>
                <Button variant="outlined" color="warning" loading={loadingRotate} onClick={handleForceRotate}>
                  Сгенерировать сейчас
                </Button>
              </Stack>
            </Paper>

          </Box>
        </Grid>

        {/* Конфигуратор инбаундов */}
        <Grid size={{ xs: 12 }}>
          <Paper sx={{ p: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Typography variant="h6">Инбаунды для ротации</Typography>
              <Button variant="outlined" startIcon={<Add />} onClick={addInbound} size="small">
                Добавить
              </Button>
            </Stack>
            <Divider sx={{ mb: 2 }} />

            {inboundsConfig.length === 0 && (
              <Typography color="textSecondary" variant="body2">
                Нет добавленных инбаундов. Нажмите "Добавить" для создания.
              </Typography>
            )}

            <Stack spacing={2}>
              {inboundsConfig.map((item, idx) => (
                <Box key={idx} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel>Тип</InputLabel>
                    <Select
                      value={item.type}
                      label="Тип"
                      onChange={(e: SelectChangeEvent) => handleInboundTypeChange(idx, e.target.value)}
                    >
                      {CONNECTION_TYPES.map(t => (
                        <MenuItem key={t} value={t}>{t}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <TextField
                    size="small" label="Порт" value={item.port}
                    onChange={e => updateInbound(idx, 'port', e.target.value)}
                    helperText="random или число"
                    sx={{ width: 130 }}
                  />

                  {SNI_TYPES.has(item.type) && (
                    <TextField
                      size="small" label="SNI" value={item.sni || ''}
                      onChange={e => updateInbound(idx, 'sni', e.target.value)}
                      helperText="random или домен"
                      sx={{ width: 200 }}
                    />
                  )}

                  <Tooltip title="Удалить">
                    <IconButton color="error" onClick={() => removeInbound(idx)} sx={{ mt: 0.5 }}>
                      <Delete />
                    </IconButton>
                  </Tooltip>
                </Box>
              ))}
            </Stack>

            {inboundsConfig.length > 0 && (
              <Button variant="contained" sx={{ mt: 3 }} onClick={handleSaveInbounds}>
                Сохранить инбаунды
              </Button>
            )}
          </Paper>
        </Grid>

        {/* Маппинг хостов */}
        <Grid size={{ xs: 12 }}>
          <Paper sx={{ p: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Typography variant="h6">Сопоставление хостов</Typography>
              <Button variant="outlined" size="small" onClick={loadHosts} disabled={!settings.remnawave_url}>
                Обновить хосты
              </Button>
            </Stack>
            <Divider sx={{ mb: 2 }} />

            {inboundsConfig.length === 0 && (
              <Typography color="textSecondary" variant="body2">
                Сначала добавьте инбаунды в секции выше.
              </Typography>
            )}

            {inboundsConfig.length > 0 && hosts.length === 0 && (
              <Typography color="textSecondary" variant="body2">
                Хосты не загружены. Убедитесь, что подключение к Remnawave настроено, и нажмите "Обновить хосты".
              </Typography>
            )}

            <Stack spacing={2}>
              {inboundsConfig.map((item, idx) => {
                const mapping = hostMappings.find(m => m.inboundIndex === idx);
                return (
                  <Box key={idx} sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="body2" sx={{ minWidth: 30, color: 'text.secondary' }}>#{idx}</Typography>
                    <Typography variant="body2" sx={{ minWidth: 180 }}>{item.type}</Typography>
                    <FormControl size="small" sx={{ minWidth: 300 }}>
                      <InputLabel>Хост Remnawave</InputLabel>
                      <Select
                        value={mapping?.hostUuid || ''}
                        label="Хост Remnawave"
                        onChange={(e: SelectChangeEvent) => updateHostMapping(idx, e.target.value)}
                      >
                        <MenuItem value=""><em>Не выбрано</em></MenuItem>
                        {hosts.map(h => (
                          <MenuItem key={h.uuid} value={h.uuid}>
                            {h.remark} ({h.address}:{h.port})
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>
                );
              })}
            </Stack>

            {inboundsConfig.length > 0 && (
              <Button variant="contained" sx={{ mt: 3 }} onClick={handleSaveHostMappings}>
                Сохранить маппинг
              </Button>
            )}
          </Paper>
        </Grid>

        {/* Доступ к панели */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Доступ к RW Profile Manager</Typography>
            <Divider sx={{ mb: 2 }} />
            <TextField
              fullWidth margin="normal" label="Логин администратора"
              value={adminProfile.login} onChange={e => setAdminProfile(p => ({ ...p, login: e.target.value }))}
            />
            <TextField
              fullWidth margin="normal" label="Новый пароль" type="password"
              value={adminProfile.password} onChange={e => setAdminProfile(p => ({ ...p, password: e.target.value }))}
              helperText="Оставьте пустым, если не хотите менять"
            />
            <Button variant="contained" color="warning" sx={{ mt: 2 }} onClick={handleSaveAdmin}>
              Обновить профиль
            </Button>
          </Paper>
        </Grid>

      </Grid>

      <Snackbar open={msg.open} autoHideDuration={5000} onClose={() => setMsg(m => ({ ...m, open: false }))}>
        <Alert severity={msg.type}>{msg.text}</Alert>
      </Snackbar>
    </Box>
  );
}
