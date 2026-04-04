import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  CheckCircleOutline,
  ErrorOutline,
  LockOpen,
  MoreVert,
  PowerSettingsNew,
  Refresh,
  Add,
  Delete,
  VpnKey,
} from '@mui/icons-material';
import api from '../api';
import ConfirmDialog from '../components/ConfirmDialog';

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

function NodeStatusDot({ node }: { node: RwNode }) {
  if (node.isDisabled)
    return <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: 'text.disabled', fontSize: '0.8rem' }}>
      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'text.disabled', flexShrink: 0 }} />
      Отключена
    </Box>;
  if (node.isConnecting)
    return <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: 'warning.main', fontSize: '0.8rem' }}>
      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'warning.main', flexShrink: 0 }} />
      Подключение...
    </Box>;
  if (node.isConnected)
    return <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: 'success.main', fontSize: '0.8rem' }}>
      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'success.main', flexShrink: 0 }} />
      Онлайн
    </Box>;
  return <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: 'error.main', fontSize: '0.8rem' }}>
    <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'error.main', flexShrink: 0 }} />
    Оффлайн
  </Box>;
}

function NodeRowMenu({ node, onRestart, onToggle, onDelete }: {
  node: RwNode;
  onRestart: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  return (
    <>
      <Tooltip title="Ещё"><IconButton size="small" onClick={e => setAnchor(e.currentTarget)}><MoreVert sx={{ fontSize: 16 }} /></IconButton></Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem onClick={() => { setAnchor(null); onDelete(); }} sx={{ color: 'error.main' }}>
          <Delete sx={{ fontSize: 16, mr: 1 }} />Удалить
        </MenuItem>
      </Menu>
    </>
  );
}

export default function NodesPage() {
  const [nodes, setNodes] = useState<RwNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  const [confirmDel, setConfirmDel] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: '', message: '', onConfirm: () => {} });
  const askDelete = (title: string, message: string, onConfirm: () => void) =>
    setConfirmDel({ open: true, title, message, onConfirm });
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [installFormDirty, setInstallFormDirty] = useState(false);

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

  const [progressOpen, setProgressOpen] = useState(false);
  const [jobStatus, setJobStatus] = useState<'running' | 'success' | 'error'>('running');
  const [jobLogs, setJobLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [secrets, setSecrets] = useState<{ id: string; name: string; type: string }[]>([]);
  const [secretPickerOpen, setSecretPickerOpen] = useState(false);
  const [secretPickerCallback, setSecretPickerCallback] = useState<((v: string) => void) | null>(null);

  const loadNodes = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/nodes');
      setNodes(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      const { data } = await api.get('/settings/profiles');
      setProfiles(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadNodes();
    api.get('/secrets').then(r => setSecrets(r.data)).catch(() => {});
  }, [loadNodes]);

  useEffect(() => {
    if (logsEndRef.current) logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [jobLogs]);

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
      } catch { if (pollRef.current) clearInterval(pollRef.current); }
    }, 2000);
  };

  const handleOpenInstall = () => {
    loadProfiles();
    setNodeName(''); setNodeIp(''); setSshPort('22'); setSshUser('root');
    setAuthType('password'); setSshPassword(''); setSshKey('');
    setProfileUuid(''); setCreateNewProfile(false); setNewProfileName('');
    setCountryCode(''); setNodePort('2222'); setEnableOptimization(true);
    setInstallError(''); setInstallFormDirty(false);
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
    if (!nodeName.trim() || !nodeIp.trim()) { setInstallError('Укажите имя ноды и IP-адрес'); return; }
    if (!createNewProfile && !profileUuid) { setInstallError('Выберите профиль или создайте новый'); return; }
    if (createNewProfile && !newProfileName.trim()) { setInstallError('Укажите имя нового профиля'); return; }
    setInstalling(true); setInstallError('');
    try {
      const { data } = await api.post('/nodes/install', {
        name: nodeName.trim(), ip: nodeIp.trim(),
        sshPort: parseInt(sshPort) || 22, sshUser: sshUser || 'root',
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
      setJobStatus('running'); setJobLogs([]); setProgressOpen(true);
      startPolling(data.jobId);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setInstallError(err?.response?.data?.message || err?.message || 'Ошибка установки');
    } finally { setInstalling(false); }
  };

  const handleProgressClose = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setProgressOpen(false);
  };

  const handleAction = async (action: () => Promise<void>) => {
    setActionError('');
    try { await action(); await loadNodes(); }
    catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setActionError(err?.response?.data?.message || err?.message || 'Ошибка');
    }
  };

  return (
    <Box>
      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3, gap: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>Ноды</Typography>
          <Typography variant="body2" color="text.secondary">Управление нодами Remnawave</Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          <Button variant="outlined" startIcon={loading ? <CircularProgress size={14} /> : <Refresh />} onClick={loadNodes} disabled={loading}>
            Обновить
          </Button>
          <Button variant="contained" startIcon={<Add />} onClick={handleOpenInstall}>
            Добавить ноду
          </Button>
        </Stack>
      </Box>

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError('')}>{actionError}</Alert>
      )}

      {/* Nodes table */}
      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Имя</TableCell>
              <TableCell>Страна</TableCell>
              <TableCell>Адрес</TableCell>
              <TableCell>Статус</TableCell>
              <TableCell>Онлайн</TableCell>
              <TableCell align="right">Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            )}
            {!loading && nodes.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  Нет нод — нажмите «Добавить ноду»
                </TableCell>
              </TableRow>
            )}
            {!loading && nodes.map(node => (
              <TableRow key={node.uuid}>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>{node.name}</Typography>
                  {node.lastStatusMessage && !node.isConnected && !node.isDisabled && (
                    <Typography variant="caption" color="error.main" display="block">{node.lastStatusMessage}</Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">{node.countryCode || '—'}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>
                    {node.address}{node.port ? `:${node.port}` : ''}
                  </Typography>
                  {node.xrayVersion && (
                    <Typography variant="caption" color="text.secondary">xray {node.xrayVersion}</Typography>
                  )}
                </TableCell>
                <TableCell><NodeStatusDot node={node} /></TableCell>
                <TableCell>
                  <Typography variant="body2">{node.usersOnline != null ? node.usersOnline : '—'}</Typography>
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    <Tooltip title="Перезапустить">
                      <IconButton size="small" onClick={() => handleAction(() => api.post(`/nodes/${node.uuid}/restart`).then(() => {}))}>
                        <Refresh sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={node.isDisabled ? 'Включить' : 'Отключить'}>
                      <IconButton
                        size="small"
                        color={node.isDisabled ? 'default' : 'primary'}
                        onClick={() => handleAction(() => (node.isDisabled
                          ? api.post(`/nodes/${node.uuid}/enable`)
                          : api.post(`/nodes/${node.uuid}/disable`)
                        ).then(() => {}))}
                      >
                        <PowerSettingsNew sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                    <NodeRowMenu
                      node={node}
                      onRestart={() => handleAction(() => api.post(`/nodes/${node.uuid}/restart`).then(() => {}))}
                      onToggle={() => handleAction(() => (node.isDisabled
                        ? api.post(`/nodes/${node.uuid}/enable`)
                        : api.post(`/nodes/${node.uuid}/disable`)
                      ).then(() => {}))}
                      onDelete={() => askDelete(
                        'Удалить ноду',
                        `Удалить ноду "${node.name}" из Remnawave?`,
                        () => {
                          setConfirmDel(d => ({ ...d, open: false }));
                          handleAction(() => api.delete(`/nodes/${node.uuid}`).then(() => {}));
                        },
                      )}
                    />
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      {/* Install dialog */}
      <Dialog open={installOpen} onClose={(_e, reason) => {
        if ((reason === 'backdropClick' || reason === 'escapeKeyDown') && installFormDirty) {
          setCloseConfirm(true);
        } else {
          setInstallOpen(false); setInstallFormDirty(false);
        }
      }} maxWidth="sm" fullWidth>
        <DialogTitle>Добавить ноду</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Внутреннее имя" size="small" fullWidth
              value={nodeName}
              onChange={e => { setNodeName(e.target.value); setInstallFormDirty(true); }}
            />
            <Stack direction="row" spacing={1}>
              <TextField
                label="IP-адрес сервера" size="small" fullWidth
                value={nodeIp}
                onChange={e => { setNodeIp(e.target.value); setInstallFormDirty(true); }}
              />
              <TextField label="SSH-порт" size="small" sx={{ width: 110 }} value={sshPort} onChange={e => setSshPort(e.target.value)} />
            </Stack>
            <Stack direction="row" spacing={1}>
              <TextField label="SSH-пользователь" size="small" fullWidth value={sshUser} onChange={e => setSshUser(e.target.value)} />
              <TextField label="Порт ноды" size="small" sx={{ width: 120 }} value={nodePort} onChange={e => setNodePort(e.target.value)} helperText="APP_PORT" />
            </Stack>
            <FormControl>
              <FormLabel>Аутентификация</FormLabel>
              <RadioGroup row value={authType} onChange={e => setAuthType(e.target.value as 'password' | 'key')}>
                <FormControlLabel value="password" control={<Radio size="small" />} label="Пароль" />
                <FormControlLabel value="key" control={<Radio size="small" />} label="SSH-ключ" />
              </RadioGroup>
            </FormControl>
            {authType === 'password' ? (
              <TextField
                label="Пароль" type="password" size="small" fullWidth
                value={sshPassword} onChange={e => setSshPassword(e.target.value)}
                slotProps={{ input: { endAdornment: secrets.length > 0 ? (
                  <Tooltip title="Вставить из секретов">
                    <IconButton size="small" edge="end" onClick={() => openSecretPicker(setSshPassword)}>
                      <LockOpen fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ) : undefined }}}
              />
            ) : (
              <Box>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                  <Typography variant="body2">SSH-ключ</Typography>
                  <Stack direction="row" spacing={0.5}>
                    {secrets.length > 0 && (
                      <Tooltip title="Вставить из секретов">
                        <IconButton size="small" onClick={() => openSecretPicker(setSshKey)}><LockOpen fontSize="small" /></IconButton>
                      </Tooltip>
                    )}
                    <Button size="small" variant="outlined" onClick={() => fileInputRef.current?.click()}>Загрузить файл</Button>
                  </Stack>
                  <input ref={fileInputRef} type="file" accept=".pem,.key,.rsa,*" style={{ display: 'none' }} onChange={handleKeyFile} />
                </Stack>
                <Box
                  component="textarea" value={sshKey}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSshKey(e.target.value)}
                  placeholder="-----BEGIN RSA PRIVATE KEY-----"
                  rows={5}
                  sx={{ width: '100%', fontFamily: 'monospace', fontSize: 12, p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', color: 'text.primary', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                />
              </Box>
            )}
            <Divider />
            <FormControl size="small" fullWidth>
              <InputLabel>Профиль</InputLabel>
              <Select
                value={createNewProfile ? '__new__' : profileUuid}
                label="Профиль"
                onChange={e => {
                  if (e.target.value === '__new__') { setCreateNewProfile(true); setProfileUuid(''); }
                  else { setCreateNewProfile(false); setProfileUuid(e.target.value); }
                }}
              >
                {profiles.map(p => <MenuItem key={p.uuid} value={p.uuid}>{p.name}</MenuItem>)}
                <MenuItem value="__new__"><em>+ Создать новый профиль</em></MenuItem>
              </Select>
            </FormControl>
            {createNewProfile && (
              <TextField label="Имя нового профиля" size="small" fullWidth value={newProfileName} onChange={e => setNewProfileName(e.target.value)} />
            )}
            <TextField
              label="Код страны (опционально)" size="small" sx={{ width: 200 }}
              value={countryCode} onChange={e => setCountryCode(e.target.value.toUpperCase().slice(0, 2))}
              helperText="Например: RU, DE, NL"
            />
            <FormControlLabel
              control={<Checkbox checked={enableOptimization} onChange={e => setEnableOptimization(e.target.checked)} size="small" />}
              label="Применить оптимизацию сети (sysctl)"
            />
            {installError && <Alert severity="error">{installError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={() => { setInstallOpen(false); setInstallFormDirty(false); }}>Отмена</Button>
          <Button variant="contained" onClick={handleInstall} disabled={installing}
            startIcon={installing ? <CircularProgress size={16} color="inherit" /> : undefined}>
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
              {jobStatus === 'running' ? 'Установка...' : jobStatus === 'success' ? 'Установка завершена' : 'Ошибка установки'}
            </span>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ bgcolor: 'background.default', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5, maxHeight: 400, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12 }}>
            {jobLogs.map((line, i) => (
              <Box key={i} component="div" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{line}</Box>
            ))}
            <div ref={logsEndRef} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleProgressClose}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDel.open} title={confirmDel.title} message={confirmDel.message}
        confirmLabel="Удалить" confirmColor="error"
        onConfirm={confirmDel.onConfirm}
        onCancel={() => setConfirmDel(d => ({ ...d, open: false }))}
      />
      <ConfirmDialog
        open={closeConfirm} title="Закрыть без сохранения?" message="Введённые данные будут потеряны."
        confirmLabel="Закрыть" confirmColor="warning"
        onConfirm={() => { setCloseConfirm(false); setInstallOpen(false); setInstallFormDirty(false); }}
        onCancel={() => setCloseConfirm(false)}
      />

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
