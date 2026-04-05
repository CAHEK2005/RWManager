import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControl, FormControlLabel,
  IconButton, InputLabel, Menu, MenuItem, Paper, Radio, RadioGroup, Select,
  Snackbar, Stack, Switch, Tab, Table, TableBody, TableCell, TableHead,
  TableRow, Tabs, TextField, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import {
  Add, CheckCircle, Close, ContentCopy, CropSquare, Delete, Edit, ErrorOutline,
  FileDownload, History, KeyboardArrowDown, KeyboardArrowUp, Label, MoreVert,
  LockOpen, OpenInNew, PlayArrow, Remove, Restore, Terminal, UploadFile, VpnKey,
} from '@mui/icons-material';
import type { SelectChangeEvent } from '@mui/material/Select';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import api from '../api';
import { useAlert } from '../hooks/useAlert';
import { getErrorMessage } from '../utils/error';
import ConfirmDialog from '../components/ConfirmDialog';

// ─── Variable extraction ──────────────────────────────────────────────────────

interface ScriptVar {
  name: string;
  label: string;
}

function extractVariables(content: string): ScriptVar[] {
  const regex = /\{\{\s*(\w+)(?:\s*\|\s*([^}]*?))?\s*\}\}/g;
  const seen = new Set<string>();
  const vars: ScriptVar[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      vars.push({ name, label: m[2]?.trim() || name.replace(/_/g, ' ') });
    }
  }
  return vars;
}

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
  categoryIds?: string[];
}

interface NodeCategory {
  id: string;
  name: string;
  color: string;
}

interface Script {
  id: string;
  name: string;
  description?: string;
  content: string;
  isBuiltIn: boolean;
  isModified?: boolean;
  isHidden?: boolean;
}

interface RwNode {
  uuid: string;
  name: string;
  address: string;
}

interface HistoryListItem {
  id: string;
  scriptId: string;
  scriptName: string;
  status: 'success' | 'error';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  nodeCount: number;
  successCount: number;
}

interface HistoryNodeResult {
  nodeId: string;
  nodeName: string;
  status: 'success' | 'error';
  logs: string[];
}

interface HistoryEntryDetail {
  id: string;
  scriptName: string;
  status: 'success' | 'error';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  nodeResults: HistoryNodeResult[];
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}с`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return sec > 0 ? `${m}м ${sec}с` : `${m}м`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
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

interface TerminalSession {
  id: string;
  nodeId: string;
  nodeName: string;
  minimized: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

interface Secret {
  id: string;
  name: string;
  type: 'password' | 'ssh-key' | 'token' | 'custom';
  description?: string;
  createdAt: string;
}

type TerminalInstance = {
  xterm: XTerm;
  ws: WebSocket;
  fit: FitAddon;
  observer: ResizeObserver;
};

// ─── TerminalWindow ───────────────────────────────────────────────────────────

const TERM_HEADER_H = 40;
const TERM_MIN_W = 380;
const TERM_MIN_H = 160;

function TerminalWindow({
  session,
  index,
  onClose,
  onPositionChange,
  onMinimizeToggle,
  onResize,
  instanceRef,
  isMobile,
}: {
  session: TerminalSession;
  index: number;
  onClose: (id: string) => void;
  onPositionChange: (id: string, pos: { x: number; y: number }) => void;
  onMinimizeToggle: (id: string) => void;
  onResize: (id: string, size: { width: number; height: number }) => void;
  instanceRef: React.MutableRefObject<Map<string, TerminalInstance>>;
  isMobile?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const isResizing = useRef(false);
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  // Initialize xterm + WebSocket on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: { background: '#1a1a1a', foreground: '#f0f0f0' },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    const initTimer = setTimeout(() => fitAddon.fit(), 50);

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const token = localStorage.getItem('token') ?? '';
    const wsUrl = `${proto}://${window.location.host}/api/terminal?nodeId=${encodeURIComponent(session.nodeId)}&token=${encodeURIComponent(token)}&cols=${term.cols}&rows=${term.rows}`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onmessage = (e: MessageEvent) => {
      if (e.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(e.data));
      } else {
        term.write(e.data as string);
      }
    };

    ws.onclose = () => {
      term.writeln('\r\n\x1b[33m[Соединение закрыто]\x1b[0m');
    };

    ws.onerror = () => {
      term.writeln('\r\n\x1b[31m[Ошибка соединения]\x1b[0m');
    };

    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    // WS heartbeat — keeps nginx proxy connection alive
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 25_000);

    const observer = new ResizeObserver(() => {
      if (!container.clientHeight) return;
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
    observer.observe(container);

    instanceRef.current.set(session.id, { xterm: term, ws, fit: fitAddon, observer });

    return () => {
      clearTimeout(initTimer);
      clearInterval(heartbeat);
      observer.disconnect();
      ws.close();
      term.dispose();
      instanceRef.current.delete(session.id);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // Re-fit when un-minimized
  useEffect(() => {
    if (!session.minimized) {
      const inst = instanceRef.current.get(session.id);
      if (inst) setTimeout(() => inst.fit.fit(), 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.minimized]);

  // Global mouse handlers for drag + resize
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (isDragging.current) {
        onPositionChange(session.id, {
          x: e.clientX - dragOffset.current.x,
          y: e.clientY - dragOffset.current.y,
        });
      }
      if (isResizing.current) {
        const newW = Math.max(TERM_MIN_W, resizeStart.current.w + e.clientX - resizeStart.current.x);
        const newH = Math.max(TERM_MIN_H + TERM_HEADER_H, resizeStart.current.h + e.clientY - resizeStart.current.y);
        onResize(session.id, { width: newW, height: newH });
      }
    };
    const onUp = () => { isDragging.current = false; isResizing.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [session.id, onPositionChange, onResize]);

  const handleTitleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    isDragging.current = true;
    dragOffset.current = { x: e.clientX - session.position.x, y: e.clientY - session.position.y };
    e.preventDefault();
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    isResizing.current = true;
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      w: session.size.width,
      h: session.size.height,
    };
    e.preventDefault();
    e.stopPropagation();
  };

  const handlePopup = async () => {
    const popup = window.open('about:blank', '_blank', 'width=900,height=600');
    try {
      const { data } = await api.post('/terminal/ticket', { nodeId: session.nodeId });
      const params = new URLSearchParams({ ticket: data.ticket, nodeName: session.nodeName });
      if (popup) popup.location.href = `/terminal-popup?${params.toString()}`;
      onClose(session.id);
    } catch {
      popup?.close();
    }
  };

  const bodyHeight = session.size.height - TERM_HEADER_H;

  // ── Mobile: fullscreen Dialog ─────────────────────────────────────────────
  if (isMobile) {
    return (
      <Dialog fullScreen open TransitionProps={{ unmountOnExit: false }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: '#1a1a1a' }}>
          <Box sx={{
            display: 'flex', alignItems: 'center', px: 2,
            height: 48, bgcolor: '#111', flexShrink: 0,
            borderBottom: '1px solid rgba(255,255,255,0.1)',
          }}>
            <Terminal sx={{ color: '#4caf50', fontSize: 16, mr: 1 }} />
            <Typography sx={{ color: '#e0e0e0', flex: 1, fontSize: '0.875rem', fontWeight: 500 }}>
              {session.nodeName}
            </Typography>
            <IconButton size="small" onClick={() => onClose(session.id)} sx={{ color: '#9e9e9e' }}>
              <Close sx={{ fontSize: 20 }} />
            </IconButton>
          </Box>
          <Box ref={containerRef} sx={{ flex: 1, overflow: 'hidden', minHeight: 0 }} />
        </Box>
      </Dialog>
    );
  }

  // ── Desktop: floating window ──────────────────────────────────────────────
  return (
    <Box
      sx={{
        position: 'fixed',
        left: session.position.x,
        top: session.position.y,
        width: session.size.width,
        zIndex: 9999 + index,
        boxShadow: 8,
        borderRadius: 1,
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.15)',
      }}
    >
      {/* Title bar */}
      <Box
        onMouseDown={handleTitleMouseDown}
        sx={{
          display: 'flex',
          alignItems: 'center',
          height: TERM_HEADER_H,
          px: 1.5,
          bgcolor: '#2d2d2d',
          cursor: 'move',
          userSelect: 'none',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          gap: 0.5,
          flexShrink: 0,
        }}
      >
        <Terminal sx={{ color: '#4caf50', fontSize: 16, mr: 0.5 }} />
        <Typography variant="caption" sx={{ flex: 1, color: '#e0e0e0', fontSize: '0.8rem', fontWeight: 500 }}>
          {session.nodeName}
        </Typography>
        <Tooltip title="Открыть в отдельном окне">
          <IconButton size="small" onClick={handlePopup} sx={{ color: '#9e9e9e', p: 0.3 }}>
            <OpenInNew sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={session.minimized ? 'Развернуть' : 'Свернуть'}>
          <IconButton size="small" onClick={() => onMinimizeToggle(session.id)} sx={{ color: '#9e9e9e', p: 0.3 }}>
            {session.minimized ? <CropSquare sx={{ fontSize: 15 }} /> : <Remove sx={{ fontSize: 15 }} />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Закрыть">
          <IconButton size="small" onClick={() => onClose(session.id)} sx={{ color: '#9e9e9e', p: 0.3 }}>
            <Close sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Terminal body */}
      <Box
        ref={containerRef}
        sx={{
          width: '100%',
          height: session.minimized ? 0 : bodyHeight,
          bgcolor: '#1a1a1a',
          overflow: 'hidden',
        }}
      />

      {/* Resize handle (bottom-right corner) */}
      {!session.minimized && (
        <Box
          onMouseDown={handleResizeMouseDown}
          sx={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: 18,
            height: 18,
            cursor: 'nwse-resize',
            zIndex: 1,
            opacity: 0.4,
            '&:hover': { opacity: 0.9 },
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-end',
            pb: '3px',
            pr: '3px',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M9 1 L1 9 M9 5 L5 9 M9 9 L9 9" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </Box>
      )}
    </Box>
  );
}

