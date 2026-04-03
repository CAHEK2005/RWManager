import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  IconButton,
  InputLabel,
  Menu,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  CheckCircleOutline,
  ErrorOutline,
  LockOpen,
  PowerSettingsNew,
  Refresh,
  Delete,
  Add,
  VpnKey,
} from '@mui/icons-material';
import api from '../api';

interface RwNode {
  uuid: string;
  name: string;
  address: string;
  port: number | null;
  isConnected: boolean;
  isDisabled: boolean;
  isConnecting: boolean;
  countryCode: string;
  xrayVersion: string | null;
  nodeVersion: string | null;
  usersOnline: number | null;
  lastStatusMessage: string | null;
}

interface RwProfile {
  uuid: string;
  name: string;
}

const StatusChip = ({ node }: { node: RwNode }) => {
  if (node.isDisabled)
    return <Chip label="Отключена" size="small" color="default" />;
  if (node.isConnecting)
    return <Chip label="Подключение..." size="small" color="warning" />;
  if (node.isConnected)
    return <Chip label="Онлайн" size="small" color="success" />;
  return <Chip label="Оффлайн" size="small" color="error" />;
};

export default function NodesPage() {
  const [nodes, setNodes] = useState<RwNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  // Install dialog
  const [installOpen, setInstallOpen] = useState(false);
  const [profiles, setProfiles] = useState<RwProfile[]>([]);

  const [nodeName, setNodeName] = useState('');
  const [nodeIp, setNodeIp] = useState('');
  const [sshPort, setSshPort] = useState('22');
  const [sshUser, setSshUser] = useState('root');
  const [authType, setAuthType] = useState<'password' | 'key'>('password');
  const [sshPassword, setSshPassword] = useState('');
  const [sshKey, setSshKey] = useState('');
  const [profileUuid, setProfileUuid] = useState('');
  const [createNewProfile, setCreateNewProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [nodePort, setNodePort] = useState('2222');
  const [enableOptimization, setEnableOptimization] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState('');

  // Progress dialog
  const [progressOpen, setProgressOpen] = useState(false);
  const [jobId, setJobId] = useState('');
  const [jobStatus, setJobStatus] = useState<'running' | 'success' | 'error'>('running');
  const [jobLogs, setJobLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Secrets picker
  const [secrets, setSecrets] = useState<{ id: string; name: string; type: string }[]>([]);
  const [secretMenuAnchor, setSecretMenuAnchor] = useState<{ el: HTMLElement; onPick: (v: string) => void } | null>(null);

  const loadNodes = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/nodes');
      setNodes(Array.isArray(data) ? data : []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      const { data } = await api.get('/settings/profiles');
      setProfiles(Array.isArray(data) ? data : []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadNodes();
    api.get('/secrets').then(r => setSecrets(r.data)).catch(() => {});
  }, [loadNodes]);

  const handlePickSecret = async (id: string) => {
    const anchor = secretMenuAnchor;
    setSecretMenuAnchor(null);
    if (!anchor) return;
    try {
      const { data } = await api.get(`/secrets/${id}/value`);
      anchor.onPick(data.value);
    } catch { /* silent */ }
  };

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [jobLogs]);

  const startPolling = (id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/nodes/install/${id}`);
        setJobLogs(data.logs || []);
        setJobStatus(data.status);
        if (data.status !== 'running') {
          if (pollRef.current) clearInterval(pollRef.current);
          loadNodes();
        }
      } catch {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 2000);
  };

  const handleOpenInstall = () => {
    loadProfiles();
    setNodeName('');
    setNodeIp('');
    setSshPort('22');
    setSshUser('root');
    setAuthType('password');
    setSshPassword('');
    setSshKey('');
    setProfileUuid('');
    setCreateNewProfile(false);
    setNewProfileName('');
    setCountryCode('');
    setNodePort('2222');
    setEnableOptimization(true);
    setInstallError('');
    setInstallOpen(true);
  };

  const handleKeyFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setSshKey((ev.target?.result as string) || '');
    reader.readAsText(file);
  };

  const handleInstall = async () => {
    if (!nodeName.trim() || !nodeIp.trim()) {
      setInstallError('Укажите имя ноды и IP-адрес');
      return;
    }
    if (!createNewProfile && !profileUuid) {
      setInstallError('Выберите профиль или создайте новый');
      return;
    }
    if (createNewProfile && !newProfileName.trim()) {
      setInstallError('Укажите имя нового профиля');
      return;
    }

    setInstalling(true);
    setInstallError('');
    try {
      const { data } = await api.post('/nodes/install', {
        name: nodeName.trim(),
        ip: nodeIp.trim(),
        sshPort: parseInt(sshPort) || 22,
        sshUser: sshUser || 'root',
        authType,
        password: authType === 'password' ? sshPassword : undefined,
        sshKey: authType === 'key' ? sshKey : undefined,
        profileUuid: createNewProfile ? undefined : profileUuid,
        createNewProfile,
        profileName: createNewProfile ? newProfileName.trim() : undefined,
        countryCode: countryCode.trim().toUpperCase() || undefined,
        nodePort: parseInt(nodePort) || 2222,
        enableOptimization,
      });

      setInstallOpen(false);
      setJobId(data.jobId);
      setJobStatus('running');
      setJobLogs([]);
      setProgressOpen(true);
      startPolling(data.jobId);
    } catch (e: any) {
      setInstallError(e?.response?.data?.message || e?.message || 'Ошибка установки');
    } finally {
      setInstalling(false);
    }
  };

  const handleProgressClose = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setProgressOpen(false);
  };

  const handleAction = async (action: () => Promise<void>) => {
    setActionError('');
    try {
      await action();
      await loadNodes();
    } catch (e: any) {
      setActionError(e?.response?.data?.message || e?.message || 'Ошибка');
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Ноды</Typography>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Refresh />}
            onClick={loadNodes}
            disabled={loading}
          >
            Обновить
          </Button>
          <Button
            variant="contained"
            size="small"
            startIcon={<Add />}
            onClick={handleOpenInstall}
          >
            Добавить ноду
          </Button>
        </Stack>
      </Stack>

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError('')}>
          {actionError}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : nodes.length === 0 ? (
        <Typography color="textSecondary">Ноды не найдены</Typography>
      ) : (
        <Stack spacing={1.5}>
          {nodes.map((node) => (
            <Paper key={node.uuid} variant="outlined" sx={{ p: 2 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1}>
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Typography variant="subtitle1" fontWeight={600}>
                      {node.name}
                    </Typography>
                    {node.countryCode && (
                      <Typography variant="body2" color="textSecondary">
                        {node.countryCode}
                      </Typography>
                    )}
                    <StatusChip node={node} />
                  </Stack>
                  <Typography variant="body2" color="textSecondary">
                    {node.address}{node.port ? `:${node.port}` : ''}
                    {node.xrayVersion ? ` · xray ${node.xrayVersion}` : ''}
                    {node.usersOnline != null ? ` · онлайн: ${node.usersOnline}` : ''}
                  </Typography>
                  {node.lastStatusMessage && !node.isConnected && (
                    <Typography variant="caption" color="error.main">
                      {node.lastStatusMessage}
                    </Typography>
                  )}
                </Box>
                <Stack direction="row" spacing={0.5}>
                  <Tooltip title="Перезапустить">
                    <IconButton size="small" onClick={() => handleAction(() => api.post(`/nodes/${node.uuid}/restart`).then(() => {}))}>
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={node.isDisabled ? 'Включить' : 'Отключить'}>
                    <IconButton
                      size="small"
                      color={node.isDisabled ? 'default' : 'primary'}
                      onClick={() =>
                        handleAction(() =>
                          (node.isDisabled
                            ? api.post(`/nodes/${node.uuid}/enable`)
                            : api.post(`/nodes/${node.uuid}/disable`)
                          ).then(() => {})
                        )
                      }
                    >
                      <PowerSettingsNew fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Удалить ноду из Remnawave">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => handleAction(() => api.delete(`/nodes/${node.uuid}`).then(() => {}))}
                    >
                      <Delete fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      {/* Install dialog */}
      <Dialog open={installOpen} onClose={() => setInstallOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Добавить ноду</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Внутреннее имя"
              value={nodeName}
              onChange={(e) => setNodeName(e.target.value)}
              fullWidth
              size="small"
            />

            <Stack direction="row" spacing={1}>
              <TextField
                label="IP-адрес сервера"
                value={nodeIp}
                onChange={(e) => setNodeIp(e.target.value)}
                fullWidth
                size="small"
              />
              <TextField
                label="SSH-порт"
                value={sshPort}
                onChange={(e) => setSshPort(e.target.value)}
                sx={{ width: 110 }}
                size="small"
              />
            </Stack>

            <Stack direction="row" spacing={1}>
              <TextField
                label="SSH-пользователь"
                value={sshUser}
                onChange={(e) => setSshUser(e.target.value)}
                fullWidth
                size="small"
              />
              <TextField
                label="Порт ноды"
                value={nodePort}
                onChange={(e) => setNodePort(e.target.value)}
                sx={{ width: 120 }}
                size="small"
                helperText="APP_PORT"
              />
            </Stack>

            <FormControl>
              <FormLabel>Аутентификация</FormLabel>
              <RadioGroup
                row
                value={authType}
                onChange={(e) => setAuthType(e.target.value as 'password' | 'key')}
              >
                <FormControlLabel value="password" control={<Radio size="small" />} label="Пароль" />
                <FormControlLabel value="key" control={<Radio size="small" />} label="SSH-ключ" />
              </RadioGroup>
            </FormControl>

            {authType === 'password' ? (
              <TextField
                label="Пароль"
                type="password"
                value={sshPassword}
                onChange={(e) => setSshPassword(e.target.value)}
                fullWidth
                size="small"
                slotProps={{ input: { endAdornment: secrets.length > 0 ? (
                  <Tooltip title="Вставить из секретов">
                    <IconButton size="small" edge="end" onClick={e => setSecretMenuAnchor({ el: e.currentTarget, onPick: setSshPassword })}>
                      <LockOpen fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ) : undefined }}}
              />
            ) : (
              <Box>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                  <Typography variant="body2">SSH-ключ</Typography>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    {secrets.length > 0 && (
                      <Tooltip title="Вставить из секретов">
                        <IconButton size="small" onClick={e => setSecretMenuAnchor({ el: e.currentTarget, onPick: setSshKey })}>
                          <LockOpen fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Button size="small" variant="outlined" onClick={() => fileInputRef.current?.click()}>
                      Загрузить файл
                    </Button>
                  </Stack>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pem,.key,.rsa,*"
                    style={{ display: 'none' }}
                    onChange={handleKeyFile}
                  />
                </Stack>
                <Box
                  component="textarea"
                  value={sshKey}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSshKey(e.target.value)}
                  placeholder="-----BEGIN RSA PRIVATE KEY-----"
                  rows={5}
                  sx={{
                    width: '100%',
                    fontFamily: 'monospace',
                    fontSize: 12,
                    p: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    bgcolor: 'background.paper',
                    color: 'text.primary',
                    resize: 'vertical',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </Box>
            )}

            <Divider />

            <FormControl size="small" fullWidth>
              <InputLabel>Профиль</InputLabel>
              <Select
                value={createNewProfile ? '__new__' : profileUuid}
                label="Профиль"
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setCreateNewProfile(true);
                    setProfileUuid('');
                  } else {
                    setCreateNewProfile(false);
                    setProfileUuid(e.target.value);
                  }
                }}
              >
                {profiles.map((p) => (
                  <MenuItem key={p.uuid} value={p.uuid}>
                    {p.name}
                  </MenuItem>
                ))}
                <MenuItem value="__new__">
                  <em>+ Создать новый профиль</em>
                </MenuItem>
              </Select>
            </FormControl>

            {createNewProfile && (
              <TextField
                label="Имя нового профиля"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                fullWidth
                size="small"
              />
            )}

            <TextField
              label="Код страны (опционально)"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value.toUpperCase().slice(0, 2))}
              sx={{ width: 200 }}
              size="small"
              helperText="Например: RU, DE, NL"
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={enableOptimization}
                  onChange={(e) => setEnableOptimization(e.target.checked)}
                  size="small"
                />
              }
              label="Применить оптимизацию сети (sysctl)"
            />

            {installError && <Alert severity="error">{installError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInstallOpen(false)}>Отмена</Button>
          <Button
            variant="contained"
            onClick={handleInstall}
            disabled={installing}
            startIcon={installing ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            Установить
          </Button>
        </DialogActions>
      </Dialog>

      {/* Progress dialog */}
      <Dialog open={progressOpen} onClose={handleProgressClose} maxWidth="md" fullWidth>
        <DialogTitle>
          <Stack direction="row" spacing={1} alignItems="center">
            {jobStatus === 'running' && <CircularProgress size={18} />}
            {jobStatus === 'success' && <CheckCircleOutline color="success" />}
            {jobStatus === 'error' && <ErrorOutline color="error" />}
            <span>
              {jobStatus === 'running' && 'Установка...'}
              {jobStatus === 'success' && 'Установка завершена'}
              {jobStatus === 'error' && 'Ошибка установки'}
            </span>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Box
            sx={{
              bgcolor: 'background.default',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              p: 1.5,
              maxHeight: 400,
              overflowY: 'auto',
              fontFamily: 'monospace',
              fontSize: 12,
            }}
          >
            {jobLogs.map((line, i) => (
              <Box key={i} component="div" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                {line}
              </Box>
            ))}
            <div ref={logsEndRef} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleProgressClose}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      {/* Secret picker menu */}
      <Menu anchorEl={secretMenuAnchor?.el} open={Boolean(secretMenuAnchor)} onClose={() => setSecretMenuAnchor(null)}>
        {secrets.map(s => (
          <MenuItem key={s.id} onClick={() => handlePickSecret(s.id)}>
            <Stack direction="row" spacing={1} alignItems="center">
              <VpnKey fontSize="small" color="action" />
              <Box>
                <Typography variant="body2">{s.name}</Typography>
                <Typography variant="caption" color="textSecondary">
                  {s.type === 'ssh-key' ? 'SSH-ключ' : s.type === 'password' ? 'Пароль' : s.type === 'token' ? 'Токен' : 'Другое'}
                </Typography>
              </Box>
            </Stack>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
