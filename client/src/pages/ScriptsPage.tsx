import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControl, FormControlLabel,
  IconButton, InputLabel, MenuItem, Paper, Radio, RadioGroup, Select,
  Snackbar, Stack, Tab, Table, TableBody, TableCell, TableHead,
  TableRow, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import { Add, Delete, Edit, PlayArrow, Terminal, UploadFile } from '@mui/icons-material';
import type { SelectChangeEvent } from '@mui/material/Select';
import api from '../api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SshNode {
  id: string;
  rwNodeUuid?: string;
  name: string;
  ip: string;
  sshPort: number;
  sshUser: string;
  authType: 'password' | 'key';
  password?: string;
  sshKey?: string;
}

interface Script {
  id: string;
  name: string;
  description?: string;
  content: string;
  isBuiltIn: boolean;
}

interface RwNode {
  uuid: string;
  name: string;
  address: string;
}

interface NodeResult {
  nodeId: string;
  nodeName: string;
  logs: string[];
  status: 'running' | 'success' | 'error';
}

interface ScriptJob {
  scriptName: string;
  status: 'running' | 'success' | 'error';
  results: NodeResult[];
}

// ─── Blank node form ─────────────────────────────────────────────────────────

const blankNode = (): Partial<SshNode> => ({
  name: '', ip: '', sshPort: 22, sshUser: 'root', authType: 'password', password: '', sshKey: '',
});

// ─── Component ───────────────────────────────────────────────────────────────

