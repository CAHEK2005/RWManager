import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControl, FormControlLabel,
  IconButton, InputLabel, Menu, MenuItem, Paper, Radio, RadioGroup, Select,
  Snackbar, Stack, Tab, Table, TableBody, TableCell, TableHead,
  TableRow, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import {
  Add, Close, ContentCopy, CropSquare, Delete, Edit, FileDownload,
  LockOpen, OpenInNew, PlayArrow, Remove, Terminal, UploadFile, VpnKey,
} from '@mui/icons-material';
import type { SelectChangeEvent } from '@mui/material/Select';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import api from '../api';

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
}: {
  session: TerminalSession;
  index: number;
  onClose: (id: string) => void;
  onPositionChange: (id: string, pos: { x: number; y: number }) => void;
  onMinimizeToggle: (id: string) => void;
  onResize: (id: string, size: { width: number; height: number }) => void;
  instanceRef: React.MutableRefObject<Map<string, TerminalInstance>>;
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
  const [tab, setTab] = useState(0);

  // Data
  const [sshNodes, setSshNodes] = useState<SshNode[]>([]);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [rwNodes, setRwNodes] = useState<RwNode[]>([]);

  // Snackbar
  const [msg, setMsg] = useState({ open: false, type: 'success' as 'success' | 'error', text: '' });
  const showMsg = (type: 'success' | 'error', text: string) => setMsg({ open: true, type, text });

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
  // Universal secret picker anchor — works in any dialog
  const [secretMenuAnchor, setSecretMenuAnchor] = useState<{ el: HTMLElement; onPick: (v: string) => void } | null>(null);

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

  useEffect(() => {
    loadSshNodes();
    loadScripts();
    loadRwNodes();
    loadSecrets();
  }, []);

  // ─── SSH Node handlers ────────────────────────────────────────────────────

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
    setUrlInput('');
    setUrlLoading(false);
    setScriptDialog(true);
  };

  const openEditScript = (s: Script) => {
    setScriptEditId(s.id);
    setScriptForm({ name: s.name, description: s.description || '', content: s.content });
    setUrlInput('');
    setUrlLoading(false);
    setScriptDialog(true);
  };

  const handleLoadFromUrl = async () => {
    if (!urlInput.trim()) return;
    setUrlLoading(true);
    try {
      const { data } = await api.post('/scripts/fetch-url', { url: urlInput });
      setScriptForm(p => ({ ...p, content: data.content }));
      setUrlInput('');
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка загрузки');
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

  const handleCloneScript = async (s: Script) => {
    try {
      await api.post('/scripts/scripts', {
        name: `${s.name} (копия)`,
        description: s.description,
        content: s.content,
      });
      showMsg('success', 'Скрипт клонирован — отредактируйте копию');
      loadScripts();
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка клонирования');
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
    const emptyVar = scriptVars.find(v => !varValues[v.name]?.trim());
    if (emptyVar) {
      showMsg('error', `Заполните переменную: ${emptyVar.label}`);
      return;
    }
    try {
      setRunLoading(true);
      setRunJob(null);
      const { data } = await api.post('/scripts/execute', {
        scriptId: runScript.id,
        nodeIds: selectedNodeIds,
        variables: varValues,
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
    setScriptVars([]);
    setVarValues({});
  };

  // ─── Secrets handlers ────────────────────────────────────────────────────

  const openAddSecret = () => {
    setSecretEditId(null);
    setSecretForm({ name: '', type: 'password', value: '', description: '' });
    setSecretDialog(true);
  };

  const openEditSecret = (s: Secret) => {
    setSecretEditId(s.id);
    setSecretForm({ name: s.name, type: s.type, value: '', description: s.description || '' });
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
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка сохранения');
    }
  };

  const handleDeleteSecret = async (id: string) => {
    try {
      await api.delete(`/secrets/${id}`);
      loadSecrets();
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка удаления');
    }
  };

  const handlePickSecret = async (secretId: string) => {
    const anchor = secretMenuAnchor;
    setSecretMenuAnchor(null);
    if (!anchor) return;
    try {
      const { data } = await api.get(`/secrets/${secretId}/value`);
      anchor.onPick(data.value);
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
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 3 }}>
        <Terminal color="primary" />
        <Typography variant="h5">Скрипты</Typography>
      </Stack>

      <Paper>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tab label="Ноды" />
          <Tab label="Скрипты" />
          <Tab label="Секреты" />
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
                            <Tooltip title="Открыть терминал">
                              <IconButton size="small" color="primary" onClick={() => openTerminal(node)}>
                                <Terminal fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Открыть терминал в отдельном окне">
                              <IconButton size="small" onClick={() => openTerminalPopup(node)}>
                                <OpenInNew fontSize="small" />
                              </IconButton>
                            </Tooltip>
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
                        {s.isBuiltIn ? (
                          <Button
                            variant="outlined"
                            size="small"
                            startIcon={<ContentCopy />}
                            onClick={() => handleCloneScript(s)}
                          >
                            Клонировать
                          </Button>
                        ) : (
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

          {/* ── Tab 2: Secrets ── */}
          {tab === 2 && (
            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Typography variant="h6">Секреты</Typography>
                <Button variant="contained" startIcon={<Add />} size="small" onClick={openAddSecret}>
                  Добавить
                </Button>
              </Stack>
              <Divider sx={{ mb: 2 }} />

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
                          <Tooltip title="Изменить">
                            <IconButton size="small" onClick={() => openEditSecret(s)}>
                              <Edit fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Удалить">
                            <IconButton size="small" color="error" onClick={() => handleDeleteSecret(s.id)}>
                              <Delete fontSize="small" />
                            </IconButton>
                          </Tooltip>
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
                slotProps={{ input: { endAdornment: secrets.length > 0 ? (
                  <Tooltip title="Вставить из секретов">
                    <IconButton size="small" edge="end" onClick={e => setSecretMenuAnchor({ el: e.currentTarget, onPick: v => setNodeForm(p => ({ ...p, password: v })) })}>
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
                        <IconButton size="small" onClick={e => setSecretMenuAnchor({ el: e.currentTarget, onPick: v => setNodeForm(p => ({ ...p, sshKey: v })) })}>
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

      {/* ── Secrets Dialog ── */}
      <Dialog open={secretDialog} onClose={() => setSecretDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{secretEditId ? 'Изменить секрет' : 'Новый секрет'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Название"
              size="small"
              fullWidth
              value={secretForm.name}
              onChange={e => setSecretForm(p => ({ ...p, name: e.target.value }))}
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
                onChange={e => setSecretForm(p => ({ ...p, value: e.target.value }))}
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
              {scriptVars.length > 0 && (
                <Box sx={{ mb: 3 }}>
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
                                <IconButton
                                  size="small"
                                  edge="end"
                                  onClick={e => setSecretMenuAnchor({ el: e.currentTarget, onPick: val => setVarValues(prev => ({ ...prev, [v.name]: val })) })}
                                >
                                  <LockOpen fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            ) : undefined,
                          },
                        }}
                      />
                    ))}
                  </Stack>
                  <Divider sx={{ mt: 2 }} />
                </Box>
              )}
              {/* Secret picker menu */}
              <Menu
                anchorEl={secretMenuAnchor?.el}
                open={Boolean(secretMenuAnchor)}
                onClose={() => setSecretMenuAnchor(null)}
              >
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
              </Menu>
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
        />
      ))}
    </Box>
  );
}
