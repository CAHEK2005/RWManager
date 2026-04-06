import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress,
  Skeleton, Snackbar, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, Tooltip, Typography, Paper,
} from '@mui/material';
import {
  Refresh, PlayArrow, Storage, Layers, Autorenew, Public,
  CheckCircle, Cancel, RadioButtonUnchecked,
} from '@mui/icons-material';
import api from '../api';
import { useAlert } from '../hooks/useAlert';
import { getErrorMessage } from '../utils/error';

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

// ── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  accent: string;
}

function StatCard({ label, value, sub, icon, accent }: StatCardProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography sx={{
            fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.07em',
            textTransform: 'uppercase', color: 'text.secondary', mb: 0.75,
          }}>
            {label}
          </Typography>
          <Typography sx={{ fontSize: '1.75rem', fontWeight: 700, lineHeight: 1, mb: 0.5, letterSpacing: '-0.02em' }}>
            {value}
          </Typography>
          <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
            {sub}
          </Typography>
        </Box>
        <Box sx={{
          width: 38, height: 38, borderRadius: '10px', flexShrink: 0,
          bgcolor: accent + '18',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: accent,
        }}>
          {icon}
        </Box>
      </Stack>
    </Paper>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600 }}>{title}</Typography>
      {count !== undefined && (
        <Box sx={{ px: 1, py: 0.25, borderRadius: '5px', bgcolor: 'action.hover' }}>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: 'text.secondary' }}>{count}</Typography>
        </Box>
      )}
    </Box>
  );
}

// ── Node status ───────────────────────────────────────────────────────────────

function NodeStatus({ node }: { node: RwNode }) {
  if (node.isDisabled) return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      <RadioButtonUnchecked sx={{ fontSize: 12, color: 'text.disabled' }} />
      <Typography sx={{ fontSize: '0.75rem', color: 'text.disabled' }}>Откл.</Typography>
    </Stack>
  );
  if (node.isConnected) return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#10b981', flexShrink: 0 }} />
      <Typography sx={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 500 }}>Онлайн</Typography>
    </Stack>
  );
  return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#ef4444', flexShrink: 0 }} />
      <Typography sx={{ fontSize: '0.75rem', color: '#ef4444', fontWeight: 500 }}>Офлайн</Typography>
    </Stack>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface NodeHealth {
  nodeId: string;
  nodeName: string;
  ip: string;
  port: number;
  online: boolean;
  lastCheck: string;
  lastOnline: string | null;
}