export default function ScriptsPage() {
  const [tab, setTab] = useState(0);

  // Data
  const [sshNodes, setSshNodes] = useState<SshNode[]>([]);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [rwNodes, setRwNodes] = useState<RwNode[]>([]);

  // Snackbar
  const [msg, setMsg] = useState({ open: false, type: 'success' as 'success' | 'error', text: '' });
  const showMsg = (type: 'success' | 'error', text: string) => setMsg({ open: true, type, text });

  // ── SSH Node dialog ────────────────────────────────────────────────────────
  const [nodeDialog, setNodeDialog] = useState(false);
  const [nodeForm, setNodeForm] = useState<Partial<SshNode>>(blankNode());
  const [nodeEditId, setNodeEditId] = useState<string | null>(null);

  // ── Script content expand ─────────────────────────────────────────────────
  const [expandedScripts, setExpandedScripts] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpandedScripts(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // ── Script dialog ──────────────────────────────────────────────────────────
  const [scriptDialog, setScriptDialog] = useState(false);
  const [scriptForm, setScriptForm] = useState<Partial<Script>>({ name: '', description: '', content: '' });
  const [scriptEditId, setScriptEditId] = useState<string | null>(null);

  // ── Run dialog ─────────────────────────────────────────────────────────────
  const [runDialog, setRunDialog] = useState(false);
  const [runScript, setRunScript] = useState<Script | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [runJob, setRunJob] = useState<ScriptJob | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const keyFileInputRef = useRef<HTMLInputElement | null>(null);

  // ─── Load ──────────────────────────────────────────────────────────────────

  const loadSshNodes = useCallback(async () => {
    try {
      const { data } = await api.get('/scripts/ssh-nodes');
      setSshNodes(Array.isArray(data) ? data : []);
    } catch { setSshNodes([]); }
  }, []);

  const loadScripts = useCallback(async () => {
    try {
      const { data } = await api.get('/scripts/scripts');
      setScripts(Array.isArray(data) ? data : []);
    } catch { setScripts([]); }
  }, []);

  const loadRwNodes = useCallback(async () => {
    try {
      const { data } = await api.get('/settings/nodes');
      setRwNodes(Array.isArray(data) ? data : []);
    } catch { setRwNodes([]); }
  }, []);

  useEffect(() => {
    loadSshNodes();
    loadScripts();
    loadRwNodes();
  }, []);

  // ─── SSH Node handlers ─────────────────────────────────────────────────────

  const openAddNode = () => {
    setNodeEditId(null);
    setNodeForm(blankNode());
    setNodeDialog(true);
  };

  const openEditNode = (node: SshNode) => {
    setNodeEditId(node.id);
    setNodeForm({ ...node });
    setNodeDialog(true);
  };

  const handleSaveNode = async () => {
    if (!nodeForm.name?.trim() || !nodeForm.ip?.trim()) {
      showMsg('error', 'Имя и IP обязательны');
      return;
    }
    try {
      const payload = { ...nodeForm };
      if (nodeEditId) payload.id = nodeEditId;
      await api[nodeEditId ? 'patch' : 'post'](
        nodeEditId ? `/scripts/ssh-nodes/${nodeEditId}` : '/scripts/ssh-nodes',
        payload,
      );
      showMsg('success', nodeEditId ? 'Нода обновлена' : 'Нода добавлена');
      setNodeDialog(false);
      loadSshNodes();
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка сохранения');
    }
  };

  const handleDeleteNode = async (id: string) => {
    try {
      await api.delete(`/scripts/ssh-nodes/${id}`);
      loadSshNodes();
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка удаления');
    }
  };

  // Выбор ноды из Remnawave — автозаполнение IP и имени
  const handleRwNodeSelect = (e: SelectChangeEvent<string>) => {
    const uuid = e.target.value;
    const rw = rwNodes.find(n => n.uuid === uuid);
    if (rw) {
      setNodeForm(prev => ({
        ...prev,
        rwNodeUuid: uuid,
        name: prev.name || rw.name,
        ip: rw.address || prev.ip,
      }));
    }
  };

  // ─── Script handlers ───────────────────────────────────────────────────────

  const openAddScript = () => {
    setScriptEditId(null);
    setScriptForm({ name: '', description: '', content: '' });
    setScriptDialog(true);
  };

  const openEditScript = (s: Script) => {
    setScriptEditId(s.id);
    setScriptForm({ name: s.name, description: s.description || '', content: s.content });
    setScriptDialog(true);
  };

  const handleSaveScript = async () => {
    if (!scriptForm.name?.trim() || !scriptForm.content?.trim()) {
      showMsg('error', 'Имя и содержимое скрипта обязательны');
      return;
    }
    try {
      await api[scriptEditId ? 'patch' : 'post'](
        scriptEditId ? `/scripts/scripts/${scriptEditId}` : '/scripts/scripts',
        scriptForm,
      );
      showMsg('success', scriptEditId ? 'Скрипт обновлён' : 'Скрипт создан');
      setScriptDialog(false);
      loadScripts();
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка сохранения');
    }
  };

  const handleDeleteScript = async (id: string) => {
    try {
      await api.delete(`/scripts/scripts/${id}`);
      loadScripts();
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка удаления');
    }
  };

  // ─── Run handlers ──────────────────────────────────────────────────────────

  const openRunDialog = (s: Script) => {
    setRunScript(s);
    setSelectedNodeIds([]);
    setRunJob(null);
    setRunDialog(true);
  };

  const toggleNodeSelection = (id: string) => {
    setSelectedNodeIds(prev =>
      prev.includes(id) ? prev.filter(n => n !== id) : [...prev, id],
    );
  };

  const startPolling = (jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get<ScriptJob>(`/scripts/execute/${jobId}`);
        setRunJob(data);
        if (data.status !== 'running') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setRunLoading(false);
        }
      } catch {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        setRunLoading(false);
      }
    }, 2000);
  };

  useEffect(() => {
    if (runJob && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [runJob]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const handleRunScript = async () => {
    if (!runScript || !selectedNodeIds.length) {
      showMsg('error', 'Выберите хотя бы одну ноду');
      return;
    }
    try {
      setRunLoading(true);
      setRunJob(null);
      const { data } = await api.post('/scripts/execute', {
        scriptId: runScript.id,
        nodeIds: selectedNodeIds,
      });
      startPolling(data.jobId);
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка запуска');
      setRunLoading(false);
    }
  };

  const handleCloseRunDialog = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setRunDialog(false);
    setRunJob(null);
    setRunLoading(false);
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 3 }}>
        <Terminal color="primary" />
        <Typography variant="h5">Скрипты</Typography>
      </Stack>

      <Paper>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tab label="Ноды" />
          <Tab label="Скрипты" />
        </Tabs>

        <Box sx={{ p: 3 }}>

          {/* ── Tab 0: SSH Nodes ── */}
          {tab === 0 && (
            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Typography variant="h6">Ноды</Typography>
                <Button variant="contained" startIcon={<Add />} size="small" onClick={openAddNode}>
                  Добавить
                </Button>
              </Stack>
              <Divider sx={{ mb: 2 }} />

              {sshNodes.length === 0 ? (
                <Alert severity="info">
                  Нет нод. Добавьте вручную или установите ноду через раздел «Ноды» — она появится здесь автоматически.
                </Alert>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Имя</TableCell>
                      <TableCell>IP</TableCell>
                      <TableCell>SSH-порт</TableCell>
                      <TableCell>Пользователь</TableCell>
                      <TableCell>Авторизация</TableCell>
                      <TableCell>Нода RW</TableCell>
                      <TableCell align="right">Действия</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sshNodes.map(node => {
                      const rw = rwNodes.find(r => r.uuid === node.rwNodeUuid);
                      return (
                        <TableRow key={node.id} hover>
                          <TableCell>{node.name}</TableCell>
                          <TableCell>{node.ip}</TableCell>
                          <TableCell>{node.sshPort}</TableCell>
                          <TableCell>{node.sshUser}</TableCell>
                          <TableCell>
                            <Chip
                              label={node.authType === 'key' ? 'SSH-ключ' : 'Пароль'}
                              size="small"
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>
                            {rw ? (
                              <Chip label={rw.name} size="small" color="primary" variant="outlined" />
                            ) : (
                              <Typography variant="caption" color="textSecondary">—</Typography>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            <Tooltip title="Изменить">
                              <IconButton size="small" onClick={() => openEditNode(node)}>
                                <Edit fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Удалить">
                              <IconButton size="small" color="error" onClick={() => handleDeleteNode(node.id)}>
                                <Delete fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </Box>
          )}

          {/* ── Tab 1: Scripts ── */}
          {tab === 1 && (
            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Typography variant="h6">Скрипты</Typography>
                <Button variant="contained" startIcon={<Add />} size="small" onClick={openAddScript}>
                  Новый скрипт
                </Button>
              </Stack>
              <Divider sx={{ mb: 2 }} />

              <Stack spacing={2}>
                {scripts.map(s => (
                  <Paper key={s.id} variant="outlined" sx={{ p: 2 }}>
                    <Stack direction="row" alignItems="flex-start" spacing={2}>
                      <Box sx={{ flex: 1 }}>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                          <Typography variant="subtitle1" fontWeight={600}>{s.name}</Typography>
                          {s.isBuiltIn && (
                            <Chip label="Встроенный" size="small" color="info" variant="outlined" />
                          )}
                        </Stack>
                        {s.description && (
                          <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                            {s.description}
                          </Typography>
                        )}
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => toggleExpand(s.id)}
                          sx={{ px: 0, minWidth: 0, textTransform: 'none', color: 'text.secondary' }}
                        >
                          {expandedScripts.has(s.id) ? '▲ Скрыть' : '▼ Показать скрипт'}
                        </Button>
                        {expandedScripts.has(s.id) && (
                          <Box
                            component="pre"
                            sx={{
                              fontSize: '0.75rem',
                              bgcolor: 'action.hover',
                              borderRadius: 1,
                              p: 1,
                              overflowX: 'auto',
                              maxHeight: 200,
                              overflowY: 'auto',
                              mt: 0.5,
                              m: 0,
                              fontFamily: 'monospace',
                            }}
                          >
                            {s.content}
                          </Box>
                        )}
                      </Box>
                      <Stack direction="column" spacing={1} sx={{ flexShrink: 0 }}>
                        <Button
                          variant="contained"
                          size="small"
                          startIcon={<PlayArrow />}
                          onClick={() => openRunDialog(s)}
                          disabled={sshNodes.length === 0}
                        >
                          Запустить
                        </Button>
                        {!s.isBuiltIn && (
                          <>
                            <Button
                              variant="outlined"
                              size="small"
                              startIcon={<Edit />}
                              onClick={() => openEditScript(s)}
                            >
                              Изменить
                            </Button>
                            <Button
                              variant="outlined"
                              size="small"
                              color="error"
                              startIcon={<Delete />}
                              onClick={() => handleDeleteScript(s.id)}
                            >
                              Удалить
                            </Button>
                          </>
                        )}
                      </Stack>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </Box>
          )}
        </Box>
      </Paper>

      {/* ── SSH Node Dialog ── */}
      <Dialog open={nodeDialog} onClose={() => setNodeDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{nodeEditId ? 'Изменить ноду' : 'Добавить ноду'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {rwNodes.length > 0 && (
              <FormControl size="small" fullWidth>
                <InputLabel>Привязать к ноде Remnawave</InputLabel>
                <Select
                  value={nodeForm.rwNodeUuid || ''}
                  label="Привязать к ноде Remnawave"
                  onChange={handleRwNodeSelect}
                >
                  <MenuItem value=""><em>— не привязывать —</em></MenuItem>
                  {rwNodes.map(n => (
                    <MenuItem key={n.uuid} value={n.uuid}>{n.name} ({n.address})</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            <TextField
              label="Имя"
              size="small"
              fullWidth
              value={nodeForm.name || ''}
              onChange={e => setNodeForm(p => ({ ...p, name: e.target.value }))}
            />
            <TextField
              label="IP-адрес"
              size="small"
              fullWidth
              value={nodeForm.ip || ''}
              onChange={e => setNodeForm(p => ({ ...p, ip: e.target.value }))}
            />
            <Stack direction="row" spacing={2}>
              <TextField
                label="SSH-порт"
                size="small"
                type="number"
                value={nodeForm.sshPort || 22}
                onChange={e => setNodeForm(p => ({ ...p, sshPort: Number(e.target.value) }))}
                sx={{ width: 120 }}
              />
              <TextField
                label="Пользователь"
                size="small"
                value={nodeForm.sshUser || ''}
                onChange={e => setNodeForm(p => ({ ...p, sshUser: e.target.value }))}
                sx={{ flex: 1 }}
              />
            </Stack>

            <FormControl>
              <RadioGroup
                row
                value={nodeForm.authType || 'password'}
                onChange={e => setNodeForm(p => ({ ...p, authType: e.target.value as 'password' | 'key' }))}
              >
                <FormControlLabel value="password" control={<Radio size="small" />} label="Пароль" />
                <FormControlLabel value="key" control={<Radio size="small" />} label="SSH-ключ" />
              </RadioGroup>
            </FormControl>

            {nodeForm.authType === 'password' ? (
              <TextField
                label="Пароль"
                size="small"
                type="password"
                fullWidth
                value={nodeForm.password || ''}
                onChange={e => setNodeForm(p => ({ ...p, password: e.target.value }))}
              />
            ) : (
              <Box>
                <input
                  ref={keyFileInputRef}
                  type="file"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = ev => {
                      setNodeForm(p => ({ ...p, sshKey: ev.target?.result as string }));
                    };
                    reader.readAsText(file);
                    e.target.value = '';
                  }}
                />
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                  <Typography variant="caption" color="textSecondary">Приватный SSH-ключ</Typography>
                  <Button
                    size="small"
                    startIcon={<UploadFile />}
                    onClick={() => keyFileInputRef.current?.click()}
                  >
                    Загрузить из файла
                  </Button>
                </Stack>
                <TextField
                  size="small"
                  multiline
                  rows={5}
                  fullWidth
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  value={nodeForm.sshKey || ''}
                  onChange={e => setNodeForm(p => ({ ...p, sshKey: e.target.value }))}
                  slotProps={{ input: { style: { fontFamily: 'monospace', fontSize: '0.75rem' } } }}
                />
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNodeDialog(false)}>Отмена</Button>
          <Button variant="contained" onClick={handleSaveNode}>Сохранить</Button>
        </DialogActions>
      </Dialog>

      {/* ── Script Dialog ── */}
      <Dialog open={scriptDialog} onClose={() => setScriptDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>{scriptEditId ? 'Изменить скрипт' : 'Новый скрипт'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Название"
              size="small"
              fullWidth
              value={scriptForm.name || ''}
              onChange={e => setScriptForm(p => ({ ...p, name: e.target.value }))}
            />
            <TextField
              label="Описание"
              size="small"
              fullWidth
              value={scriptForm.description || ''}
              onChange={e => setScriptForm(p => ({ ...p, description: e.target.value }))}
            />
            <TextField
              label="Bash-скрипт"
              size="small"
              multiline
              rows={12}
              fullWidth
              value={scriptForm.content || ''}
              onChange={e => setScriptForm(p => ({ ...p, content: e.target.value }))}
              slotProps={{ input: { style: { fontFamily: 'monospace', fontSize: '0.8rem' } } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScriptDialog(false)}>Отмена</Button>
          <Button variant="contained" onClick={handleSaveScript}>Сохранить</Button>
        </DialogActions>
      </Dialog>

      {/* ── Run Dialog ── */}
      <Dialog open={runDialog} onClose={handleCloseRunDialog} maxWidth="md" fullWidth>
        <DialogTitle>
          Запуск: {runScript?.name}
        </DialogTitle>
        <DialogContent>
          {!runJob ? (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Выберите ноды для запуска:
              </Typography>
              {sshNodes.length === 0 ? (
                <Alert severity="warning">Нет нод. Добавьте ноды на вкладке «Ноды».</Alert>
              ) : (
                <Stack spacing={1} sx={{ mb: 2 }}>
                  {sshNodes.map(node => {
                    const selected = selectedNodeIds.includes(node.id);
                    return (
                      <Paper
                        key={node.id}
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          cursor: 'pointer',
                          borderColor: selected ? 'primary.main' : undefined,
                          bgcolor: selected ? 'action.selected' : undefined,
                        }}
                        onClick={() => toggleNodeSelection(node.id)}
                      >
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Box sx={{
                            width: 16, height: 16, borderRadius: '50%',
                            border: '2px solid',
                            borderColor: selected ? 'primary.main' : 'text.disabled',
                            bgcolor: selected ? 'primary.main' : 'transparent',
                            flexShrink: 0,
                          }} />
                          <Typography variant="body2" fontWeight={selected ? 600 : 400}>
                            {node.name}
                          </Typography>
                          <Typography variant="caption" color="textSecondary">
                            {node.ip}:{node.sshPort} ({node.sshUser})
                          </Typography>
                        </Stack>
                      </Paper>
                    );
                  })}
                </Stack>
              )}
            </Box>
          ) : (
            <Box>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                <Typography variant="subtitle2">Статус:</Typography>
                {runJob.status === 'running' && <CircularProgress size={16} />}
                <Chip
                  label={runJob.status === 'running' ? 'Выполняется' : runJob.status === 'success' ? 'Успешно' : 'Ошибка'}
                  color={runJob.status === 'running' ? 'default' : runJob.status === 'success' ? 'success' : 'error'}
                  size="small"
                />
              </Stack>

              <Stack spacing={2}>
                {runJob.results.map(result => (
                  <Box key={result.nodeId}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                      <Typography variant="body2" fontWeight={600}>{result.nodeName}</Typography>
                      <Chip
                        label={result.status === 'running' ? '...' : result.status === 'success' ? 'OK' : 'Ошибка'}
                        color={result.status === 'running' ? 'default' : result.status === 'success' ? 'success' : 'error'}
                        size="small"
                      />
                    </Stack>
                    <Box
                      component="pre"
                      sx={{
                        fontSize: '0.7rem',
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        p: 1.5,
                        overflowX: 'auto',
                        maxHeight: 200,
                        overflowY: 'auto',
                        m: 0,
                        fontFamily: 'monospace',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {result.logs.join('\n') || '...'}
                    </Box>
                  </Box>
                ))}
              </Stack>
              <div ref={logsEndRef} />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseRunDialog}>
            {runJob && runJob.status !== 'running' ? 'Закрыть' : 'Отмена'}
          </Button>
          {!runJob && (
            <Button
              variant="contained"
              startIcon={runLoading ? <CircularProgress size={16} /> : <PlayArrow />}
              disabled={runLoading || selectedNodeIds.length === 0}
              onClick={handleRunScript}
            >
              Запустить
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Snackbar
        open={msg.open}
        autoHideDuration={4000}
        onClose={() => setMsg(m => ({ ...m, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={msg.type} onClose={() => setMsg(m => ({ ...m, open: false }))}>
          {msg.text}
        </Alert>
      </Snackbar>
    </Box>
  );
}
