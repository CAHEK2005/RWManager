import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Box, Typography, Paper, Button, Stack, Chip, Tooltip, IconButton,
  TextField, Select, MenuItem, FormControl, InputLabel, Switch, FormControlLabel,
  Dialog, DialogTitle, DialogContent, DialogActions, Checkbox,
  Tabs, Tab, Snackbar, Alert, useTheme, useMediaQuery, Grid, Divider,
  CircularProgress, FormHelperText, List, ListItem, ListItemText,
} from '@mui/material';
import {
  Add, Delete, PlayArrow, PauseCircleFilled, Warning, Check, Refresh,
  CheckCircle, UploadFile, Language, FileDownload,
} from '@mui/icons-material';
import type { SelectChangeEvent } from '@mui/material/Select';
import api from '../api';
import UrlImportDialog from '../components/UrlImportDialog';

// ─── Types ───────────────────────────────────────────────────────────────────

interface InboundConfigItem {
  type: string;
  port: string;
  sni?: string;
  security?: string;
  tag?: string;
  tagSuffix?: string;
}

interface HostMapping {
  tag: string;
  hostUuid: string;
}

interface ManagedProfile {
  uuid: string;
  name: string;
  inboundsConfig: InboundConfigItem[];
  excludedPorts: number[];
  nodeUuid: string;
  nodeAddress: string;
  applyToNode: boolean;
  hostMappings: HostMapping[];
  hostTemplate: string;
  rotationEnabled: boolean;
  rotationMode: 'interval' | 'schedule';
  rotationInterval: number;
  rotationScheduleTime: string;
  rotationTimezone: string;
  lastRotationTimestamp: number;
  lastRotationStatus: 'success' | 'error' | null;
  lastRotationError: string;
  profileDomains?: string[];
  hostIndexStart?: number;
}

interface RwProfile { uuid: string; name: string; }
interface RwNode { uuid: string; name: string; address: string; countryCode: string; }
interface RwHost { uuid: string; remark: string; address: string; port: number; }

// ─── Constants ───────────────────────────────────────────────────────────────

const CONNECTION_TYPES = [
  'vless-tcp-reality',
  'vless-xhttp-reality',
  'vless-grpc-reality',
  'vless-ws',
  'shadowsocks-tcp',
  'trojan-tcp-reality',
] as const;

const SNI_TYPES = new Set([
  'vless-tcp-reality',
  'vless-xhttp-reality',
  'vless-grpc-reality',
  'vless-ws',
  'trojan-tcp-reality',
]);

const ROTATION_PRESETS = [
  { label: 'Сутки', value: 1440 },
  { label: '3 дня', value: 4320 },
  { label: 'Неделя', value: 10080 },
];

const TIMEZONES = [
  { value: 'UTC', label: 'UTC (UTC+0)' },
  { value: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)' },
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)' },
  { value: 'Europe/Samara', label: 'Самара (UTC+4)' },
  { value: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
  { value: 'Asia/Omsk', label: 'Омск (UTC+6)' },
  { value: 'Asia/Krasnoyarsk', label: 'Красноярск (UTC+7)' },
  { value: 'Asia/Irkutsk', label: 'Иркутск (UTC+8)' },
  { value: 'Asia/Yakutsk', label: 'Якутск (UTC+9)' },
  { value: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)' },
  { value: 'Asia/Magadan', label: 'Магадан (UTC+11)' },
  { value: 'Asia/Kamchatka', label: 'Камчатка (UTC+12)' },
  { value: 'Europe/London', label: 'Лондон (UTC+0/+1)' },
  { value: 'Europe/Paris', label: 'Париж/Берлин (UTC+1/+2)' },
  { value: 'Europe/Helsinki', label: 'Хельсинки/Киев (UTC+2/+3)' },
  { value: 'Asia/Dubai', label: 'Дубай (UTC+4)' },
  { value: 'Asia/Almaty', label: 'Алматы (UTC+5)' },
  { value: 'Asia/Bangkok', label: 'Бангкок (UTC+7)' },
  { value: 'Asia/Singapore', label: 'Сингапур (UTC+8)' },
  { value: 'Asia/Tokyo', label: 'Токио (UTC+9)' },
  { value: 'America/New_York', label: 'Нью-Йорк (UTC-5/-4)' },
  { value: 'America/Los_Angeles', label: 'Лос-Анджелес (UTC-8/-7)' },
];

