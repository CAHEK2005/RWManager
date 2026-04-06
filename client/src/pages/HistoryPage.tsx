import { useEffect, useState, useCallback } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse,
  IconButton, Paper, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, Typography, TextField, Select, MenuItem,
  FormControl, InputLabel, Pagination,
} from '@mui/material';
import { CheckCircle, Cancel, ExpandMore, ExpandLess, DeleteOutline, Refresh } from '@mui/icons-material';
import api from '../api';
import { useAlert } from '../hooks/useAlert';

interface HistoryNodeResult {
  nodeId: string;
  nodeName: string;
  status: 'success' | 'error';
  logs: string[];
}

interface HistoryEntry {
  id: string;
  scriptId: string;
  scriptName: string;
  status: 'success' | 'error';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  nodeCount: number;
  successCount: number;
  logPreview?: string;
  nodeResults?: HistoryNodeResult[];
}

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
  const [scriptFilter, setScriptFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detailCache, setDetailCache] = useState<Record<string, HistoryEntry>>({});
  const [clearing, setClearing] = useState(false);
  const { msg, showMsg, closeMsg } = useAlert();

  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/scripts/history?page=${page}&limit=${PAGE_SIZE}`);
      setEntries(data.data || []);
      setTotal(data.total || 0);
    } catch {
      showMsg('Ошибка загрузки истории', 'error');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = async (entry: HistoryEntry) => {
    const next = new Set(expanded);
    if (next.has(entry.id)) {
      next.delete(entry.id);
    } else {
      next.add(entry.id);
      if (!detailCache[entry.id]) {
        try {
          const { data } = await api.get(`/scripts/history/${entry.id}`);
          setDetailCache(prev => ({ ...prev, [entry.id]: data }));
        } catch { /* ignore */ }
      }
    }
    setExpanded(next);
  };

  const handleClear = async () => {
    if (!confirm('Удалить всю историю выполнений?')) return;
    setClearing(true);
    try {
      await api.delete('/scripts/history');
      setEntries([]);
      setTotal(0);
      setDetailCache({});
      showMsg('История очищена', 'success');
    } catch {
      showMsg('Ошибка при очистке', 'error');
    } finally {
      setClearing(false);
    }
  };

  const filtered = entries.filter(e => {
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    if (scriptFilter && !e.scriptName.toLowerCase().includes(scriptFilter.toLowerCase())) return false;
    return true;
  });

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}мс`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}с`;
    return `${Math.floor(ms / 60000)}м ${Math.round((ms % 60000) / 1000)}с`;
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>История</Typography>
        <Typography variant="body2" color="text.secondary">Результаты выполнения скриптов</Typography>
      </Box>

      {/* Filters */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }} alignItems="center">
        <TextField
          size="small"
          placeholder="Поиск по скрипту..."
          value={scriptFilter}
          onChange={e => setScriptFilter(e.target.value)}
          sx={{ minWidth: 200 }}
        />
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Статус</InputLabel>
          <Select value={statusFilter} label="Статус" onChange={e => setStatusFilter(e.target.value as any)}>
            <MenuItem value="all">Все</MenuItem>
            <MenuItem value="success">Успешно</MenuItem>
            <MenuItem value="error">С ошибкой</MenuItem>
          </Select>
        </FormControl>
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<Refresh />} onClick={load} disabled={loading}>
          Обновить
        </Button>
        <Button size="small" color="error" startIcon={clearing ? <CircularProgress size={14} /> : <DeleteOutline />}
          onClick={handleClear} disabled={clearing || entries.length === 0}>
          Очистить всё
        </Button>
      </Stack>

      {loading && <CircularProgress size={24} sx={{ display: 'block', mx: 'auto', my: 3 }} />}

      {!loading && filtered.length === 0 && (
        <Alert severity="info">История выполнений пуста.</Alert>
      )}

      {!loading && filtered.length > 0 && (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell />
                <TableCell>Скрипт</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Ноды</TableCell>
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Длительность</TableCell>
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Время</TableCell>
                <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>Превью лога</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map(entry => {
                const detail = detailCache[entry.id];
                const isOpen = expanded.has(entry.id);
                return (
                  <>
                    <TableRow key={entry.id} hover sx={{ cursor: 'pointer' }} onClick={() => toggleExpand(entry)}>
                      <TableCell sx={{ width: 32 }}>
                        <IconButton size="small" onClick={e => { e.stopPropagation(); toggleExpand(entry); }}>
                          {isOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                        </IconButton>
                      </TableCell>
                      <TableCell>{entry.scriptName}</TableCell>
                      <TableCell>
                        <Chip
                          icon={entry.status === 'success' ? <CheckCircle sx={{ fontSize: 14 }} /> : <Cancel sx={{ fontSize: 14 }} />}
                          label={entry.status === 'success' ? 'Успешно' : 'Ошибка'}
                          size="small"
                          color={entry.status === 'success' ? 'success' : 'error'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                        {entry.successCount}/{entry.nodeCount}
                      </TableCell>
                      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                        {formatDuration(entry.durationMs)}
                      </TableCell>
                      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                        {formatDate(entry.startedAt)}
                      </TableCell>
                      <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' }, maxWidth: 260 }}>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {entry.logPreview}
                        </Typography>
                      </TableCell>
                    </TableRow>
                    <TableRow key={`${entry.id}-detail`}>
                      <TableCell colSpan={7} sx={{ py: 0 }}>
                        <Collapse in={isOpen} unmountOnExit>
                          <Box sx={{ p: 2 }}>
                            {!detail ? (
                              <CircularProgress size={20} />
                            ) : (
                              <Stack spacing={1.5}>
                                {detail.nodeResults?.map(nr => (
                                  <Paper key={nr.nodeId} variant="outlined" sx={{ p: 1.5 }}>
                                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                                      {nr.status === 'success'
                                        ? <CheckCircle color="success" sx={{ fontSize: 16 }} />
                                        : <Cancel color="error" sx={{ fontSize: 16 }} />}
                                      <Typography variant="subtitle2">{nr.nodeName}</Typography>
                                    </Stack>
                                    <Box component="pre" sx={{
                                      fontSize: 11, fontFamily: 'monospace', bgcolor: 'background.default',
                                      p: 1, borderRadius: 1, overflowX: 'auto', maxHeight: 200,
                                      overflowY: 'auto', m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                    }}>
                                      {nr.logs.join('\n')}
                                    </Box>
                                  </Paper>
                                ))}
                              </Stack>
                            )}
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </>
                );
              })}
            </TableBody>
          </Table>
        </Paper>
      )}

      {total > PAGE_SIZE && (
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
          <Pagination
            count={Math.ceil(total / PAGE_SIZE)}
            page={page}
            onChange={(_, v) => setPage(v)}
            color="primary"
          />
        </Box>
      )}

      {msg && (
        <Box sx={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9999 }}>
          <Alert severity={msg.severity} onClose={closeMsg}>{msg.text}</Alert>
        </Box>
      )}
    </Box>
  );
}
