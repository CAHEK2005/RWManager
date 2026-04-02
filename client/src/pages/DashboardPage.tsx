import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { Refresh, PlayArrow } from '@mui/icons-material';
import api from '../api';

interface ManagedProfile {
  uuid: string;
  name: string;
  rotationEnabled: boolean;
  lastRotationTimestamp: number;
  lastRotationStatus: 'success' | 'error' | null;
  lastRotationError: string;
}

interface RwNode {
  uuid: string;
  name: string;
  address: string;
  port: number | null;
  isConnected: boolean;
  isDisabled: boolean;
  countryCode: string;
  usersOnline: number | null;
  xrayVersion: string | null;
}

interface HistoryEntry {
  id: string;
  profileName: string;
  timestamp: number;
  status: 'success' | 'error';
  message: string;
}

function formatAgo(ts: number): string {
  if (!ts) return 'никогда';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}с назад`;
  if (diff < 3600) return `${Math.floor(diff / 60)}м назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}ч назад`;
  return `${Math.floor(diff / 86400)}д назад`;
}

export default function DashboardPage() {
  const [profiles, setProfiles] = useState<ManagedProfile[]>([]);
  const [nodes, setNodes] = useState<RwNode[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [domainsCount, setDomainsCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ open: false, type: 'success' as 'success' | 'error', text: '' });
  const [rotating, setRotating] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showMsg = (type: 'success' | 'error', text: string) => setMsg({ open: true, type, text });

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [profRes, nodeRes, histRes, domRes] = await Promise.allSettled([
        api.get('/settings/profiles/managed'),
        api.get('/nodes'),
        api.get('/rotation/history'),
        api.get('/domains?page=1&limit=1'),
      ]);
      if (profRes.status === 'fulfilled') setProfiles(profRes.value.data || []);
      if (nodeRes.status === 'fulfilled') setNodes(nodeRes.value.data || []);
      if (histRes.status === 'fulfilled') setHistory((histRes.value.data || []).slice(0, 10));
      if (domRes.status === 'fulfilled') setDomainsCount(domRes.value.data?.total ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
    intervalRef.current = setInterval(loadAll, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [loadAll]);

  const handleRotateAll = async () => {
    try {
      setRotating('all');
      const { data } = await api.post('/rotation/rotate-all');
      showMsg('success', data.message || 'Ротация запущена');
      await loadAll();
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка ротации');
    } finally {
      setRotating(null);
    }
  };

  const handleRotateOne = async (uuid: string) => {
    try {
      setRotating(uuid);
      const { data } = await api.post(`/settings/profiles/managed/${uuid}/rotate`);
      showMsg(data.success ? 'success' : 'error', data.message);
      await loadAll();
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка ротации');
    } finally {
      setRotating(null);
    }
  };

  const onlineNodes = nodes.filter(n => n.isConnected && !n.isDisabled).length;
  const enabledProfiles = profiles.filter(p => p.rotationEnabled).length;
  const lastRotation = profiles
    .filter(p => p.lastRotationTimestamp)
    .sort((a, b) => b.lastRotationTimestamp - a.lastRotationTimestamp)[0];

  const statCards = [
    { label: 'Ноды', value: `${onlineNodes} / ${nodes.length}`, sub: 'онлайн', color: onlineNodes === nodes.length && nodes.length > 0 ? 'success.main' : 'warning.main' },
    { label: 'Профили', value: String(profiles.length), sub: `${enabledProfiles} активных`, color: 'primary.main' },
    { label: 'Последняя ротация', value: lastRotation ? formatAgo(lastRotation.lastRotationTimestamp) : 'никогда', sub: lastRotation?.name || '', color: 'text.primary' },
    { label: 'Домены', value: domainsCount !== null ? String(domainsCount) : '—', sub: 'для SNI', color: 'text.primary' },
  ];

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
        <Typography variant="h5">Главная</Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" startIcon={<Refresh />} onClick={loadAll} disabled={loading}>
            Обновить
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={rotating === 'all' ? <CircularProgress size={14} color="inherit" /> : <PlayArrow />}
            onClick={handleRotateAll}
            disabled={!!rotating}
          >
            Ротировать всё
          </Button>
        </Stack>
      </Stack>

      {/* Stat cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mb: 3 }}>
        {statCards.map((c) => (
          <Card key={c.label} variant="outlined">
            <CardContent sx={{ pb: '12px !important' }}>
              <Typography variant="caption" color="textSecondary">{c.label}</Typography>
              <Typography variant="h5" fontWeight={700} sx={{ color: c.color }}>{c.value}</Typography>
              <Typography variant="caption" color="textSecondary">{c.sub}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 3 }}>
        {/* Profiles table */}
        <Paper variant="outlined">
          <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle1" fontWeight={600}>Профили</Typography>
          </Box>
          {profiles.length === 0 ? (
            <Box sx={{ p: 2 }}><Typography variant="body2" color="textSecondary">Нет профилей</Typography></Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Имя</TableCell>
                  <TableCell>Статус</TableCell>
                  <TableCell>Ротация</TableCell>
                  <TableCell align="right"></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {profiles.map((p) => (
                  <TableRow key={p.uuid} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>{p.name}</Typography>
                    </TableCell>
                    <TableCell>
                      {p.lastRotationStatus === 'success' && <Chip label="OK" size="small" color="success" />}
                      {p.lastRotationStatus === 'error' && (
                        <Tooltip title={p.lastRotationError}>
                          <Chip label="Ошибка" size="small" color="error" />
                        </Tooltip>
                      )}
                      {!p.lastRotationStatus && <Chip label="—" size="small" />}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="textSecondary">
                        {formatAgo(p.lastRotationTimestamp)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        onClick={() => handleRotateOne(p.uuid)}
                        disabled={!!rotating}
                        startIcon={rotating === p.uuid ? <CircularProgress size={12} color="inherit" /> : undefined}
                      >
                        Ротировать
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>

        {/* Nodes table */}
        <Paper variant="outlined">
          <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle1" fontWeight={600}>Ноды</Typography>
          </Box>
          {nodes.length === 0 ? (
            <Box sx={{ p: 2 }}><Typography variant="body2" color="textSecondary">Нет нод</Typography></Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Имя</TableCell>
                  <TableCell>Адрес</TableCell>
                  <TableCell>Статус</TableCell>
                  <TableCell>Онлайн</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {nodes.map((n) => (
                  <TableRow key={n.uuid} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>{n.name}</Typography>
                      {n.countryCode && <Typography variant="caption" color="textSecondary"> {n.countryCode}</Typography>}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{n.address}{n.port ? `:${n.port}` : ''}</Typography>
                    </TableCell>
                    <TableCell>
                      {n.isDisabled
                        ? <Chip label="Откл." size="small" />
                        : n.isConnected
                          ? <Chip label="Онлайн" size="small" color="success" />
                          : <Chip label="Офлайн" size="small" color="error" />}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{n.usersOnline ?? '—'}</Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>
      </Box>

      {/* History */}
      {history.length > 0 && (
        <Paper variant="outlined" sx={{ mt: 3 }}>
          <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle1" fontWeight={600}>Последние ротации</Typography>
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Время</TableCell>
                <TableCell>Профиль</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell>Сообщение</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.map((h) => (
                <TableRow key={h.id} hover>
                  <TableCell>
                    <Typography variant="caption">{new Date(h.timestamp).toLocaleString('ru')}</Typography>
                  </TableCell>
                  <TableCell>{h.profileName}</TableCell>
                  <TableCell>
                    {h.status === 'success'
                      ? <Chip label="OK" size="small" color="success" />
                      : <Chip label="Ошибка" size="small" color="error" />}
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="textSecondary">{h.message}</Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      <Snackbar open={msg.open} autoHideDuration={4000} onClose={() => setMsg(m => ({ ...m, open: false }))}>
        <Alert severity={msg.type}>{msg.text}</Alert>
      </Snackbar>
    </Box>
  );
}