// ─── Blank node form ──────────────────────────────────────────────────────────

const blankNode = (): Partial<SshNode> => ({
  name: '', ip: '', sshPort: 22, sshUser: 'root', authType: 'password', password: '', sshKey: '',
});

// ─── Component ────────────────────────────────────────────────────────────────

export default function ScriptsPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [tab, setTab] = useState(0);

  // Data
  const [sshNodes, setSshNodes] = useState<SshNode[]>([]);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [rwNodes, setRwNodes] = useState<RwNode[]>([]);

  // Snackbar
  const { msg, showMsg, closeMsg } = useAlert();

  // ── SSH Node dialog ───────────────────────────────────────────────────────
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

  // ── Script dialog ─────────────────────────────────────────────────────────
  const [scriptDialog, setScriptDialog] = useState(false);
  const [scriptForm, setScriptForm] = useState<Partial<Script>>({ name: '', description: '', content: '' });
  const [scriptEditId, setScriptEditId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);

  // ── Run dialog ────────────────────────────────────────────────────────────
  const [runDialog, setRunDialog] = useState(false);
  const [runScript, setRunScript] = useState<Script | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [runJob, setRunJob] = useState<ScriptJob | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [scriptVars, setScriptVars] = useState<ScriptVar[]>([]);
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const keyFileInputRef = useRef<HTMLInputElement | null>(null);
  const secretFileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Secrets ───────────────────────────────────────────────────────────────
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [secretDialog, setSecretDialog] = useState(false);
  const [secretEditId, setSecretEditId] = useState<string | null>(null);
  const [secretForm, setSecretForm] = useState({ name: '', type: 'password', value: '', description: '' });
  // Universal secret picker dialog
  const [secretPickerOpen, setSecretPickerOpen] = useState(false);
  const [secretPickerCallback, setSecretPickerCallback] = useState<((v: string) => void) | null>(null);

  // ── History ───────────────────────────────────────────────────────────────
  const [scriptHistoryDots, setScriptHistoryDots] = useState<
    Record<string, { id: string; status: 'success' | 'error'; startedAt: string }[]>
  >({});
  const [expandedHistoryScript, setExpandedHistoryScript] = useState<string | null>(null);
  const [expandedHistoryItems, setExpandedHistoryItems] = useState<HistoryListItem[]>([]);
  const [expandedHistoryTotal, setExpandedHistoryTotal] = useState(0);
  const [expandedHistoryPage, setExpandedHistoryPage] = useState(1);
  const [expandedHistoryLoading, setExpandedHistoryLoading] = useState(false);
  const [historyDetail, setHistoryDetail] = useState<HistoryEntryDetail | null>(null);
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false);

  // ── Categories ────────────────────────────────────────────────────────────
  const [categories, setCategories] = useState<NodeCategory[]>([]);
  const [catDialog, setCatDialog] = useState(false);
  const [catForm, setCatForm] = useState<{ id?: string; name: string; color: string }>({ name: '', color: '#1976d2' });
  const [catEditId, setCatEditId] = useState<string | null>(null);

  // ── Per-node vars (single run) ────────────────────────────────────────────
  const [perNodeVarsMode, setPerNodeVarsMode] = useState(false);
  const [varValuesPerNode, setVarValuesPerNode] = useState<Record<string, Record<string, string>>>({});

  // ── Script Queue ──────────────────────────────────────────────────────────
  const [scriptQueue, setScriptQueue] = useState<Script[]>([]);
  const [queueDialogOpen, setQueueDialogOpen] = useState(false);
  const [queueSelectedNodeIds, setQueueSelectedNodeIds] = useState<string[]>([]);
  const [varValuesPerScript, setVarValuesPerScript] = useState<Record<string, Record<string, string>>>({});
  // ── Per-node vars (queue run) ─────────────────────────────────────────────
  const [perNodeVarsQueueMode, setPerNodeVarsQueueMode] = useState(false);
  const [varValuesPerScriptPerNode, setVarValuesPerScriptPerNode] = useState<Record<string, Record<string, Record<string, string>>>>({});

  // ── Overflow menus ────────────────────────────────────────────────────────
  const [nodeRowMenu, setNodeRowMenu] = useState<{ el: HTMLElement; nodeId: string; nodeName: string } | null>(null);
  const [secretRowMenu, setSecretRowMenu] = useState<{ el: HTMLElement; id: string; name: string } | null>(null);

  // ── Confirm dialogs ───────────────────────────────────────────────────────
  const [confirmDel, setConfirmDel] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: '', message: '', onConfirm: () => {} });
  const askDelete = (title: string, message: string, onConfirm: () => void) =>
    setConfirmDel({ open: true, title, message, onConfirm });
  const [closeConfirm, setCloseConfirm] = useState(false);
  const pendingCloseRef = useRef<() => void>(() => {});
  const askClose = (onConfirmed: () => void) => { pendingCloseRef.current = onConfirmed; setCloseConfirm(true); };
  // isDirty per form dialog
  const [nodeFormDirty, setNodeFormDirty] = useState(false);
  const [catFormDirty, setCatFormDirty] = useState(false);
  const [scriptFormDirty, setScriptFormDirty] = useState(false);
  const [secretFormDirty, setSecretFormDirty] = useState(false);

  // ── Terminals ─────────────────────────────────────────────────────────────
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const termInstancesRef = useRef<Map<string, TerminalInstance>>(new Map());

  // ─── Load ─────────────────────────────────────────────────────────────────

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

  const loadSecrets = useCallback(async () => {
    try {
      const { data } = await api.get('/secrets');
      setSecrets(Array.isArray(data) ? data : []);
    } catch { setSecrets([]); }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const { data } = await api.get('/settings');
      const raw = data?.node_categories;
      setCategories(raw ? JSON.parse(raw) : []);
    } catch { setCategories([]); }
  }, []);

  const loadScriptDots = useCallback(async () => {
    try {
      const { data } = await api.get('/scripts/history?page=1&limit=50');
      const map: Record<string, { id: string; status: 'success' | 'error'; startedAt: string }[]> = {};
      for (const item of data.data as HistoryListItem[]) {
        if (!map[item.scriptId]) map[item.scriptId] = [];
        if (map[item.scriptId].length < 10)
          map[item.scriptId].push({ id: item.id, status: item.status, startedAt: item.startedAt });
      }
      setScriptHistoryDots(map);
    } catch { /* silent */ }
  }, []);

  const toggleScriptHistory = async (scriptId: string) => {
    if (expandedHistoryScript === scriptId) {
      setExpandedHistoryScript(null);
      return;
    }
    setExpandedHistoryScript(scriptId);
    setExpandedHistoryItems([]);
    setExpandedHistoryPage(1);
    setExpandedHistoryTotal(0);
    setExpandedHistoryLoading(true);
    try {
      const { data } = await api.get(`/scripts/history/by-script/${scriptId}?page=1&limit=10`);
      setExpandedHistoryItems(data.data);
      setExpandedHistoryTotal(data.total);
    } catch { /* silent */ }
    setExpandedHistoryLoading(false);
  };

  const loadMoreHistory = async (scriptId: string) => {
    const nextPage = expandedHistoryPage + 1;
    setExpandedHistoryLoading(true);
    try {
      const { data } = await api.get(`/scripts/history/by-script/${scriptId}?page=${nextPage}&limit=10`);
      setExpandedHistoryItems(prev => [...prev, ...data.data]);
      setExpandedHistoryPage(nextPage);
    } catch { /* silent */ }
    setExpandedHistoryLoading(false);
  };

  const openHistoryDetail = async (id: string) => {
    setHistoryDetailLoading(true);
    setHistoryDetail(null);
    try {
      const { data } = await api.get(`/scripts/history/${id}`);
      setHistoryDetail(data);
    } catch { /* silent */ }
    setHistoryDetailLoading(false);
  };

  useEffect(() => {
    loadSshNodes();
    loadScripts();
    loadRwNodes();
    loadSecrets();
    loadCategories();
  }, []);

  // ─── SSH Node handlers ────────────────────────────────────────────────────

  const openAddNode = () => {
    setNodeEditId(null);
    setNodeForm(blankNode());
    setNodeFormDirty(false);
    setNodeDialog(true);
  };

  const openEditNode = (node: SshNode) => {
    setNodeEditId(node.id);
    setNodeForm({ ...node });
    setNodeFormDirty(false);
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
    } catch (e: unknown) {
      showMsg('error', getErrorMessage(e));
    }
  };

  const handleDeleteNode = (id: string, name: string) => {
    askDelete('Удалить ноду', `Удалить ноду "${name}"?`, async () => {
      setConfirmDel(d => ({ ...d, open: false }));
      try {
        await api.delete(`/scripts/ssh-nodes/${id}`);
        loadSshNodes();
      } catch (e: unknown) {
        showMsg('error', getErrorMessage(e));
      }
    });
  };

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

  // ─── Category handlers ────────────────────────────────────────────────────

  const openAddCategory = () => {
    setCatEditId(null);
    setCatForm({ name: '', color: '#1976d2' });
    setCatFormDirty(false);
    setCatDialog(true);
  };

  const openEditCategory = (cat: NodeCategory) => {
    setCatEditId(cat.id);
    setCatForm({ name: cat.name, color: cat.color });
    setCatFormDirty(false);
    setCatDialog(true);
  };

  const handleSaveCategory = async () => {
    if (!catForm.name.trim()) { showMsg('error', 'Название обязательно'); return; }
    const updated = catEditId
      ? categories.map(c => c.id === catEditId ? { ...c, name: catForm.name, color: catForm.color } : c)
      : [...categories, { id: crypto.randomUUID(), name: catForm.name, color: catForm.color }];
    try {
      await api.post('/settings', { node_categories: JSON.stringify(updated) });
      setCategories(updated);
      setCatDialog(false);
    } catch (e: unknown) {
      showMsg('error', getErrorMessage(e));
    }
  };

  const handleDeleteCategory = (id: string, name: string) => {
    askDelete('Удалить категорию', `Удалить категорию "${name}"?`, async () => {
      setConfirmDel(d => ({ ...d, open: false }));
      const updated = categories.filter(c => c.id !== id);
      try {
        await api.post('/settings', { node_categories: JSON.stringify(updated) });
        setCategories(updated);
        const updatedNodes = sshNodes.map(n => ({
          ...n,
          categoryIds: (n.categoryIds || []).filter(cid => cid !== id),
        }));
        await Promise.all(updatedNodes
          .filter((n, i) => JSON.stringify(n.categoryIds) !== JSON.stringify(sshNodes[i].categoryIds))
          .map(n => api.patch(`/scripts/ssh-nodes/${n.id}`, n)),
        );
        await loadSshNodes();
      } catch (e: unknown) {
        showMsg('error', getErrorMessage(e));
      }
    });
  };

  const toggleNodeCategory = (catId: string) => {
    setNodeForm(prev => {
      const ids = prev.categoryIds || [];
      return {
        ...prev,
        categoryIds: ids.includes(catId) ? ids.filter(id => id !== catId) : [...ids, catId],
      };
    });
  };

  // ─── Script handlers ───────────────────────────────────────────────────────

  const openAddScript = () => {
    setScriptEditId(null);
    setScriptForm({ name: '', description: '', content: '' });
    setUrlInput('');
    setUrlLoading(false);
    setScriptFormDirty(false);
    setScriptDialog(true);
  };

  const openEditScript = (s: Script) => {
    setScriptEditId(s.id);
    setScriptForm({ name: s.name, description: s.description || '', content: s.content });
    setUrlInput('');
    setUrlLoading(false);
    setScriptFormDirty(false);
    setScriptDialog(true);
  };

  const handleLoadFromUrl = async () => {
    if (!urlInput.trim()) return;
    setUrlLoading(true);
    try {
      const { data } = await api.post('/scripts/fetch-url', { url: urlInput });
      setScriptForm(p => ({ ...p, content: data.content }));
      setUrlInput('');
    } catch (e: unknown) {
      showMsg('error', getErrorMessage(e));
    } finally {
      setUrlLoading(false);
    }
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
    } catch (e: unknown) {
      showMsg('error', getErrorMessage(e));
    }
  };

  const handleDeleteScript = (id: string, name: string, isBuiltIn?: boolean) => {
    const title = isBuiltIn ? 'Скрыть скрипт' : 'Удалить скрипт';
    const message = isBuiltIn
      ? `Скрыть встроенный скрипт "${name}"? Его можно восстановить через откат.`
      : `Удалить скрипт "${name}"?`;
    askDelete(title, message, async () => {
      setConfirmDel(d => ({ ...d, open: false }));
      try {
        await api.delete(`/scripts/scripts/${id}`);
        loadScripts();
      } catch (e: unknown) {
        showMsg('error', getErrorMessage(e));
      }
    });
  };

  const handleRevertScript = (id: string, name: string) => {
    askDelete('Откатить скрипт', `Откатить "${name}" к оригинальной версии? Ваши изменения будут потеряны.`, async () => {
      setConfirmDel(d => ({ ...d, open: false }));
      try {
        await api.post(`/scripts/scripts/${id}/revert`);
        showMsg('success', 'Скрипт откатан к оригиналу');
        loadScripts();
      } catch (e: unknown) {
        showMsg('error', getErrorMessage(e));
      }
    });
  };

  const handleCloneScript = async (s: Script) => {
    try {
      await api.post('/scripts/scripts', {
        name: `${s.name} (копия)`,
        description: s.description,
        content: s.content,
      });
      showMsg('success', 'Скрипт клонирован — отредактируйте копию');
      loadScripts();
    } catch (e: unknown) {
      showMsg('error', getErrorMessage(e));
    }
  };

  // ─── Run handlers ──────────────────────────────────────────────────────────

  const openRunDialog = (s: Script) => {
    const vars = extractVariables(s.content);
    setRunScript(s);
    setSelectedNodeIds([]);
    setRunJob(null);
    setScriptVars(vars);
    setVarValues(Object.fromEntries(vars.map(v => [v.name, ''])));
    setPerNodeVarsMode(false);
    setVarValuesPerNode({});
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

  useEffect(() => { if (tab === 1) loadScriptDots(); }, [tab]);

  const handleRunScript = async () => {
    if (!runScript || !selectedNodeIds.length) {
      showMsg('error', 'Выберите хотя бы одну ноду');
      return;
    }

    if (perNodeVarsMode) {
      // Валидация: у каждой выбранной ноды заполнены все переменные
      for (const nodeId of selectedNodeIds) {
        const node = sshNodes.find(n => n.id === nodeId);
        const emptyVar = scriptVars.find(v => !varValuesPerNode[nodeId]?.[v.name]?.trim());
        if (emptyVar) {
          showMsg('error', `Заполните «${emptyVar.label}» для ноды «${node?.name ?? nodeId}»`);
          return;
        }
      }
    } else {
      const emptyVar = scriptVars.find(v => !varValues[v.name]?.trim());
      if (emptyVar) {
        showMsg('error', `Заполните переменную: ${emptyVar.label}`);
        return;
      }
    }

    try {
      setRunLoading(true);
      setRunJob(null);
      const payload: any = {
        scriptId: runScript.id,
        nodeIds: selectedNodeIds,
      };
      if (perNodeVarsMode) {
        payload.variablesPerNode = varValuesPerNode;
      } else {
        payload.variables = varValues;
      }
      const { data } = await api.post('/scripts/execute', payload);
      startPolling(data.jobId);
    } catch (e: unknown) {
      showMsg('error', getErrorMessage(e));
      setRunLoading(false);
    }
  };

  const handleCloseRunDialog = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setRunDialog(false);
    setRunJob(null);
    setRunLoading(false);
    setScriptVars([]);
    setVarValues({});
    setPerNodeVarsMode(false);
    setVarValuesPerNode({});
    loadScriptDots();
  };

  // ─── Queue handlers ───────────────────────────────────────────────────────

  const addToQueue = (s: Script) => setScriptQueue(prev => [...prev, s]);

  const removeFromQueue = (index: number) =>
    setScriptQueue(prev => prev.filter((_, i) => i !== index));

  const moveQueueItem = (index: number, dir: 'up' | 'down') => {
    setScriptQueue(prev => {
      const next = [...prev];
      const swap = dir === 'up' ? index - 1 : index + 1;
      if (swap < 0 || swap >= next.length) return prev;
      [next[index], next[swap]] = [next[swap], next[index]];
      return next;
    });
  };

  const openQueueDialog = () => {
    const initialVars: Record<string, Record<string, string>> = {};
    for (const s of scriptQueue) {
      if (!initialVars[s.id]) {
        const vars = extractVariables(s.content);
        initialVars[s.id] = Object.fromEntries(vars.map(v => [v.name, '']));
      }
    }
    setVarValuesPerScript(initialVars);
    setQueueSelectedNodeIds([]);
    setRunJob(null);
    setRunLoading(false);
    setQueueDialogOpen(true);
  };

  const handleCloseQueueDialog = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setQueueDialogOpen(false);
    setRunJob(null);
    setRunLoading(false);
    setPerNodeVarsQueueMode(false);
    setVarValuesPerScriptPerNode({});
    loadScriptDots();
  };

  const handleRunQueue = async () => {
    if (!queueSelectedNodeIds.length) { showMsg('error', 'Выберите хотя бы одну ноду'); return; }

    if (perNodeVarsQueueMode) {
      for (const s of scriptQueue) {
        const vars = extractVariables(s.content);
        for (const nodeId of queueSelectedNodeIds) {
          const node = sshNodes.find(n => n.id === nodeId);
          const emptyVar = vars.find(v => !varValuesPerScriptPerNode[s.id]?.[nodeId]?.[v.name]?.trim());
          if (emptyVar) {
            showMsg('error', `Заполните «${emptyVar.label}» для ноды «${node?.name ?? nodeId}» (скрипт «${s.name}»)`);
            return;
          }
        }
      }
    } else {
      for (const s of scriptQueue) {
        const vars = extractVariables(s.content);
        const emptyVar = vars.find(v => !varValuesPerScript[s.id]?.[v.name]?.trim());
        if (emptyVar) {
          showMsg('error', `Заполните переменную «${emptyVar.label}» для скрипта «${s.name}»`);
          return;
        }
      }
    }

    try {
      setRunLoading(true);
      setRunJob(null);
      const payload: any = {
        scriptIds: scriptQueue.map(s => s.id),
        nodeIds: queueSelectedNodeIds,
        variablesPerScript: varValuesPerScript,
      };
      if (perNodeVarsQueueMode) {
        payload.variablesPerScriptPerNode = varValuesPerScriptPerNode;
      }
      const { data } = await api.post('/scripts/execute-sequence', payload);
      startPolling(data.jobId);
    } catch (e: unknown) {
      showMsg('error', getErrorMessage(e));
      setRunLoading(false);
    }
  };

  const selectNodesByCategory = (
    catId: string,
    currentIds: string[],
    setIds: React.Dispatch<React.SetStateAction<string[]>>,
  ) => {
    const nodesInCat = sshNodes.filter(n => (n.categoryIds || []).includes(catId)).map(n => n.id);
    const allSelected = nodesInCat.every(id => currentIds.includes(id));
    if (allSelected) {
      setIds(prev => prev.filter(id => !nodesInCat.includes(id)));
    } else {
      setIds(prev => [...new Set([...prev, ...nodesInCat])]);
    }
  };

  // ─── Secrets handlers ────────────────────────────────────────────────────

  const openAddSecret = () => {
    setSecretEditId(null);
    setSecretForm({ name: '', type: 'password', value: '', description: '' });
    setSecretFormDirty(false);
    setSecretDialog(true);
  };

  const openEditSecret = (s: Secret) => {
    setSecretEditId(s.id);
    setSecretForm({ name: s.name, type: s.type, value: '', description: s.description || '' });
    setSecretFormDirty(false);
    setSecretDialog(true);
  };

  const handleSaveSecret = async () => {
    if (!secretForm.name.trim()) {
      showMsg('error', 'Название обязательно');
      return;
    }
    if (!secretEditId && !secretForm.value.trim()) {
      showMsg('error', 'Значение обязательно');
      return;
    }
    try {
      const payload: any = { name: secretForm.name, type: secretForm.type, description: secretForm.description };
      if (secretForm.value.trim()) payload.value = secretForm.value;
      await api[secretEditId ? 'patch' : 'post'](
        secretEditId ? `/secrets/${secretEditId}` : '/secrets',
        payload,
      );
      showMsg('success', secretEditId ? 'Секрет обновлён' : 'Секрет создан');
      setSecretDialog(false);
      loadSecrets();
    } catch (e: unknown) {
      showMsg('error', getErrorMessage(e));
    }
  };

  const handleDeleteSecret = (id: string, name: string) => {
    askDelete('Удалить секрет', `Удалить секрет "${name}"?`, async () => {
      setConfirmDel(d => ({ ...d, open: false }));
      try {
        await api.delete(`/secrets/${id}`);
        loadSecrets();
      } catch (e: unknown) {
        showMsg('error', getErrorMessage(e));
      }
    });
  };

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
    } catch {
      showMsg('error', 'Не удалось получить значение секрета');
    }
  };

  // ─── Terminal handlers ────────────────────────────────────────────────────

  const openTerminal = useCallback((node: SshNode) => {
    setTerminals(prev => [...prev, {
      id: crypto.randomUUID(),
      nodeId: node.id,
      nodeName: node.name,
      minimized: false,
      position: { x: 80 + prev.length * 30, y: 80 + prev.length * 30 },
      size: { width: 680, height: 420 },
    }]);
  }, []);

  const openTerminalPopup = useCallback(async (node: SshNode) => {
    const popup = window.open('about:blank', '_blank', 'width=900,height=600');
    try {
      const { data } = await api.post('/terminal/ticket', { nodeId: node.id });
      const params = new URLSearchParams({ ticket: data.ticket, nodeName: node.name });
      if (popup) popup.location.href = `/terminal-popup?${params.toString()}`;
    } catch {
      popup?.close();
    }
  }, []);

  const closeTerminal = useCallback((id: string) => {
    setTerminals(prev => prev.filter(t => t.id !== id));
  }, []);

  const toggleMinimize = useCallback((id: string) => {
    setTerminals(prev => prev.map(t => t.id === id ? { ...t, minimized: !t.minimized } : t));
  }, []);

  const moveTerminal = useCallback((id: string, pos: { x: number; y: number }) => {
    setTerminals(prev => prev.map(t => t.id === id ? { ...t, position: pos } : t));
  }, []);

  const resizeTerminal = useCallback((id: string, size: { width: number; height: number }) => {
    setTerminals(prev => prev.map(t => t.id === id ? { ...t, size } : t));
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>Скрипты</Typography>
        <Typography variant="body2" color="text.secondary">SSH-ноды, bash-скрипты и хранилище секретов</Typography>
      </Box>

      <Paper>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tab label="Ноды" />
          <Tab label="Скрипты" />
          <Tab label="Секреты" />
        </Tabs>

        <Box sx={{ p: { xs: 2, md: 3 } }}>

          {/* ── Tab 0: SSH Nodes ── */}
          {tab === 0 && (
            <Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} sx={{ mb: 2, gap: 1 }}>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>SSH-ноды</Typography>
                  <Typography variant="caption" color="text.secondary">Серверы для выполнения скриптов</Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Button variant="outlined" startIcon={<Label />} size="small" onClick={() => { setCatDialog(true); setCatEditId(null); setCatForm({ name: '', color: '#1976d2' }); }}>
                    Категории
                  </Button>
                  <Button variant="contained" startIcon={<Add />} size="small" onClick={openAddNode}>
                    Добавить ноду
                  </Button>
                </Stack>
              </Stack>

              {sshNodes.length === 0 ? (
                <Alert severity="info">
                  Нет нод. Добавьте вручную или установите ноду через раздел «Ноды» — она появится здесь автоматически.
                </Alert>
              ) : (
                <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" sx={{ minWidth: 360 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Имя</TableCell>
                      <TableCell>IP</TableCell>
                      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>SSH-порт</TableCell>
                      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Пользователь</TableCell>
                      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Авторизация</TableCell>
                      <TableCell>Категории</TableCell>
                      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Нода RW</TableCell>
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
                          <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{node.sshPort}</TableCell>
                          <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{node.sshUser}</TableCell>
                          <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                            <Chip
                              label={node.authType === 'key' ? 'SSH-ключ' : 'Пароль'}
                              size="small"
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={0.5} flexWrap="wrap">
                              {(node.categoryIds || []).map(cid => {
                                const cat = categories.find(c => c.id === cid);
                                return cat ? (
                                  <Chip key={cid} label={cat.name} size="small"
                                    sx={{ bgcolor: cat.color, color: '#fff', fontSize: '0.7rem' }} />
                                ) : null;
                              })}
                            </Stack>
                          </TableCell>
                          <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                            {rw ? (
                              <Chip label={rw.name} size="small" color="primary" variant="outlined" />
                            ) : (
                              <Typography variant="caption" color="textSecondary">—</Typography>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                              <Tooltip title="Открыть терминал">
                                <IconButton size="small" color="primary" onClick={() => openTerminal(node)}>
                                  <Terminal sx={{ fontSize: 16 }} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Изменить">
                                <IconButton size="small" onClick={() => openEditNode(node)}>
                                  <Edit sx={{ fontSize: 16 }} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Ещё">
                                <IconButton size="small" onClick={e => setNodeRowMenu({ el: e.currentTarget, nodeId: node.id, nodeName: node.name })}>
                                  <MoreVert sx={{ fontSize: 16 }} />
                                </IconButton>
                              </Tooltip>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                </Box>
              )}
            </Box>
          )}

          {/* ── Tab 1: Scripts ── */}
          {tab === 1 && (
            <Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} sx={{ mb: 2, gap: 1 }}>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Скрипты</Typography>
                  <Typography variant="caption" color="text.secondary">Bash-скрипты для выполнения на нодах</Typography>
                </Box>
                <Button variant="contained" startIcon={<Add />} size="small" onClick={openAddScript}>
                  Создать скрипт
                </Button>
              </Stack>

              {scriptQueue.length > 0 && (
                <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderColor: 'primary.main', bgcolor: 'action.hover' }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" alignItems="center" sx={{ flex: 1 }}>
                      <Typography variant="caption" color="textSecondary" sx={{ mr: 0.5, whiteSpace: 'nowrap' }}>
                        Очередь:
                      </Typography>
                      {scriptQueue.map((s, i) => (
                        <Chip key={i} label={`${i + 1}. ${s.name}`} size="small"
                          onDelete={() => removeFromQueue(i)} />
                      ))}
                    </Stack>
                    <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                      <Button size="small" color="error" variant="text" onClick={() => setScriptQueue([])}>
                        Очистить
                      </Button>
                      <Button size="small" variant="contained" startIcon={<PlayArrow />}
                        onClick={openQueueDialog} disabled={sshNodes.length === 0}>
                        Запустить ({scriptQueue.length})
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>
              )}

              <Divider sx={{ mb: 2 }} />

              <Stack spacing={2}>
                {scripts.map(s => (
                  <Paper key={s.id} variant="outlined" sx={{ p: 2 }}>
                    <Stack direction="row" alignItems="flex-start" spacing={2}>
                      <Box sx={{ flex: 1 }}>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                          <Typography variant="subtitle1" fontWeight={600}>{s.name}</Typography>
                          {s.isBuiltIn && !s.isModified && (
                            <Chip label="Встроенный" size="small" color="info" variant="outlined" />
                          )}
                          {s.isBuiltIn && s.isModified && (
                            <Chip label="Изменён" size="small" color="warning" variant="outlined" />
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
                    </Stack>
                    {/* History dots */}
                    {scriptHistoryDots[s.id]?.length > 0 && (
                      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 1, mb: 0.5 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5, fontSize: '0.65rem' }}>
                          Запуски:
                        </Typography>
                        {[...scriptHistoryDots[s.id]].reverse().map(dot => (
                          <Tooltip key={dot.id} title={`${dot.status === 'success' ? 'Успешно' : 'Ошибка'} · ${formatDate(dot.startedAt)}`}>
                            <Box
                              onClick={e => { e.stopPropagation(); openHistoryDetail(dot.id); }}
                              sx={{
                                width: 8, height: 8, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
                                bgcolor: dot.status === 'success' ? 'success.main' : 'error.main',
                                transition: 'transform 0.1s', '&:hover': { transform: 'scale(1.5)' },
                              }}
                            />
                          </Tooltip>
                        ))}
                      </Stack>
                    )}

                    {/* Card footer */}
                    <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap"
                      sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider', gap: 1 }}>
                      <Stack direction="row" spacing={1}>
                        <Button size="small" variant="contained" startIcon={<PlayArrow />}
                          onClick={() => openRunDialog(s)} disabled={sshNodes.length === 0}>
                          Запустить
                        </Button>
                        <Button size="small" variant="outlined" startIcon={<Add />}
                          onClick={() => addToQueue(s)} disabled={sshNodes.length === 0}>
                          В очередь
                        </Button>
                        <Button
                          size="small" variant="text"
                          startIcon={<History sx={{ fontSize: 14 }} />}
                          onClick={() => toggleScriptHistory(s.id)}
                          sx={{ color: expandedHistoryScript === s.id ? 'primary.main' : 'text.secondary' }}
                        >
                          История
                        </Button>
                      </Stack>
                      <Stack direction="row" spacing={0.5}>
                        {s.isBuiltIn && s.isModified && (
                          <Tooltip title="Откатить к оригиналу">
                            <IconButton size="small" onClick={() => handleRevertScript(s.id, s.name)}
                              sx={{ color: 'warning.main' }}>
                              <Restore sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Tooltip>
                        )}
                        <Tooltip title="Клонировать">
                          <IconButton size="small" onClick={() => handleCloneScript(s)}>
                            <ContentCopy sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Изменить">
                          <IconButton size="small" onClick={() => openEditScript(s)}>
                            <Edit sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={s.isBuiltIn ? 'Скрыть' : 'Удалить'}>
                          <IconButton size="small" onClick={() => handleDeleteScript(s.id, s.name, s.isBuiltIn)}
                            sx={{ color: 'error.main' }}>
                            <Delete sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </Stack>

                    {/* Expandable history panel */}
                    {expandedHistoryScript === s.id && (
                      <Box sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
                        {expandedHistoryLoading && !expandedHistoryItems.length
                          ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={20} /></Box>
                          : !expandedHistoryItems.length
                            ? <Typography variant="caption" color="text.secondary">История запусков пуста</Typography>
                            : (
                              <Stack spacing={0}>
                                {expandedHistoryItems.map(item => (
                                  <Box key={item.id} onClick={() => openHistoryDetail(item.id)}
                                    sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.75,
                                      borderRadius: 1, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}>
                                    <Box sx={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                                      bgcolor: item.status === 'success' ? 'success.main' : 'error.main' }} />
                                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, minWidth: 90 }}>
                                      {formatDate(item.startedAt)}
                                    </Typography>
                                    <Chip label={`${item.successCount}/${item.nodeCount}`} size="small" variant="outlined"
                                      color={item.successCount === item.nodeCount ? 'success' : item.successCount === 0 ? 'error' : 'warning'}
                                      sx={{ height: 18, fontSize: '0.65rem' }} />
                                    <Typography variant="caption"
                                      color={item.status === 'success' ? 'text.secondary' : 'error.main'}
                                      sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {(item as any).logPreview || (item.status === 'success' ? 'Выполнено успешно' : 'Ошибка')}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                                      {formatDuration(item.durationMs)}
                                    </Typography>
                                  </Box>
                                ))}
                                {expandedHistoryItems.length < expandedHistoryTotal && (
                                  <Button size="small" variant="text" sx={{ alignSelf: 'flex-start', mt: 0.5 }}
                                    disabled={expandedHistoryLoading}
                                    onClick={e => { e.stopPropagation(); loadMoreHistory(s.id); }}>
                                    Загрузить ещё ({Math.min(10, expandedHistoryTotal - expandedHistoryItems.length)})
                                  </Button>
                                )}
                              </Stack>
                            )
                        }
                      </Box>
                    )}
                  </Paper>
                ))}
              </Stack>
            </Box>
          )}

          {/* ── Tab 2: Secrets ── */}
          {tab === 2 && (
            <Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} sx={{ mb: 2, gap: 1 }}>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Секреты</Typography>
                  <Typography variant="caption" color="text.secondary">Зашифрованное хранилище паролей, ключей и токенов</Typography>
                </Box>
                <Button variant="contained" startIcon={<Add />} size="small" onClick={openAddSecret}>
                  Добавить секрет
                </Button>
              </Stack>

              {secrets.length === 0 ? (
                <Alert severity="info">
                  Нет сохранённых секретов. Добавьте SSH-ключи, пароли или токены, чтобы использовать их как переменные при запуске скриптов.
                </Alert>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Название</TableCell>
                      <TableCell>Тип</TableCell>
                      <TableCell>Описание</TableCell>
                      <TableCell>Создан</TableCell>
                      <TableCell align="right">Действия</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {secrets.map(s => (
                      <TableRow key={s.id} hover>
                        <TableCell>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <VpnKey fontSize="small" color="action" />
                            <Typography variant="body2">{s.name}</Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={s.type === 'ssh-key' ? 'SSH-ключ' : s.type === 'password' ? 'Пароль' : s.type === 'token' ? 'Токен' : 'Другое'}
                            size="small"
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="textSecondary">{s.description || '—'}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="textSecondary">
                            {new Date(s.createdAt).toLocaleDateString()}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                            <Tooltip title="Изменить">
                              <IconButton size="small" onClick={() => openEditSecret(s)}>
                                <Edit sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Ещё">
                              <IconButton size="small" onClick={e => setSecretRowMenu({ el: e.currentTarget, id: s.id, name: s.name })}>
                                <MoreVert sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Box>
          )}

        </Box>
      </Paper>

      {/* ── SSH Node Dialog ── */}
      <Dialog open={nodeDialog} onClose={(_e, reason) => {
        if ((reason === 'backdropClick' || reason === 'escapeKeyDown') && nodeFormDirty) {
          askClose(() => { setNodeDialog(false); setNodeFormDirty(false); });
        } else { setNodeDialog(false); setNodeFormDirty(false); }
      }} maxWidth="sm" fullWidth>
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
              onChange={e => { setNodeForm(p => ({ ...p, name: e.target.value })); setNodeFormDirty(true); }}
            />
            <TextField
              label="IP-адрес"
              size="small"
              fullWidth
              value={nodeForm.ip || ''}
              onChange={e => { setNodeForm(p => ({ ...p, ip: e.target.value })); setNodeFormDirty(true); }}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="SSH-порт"
                size="small"
                type="number"
                value={nodeForm.sshPort || 22}
                onChange={e => setNodeForm(p => ({ ...p, sshPort: Number(e.target.value) }))}
                sx={{ width: { xs: '100%', sm: 120 } }}
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
                slotProps={{ input: { endAdornment: secrets.length > 0 ? (
                  <Tooltip title="Вставить из секретов">
                    <IconButton size="small" edge="end" onClick={() => openSecretPicker(v => setNodeForm(p => ({ ...p, password: v })))}>
                      <LockOpen fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ) : undefined }}}
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
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    {secrets.length > 0 && (
                      <Tooltip title="Вставить из секретов">
                        <IconButton size="small" onClick={() => openSecretPicker(v => setNodeForm(p => ({ ...p, sshKey: v })))}>
                          <LockOpen fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Button size="small" startIcon={<UploadFile />} onClick={() => keyFileInputRef.current?.click()}>
                      Загрузить из файла
                    </Button>
                  </Stack>
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

            {categories.length > 0 && (
              <Box>
                <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mb: 0.5 }}>
                  Категории
                </Typography>
                <Stack direction="row" spacing={0.5} flexWrap="wrap">
                  {categories.map(cat => {
                    const selected = (nodeForm.categoryIds || []).includes(cat.id);
                    return (
                      <Chip
                        key={cat.id}
                        label={cat.name}
                        size="small"
                        clickable
                        onClick={() => toggleNodeCategory(cat.id)}
                        sx={{
                          bgcolor: selected ? cat.color : 'transparent',
                          color: selected ? '#fff' : cat.color,
                          border: `1px solid ${cat.color}`,
                          fontWeight: selected ? 600 : 400,
                        }}
                      />
                    );
                  })}
                </Stack>
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNodeDialog(false)}>Отмена</Button>
          <Button variant="contained" onClick={handleSaveNode}>Сохранить</Button>
        </DialogActions>
      </Dialog>

      {/* ── Categories Dialog ── */}
      <Dialog open={catDialog} onClose={(_e, reason) => {
        if ((reason === 'backdropClick' || reason === 'escapeKeyDown') && catFormDirty) {
          askClose(() => { setCatDialog(false); setCatFormDirty(false); });
        } else { setCatDialog(false); setCatFormDirty(false); }
      }} maxWidth="xs" fullWidth>
        <DialogTitle>Категории нод</DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ mt: 1 }}>
            {categories.length === 0 && (
              <Typography variant="body2" color="textSecondary">Нет категорий. Создайте первую.</Typography>
            )}
            {categories.map(cat => (
              <Stack key={cat.id} direction="row" spacing={1} alignItems="center">
                <Box sx={{ width: 20, height: 20, borderRadius: '50%', bgcolor: cat.color, flexShrink: 0 }} />
                <Typography variant="body2" sx={{ flex: 1 }}>{cat.name}</Typography>
                <IconButton size="small" onClick={() => openEditCategory(cat)}><Edit fontSize="small" /></IconButton>
                <IconButton size="small" color="error" onClick={() => handleDeleteCategory(cat.id, cat.name)}><Delete fontSize="small" /></IconButton>
              </Stack>
            ))}
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2">{catEditId ? 'Изменить категорию' : 'Новая категория'}</Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                label="Название"
                size="small"
                value={catForm.name}
                onChange={e => { setCatForm(p => ({ ...p, name: e.target.value })); setCatFormDirty(true); }}
                sx={{ flex: 1 }}
              />
              <Tooltip title="Выбрать цвет">
                <Box sx={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
                  <Box
                    component="input"
                    type="color"
                    value={catForm.color}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setCatForm(p => ({ ...p, color: e.target.value })); setCatFormDirty(true); }}
                    sx={{
                      position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer',
                      width: '100%', height: '100%', border: 'none', padding: 0,
                    }}
                  />
                  <Box sx={{
                    width: 40, height: 40, borderRadius: 1, bgcolor: catForm.color,
                    border: '2px solid', borderColor: 'divider', pointerEvents: 'none',
                  }} />
                </Box>
              </Tooltip>
            </Stack>
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              {catEditId && (
                <Button size="small" onClick={() => { setCatEditId(null); setCatForm({ name: '', color: '#1976d2' }); }}>
                  Отмена
                </Button>
              )}
              <Button size="small" variant="contained" onClick={handleSaveCategory}>
                {catEditId ? 'Сохранить' : 'Добавить'}
              </Button>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCatDialog(false)}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      {/* ── Script Dialog ── */}
      <Dialog open={scriptDialog} onClose={(_e, reason) => {
        if ((reason === 'backdropClick' || reason === 'escapeKeyDown') && scriptFormDirty) {
          askClose(() => { setScriptDialog(false); setScriptFormDirty(false); });
        } else { setScriptDialog(false); setScriptFormDirty(false); }
      }} maxWidth="md" fullWidth>
        <DialogTitle>{scriptEditId ? 'Изменить скрипт' : 'Новый скрипт'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Название"
              size="small"
              fullWidth
              value={scriptForm.name || ''}
              onChange={e => { setScriptForm(p => ({ ...p, name: e.target.value })); setScriptFormDirty(true); }}
            />
            <TextField
              label="Описание"
              size="small"
              fullWidth
              value={scriptForm.description || ''}
              onChange={e => setScriptForm(p => ({ ...p, description: e.target.value }))}
            />
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <TextField
                label="Загрузить из URL"
                size="small"
                placeholder="https://example.com/script.sh"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLoadFromUrl()}
                sx={{ flex: 1 }}
              />
              <Button
                variant="outlined"
                size="small"
                onClick={handleLoadFromUrl}
                disabled={urlLoading || !urlInput.trim()}
                startIcon={urlLoading ? <CircularProgress size={14} /> : <FileDownload />}
                sx={{ height: 40, flexShrink: 0 }}
              >
                Загрузить
              </Button>
            </Stack>
            <TextField
              label="Bash-скрипт"
              size="small"
              multiline
              rows={12}
              fullWidth
              value={scriptForm.content || ''}
              onChange={e => { setScriptForm(p => ({ ...p, content: e.target.value })); setScriptFormDirty(true); }}
              slotProps={{ input: { style: { fontFamily: 'monospace', fontSize: '0.8rem' } } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScriptDialog(false)}>Отмена</Button>
          <Button variant="contained" onClick={handleSaveScript}>Сохранить</Button>
        </DialogActions>
      </Dialog>

      {/* ── Secrets Dialog ── */}
      <Dialog open={secretDialog} onClose={(_e, reason) => {
        if ((reason === 'backdropClick' || reason === 'escapeKeyDown') && secretFormDirty) {
          askClose(() => { setSecretDialog(false); setSecretFormDirty(false); });
        } else { setSecretDialog(false); setSecretFormDirty(false); }
      }} maxWidth="sm" fullWidth>
        <DialogTitle>{secretEditId ? 'Изменить секрет' : 'Новый секрет'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Название"
              size="small"
              fullWidth
              value={secretForm.name}
              onChange={e => { setSecretForm(p => ({ ...p, name: e.target.value })); setSecretFormDirty(true); }}
              placeholder="Например: SSH-ключ для node-01"
            />
            <FormControl size="small" fullWidth>
              <InputLabel>Тип</InputLabel>
              <Select
                value={secretForm.type}
                label="Тип"
                onChange={e => setSecretForm(p => ({ ...p, type: e.target.value }))}
              >
                <MenuItem value="password">Пароль</MenuItem>
                <MenuItem value="ssh-key">SSH-ключ</MenuItem>
                <MenuItem value="token">Токен / API-ключ</MenuItem>
                <MenuItem value="custom">Другое</MenuItem>
              </Select>
            </FormControl>
            <Box>
              <input
                ref={secretFileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = ev => setSecretForm(p => ({ ...p, value: ev.target?.result as string }));
                  reader.readAsText(file);
                  e.target.value = '';
                }}
              />
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                <Typography variant="caption" color="textSecondary">
                  {secretEditId ? 'Новое значение (пусто = не менять)' : 'Значение'}
                </Typography>
                <Button size="small" startIcon={<UploadFile />} onClick={() => secretFileInputRef.current?.click()}>
                  Загрузить из файла
                </Button>
              </Stack>
              <TextField
                size="small"
                fullWidth
                multiline={secretForm.type === 'ssh-key'}
                rows={secretForm.type === 'ssh-key' ? 6 : 1}
                type={secretForm.type !== 'ssh-key' ? 'password' : undefined}
                value={secretForm.value}
                onChange={e => { setSecretForm(p => ({ ...p, value: e.target.value })); setSecretFormDirty(true); }}
                placeholder={secretForm.type === 'ssh-key' ? '-----BEGIN OPENSSH PRIVATE KEY-----' : undefined}
                slotProps={secretForm.type === 'ssh-key' ? { input: { style: { fontFamily: 'monospace', fontSize: '0.75rem' } } } : undefined}
              />
            </Box>
            <TextField
              label="Описание (необязательно)"
              size="small"
              fullWidth
              value={secretForm.description}
              onChange={e => setSecretForm(p => ({ ...p, description: e.target.value }))}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSecretDialog(false)}>Отмена</Button>
          <Button variant="contained" onClick={handleSaveSecret}>Сохранить</Button>
        </DialogActions>
      </Dialog>

      {/* ── Run Dialog ── */}
      <Dialog open={runDialog} onClose={handleCloseRunDialog} maxWidth="md" fullWidth>
        <DialogTitle>Запуск: {runScript?.name}</DialogTitle>
        <DialogContent>
          {!runJob ? (
            <Box>
              {/* Глобальные переменные — только когда НЕ в per-node режиме */}
              {scriptVars.length > 0 && !perNodeVarsMode && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
                    Переменные скрипта:
                  </Typography>
                  <Stack spacing={1.5}>
                    {scriptVars.map(v => (
                      <TextField
                        key={v.name}
                        label={v.label}
                        size="small"
                        fullWidth
                        value={varValues[v.name] ?? ''}
                        onChange={e => setVarValues(prev => ({ ...prev, [v.name]: e.target.value }))}
                        slotProps={{
                          input: {
                            style: { fontFamily: 'monospace', fontSize: '0.85rem' },
                            endAdornment: secrets.length > 0 ? (
                              <Tooltip title="Вставить из секретов">
                                <IconButton size="small" edge="end"
                                  onClick={() => openSecretPicker(val => setVarValues(prev => ({ ...prev, [v.name]: val })))}>
                                  <LockOpen fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            ) : undefined,
                          },
                        }}
                      />
                    ))}
                  </Stack>
                </Box>
              )}

              {/* Toggle индивидуальных переменных */}
              {scriptVars.length > 0 && (
                <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={perNodeVarsMode}
                        onChange={e => {
                          const next = e.target.checked;
                          setPerNodeVarsMode(next);
                          if (next) {
                            const init: Record<string, Record<string, string>> = {};
                            for (const nodeId of selectedNodeIds) {
                              init[nodeId] = Object.fromEntries(scriptVars.map(v => [v.name, varValues[v.name] || '']));
                            }
                            setVarValuesPerNode(init);
                          } else {
                            setVarValuesPerNode({});
                          }
                        }}
                      />
                    }
                    label={<Typography variant="body2">Индивидуальные переменные для каждой ноды</Typography>}
                  />
                </Stack>
              )}

              <Divider sx={{ mb: 2 }} />
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Выберите ноды для запуска:
              </Typography>
              {categories.length > 0 && (
                <Stack direction="row" spacing={0.5} flexWrap="wrap" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="caption" color="textSecondary">Категория:</Typography>
                  {categories.map(cat => (
                    <Chip key={cat.id} label={cat.name} size="small" clickable
                      sx={{ bgcolor: cat.color, color: '#fff' }}
                      onClick={() => selectNodesByCategory(cat.id, selectedNodeIds, setSelectedNodeIds)}
                    />
                  ))}
                </Stack>
              )}
              {sshNodes.length === 0 ? (
                <Alert severity="warning">Нет нод. Добавьте ноды на вкладке «Ноды».</Alert>
              ) : (
                <Stack spacing={1} sx={{ mb: 2 }}>
                  {sshNodes.map(node => {
                    const selected = selectedNodeIds.includes(node.id);
                    return (
                      <Paper key={node.id} variant="outlined"
                        sx={{ borderColor: selected ? 'primary.main' : undefined, bgcolor: selected ? 'action.selected' : undefined }}>
                        {/* Заголовок ноды — кликабелен для выбора */}
                        <Box sx={{ p: 1.5, cursor: 'pointer' }}
                          onClick={() => {
                            if (perNodeVarsMode && !selected) {
                              setVarValuesPerNode(prev => ({
                                ...prev,
                                [node.id]: prev[node.id] || Object.fromEntries(scriptVars.map(v => [v.name, varValues[v.name] || ''])),
                              }));
                            }
                            toggleNodeSelection(node.id);
                          }}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Box sx={{
                              width: 16, height: 16, borderRadius: '50%', border: '2px solid', flexShrink: 0,
                              borderColor: selected ? 'primary.main' : 'text.disabled',
                              bgcolor: selected ? 'primary.main' : 'transparent',
                            }} />
                            <Typography variant="body2" fontWeight={selected ? 600 : 400}>{node.name}</Typography>
                            <Typography variant="caption" color="textSecondary">{node.ip}:{node.sshPort} ({node.sshUser})</Typography>
                            <Stack direction="row" spacing={0.3}>
                              {(node.categoryIds || []).map(cid => {
                                const cat = categories.find(c => c.id === cid);
                                return cat ? <Chip key={cid} label={cat.name} size="small"
                                  sx={{ bgcolor: cat.color, color: '#fff', fontSize: '0.65rem', height: 18 }} /> : null;
                              })}
                            </Stack>
                          </Stack>
                        </Box>
                        {/* Поля переменных для ноды — только в per-node режиме */}
                        {perNodeVarsMode && selected && scriptVars.length > 0 && (
                          <Box sx={{ px: 2, pb: 1.5, pt: 0 }}>
                            <Divider sx={{ mb: 1 }} />
                            <Stack spacing={1}>
                              {scriptVars.map(v => (
                                <TextField
                                  key={v.name}
                                  label={v.label}
                                  size="small"
                                  fullWidth
                                  value={varValuesPerNode[node.id]?.[v.name] ?? ''}
                                  onChange={e => setVarValuesPerNode(prev => ({
                                    ...prev,
                                    [node.id]: { ...prev[node.id], [v.name]: e.target.value },
                                  }))}
                                  onClick={e => e.stopPropagation()}
                                  slotProps={{
                                    input: {
                                      style: { fontFamily: 'monospace', fontSize: '0.85rem' },
                                      endAdornment: secrets.length > 0 ? (
                                        <Tooltip title="Вставить из секретов">
                                          <IconButton size="small" edge="end"
                                            onClick={e => { e.stopPropagation(); openSecretPicker(val => setVarValuesPerNode(prev => ({ ...prev, [node.id]: { ...prev[node.id], [v.name]: val } }))); }}>
                                            <LockOpen fontSize="small" />
                                          </IconButton>
                                        </Tooltip>
                                      ) : undefined,
                                    },
                                  }}
                                />
                              ))}
                            </Stack>
                          </Box>
                        )}
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

      {/* ── Queue Run Dialog ── */}
      <Dialog open={queueDialogOpen} onClose={handleCloseQueueDialog} maxWidth="md" fullWidth>
        <DialogTitle>Запуск очереди ({scriptQueue.length} скриптов)</DialogTitle>
        <DialogContent>
          {!runJob ? (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Порядок выполнения:</Typography>
              <Stack spacing={1} sx={{ mb: 3 }}>
                {scriptQueue.map((s, i) => (
                  <Paper key={i} variant="outlined" sx={{ p: 1.5 }}>
                    <Stack direction="row" spacing={1} alignItems="flex-start">
                      <Stack direction="column" sx={{ flexShrink: 0 }}>
                        <IconButton size="small" disabled={i === 0} onClick={() => moveQueueItem(i, 'up')}>
                          <KeyboardArrowUp fontSize="small" />
                        </IconButton>
                        <IconButton size="small" disabled={i === scriptQueue.length - 1} onClick={() => moveQueueItem(i, 'down')}>
                          <KeyboardArrowDown fontSize="small" />
                        </IconButton>
                      </Stack>
                      <Box sx={{ flex: 1 }}>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                          <Chip label={String(i + 1)} size="small" color="primary" />
                          <Typography variant="body2" fontWeight={600}>{s.name}</Typography>
                          {s.isBuiltIn && <Chip label="Встроенный" size="small" color="info" variant="outlined" />}
                        </Stack>
                        {extractVariables(s.content).length > 0 && (
                          <Stack spacing={1} sx={{ mt: 1 }}>
                            {extractVariables(s.content).map(v => (
                              <TextField
                                key={v.name}
                                label={v.label}
                                size="small"
                                fullWidth
                                value={varValuesPerScript[s.id]?.[v.name] ?? ''}
                                onChange={e => setVarValuesPerScript(prev => ({
                                  ...prev,
                                  [s.id]: { ...prev[s.id], [v.name]: e.target.value },
                                }))}
                                slotProps={{
                                  input: {
                                    style: { fontFamily: 'monospace', fontSize: '0.85rem' },
                                    endAdornment: secrets.length > 0 ? (
                                      <Tooltip title="Вставить из секретов">
                                        <IconButton size="small" edge="end"
                                          onClick={() => openSecretPicker(val => setVarValuesPerScript(prev => ({
                                            ...prev,
                                            [s.id]: { ...prev[s.id], [v.name]: val },
                                          })))}>
                                          <LockOpen fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                    ) : undefined,
                                  },
                                }}
                              />
                            ))}
                          </Stack>
                        )}
                      </Box>
                      <IconButton size="small" color="error" onClick={() => removeFromQueue(i)}>
                        <Delete fontSize="small" />
                      </IconButton>
                    </Stack>
                  </Paper>
                ))}
              </Stack>

              <Divider sx={{ mb: 2 }} />

              {/* Toggle индивидуальных переменных для очереди */}
              {scriptQueue.some(s => extractVariables(s.content).length > 0) && (
                <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={perNodeVarsQueueMode}
                        onChange={e => {
                          const next = e.target.checked;
                          setPerNodeVarsQueueMode(next);
                          if (next) {
                            const init: Record<string, Record<string, Record<string, string>>> = {};
                            for (const s of scriptQueue) {
                              const svars = extractVariables(s.content);
                              if (!svars.length) continue;
                              init[s.id] = {};
                              for (const nodeId of queueSelectedNodeIds) {
                                init[s.id][nodeId] = Object.fromEntries(svars.map(v => [v.name, varValuesPerScript[s.id]?.[v.name] || '']));
                              }
                            }
                            setVarValuesPerScriptPerNode(init);
                          } else {
                            setVarValuesPerScriptPerNode({});
                          }
                        }}
                      />
                    }
                    label={<Typography variant="body2">Индивидуальные переменные для каждой ноды</Typography>}
                  />
                </Stack>
              )}

              <Typography variant="subtitle2" sx={{ mb: 1 }}>Выберите ноды для запуска:</Typography>
              {categories.length > 0 && (
                <Stack direction="row" spacing={0.5} flexWrap="wrap" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="caption" color="textSecondary">Категория:</Typography>
                  {categories.map(cat => (
                    <Chip key={cat.id} label={cat.name} size="small" clickable
                      sx={{ bgcolor: cat.color, color: '#fff' }}
                      onClick={() => selectNodesByCategory(cat.id, queueSelectedNodeIds, setQueueSelectedNodeIds)}
                    />
                  ))}
                </Stack>
              )}
              {sshNodes.length === 0 ? (
                <Alert severity="warning">Нет нод.</Alert>
              ) : (
                <Stack spacing={1}>
                  {sshNodes.map(node => {
                    const selected = queueSelectedNodeIds.includes(node.id);
                    const scriptsWithVars = scriptQueue.filter(s => extractVariables(s.content).length > 0);
                    return (
                      <Paper key={node.id} variant="outlined"
                        sx={{ borderColor: selected ? 'primary.main' : undefined, bgcolor: selected ? 'action.selected' : undefined }}>
                        <Box sx={{ p: 1.5, cursor: 'pointer' }}
                          onClick={() => {
                            if (perNodeVarsQueueMode && !selected) {
                              setVarValuesPerScriptPerNode(prev => {
                                const next = { ...prev };
                                for (const s of scriptQueue) {
                                  const svars = extractVariables(s.content);
                                  if (!svars.length) continue;
                                  next[s.id] = { ...next[s.id], [node.id]: next[s.id]?.[node.id] || Object.fromEntries(svars.map(v => [v.name, varValuesPerScript[s.id]?.[v.name] || ''])) };
                                }
                                return next;
                              });
                            }
                            setQueueSelectedNodeIds(prev => prev.includes(node.id) ? prev.filter(id => id !== node.id) : [...prev, node.id]);
                          }}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Box sx={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid', borderColor: selected ? 'primary.main' : 'text.disabled', bgcolor: selected ? 'primary.main' : 'transparent', flexShrink: 0 }} />
                            <Typography variant="body2" fontWeight={selected ? 600 : 400}>{node.name}</Typography>
                            <Typography variant="caption" color="textSecondary">{node.ip}:{node.sshPort} ({node.sshUser})</Typography>
                            <Stack direction="row" spacing={0.3}>
                              {(node.categoryIds || []).map(cid => {
                                const cat = categories.find(c => c.id === cid);
                                return cat ? <Chip key={cid} label={cat.name} size="small"
                                  sx={{ bgcolor: cat.color, color: '#fff', fontSize: '0.65rem', height: 18 }} /> : null;
                              })}
                            </Stack>
                          </Stack>
                        </Box>
                        {/* Per-node переменные для каждого скрипта очереди */}
                        {perNodeVarsQueueMode && selected && scriptsWithVars.length > 0 && (
                          <Box sx={{ px: 2, pb: 1.5, pt: 0 }}>
                            <Divider sx={{ mb: 1 }} />
                            <Stack spacing={1.5}>
                              {scriptsWithVars.map(s => {
                                const svars = extractVariables(s.content);
                                return (
                                  <Box key={s.id}>
                                    <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mb: 0.5 }}>
                                      {s.name}
                                    </Typography>
                                    <Stack spacing={1}>
                                      {svars.map(v => (
                                        <TextField
                                          key={v.name}
                                          label={v.label}
                                          size="small"
                                          fullWidth
                                          value={varValuesPerScriptPerNode[s.id]?.[node.id]?.[v.name] ?? ''}
                                          onChange={e => setVarValuesPerScriptPerNode(prev => ({
                                            ...prev,
                                            [s.id]: { ...prev[s.id], [node.id]: { ...prev[s.id]?.[node.id], [v.name]: e.target.value } },
                                          }))}
                                          onClick={e => e.stopPropagation()}
                                          slotProps={{
                                            input: {
                                              style: { fontFamily: 'monospace', fontSize: '0.85rem' },
                                              endAdornment: secrets.length > 0 ? (
                                                <Tooltip title="Вставить из секретов">
                                                  <IconButton size="small" edge="end"
                                                    onClick={e => { e.stopPropagation(); openSecretPicker(val => setVarValuesPerScriptPerNode(prev => ({ ...prev, [s.id]: { ...prev[s.id], [node.id]: { ...prev[s.id]?.[node.id], [v.name]: val } } }))); }}>
                                                    <LockOpen fontSize="small" />
                                                  </IconButton>
                                                </Tooltip>
                                              ) : undefined,
                                            },
                                          }}
                                        />
                                      ))}
                                    </Stack>
                                  </Box>
                                );
                              })}
                            </Stack>
                          </Box>
                        )}
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
                      <Chip label={result.status === 'running' ? '...' : result.status === 'success' ? 'OK' : 'Ошибка'}
                        color={result.status === 'running' ? 'default' : result.status === 'success' ? 'success' : 'error'}
                        size="small" />
                    </Stack>
                    <Box component="pre" sx={{ fontSize: '0.7rem', bgcolor: 'action.hover', borderRadius: 1, p: 1.5, overflowX: 'auto', maxHeight: 300, overflowY: 'auto', m: 0, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
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
          <Button onClick={handleCloseQueueDialog}>
            {runJob && runJob.status !== 'running' ? 'Закрыть' : 'Отмена'}
          </Button>
          {!runJob && (
            <Button variant="contained"
              startIcon={runLoading ? <CircularProgress size={16} /> : <PlayArrow />}
              disabled={runLoading || queueSelectedNodeIds.length === 0 || scriptQueue.length === 0}
              onClick={handleRunQueue}>
              Запустить ({scriptQueue.length})
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Secret picker dialog */}
      <Dialog open={secretPickerOpen} onClose={() => setSecretPickerOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Выбрать секрет</DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {secrets.map(s => (
            <MenuItem key={s.id} onClick={() => handlePickSecret(s.id)}>
              <Stack direction="row" spacing={1} alignItems="center">
                <VpnKey fontSize="small" color="action" />
                <Box>
                  <Typography variant="body2">{s.name}</Typography>
                  <Typography variant="caption" color="textSecondary">
                    {s.type === 'ssh-key' ? 'SSH-ключ' : s.type === 'password' ? 'Пароль' : s.type === 'token' ? 'Токен' : 'Другое'}
                    {s.description ? ` — ${s.description}` : ''}
                  </Typography>
                </Box>
              </Stack>
            </MenuItem>
          ))}
        </DialogContent>
      </Dialog>

      {/* Node row overflow menu */}
      <Menu
        anchorEl={nodeRowMenu?.el}
        open={Boolean(nodeRowMenu)}
        onClose={() => setNodeRowMenu(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem onClick={() => {
          const node = sshNodes.find(n => n.id === nodeRowMenu?.nodeId);
          setNodeRowMenu(null);
          if (node) openTerminalPopup(node);
        }}>
          <OpenInNew sx={{ fontSize: 16, mr: 1 }} />Открыть терминал в окне
        </MenuItem>
        <MenuItem sx={{ color: 'error.main' }} onClick={() => {
          const { nodeId, nodeName } = nodeRowMenu || {};
          setNodeRowMenu(null);
          if (nodeId && nodeName) handleDeleteNode(nodeId, nodeName);
        }}>
          <Delete sx={{ fontSize: 16, mr: 1 }} />Удалить
        </MenuItem>
      </Menu>

      {/* Secret row overflow menu */}
      <Menu
        anchorEl={secretRowMenu?.el}
        open={Boolean(secretRowMenu)}
        onClose={() => setSecretRowMenu(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem sx={{ color: 'error.main' }} onClick={() => {
          const { id, name } = secretRowMenu || {};
          setSecretRowMenu(null);
          if (id && name) handleDeleteSecret(id, name);
        }}>
          <Delete sx={{ fontSize: 16, mr: 1 }} />Удалить
        </MenuItem>
      </Menu>

      <ConfirmDialog
        open={confirmDel.open}
        title={confirmDel.title}
        message={confirmDel.message}
        confirmLabel="Удалить"
        confirmColor="error"
        onConfirm={confirmDel.onConfirm}
        onCancel={() => setConfirmDel(d => ({ ...d, open: false }))}
      />

      <ConfirmDialog
        open={closeConfirm}
        title="Закрыть без сохранения?"
        message="Введённые данные будут потеряны."
        confirmLabel="Закрыть"
        confirmColor="warning"
        onConfirm={() => { setCloseConfirm(false); pendingCloseRef.current(); }}
        onCancel={() => setCloseConfirm(false)}
      />

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

      {/* ── History Detail Dialog ── */}
      <Dialog open={Boolean(historyDetail || historyDetailLoading)} onClose={() => setHistoryDetail(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Stack direction="row" spacing={1} alignItems="center">
            <History sx={{ color: 'text.secondary', fontSize: 20 }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" fontWeight={600}>
                {historyDetail?.scriptName ?? '...'}
              </Typography>
              {historyDetail && (
                <Typography variant="caption" color="text.secondary">
                  {formatDate(historyDetail.startedAt)} · {formatDuration(historyDetail.durationMs)}
                </Typography>
              )}
            </Box>
            {historyDetail && (
              <Chip
                label={historyDetail.status === 'success' ? 'Успешно' : 'Ошибка'}
                color={historyDetail.status === 'success' ? 'success' : 'error'}
                size="small"
              />
            )}
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {historyDetailLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={32} />
            </Box>
          )}
          {historyDetail && (
            <Stack spacing={2}>
              {historyDetail.nodeResults.map(result => (
                <Box key={result.nodeId}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                    {result.status === 'success'
                      ? <CheckCircle sx={{ fontSize: 16, color: 'success.main' }} />
                      : <ErrorOutline sx={{ fontSize: 16, color: 'error.main' }} />}
                    <Typography variant="body2" fontWeight={600}>{result.nodeName}</Typography>
                    <Chip
                      label={result.status === 'success' ? 'OK' : 'Ошибка'}
                      color={result.status === 'success' ? 'success' : 'error'}
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
                      maxHeight: 300,
                      overflowY: 'auto',
                      m: 0,
                      fontFamily: 'monospace',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    {result.logs.join('\n') || '(нет вывода)'}
                  </Box>
                </Box>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryDetail(null)}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      {/* ── Floating terminal windows ── */}
      {terminals.map((session, index) => (
        <TerminalWindow
          key={session.id}
          session={session}
          index={index}
          onClose={closeTerminal}
          onPositionChange={moveTerminal}
          onMinimizeToggle={toggleMinimize}
          onResize={resizeTerminal}
          instanceRef={termInstancesRef}
          isMobile={isMobile}
        />
      ))}
    </Box>
  );
}
