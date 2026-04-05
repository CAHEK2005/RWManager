import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, TextField, Button, Typography, IconButton, Paper, TablePagination,
  Table, TableHead, TableRow, TableCell, TableBody, Stack, Snackbar, Tooltip,
} from '@mui/material';
import { Delete, Add, UploadFile, Language, FileDownload, Remove, DnsOutlined } from '@mui/icons-material';
import api from '../api';
import { useAlert } from '../hooks/useAlert';
import UrlImportDialog from '../components/UrlImportDialog';
import ConfirmDialog from '../components/ConfirmDialog';

interface Domain { id: number; name: string; }

export default function DomainsPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [urlImportOpen, setUrlImportOpen] = useState(false);
  const { msg, showMsg, closeMsg } = useAlert();

  const [confirmDel, setConfirmDel] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>
    ({ open: false, title: '', message: '', onConfirm: () => {} });

  const askDelete = (title: string, message: string, onConfirm: () => void) =>
    setConfirmDel({ open: true, title, message, onConfirm });

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const loadDomains = useCallback(async () => {
    try {
      const { data } = await api.get(`/domains?page=${page + 1}&limit=${rowsPerPage}`);
      setDomains(data.data);
      setTotalCount(data.total);
    } catch (e) {
      console.error(e);
    }
  }, [page, rowsPerPage]);

  useEffect(() => { loadDomains(); }, [loadDomains]);

  const handleAdd = async () => {
    if (!newDomain.trim()) return;
    await api.post('/domains', { name: newDomain.trim() });
    setNewDomain('');
    loadDomains();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd();
  };

  const handleDelete = (id: number, name: string) => {
    askDelete('Удалить домен', `Удалить домен "${name}" из белого списка?`, async () => {
      setConfirmDel(d => ({ ...d, open: false }));
      await api.delete(`/domains/${id}`);
      loadDomains();
    });
  };

  const handleDeleteAll = () => {
    askDelete(
      'Удалить все домены',
      'Вы действительно хотите удалить ВСЕ домены из белого списка?',
      async () => {
        setConfirmDel(d => ({ ...d, open: false }));
        try { await api.delete('/domains/all'); loadDomains(); } catch { /* ignore */ }
      },
    );
  };

  const handleExport = async () => {
    try {
      const { data } = await api.get('/domains/all');
      const text = (data as { name: string }[]).map(d => d.name).join('\n');
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'domains.txt'; a.click();
      URL.revokeObjectURL(url);
    } catch { showMsg('error', 'Ошибка экспорта'); }
  };

  const handleUrlImport = async (importedDomains: string[]) => {
    try {
      const { data } = await api.post('/domains/upload', { domains: importedDomains });
      showMsg('success', `Успешно добавлено доменов: ${data.count}`);
      loadDomains();
    } catch { showMsg('error', 'Ошибка при загрузке списка'); }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      if (!text) return;
      try {
        const { data } = await api.post('/domains/upload', { domains: text.split(/\r?\n/) });
        showMsg('success', `Успешно добавлено доменов: ${data.count}`);
        loadDomains();
      } catch { showMsg('error', 'Ошибка при загрузке списка'); }
      finally { if (fileInputRef.current) fileInputRef.current.value = ''; }
    };
    reader.readAsText(file);
  };

  return (
    <Box>
      {/* Page header */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'flex-start', justifyContent: 'space-between', mb: 3, gap: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>Домены SNI</Typography>
          <Typography variant="body2" color="text.secondary">Белый список доменов для Reality-инбаундов</Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          <Tooltip title="Импорт из файла">
            <Button variant="outlined" startIcon={<UploadFile />} onClick={() => fileInputRef.current?.click()}>
              Из файла
            </Button>
          </Tooltip>
          <Button variant="outlined" startIcon={<Language />} onClick={() => setUrlImportOpen(true)}>
            Из URL
          </Button>
        </Stack>
      </Box>

      {/* Add domain */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <DnsOutlined sx={{ color: 'text.secondary', flexShrink: 0, display: { xs: 'none', sm: 'block' } }} />
          <TextField
            size="small" fullWidth placeholder="Введите доменное имя и нажмите Enter"
            value={newDomain}
            onChange={e => setNewDomain(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button variant="contained" startIcon={<Add />} onClick={handleAdd} sx={{ flexShrink: 0 }}>
            Добавить
          </Button>
        </Stack>
      </Paper>

      <input type="file" accept=".txt" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />

      {/* Table */}
      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Домен</TableCell>
              <TableCell align="right" sx={{ width: 60 }}></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {domains.map(d => (
              <TableRow key={d.id}>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{d.name}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => handleDelete(d.id, d.name)} sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}>
                    <Delete sx={{ fontSize: 16 }} />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {domains.length === 0 && (
              <TableRow>
                <TableCell colSpan={2} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  Нет доменов
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, borderTop: 1, borderColor: 'divider' }}>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="text" startIcon={<FileDownload />} onClick={handleExport} disabled={totalCount === 0}>
              Экспорт .txt
            </Button>
            <Button size="small" variant="text" color="error" startIcon={<Remove />} onClick={handleDeleteAll} disabled={totalCount === 0}>
              Удалить все
            </Button>
          </Stack>
          <TablePagination
            component="div"
            count={totalCount}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[25, 50, 100]}
            labelRowsPerPage="На странице:"
            labelDisplayedRows={({ from, to, count }) => `${from}–${to} из ${count !== -1 ? count : `>${to}`}`}
            sx={{ border: 0, '.MuiTablePagination-toolbar': { minHeight: 40 } }}
          />
        </Box>
      </Paper>

      <Snackbar open={msg.open} autoHideDuration={4000} onClose={() => closeMsg()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={msg.type} onClose={() => closeMsg()}>{msg.text}</Alert>
      </Snackbar>
      <UrlImportDialog open={urlImportOpen} onClose={() => setUrlImportOpen(false)} onAdd={handleUrlImport} />
      <ConfirmDialog
        open={confirmDel.open}
        title={confirmDel.title}
        message={confirmDel.message}
        confirmLabel="Удалить"
        confirmColor="error"
        onConfirm={confirmDel.onConfirm}
        onCancel={() => setConfirmDel(d => ({ ...d, open: false }))}
      />
    </Box>
  );
}