export default function DashboardPage() {
  const [profiles, setProfiles] = useState<ManagedProfile[]>([]);
  const [nodes, setNodes] = useState<RwNode[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [domainsCount, setDomainsCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [healthStatus, setHealthStatus] = useState<NodeHealth[]>([]);
  const { msg, showMsg, closeMsg } = useAlert();
  const [rotating, setRotating] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [profRes, nodeRes, histRes, domRes, healthRes] = await Promise.allSettled([
        api.get('/settings/profiles/managed'),
        api.get('/nodes'),
        api.get('/rotation/history'),
        api.get('/domains?page=1&limit=1'),
        api.get('/health/status'),
      ]);
      if (profRes.status === 'fulfilled') setProfiles(profRes.value.data || []);
      else console.warn('Не удалось загрузить профили:', profRes.reason);
      if (nodeRes.status === 'fulfilled') setNodes(nodeRes.value.data || []);
      else console.warn('Не удалось загрузить ноды:', nodeRes.reason);
      if (histRes.status === 'fulfilled') setHistory((histRes.value.data || []).slice(0, 10));
      else console.warn('Не удалось загрузить историю:', histRes.reason);
      if (domRes.status === 'fulfilled') setDomainsCount(domRes.value.data?.total ?? null);
      else console.warn('Не удалось загрузить домены:', domRes.reason);
      if (healthRes.status === 'fulfilled') setHealthStatus(healthRes.value.data || []);
      else console.warn('Не удалось загрузить health-статус:', healthRes.reason);
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
    } catch (e: unknown) {
      showMsg('error', getErrorMessage(e));
    } finally { setRotating(null); }
  };

  const handleRotateOne = async (uuid: string) => {
    try {
      setRotating(uuid);
      const { data } = await api.post(`/settings/profiles/managed/${uuid}/rotate`);
      showMsg(data.success ? 'success' : 'error', data.message);
      await loadAll();
    } catch (e: unknown) {
      showMsg('error', getErrorMessage(e));
    } finally { setRotating(null); }
  };

  const onlineNodes = nodes.filter(n => n.isConnected && !n.isDisabled).length;
  const enabledProfiles = profiles.filter(p => p.rotationEnabled).length;
  const lastRotation = profiles
    .filter(p => p.lastRotationTimestamp)
    .sort((a, b) => b.lastRotationTimestamp - a.lastRotationTimestamp)[0];

  return (
    <Box>
      {/* Page header */}
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems="flex-start" sx={{ mb: 3, gap: 1.5 }}>
        <Box>
          <Typography sx={{ fontSize: '1.125rem', fontWeight: 700, letterSpacing: '-0.01em', mb: 0.25 }}>
            Главная
          </Typography>
          <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
            Обзор системы и управление ротацией
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            startIcon={loading ? <CircularProgress size={12} color="inherit" /> : <Refresh sx={{ fontSize: 14 }} />}
            onClick={loadAll}
            disabled={loading}
          >
            Обновить
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={rotating === 'all' ? <CircularProgress size={12} color="inherit" /> : <PlayArrow sx={{ fontSize: 14 }} />}
            onClick={handleRotateAll}
            disabled={!!rotating}
          >
            Ротировать всё
          </Button>
        </Stack>
      </Stack>

      {/* Stat cards */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
        gap: 2,
        mb: 3,
      }}>
        <StatCard
          label="Ноды"
          value={`${onlineNodes}/${nodes.length}`}
          sub="онлайн / всего"
          icon={<Storage sx={{ fontSize: 18 }} />}
          accent={onlineNodes === nodes.length && nodes.length > 0 ? '#10b981' : '#f59e0b'}
        />
        <StatCard
          label="Профили"
          value={String(profiles.length)}
          sub={`${enabledProfiles} с ротацией`}
          icon={<Layers sx={{ fontSize: 18 }} />}
          accent="#1395de"
        />
        <StatCard
          label="Последняя ротация"
          value={lastRotation ? formatAgo(lastRotation.lastRotationTimestamp) : '—'}
          sub={lastRotation?.name || 'нет данных'}
          icon={<Autorenew sx={{ fontSize: 18 }} />}
          accent="#8b5cf6"
        />
        <StatCard
          label="Домены SNI"
          value={domainsCount !== null ? String(domainsCount) : '—'}
          sub="в белом списке"
          icon={<Public sx={{ fontSize: 18 }} />}
          accent="#f59e0b"
        />
      </Box>

      {/* Tables row */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
        gap: 2.5,
        mb: 2.5,
      }}>
        {/* Profiles */}
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', overflowX: 'auto' }}>
          <SectionHeader title="Профили" count={profiles.length} />
          {profiles.length === 0 ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>Нет профилей</Typography>
            </Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Имя</TableCell>
                  <TableCell>Статус</TableCell>
                  <TableCell>Ротация</TableCell>
                  <TableCell align="right" sx={{ pr: '16px !important' }}></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading && Array(3).fill(0).map((_, i) => (
                  <TableRow key={`sk-p-${i}`}>
                    {Array(4).fill(0).map((__, j) => <TableCell key={j}><Skeleton variant="text" /></TableCell>)}
                  </TableRow>
                ))}
                {!loading && profiles.map((p) => (
                  <TableRow key={p.uuid}>
                    <TableCell>
                      <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500 }}>{p.name}</Typography>
                    </TableCell>
                    <TableCell>
                      {p.lastRotationStatus === 'success' && (
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <CheckCircle sx={{ fontSize: 13, color: '#10b981' }} />
                          <Typography sx={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 500 }}>OK</Typography>
                        </Stack>
                      )}
                      {p.lastRotationStatus === 'error' && (
                        <Tooltip title={p.lastRotationError}>
                          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ cursor: 'help' }}>
                            <Cancel sx={{ fontSize: 13, color: '#ef4444' }} />
                            <Typography sx={{ fontSize: '0.75rem', color: '#ef4444', fontWeight: 500 }}>Ошибка</Typography>
                          </Stack>
                        </Tooltip>
                      )}
                      {!p.lastRotationStatus && (
                        <Typography sx={{ fontSize: '0.75rem', color: 'text.disabled' }}>—</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                        {formatAgo(p.lastRotationTimestamp)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => handleRotateOne(p.uuid)}
                        disabled={!!rotating}
                        sx={{ fontSize: '0.75rem', py: 0.25, px: 1, minWidth: 0 }}
                        startIcon={rotating === p.uuid ? <CircularProgress size={10} color="inherit" /> : undefined}
                      >
                        {rotating === p.uuid ? '' : 'Ротировать'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>

        {/* Nodes */}
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', overflowX: 'auto' }}>
          <SectionHeader title="Ноды" count={nodes.length} />
          {!loading && nodes.length === 0 ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>Нет нод</Typography>
            </Box>
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
                {loading && Array(3).fill(0).map((_, i) => (
                  <TableRow key={`sk-n-${i}`}>
                    {Array(4).fill(0).map((__, j) => <TableCell key={j}><Skeleton variant="text" /></TableCell>)}
                  </TableRow>
                ))}
                {!loading && nodes.map((n) => (
                  <TableRow key={n.uuid}>
                    <TableCell>
                      <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500, lineHeight: 1.3 }}>{n.name}</Typography>
                      {n.countryCode && (
                        <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>{n.countryCode}</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', fontFamily: 'monospace' }}>
                        {n.address}{n.port ? `:${n.port}` : ''}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <NodeStatus node={n} />
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: '0.8125rem', fontWeight: n.usersOnline ? 600 : 400, color: n.usersOnline ? 'text.primary' : 'text.secondary' }}>
                        {n.usersOnline ?? '—'}
                      </Typography>
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
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', overflowX: 'auto' }}>
          <SectionHeader title="Последние ротации" count={history.length} />
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
                <TableRow key={h.id}>
                  <TableCell>
                    <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                      {new Date(h.timestamp).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500 }}>{h.profileName}</Typography>
                  </TableCell>
                  <TableCell>
                    {h.status === 'success' ? (
                      <Chip
                        label="OK"
                        size="small"
                        sx={{ bgcolor: '#10b98120', color: '#10b981', border: 'none', fontWeight: 600, fontSize: '0.68rem' }}
                        variant="outlined"
                      />
                    ) : (
                      <Chip
                        label="Ошибка"
                        size="small"
                        sx={{ bgcolor: '#ef444420', color: '#ef4444', border: 'none', fontWeight: 600, fontSize: '0.68rem' }}
                        variant="outlined"
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{h.message}</Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {/* Health Status */}
      {healthStatus.length > 0 && (
        <Paper variant="outlined" sx={{ mb: 3 }}>
          <Box sx={{ px: 2, pt: 2, pb: 1 }}>
            <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'text.secondary', mb: 1 }}>
              МОНИТОРИНГ НОД
            </Typography>
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Нода</TableCell>
                <TableCell>IP</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Последняя проверка</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {healthStatus.map(h => (
                <TableRow key={h.nodeId}>
                  <TableCell>{h.nodeName}</TableCell>
                  <TableCell><Typography sx={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{h.ip}:{h.port}</Typography></TableCell>
                  <TableCell>
                    <Chip
                      label={h.online ? 'Онлайн' : 'Офлайн'}
                      size="small"
                      color={h.online ? 'success' : 'error'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                    <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                      {h.lastCheck ? new Date(h.lastCheck).toLocaleTimeString('ru-RU') : '—'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      <Snackbar
        open={msg.open}
        autoHideDuration={4000}
        onClose={() => closeMsg()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={msg.type} onClose={() => closeMsg()}>
          {msg.text}
        </Alert>
      </Snackbar>
    </Box>
  );
}
