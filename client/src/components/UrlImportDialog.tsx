import React, { useEffect, useState } from 'react';
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
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material';
import api from '../api';
import ConfirmDialog from './ConfirmDialog';

interface CategoryResult {
  name: string;
  count: number;
  domains: string[];
}

interface UrlImportDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (domains: string[]) => void;
}

export default function UrlImportDialog({ open, onClose, onAdd }: UrlImportDialogProps) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [categories, setCategories] = useState<CategoryResult[] | null>(null);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [closeConfirm, setCloseConfirm] = useState(false);

  useEffect(() => {
    if (!open) {
      setUrl('');
      setLoading(false);
      setError('');
      setCategories(null);
      setTotal(0);
      setSelected(new Set());
    }
  }, [open]);

  const handleFetch = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/domains/preview-url', { url: url.trim() });
      setCategories(data.categories);
      setTotal(data.total);
      setSelected(new Set(data.categories.map((c: CategoryResult) => c.name)));
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) { next.delete(name); } else { next.add(name); }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelected(new Set(categories?.map(c => c.name) ?? []));
  };

  const handleSelectNone = () => {
    setSelected(new Set());
  };

  const selectedCount = (categories ?? [])
    .filter(c => selected.has(c.name))
    .reduce((sum, c) => sum + c.count, 0);

  const handleAddSelected = () => {
    const domains = (categories ?? [])
      .filter(c => selected.has(c.name))
      .flatMap(c => c.domains);
    onAdd(domains);
    onClose();
  };

  const handleClose = (_event?: unknown, reason?: string) => {
    if ((reason === 'backdropClick' || reason === 'escapeKeyDown') && url.trim() && categories === null) {
      setCloseConfirm(true);
    } else {
      onClose();
    }
  };

  return (
    <>
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Загрузить домены из URL</DialogTitle>
      <DialogContent>
        {categories === null ? (
          <Box sx={{ pt: 1 }}>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <Box
                component="input"
                value={url}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && handleFetch()}
                placeholder="https://example.com/domains.txt"
                sx={{
                  flex: 1,
                  height: 40,
                  px: 1.5,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  fontSize: 14,
                  bgcolor: 'background.paper',
                  color: 'text.primary',
                  outline: 'none',
                  '&:focus': { borderColor: 'primary.main' },
                }}
              />
              <Button
                variant="contained"
                onClick={handleFetch}
                disabled={loading || !url.trim()}
                startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
                sx={{ whiteSpace: 'nowrap' }}
              >
                Загрузить
              </Button>
            </Stack>
            {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
          </Box>
        ) : (
          <Box sx={{ pt: 1 }}>
            <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
              Найдено доменов: {total}. Выберите категории для добавления:
            </Typography>

            <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
              <Button size="small" onClick={handleSelectAll}>Выбрать все</Button>
              <Button size="small" onClick={handleSelectNone}>Снять все</Button>
            </Stack>

            <Divider sx={{ mb: 1 }} />

            <Box sx={{ maxHeight: 360, overflowY: 'auto' }}>
              {categories.map(c => (
                <FormControlLabel
                  key={c.name}
                  control={
                    <Checkbox
                      checked={selected.has(c.name)}
                      onChange={() => handleToggle(c.name)}
                      size="small"
                    />
                  }
                  label={
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2">{c.name}</Typography>
                      <Typography variant="caption" color="textSecondary">({c.count})</Typography>
                    </Stack>
                  }
                  sx={{ display: 'flex', ml: 0 }}
                />
              ))}
            </Box>

            <Divider sx={{ mt: 1, mb: 1 }} />
            <Typography variant="body2" color="textSecondary">
              Выбрано доменов: <strong>{selectedCount}</strong>
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {categories !== null && (
          <Button onClick={() => { setCategories(null); setError(''); }}>Назад</Button>
        )}
        <Button onClick={onClose}>Закрыть</Button>
        {categories !== null && (
          <Button
            variant="contained"
            onClick={handleAddSelected}
            disabled={selectedCount === 0}
          >
            Добавить выбранные ({selectedCount})
          </Button>
        )}
      </DialogActions>
    </Dialog>
    <ConfirmDialog
      open={closeConfirm}
      title="Закрыть без сохранения?"
      message="Введённый URL будет потерян."
      confirmLabel="Закрыть"
      confirmColor="warning"
      onConfirm={() => { setCloseConfirm(false); onClose(); }}
      onCancel={() => setCloseConfirm(false)}
    />
    </>
  );
}