const PROFILE_NAME_RE = /^[A-Za-z0-9_\s-]+$/;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  if (!ts) return 'Нет данных';
  return new Date(ts).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function getNextRotationTime(p: ManagedProfile): string {
  if (!p.rotationEnabled) return 'Пауза';
  if (p.rotationMode === 'interval') {
    if (!p.lastRotationTimestamp) return 'Ожидание...';
    const next = new Date(p.lastRotationTimestamp + p.rotationInterval * 60000);
    return next.toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
  return `Ежедневно в ${p.rotationScheduleTime} (${p.rotationTimezone})`;
}

function validateProfileName(name: string): string {
  if (!name.trim()) return 'Имя не может быть пустым';
  if (name.length < 2) return 'Минимум 2 символа';
  if (name.length > 30) return 'Максимум 30 символов';
  if (!PROFILE_NAME_RE.test(name)) return 'Только латинские буквы, цифры, пробел, _ и -';
  return '';
}

function computeEffectiveTags(items: InboundConfigItem[]): string[] {
  const result: string[] = [];
  for (const item of items) {
    if (item.type === 'custom') {
      result.push(item.tag || '');
      continue;
    }
    const baseTag = item.tag || `${item.type}-rwm`;
    const tagWithSuffix = item.tagSuffix ? `${baseTag}-${item.tagSuffix}` : baseTag;
    const sameCount = result.filter(t => t === tagWithSuffix || t.startsWith(`${tagWithSuffix}-`)).length;
    result.push(sameCount > 0 ? `${tagWithSuffix}-${sameCount + 1}` : tagWithSuffix);
  }
  return result;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ProfilesPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [profiles, setProfiles] = useState<ManagedProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<ManagedProfile | null>(null);
  const [rwProfiles, setRwProfiles] = useState<RwProfile[]>([]);
  const [nodes, setNodes] = useState<RwNode[]>([]);
  const [hosts, setHosts] = useState<RwHost[]>([]);
  const [profileTab, setProfileTab] = useState(0);

  // Dialogs
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [profileToDelete, setProfileToDelete] = useState<ManagedProfile | null>(null);
  const [deleteFromRemnawave, setDeleteFromRemnawave] = useState(false);

  // Inline rename
  const [renamingUuid, setRenamingUuid] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Add existing dialog
  const [addExistingUuid, setAddExistingUuid] = useState('');

  // Create new dialog
  const [createName, setCreateName] = useState('');
  const [createNameError, setCreateNameError] = useState('');

  // Local edit state for selected profile
  const [localInbounds, setLocalInbounds] = useState<InboundConfigItem[]>([]);
  const [localNodeUuid, setLocalNodeUuid] = useState('');
  const [localApplyToNode, setLocalApplyToNode] = useState(false);
  const [localTemplate, setLocalTemplate] = useState('{countryCode} {nodeName} - {inboundType}');
  const [localHostIndexStart, setLocalHostIndexStart] = useState(1);
  const [localHostMappings, setLocalHostMappings] = useState<HostMapping[]>([]);
  const [sniData, setSniData] = useState<{ tag: string; sni: string; protocol: string; port: number | null }[]>([]);
  const [localExcludedPorts, setLocalExcludedPorts] = useState<number[]>([]);
  const [excludedPortInput, setExcludedPortInput] = useState('');
  const [localRotationEnabled, setLocalRotationEnabled] = useState(true);
  const [localRotationMode, setLocalRotationMode] = useState<'interval' | 'schedule'>('interval');
  const [localInterval, setLocalInterval] = useState(1440);
  const [localScheduleTime, setLocalScheduleTime] = useState('03:00');
  const [localTimezone, setLocalTimezone] = useState('Europe/Moscow');

  // ── Tab 4: SNI Domains ────────────────────────────────────────────────────
  const [localProfileDomains, setLocalProfileDomains] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState('');
  const [profileUrlImportOpen, setProfileUrlImportOpen] = useState(false);
  const domainFileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ open: false, type: 'success' as 'success' | 'error', text: '' });

  const showMsg = (type: 'success' | 'error', text: string) => setMsg({ open: true, type, text });

  // ── Load data ─────────────────────────────────────────────────────────────

  const loadProfiles = useCallback(async () => {
    try {
      const { data } = await api.get('/settings/profiles/managed');
      setProfiles(Array.isArray(data) ? data : []);
      // Sync selectedProfile
      setSelectedProfile(prev => {
        if (!prev) return null;
        return (Array.isArray(data) ? data : []).find((p: ManagedProfile) => p.uuid === prev.uuid) || null;
      });
    } catch (e: any) {
      console.error(e);
    }
  }, []);

  const loadRwProfiles = useCallback(async () => {
    try {
      const { data } = await api.get('/settings/profiles');
      setRwProfiles(Array.isArray(data) ? data : []);
    } catch { setRwProfiles([]); }
  }, []);

  const loadNodes = useCallback(async () => {
    try {
      const { data } = await api.get('/settings/nodes');
      setNodes(Array.isArray(data) ? data : []);
    } catch { setNodes([]); }
  }, []);

  const loadHosts = useCallback(async () => {
    try {
      const { data } = await api.get('/settings/hosts');
      setHosts(Array.isArray(data) ? data : []);
    } catch { setHosts([]); }
  }, []);

  const loadSni = useCallback(async (profileUuid: string) => {
    try {
      const { data } = await api.get(`/settings/profiles/managed/${profileUuid}/hosts-with-sni`);
      setSniData(Array.isArray(data) ? data : []);
    } catch { setSniData([]); }
  }, []);

  useEffect(() => {
    loadProfiles();
    loadRwProfiles();
    loadNodes();
    loadHosts();
  }, []);

  // Sync local state when selectedProfile changes
  useEffect(() => {
    if (!selectedProfile) return;
    setLocalInbounds(selectedProfile.inboundsConfig || []);
    setLocalExcludedPorts(selectedProfile.excludedPorts || []);
    setExcludedPortInput('');
    setLocalNodeUuid(selectedProfile.nodeUuid || '');
    setLocalApplyToNode(selectedProfile.applyToNode ?? false);
    setLocalTemplate(selectedProfile.hostTemplate || '{countryCode} {nodeName} - {inboundType}');
    setLocalHostIndexStart(selectedProfile.hostIndexStart ?? 1);
    setLocalHostMappings(selectedProfile.hostMappings || []);
    loadSni(selectedProfile.uuid);
    setLocalRotationEnabled(selectedProfile.rotationEnabled !== false);
    setLocalRotationMode(selectedProfile.rotationMode || 'interval');
    setLocalInterval(selectedProfile.rotationInterval || 1440);
    setLocalScheduleTime(selectedProfile.rotationScheduleTime || '03:00');
    setLocalTimezone(selectedProfile.rotationTimezone || 'Europe/Moscow');
    setLocalProfileDomains(selectedProfile.profileDomains || []);
    setDomainInput('');
  }, [selectedProfile?.uuid]);

  // ── Profile state helpers ─────────────────────────────────────────────────

  const updateProfileInState = (uuid: string, patch: Partial<ManagedProfile>) => {
    setProfiles(prev => prev.map(p => p.uuid === uuid ? { ...p, ...patch } : p));
    setSelectedProfile(prev => prev?.uuid === uuid ? { ...prev, ...patch } : prev);
  };

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSelectProfile = (p: ManagedProfile) => {
    setSelectedProfile(p);
    setProfileTab(0);
  };

  const handleRotateAll = async () => {
    try {
      setLoading(true);
      const res = await api.post('/rotation/rotate-all');
      showMsg('success', res.data?.message || 'Ротация запущена');
      await loadProfiles();
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка ротации');
    } finally {
      setLoading(false);
    }
  };

  const handleRename = async (uuid: string) => {
    const trimmed = renameValue.trim();
    const err = validateProfileName(trimmed);
    if (err) { showMsg('error', err); setRenamingUuid(null); return; }
    const profile = profiles.find(p => p.uuid === uuid);
    if (!profile || trimmed === profile.name) { setRenamingUuid(null); return; }
    try {
      await api.patch(`/settings/profiles/managed/${uuid}/name`, { name: trimmed });
      updateProfileInState(uuid, { name: trimmed });
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка переименования');
    }
    setRenamingUuid(null);
  };

  const handleDeleteOpen = (p: ManagedProfile, e: React.MouseEvent) => {
    e.stopPropagation();
    setProfileToDelete(p);
    setDeleteFromRemnawave(false);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!profileToDelete) return;
    try {
      const params = deleteFromRemnawave ? '?deleteFromRemnawave=true' : '';
      await api.delete(`/settings/profiles/managed/${profileToDelete.uuid}${params}`);
      setProfiles(prev => prev.filter(p => p.uuid !== profileToDelete.uuid));
      if (selectedProfile?.uuid === profileToDelete.uuid) setSelectedProfile(null);
      showMsg('success', `Профиль "${profileToDelete.name}" удалён`);
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка удаления');
    }
    setDeleteDialogOpen(false);
    setProfileToDelete(null);
  };

  const handleAddExisting = async () => {
    if (!addExistingUuid) return;
    const rwProfile = rwProfiles.find(p => p.uuid === addExistingUuid);
    if (!rwProfile) return;
    try {
      const { data } = await api.post('/settings/profiles/managed', { uuid: addExistingUuid, name: rwProfile.name });
      setProfiles(prev => [...prev, data]);
      showMsg('success', `Профиль "${rwProfile.name}" добавлен`);
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка добавления профиля');
    }
    setAddDialogOpen(false);
    setAddExistingUuid('');
  };

  const handleCreateNew = async () => {
    const err = validateProfileName(createName);
    if (err) { setCreateNameError(err); return; }
    try {
      const { data } = await api.post('/settings/profiles/managed', { name: createName, createNew: true });
      setProfiles(prev => [...prev, data]);
      showMsg('success', `Профиль "${createName}" создан`);
      setCreateDialogOpen(false);
      setCreateName('');
      setCreateNameError('');
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка создания профиля');
    }
  };

  // ── Tab 0: Inbounds ───────────────────────────────────────────────────────

  const addInbound = () => {
    const tagSuffix = Math.random().toString(16).slice(2, 8);
    setLocalInbounds(prev => [...prev, { type: 'vless-tcp-reality', port: 'random', sni: 'random', tagSuffix }]);
  };

  const removeInbound = (idx: number) => {
    setLocalInbounds(prev => prev.filter((_, i) => i !== idx));
  };

  const updateInbound = (idx: number, field: string, value: string) => {
    setLocalInbounds(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const handleInboundTypeChange = (idx: number, newType: string) => {
    const hasSni = SNI_TYPES.has(newType);
    setLocalInbounds(prev => prev.map((item, i) =>
      i === idx ? {
        type: newType,
        port: item.port,
        ...(hasSni ? { sni: item.sni || 'random' } : {}),
        ...(newType === 'vless-ws' && item.security ? { security: item.security } : {}),
        ...(item.tag ? { tag: item.tag } : {}),
        ...(item.tagSuffix ? { tagSuffix: item.tagSuffix } : {}),
      } : item
    ));
  };

  const handleSaveInbounds = async () => {
    if (!selectedProfile) return;
    try {
      await api.patch(`/settings/profiles/managed/${selectedProfile.uuid}`, {
        inboundsConfig: localInbounds,
        excludedPorts: localExcludedPorts,
      });
      updateProfileInState(selectedProfile.uuid, {
        inboundsConfig: localInbounds,
        excludedPorts: localExcludedPorts,
      });
      showMsg('success', 'Инбаунды сохранены');
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка сохранения');
    }
  };

  const handleAddExcludedPort = () => {
    const port = parseInt(excludedPortInput, 10);
    if (isNaN(port) || port < 1 || port > 65535) return;
    if (localExcludedPorts.includes(port)) { setExcludedPortInput(''); return; }
    setLocalExcludedPorts(prev => [...prev, port].sort((a, b) => a - b));
    setExcludedPortInput('');
  };

  const handleRemoveExcludedPort = (port: number) => {
    setLocalExcludedPorts(prev => prev.filter(p => p !== port));
  };

  // ── Tab 1: Node ───────────────────────────────────────────────────────────

  const handleSaveNode = async () => {
    if (!selectedProfile) return;
    const node = nodes.find(n => n.uuid === localNodeUuid);
    try {
      await api.patch(`/settings/profiles/managed/${selectedProfile.uuid}`, {
        nodeUuid: localNodeUuid,
        nodeAddress: node?.address || '',
        applyToNode: localApplyToNode,
      });
      updateProfileInState(selectedProfile.uuid, {
        nodeUuid: localNodeUuid,
        nodeAddress: node?.address || '',
        applyToNode: localApplyToNode,
      });
      showMsg('success', 'Нода сохранена');
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка сохранения');
    }
  };

  // ── Tab 2: Hosts ──────────────────────────────────────────────────────────

  const countryCodeToFlag = (code: string): string => {
    if (!code || code.length !== 2) return code;
    return Array.from(code.toUpperCase()).map(c => String.fromCodePoint(c.charCodeAt(0) - 65 + 0x1F1E6)).join('');
  };

  const checkTemplateWarning = (): boolean => {
    const node = nodes.find(n => n.uuid === localNodeUuid);
    const countryCode = node?.countryCode || '';
    const countryFlag = countryCodeToFlag(countryCode);
    const nodeName = node?.name || '';
    const nodeAddress = node?.address || '';
    for (let i = 0; i < localInbounds.length; i++) {
      const inboundType = localInbounds[i].type;
      const remark = localTemplate
        .replace('{countryFlag}', countryFlag)
        .replace('{countryCode}', countryCode)
        .replace('{nodeName}', nodeName)
        .replace('{nodeAddress}', nodeAddress)
        .replace('{inboundType}', inboundType)
        .replace('{index}', String(localHostIndexStart + i));
      if (remark.length > 40) return true;
    }
    return false;
  };

  const handleCreateHosts = async () => {
    if (!selectedProfile) return;
    try {
      // Save template and index start first
      await api.patch(`/settings/profiles/managed/${selectedProfile.uuid}`, { hostTemplate: localTemplate, hostIndexStart: localHostIndexStart });
      const { data } = await api.post(`/settings/profiles/managed/${selectedProfile.uuid}/hosts/create`);
      setLocalHostMappings(data.mappings || []);
      updateProfileInState(selectedProfile.uuid, { hostMappings: data.mappings || [], hostTemplate: localTemplate });
      showMsg('success', `Создано хостов: ${data.created}`);
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка создания хостов');
    }
  };

  const updateHostMapping = (tag: string, hostUuid: string) => {
    setLocalHostMappings(prev => {
      const existing = prev.find(m => m.tag === tag);
      if (existing) return prev.map(m => m.tag === tag ? { ...m, hostUuid } : m);
      return [...prev, { tag, hostUuid }];
    });
  };

  const handleSaveHostMappings = async () => {
    if (!selectedProfile) return;
    try {
      await api.patch(`/settings/profiles/managed/${selectedProfile.uuid}`, { hostMappings: localHostMappings });
      updateProfileInState(selectedProfile.uuid, { hostMappings: localHostMappings });
      showMsg('success', 'Маппинг хостов сохранён');
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка сохранения');
    }
  };

  // ── Tab 3: Schedule ───────────────────────────────────────────────────────

  const handleSaveSchedule = async () => {
    if (!selectedProfile) return;
    try {
      await api.patch(`/settings/profiles/managed/${selectedProfile.uuid}`, {
        rotationEnabled: localRotationEnabled,
        rotationMode: localRotationMode,
        rotationInterval: localInterval,
        rotationScheduleTime: localScheduleTime,
        rotationTimezone: localTimezone,
      });
      updateProfileInState(selectedProfile.uuid, {
        rotationEnabled: localRotationEnabled,
        rotationMode: localRotationMode,
        rotationInterval: localInterval,
        rotationScheduleTime: localScheduleTime,
        rotationTimezone: localTimezone,
      });
      showMsg('success', 'Расписание сохранено');
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка сохранения');
    }
  };

  const handleRotateNow = async () => {
    if (!selectedProfile) return;
    try {
      setLoading(true);
      const { data } = await api.post(`/settings/profiles/managed/${selectedProfile.uuid}/rotate`);
      if (data.success) {
        showMsg('success', data.message || 'Ротация выполнена');
        updateProfileInState(selectedProfile.uuid, {
          lastRotationTimestamp: Date.now(),
          lastRotationStatus: 'success',
          lastRotationError: '',
        });
      } else {
        showMsg('error', data.message || 'Ошибка ротации');
        updateProfileInState(selectedProfile.uuid, {
          lastRotationStatus: 'error',
          lastRotationError: data.message || '',
        });
      }
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка сети');
    } finally {
      setLoading(false);
    }
  };

  // ── Tab 4: SNI Domains ────────────────────────────────────────────────────

  const handleAddDomain = () => {
    const trimmed = domainInput.trim();
    if (!trimmed || localProfileDomains.includes(trimmed)) return;
    setLocalProfileDomains(prev => [...prev, trimmed]);
    setDomainInput('');
  };

  const handleRemoveDomain = (domain: string) => {
    setLocalProfileDomains(prev => prev.filter(d => d !== domain));
  };

  const handleClearAllDomains = () => {
    setLocalProfileDomains([]);
  };

  const handleDomainFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;
      const lines = text
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('#'));
      setLocalProfileDomains(prev => {
        const existing = new Set(prev);
        return [...prev, ...lines.filter(l => !existing.has(l))];
      });
      if (domainFileInputRef.current) domainFileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const handleSaveProfileDomains = async () => {
    if (!selectedProfile) return;
    try {
      await api.patch(`/settings/profiles/managed/${selectedProfile.uuid}`, {
        profileDomains: localProfileDomains,
      });
      updateProfileInState(selectedProfile.uuid, { profileDomains: localProfileDomains });
      showMsg('success', 'Домены SNI сохранены');
    } catch (e: any) {
      showMsg('error', e?.response?.data?.message || 'Ошибка сохранения');
    }
  };

  const handleExportProfileDomains = () => {
    const text = localProfileDomains.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedProfile?.name || 'profile'}-domains.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUrlAddToProfile = (domains: string[]) => {
    setLocalProfileDomains(prev => {
      const existing = new Set(prev);
      return [...prev, ...domains.filter(d => !existing.has(d))];
    });
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const alreadyAddedUuids = new Set(profiles.map(p => p.uuid));
  const availableRwProfiles = rwProfiles.filter(p => !alreadyAddedUuids.has(p.uuid));

  return (
    <Box>
      {/* Header */}
      <Stack
        direction={isMobile ? 'column' : 'row'}
        justifyContent="space-between"
        alignItems={isMobile ? 'flex-start' : 'center'}
        spacing={1}
        sx={{ mb: 3 }}
      >
        <Typography variant={isMobile ? 'h5' : 'h4'}>Профили</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Button
            variant="outlined"
            color="warning"
            onClick={handleRotateAll}
            disabled={loading || profiles.length === 0}
            startIcon={loading ? <CircularProgress size={16} /> : <Refresh />}
          >
            Запустить все
          </Button>
          <Button variant="outlined" onClick={() => { setAddDialogOpen(true); loadRwProfiles(); }}>
            Добавить существующий
          </Button>
          <Button variant="contained" startIcon={<Add />} onClick={() => setCreateDialogOpen(true)}>
            Создать новый
          </Button>
        </Stack>
      </Stack>

      <Grid container spacing={3}>
        {/* Profile cards */}
        <Grid size={{ xs: 12, md: selectedProfile ? 4 : 12 }}>
          {profiles.length === 0 && (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <Typography color="textSecondary">
                Нет профилей. Создайте новый или добавьте существующий профиль Remnawave.
              </Typography>
            </Paper>
          )}
          <Stack spacing={2}>
            {profiles.map(p => (
              <Paper
                key={p.uuid}
                onClick={() => handleSelectProfile(p)}
                sx={{
                  p: 2,
                  cursor: 'pointer',
                  border: selectedProfile?.uuid === p.uuid ? 2 : 1,
                  borderColor: selectedProfile?.uuid === p.uuid ? 'primary.main' : 'divider',
                  '&:hover': { borderColor: 'primary.light' },
                  transition: 'border-color 0.2s',
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    {/* Inline rename */}
                    {renamingUuid === p.uuid ? (
                      <TextField
                        size="small"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => handleRename(p.uuid)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleRename(p.uuid);
                          if (e.key === 'Escape') setRenamingUuid(null);
                        }}
                        autoFocus
                        onClick={e => e.stopPropagation()}
                        sx={{ mb: 0.5 }}
                      />
                    ) : (
                      <Typography
                        variant="h6"
                        sx={{ cursor: 'text', '&:hover': { textDecoration: 'underline' } }}
                        onClick={e => {
                          e.stopPropagation();
                          setRenamingUuid(p.uuid);
                          setRenameValue(p.name);
                        }}
                      >
                        {p.name}
                      </Typography>
                    )}

                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                      {p.rotationEnabled ? (
                        <Chip icon={<CheckCircle />} label="Активен" color="success" size="small" variant="outlined" />
                      ) : (
                        <Chip icon={<PauseCircleFilled />} label="Пауза" color="warning" size="small" variant="outlined" />
                      )}
                      {p.lastRotationStatus === 'error' && (
                        <Tooltip title={p.lastRotationError || 'Ошибка ротации'}>
                          <Warning color="error" fontSize="small" />
                        </Tooltip>
                      )}
                      {p.lastRotationStatus === 'success' && (
                        <Tooltip title="Последняя ротация успешна">
                          <Check color="success" fontSize="small" />
                        </Tooltip>
                      )}
                    </Stack>

                    <Typography variant="body2" color="textSecondary" sx={{ mt: 0.5 }}>
                      Инбаундов: {p.inboundsConfig?.length || 0}
                      {p.nodeAddress ? ` • ${p.nodeAddress}` : ''}
                    </Typography>
                    <Typography variant="caption" color="textSecondary">
                      Последняя: {formatDate(p.lastRotationTimestamp)}
                    </Typography>
                    <br />
                    <Typography variant="caption" color="textSecondary">
                      Следующая: {getNextRotationTime(p)}
                    </Typography>
                  </Box>

                  <Tooltip title="Удалить профиль">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={e => handleDeleteOpen(p, e)}
                      sx={{ ml: 1, flexShrink: 0 }}
                    >
                      <Delete fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Grid>

        {/* Profile detail */}
        {selectedProfile && (
          <Grid size={{ xs: 12, md: 8 }}>
            <Paper>
              <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                <Tabs
                  value={profileTab}
                  onChange={(_, v) => setProfileTab(v)}
                  variant={isMobile ? 'scrollable' : 'standard'}
                  scrollButtons="auto"
                >
                  <Tab label="Инбаунды" />
                  <Tab label="Нода" />
                  <Tab label="Хосты" />
                  <Tab label="Расписание" />
                  <Tab label="Домены SNI" />
                </Tabs>
              </Box>

              <Box sx={{ p: 3 }}>

                {/* ── Tab 0: Inbounds ── */}
                {profileTab === 0 && (
                  <Box>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                      <Typography variant="h6">Инбаунды для ротации</Typography>
                      <Button variant="outlined" startIcon={<Add />} onClick={addInbound} size="small">
                        Добавить
                      </Button>
                    </Stack>
                    <Divider sx={{ mb: 2 }} />

                    {localInbounds.length === 0 && (
                      <Typography color="textSecondary" variant="body2">
                        Нет инбаундов. Нажмите "Добавить".
                      </Typography>
                    )}

                    <Stack spacing={2}>
                      {(() => {
                        const effectiveTags = computeEffectiveTags(localInbounds);
                        return localInbounds.map((item, idx) => {
                          const effectiveTag = effectiveTags[idx];
                          const sniEntry = sniData.find(s => s.tag === effectiveTag);
                          return (
                          <Box key={idx} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                            <FormControl size="small" sx={{ minWidth: 200 }}>
                              <InputLabel>Тип</InputLabel>
                              <Select
                                value={item.type}
                                label="Тип"
                                onChange={(e: SelectChangeEvent) => handleInboundTypeChange(idx, e.target.value)}
                              >
                                {CONNECTION_TYPES.map(t => (
                                  <MenuItem key={t} value={t}>{t}</MenuItem>
                                ))}
                              </Select>
                            </FormControl>

                            <TextField
                              size="small" label="Порт" value={item.port}
                              onChange={e => updateInbound(idx, 'port', e.target.value)}
                              helperText="random или число"
                              sx={{ width: 130 }}
                            />

                            {SNI_TYPES.has(item.type) && (
                              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                <TextField
                                  size="small" label="SNI" value={item.sni || ''}
                                  onChange={e => updateInbound(idx, 'sni', e.target.value)}
                                  helperText="random или домен"
                                  sx={{ width: 200 }}
                                />
                                {sniEntry && sniEntry.sni && sniEntry.sni !== '-' && (
                                  <Tooltip title="Открыть в новой вкладке">
                                    <Typography
                                      variant="caption"
                                      component="a"
                                      href={`https://${sniEntry.sni}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      sx={{ color: 'success.main', cursor: 'pointer', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                                    >
                                      ↳ {sniEntry.sni}
                                    </Typography>
                                  </Tooltip>
                                )}
                              </Box>
                            )}

                            {item.type === 'vless-ws' && (
                              <FormControl size="small" sx={{ width: 110 }}>
                                <InputLabel>Security</InputLabel>
                                <Select
                                  value={item.security || 'none'}
                                  label="Security"
                                  onChange={(e: SelectChangeEvent) => updateInbound(idx, 'security', e.target.value)}
                                >
                                  <MenuItem value="none">none</MenuItem>
                                  <MenuItem value="tls">tls</MenuItem>
                                </Select>
                              </FormControl>
                            )}

                            <TextField
                              size="small" label="Тег (опционально)" value={item.tag || ''}
                              onChange={e => updateInbound(idx, 'tag', e.target.value)}
                              helperText={`→ ${effectiveTags[idx]}`}
                              sx={{ width: 220 }}
                            />

                            <TextField
                              size="small" label="Суффикс тега" value={item.tagSuffix || ''}
                              onChange={e => updateInbound(idx, 'tagSuffix', e.target.value)}
                              helperText="уникальный суффикс профиля"
                              sx={{ width: 160 }}
                            />

                            <Tooltip title="Удалить">
                              <IconButton color="error" onClick={() => removeInbound(idx)} sx={{ mt: 0.5 }}>
                                <Delete />
                              </IconButton>
                            </Tooltip>
                          </Box>
                          );
                        });
                      })()}
                    </Stack>

                    <Divider sx={{ mt: 3, mb: 2 }} />

                    <Typography variant="subtitle2" gutterBottom>
                      Исключённые порты (рандомайзер пропускает)
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                      <TextField
                        size="small"
                        label="Порт"
                        value={excludedPortInput}
                        onChange={e => setExcludedPortInput(e.target.value.replace(/\D/g, ''))}
                        onKeyDown={e => e.key === 'Enter' && handleAddExcludedPort()}
                        sx={{ width: 110 }}
                        inputProps={{ inputMode: 'numeric', min: 1, max: 65535 }}
                        helperText="1–65535"
                      />
                      <Button variant="outlined" size="small" onClick={handleAddExcludedPort} sx={{ mt: -1.5 }}>
                        Добавить
                      </Button>
                    </Stack>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ gap: 0.5 }}>
                      {localExcludedPorts.map(port => (
                        <Chip
                          key={port}
                          label={port}
                          size="small"
                          onDelete={() => handleRemoveExcludedPort(port)}
                        />
                      ))}
                      {localExcludedPorts.length === 0 && (
                        <Typography variant="caption" color="textSecondary">Нет исключений</Typography>
                      )}
                    </Stack>

                    <Button variant="contained" sx={{ mt: 3 }} onClick={handleSaveInbounds}>
                      Сохранить инбаунды
                    </Button>
                  </Box>
                )}

                {/* ── Tab 1: Node ── */}
                {profileTab === 1 && (
                  <Box>
                    <Typography variant="h6" gutterBottom>Сервер (нода)</Typography>
                    <Divider sx={{ mb: 2 }} />

                    <FormControl fullWidth margin="normal">
                      <InputLabel>Выберите ноду</InputLabel>
                      <Select
                        value={localNodeUuid}
                        label="Выберите ноду"
                        onChange={(e: SelectChangeEvent) => setLocalNodeUuid(e.target.value)}
                      >
                        <MenuItem value=""><em>Не выбрано</em></MenuItem>
                        {nodes.map(n => (
                          <MenuItem key={n.uuid} value={n.uuid}>
                            {n.countryCode} {n.name} ({n.address})
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    <FormControlLabel
                      control={
                        <Switch
                          checked={localApplyToNode}
                          onChange={e => setLocalApplyToNode(e.target.checked)}
                        />
                      }
                      label="Назначать профиль ноде после ротации"
                      sx={{ mt: 1, display: 'block' }}
                    />

                    <Button variant="contained" sx={{ mt: 2 }} onClick={handleSaveNode}>
                      Сохранить
                    </Button>
                  </Box>
                )}

                {/* ── Tab 2: Hosts ── */}
                {profileTab === 2 && (
                  <Box>
                    <Typography variant="h6" gutterBottom>Хосты</Typography>
                    <Divider sx={{ mb: 2 }} />

                    <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
                      <Typography variant="subtitle1" gutterBottom>Создать хосты по шаблону</Typography>
                      <TextField
                        fullWidth
                        size="small"
                        label="Шаблон имени хоста"
                        value={localTemplate}
                        onChange={e => setLocalTemplate(e.target.value)}
                        helperText="Переменные: {countryFlag} {countryCode} {nodeName} {nodeAddress} {inboundType} {index}"
                        sx={{ mb: 1 }}
                      />
                      <TextField
                        size="small"
                        label="Начальный индекс {index}"
                        type="number"
                        value={localHostIndexStart}
                        onChange={e => setLocalHostIndexStart(Math.max(1, parseInt(e.target.value) || 1))}
                        inputProps={{ min: 1 }}
                        sx={{ mb: 1, width: 200 }}
                      />
                      {checkTemplateWarning() && (
                        <Alert severity="warning" sx={{ mb: 1 }}>
                          Имя хоста с текущими значениями превысит 40 символов и будет обрезано.
                        </Alert>
                      )}
                      {localInbounds.length === 0 && (
                        <Alert severity="info" sx={{ mb: 1 }}>
                          Сначала добавьте инбаунды на вкладке "Инбаунды" и запустите ротацию.
                        </Alert>
                      )}
                      <Button
                        variant="contained"
                        onClick={handleCreateHosts}
                        disabled={!localNodeUuid || localInbounds.length === 0}
                      >
                        Создать хосты
                      </Button>
                    </Paper>

                    <Paper variant="outlined" sx={{ p: 2 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                        <Typography variant="subtitle1">Маппинг хостов (по тегу инбаунда)</Typography>
                        <Stack direction="row" spacing={1}>
                          <Button size="small" onClick={() => selectedProfile && loadSni(selectedProfile.uuid)} variant="outlined">
                            SNI
                          </Button>
                          <Button size="small" onClick={loadHosts} startIcon={<Refresh />}>Обновить</Button>
                        </Stack>
                      </Stack>

                      {localInbounds.length === 0 && (
                        <Typography color="textSecondary" variant="body2">
                          Добавьте инбаунды на вкладке "Инбаунды".
                        </Typography>
                      )}

                      <Stack spacing={2}>
                        {(() => {
                          const effectiveTags = computeEffectiveTags(localInbounds);
                          return localInbounds.map((item, idx) => {
                            const effectiveTag = effectiveTags[idx];
                            const mapping = localHostMappings.find(m => m.tag === effectiveTag);
                            const sni = sniData.find(s => s.tag === effectiveTag);
                            return (
                              <Box key={idx} sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                                <Box sx={{ minWidth: 180 }}>
                                  <Typography variant="body2">{effectiveTag}</Typography>
                                  {sni && (
                                    <Typography
                                      variant="caption"
                                      component="a"
                                      href={sni.sni !== '-' ? `https://${sni.sni}` : undefined}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      sx={{ color: sni.sni !== '-' ? 'success.main' : 'text.disabled', textDecoration: 'none', cursor: sni.sni !== '-' ? 'pointer' : 'default' }}
                                    >
                                      SNI: {sni.sni}
                                    </Typography>
                                  )}
                                </Box>
                                <FormControl size="small" sx={{ minWidth: 280 }}>
                                  <InputLabel>Хост Remnawave</InputLabel>
                                  <Select
                                    value={mapping?.hostUuid || ''}
                                    label="Хост Remnawave"
                                    onChange={(e: SelectChangeEvent) => updateHostMapping(effectiveTag, e.target.value)}
                                  >
                                    <MenuItem value=""><em>Не выбрано</em></MenuItem>
                                    {hosts.map(h => (
                                      <MenuItem key={h.uuid} value={h.uuid}>
                                        {h.remark} ({h.address}:{h.port})
                                      </MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                              </Box>
                            );
                          });
                        })()}
                      </Stack>

                      {localInbounds.length > 0 && (
                        <Button variant="contained" sx={{ mt: 2 }} onClick={handleSaveHostMappings}>
                          Сохранить маппинг
                        </Button>
                      )}
                    </Paper>
                  </Box>
                )}

                {/* ── Tab 3: Schedule ── */}
                {profileTab === 3 && (
                  <Box>
                    <Typography variant="h6" gutterBottom>Расписание ротации</Typography>
                    <Divider sx={{ mb: 2 }} />

                    <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
                      {localRotationEnabled ? (
                        <Chip icon={<CheckCircle />} label="Активен" color="success" variant="outlined" />
                      ) : (
                        <Chip icon={<PauseCircleFilled />} label="Пауза" color="warning" variant="outlined" />
                      )}
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => setLocalRotationEnabled(v => !v)}
                        startIcon={localRotationEnabled ? <PauseCircleFilled /> : <PlayArrow />}
                      >
                        {localRotationEnabled ? 'Пауза' : 'Возобновить'}
                      </Button>
                    </Stack>

                    <Typography variant="subtitle2" gutterBottom>Режим</Typography>
                    <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                      <Button
                        variant={localRotationMode === 'interval' ? 'contained' : 'outlined'}
                        size="small"
                        onClick={() => setLocalRotationMode('interval')}
                      >
                        По интервалу
                      </Button>
                      <Button
                        variant={localRotationMode === 'schedule' ? 'contained' : 'outlined'}
                        size="small"
                        onClick={() => setLocalRotationMode('schedule')}
                      >
                        По расписанию
                      </Button>
                    </Stack>

                    {localRotationMode === 'interval' && (
                      <Box sx={{ mb: 2 }}>
                        <TextField
                          label="Интервал (минуты)"
                          type="number"
                          size="small"
                          value={localInterval}
                          onChange={e => setLocalInterval(Number(e.target.value))}
                          sx={{ width: 180, mr: 2 }}
                        />
                        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                          {ROTATION_PRESETS.map(p => (
                            <Chip
                              key={p.value}
                              label={p.label}
                              clickable
                              onClick={() => setLocalInterval(p.value)}
                              color={localInterval === p.value ? 'primary' : 'default'}
                              variant={localInterval === p.value ? 'filled' : 'outlined'}
                            />
                          ))}
                        </Stack>
                      </Box>
                    )}

                    {localRotationMode === 'schedule' && (
                      <Box sx={{ mb: 2 }}>
                        <Stack direction={isMobile ? 'column' : 'row'} spacing={2}>
                          <TextField
                            label="Время"
                            type="time"
                            size="small"
                            value={localScheduleTime}
                            onChange={e => setLocalScheduleTime(e.target.value)}
                            sx={{ width: 160 }}
                            slotProps={{ inputLabel: { shrink: true } }}
                          />
                          <FormControl size="small" sx={{ minWidth: 260 }}>
                            <InputLabel>Часовой пояс</InputLabel>
                            <Select
                              value={localTimezone}
                              label="Часовой пояс"
                              onChange={(e: SelectChangeEvent) => setLocalTimezone(e.target.value)}
                            >
                              {TIMEZONES.map(tz => (
                                <MenuItem key={tz.value} value={tz.value}>{tz.label}</MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Stack>
                      </Box>
                    )}

                    <Divider sx={{ my: 2 }} />
                    <Typography variant="body2" color="textSecondary">
                      Последняя ротация: {formatDate(selectedProfile.lastRotationTimestamp)}
                    </Typography>
                    <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                      Следующая: {getNextRotationTime({ ...selectedProfile, rotationEnabled: localRotationEnabled, rotationMode: localRotationMode, rotationInterval: localInterval, rotationScheduleTime: localScheduleTime, rotationTimezone: localTimezone })}
                    </Typography>

                    <Stack direction="row" spacing={2}>
                      <Button variant="contained" onClick={handleSaveSchedule}>Сохранить</Button>
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={handleRotateNow}
                        disabled={loading}
                        startIcon={loading ? <CircularProgress size={16} /> : <Refresh />}
                      >
                        Запустить сейчас
                      </Button>
                    </Stack>
                  </Box>
                )}

                {/* ── Tab 4: SNI Domains ── */}
                {profileTab === 4 && (
                  <Box>
                    <Typography variant="h6" gutterBottom>Домены SNI профиля</Typography>
                    <Divider sx={{ mb: 2 }} />

                    <Alert severity="info" sx={{ mb: 2 }}>
                      Если указаны домены профиля, они используются вместо глобального списка при sni: random
                    </Alert>

                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                      <TextField
                        size="small"
                        label="Домен"
                        value={domainInput}
                        onChange={e => setDomainInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAddDomain()}
                        sx={{ flex: 1 }}
                      />
                      <Button variant="contained" onClick={handleAddDomain} startIcon={<Add />}>
                        Добавить
                      </Button>
                    </Stack>

                    <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<UploadFile />}
                        onClick={() => domainFileInputRef.current?.click()}
                      >
                        Из файла
                      </Button>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<Language />}
                        onClick={() => setProfileUrlImportOpen(true)}
                      >
                        Из URL
                      </Button>
                      {localProfileDomains.length > 0 && (
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<FileDownload />}
                          onClick={handleExportProfileDomains}
                        >
                          Экспорт .txt
                        </Button>
                      )}
                      {localProfileDomains.length > 0 && (
                        <Button
                          variant="outlined"
                          size="small"
                          color="error"
                          startIcon={<Delete />}
                          onClick={handleClearAllDomains}
                        >
                          Очистить всё
                        </Button>
                      )}
                    </Stack>

                    <input
                      type="file"
                      accept=".txt"
                      ref={domainFileInputRef}
                      style={{ display: 'none' }}
                      onChange={handleDomainFileUpload}
                    />

                    <Paper variant="outlined" sx={{ maxHeight: 360, overflowY: 'auto', mb: 2 }}>
                      <List dense>
                        {localProfileDomains.length === 0 && (
                          <Typography sx={{ p: 2 }} color="textSecondary" textAlign="center">
                            Нет доменов. Используется глобальный список.
                          </Typography>
                        )}
                        {localProfileDomains.map(d => (
                          <ListItem
                            key={d}
                            secondaryAction={
                              <IconButton edge="end" size="small" onClick={() => handleRemoveDomain(d)}>
                                <Delete fontSize="small" />
                              </IconButton>
                            }
                          >
                            <ListItemText primary={d} />
                          </ListItem>
                        ))}
                      </List>
                    </Paper>

                    {localProfileDomains.length > 0 && (
                      <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mb: 1 }}>
                        {localProfileDomains.length} доменов
                      </Typography>
                    )}

                    <Button variant="contained" onClick={handleSaveProfileDomains}>
                      Сохранить домены
                    </Button>

                    <UrlImportDialog
                      open={profileUrlImportOpen}
                      onClose={() => setProfileUrlImportOpen(false)}
                      onAdd={handleUrlAddToProfile}
                    />
                  </Box>
                )}

              </Box>
            </Paper>
          </Grid>
        )}
      </Grid>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Удалить профиль</DialogTitle>
        <DialogContent>
          <Typography>
            Удалить профиль <strong>{profileToDelete?.name}</strong>?
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={deleteFromRemnawave}
                onChange={e => setDeleteFromRemnawave(e.target.checked)}
              />
            }
            label="Также удалить из Remnawave"
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Отмена</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">Удалить</Button>
        </DialogActions>
      </Dialog>

      {/* Add Existing Dialog */}
      <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Добавить существующий профиль</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>Профиль Remnawave</InputLabel>
            <Select
              value={addExistingUuid}
              label="Профиль Remnawave"
              onChange={(e: SelectChangeEvent) => setAddExistingUuid(e.target.value)}
            >
              {availableRwProfiles.length === 0 && (
                <MenuItem value="" disabled>Нет доступных профилей</MenuItem>
              )}
              {availableRwProfiles.map(p => (
                <MenuItem key={p.uuid} value={p.uuid}>{p.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setAddDialogOpen(false); setAddExistingUuid(''); }}>Отмена</Button>
          <Button onClick={handleAddExisting} variant="contained" disabled={!addExistingUuid}>
            Добавить
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create New Dialog */}
      <Dialog open={createDialogOpen} onClose={() => { setCreateDialogOpen(false); setCreateName(''); setCreateNameError(''); }} maxWidth="xs" fullWidth>
        <DialogTitle>Создать новый профиль</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            sx={{ mt: 1 }}
            label="Имя профиля"
            value={createName}
            onChange={e => {
              setCreateName(e.target.value);
              setCreateNameError(validateProfileName(e.target.value));
            }}
            error={!!createNameError}
            helperText={createNameError || 'Только латиница, цифры, пробел, _ и - (2–30 символов)'}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateNew(); }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCreateDialogOpen(false); setCreateName(''); setCreateNameError(''); }}>
            Отмена
          </Button>
          <Button onClick={handleCreateNew} variant="contained" disabled={!!createNameError || !createName}>
            Создать
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={msg.open} autoHideDuration={5000} onClose={() => setMsg(m => ({ ...m, open: false }))}>
        <Alert severity={msg.type}>{msg.text}</Alert>
      </Snackbar>
    </Box>
  );
}
