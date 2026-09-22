import { isIP } from 'node:net';

export const HYSTERIA2_CLUSTER_STATE_VERSION = 1 as const;

export interface Hysteria2ClusterGroup {
  version: typeof HYSTERIA2_CLUSTER_STATE_VERSION;
  id: string;
  domain: string;
  email: string;
  nodeIds: string[];
  coordinatorNodeId: string;
  previousDomain?: string;
  certificateFingerprint?: string;
  certificateNotAfter?: string;
  lastRenewalAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Hysteria2ClusterState {
  version: typeof HYSTERIA2_CLUSTER_STATE_VERSION;
  groups: Hysteria2ClusterGroup[];
}

export interface Hysteria2ClusterNodeEndpoint {
  nodeId: string;
  address: string;
}

export interface Hysteria2ClusterDnsInput {
  domain: string;
  resolvedIpv4: readonly string[];
  resolvedIpv6?: readonly string[];
  nodes: readonly Hysteria2ClusterNodeEndpoint[];
}

export interface Hysteria2ClusterDnsValidation {
  domain: string;
  resolvedIpv4: string[];
  resolvedIpv6: string[];
  resolvedAddresses: string[];
  nodeAddresses: string[];
  nodes: Hysteria2ClusterNodeEndpoint[];
}

export interface Hysteria2SetupGroupInput {
  groupId?: string;
  domain: string;
  email: string;
  nodeIds: readonly string[];
  now: string;
}

export interface Hysteria2ReconfigureGroupInput {
  groupId?: string;
  newDomain: string;
  email: string;
  nodeIds: readonly string[];
  now: string;
}

export interface Hysteria2ClusterUpsertResult {
  state: Hysteria2ClusterState;
  group: Hysteria2ClusterGroup;
  created: boolean;
}

export type Hysteria2ClusterStateErrorCode =
  | 'invalid_state'
  | 'invalid_group_id'
  | 'invalid_node_id'
  | 'invalid_domain'
  | 'invalid_email'
  | 'invalid_ip_address'
  | 'invalid_dns_family'
  | 'empty_node_selection'
  | 'duplicate_node_endpoint'
  | 'dns_has_no_addresses'
  | 'dns_node_mismatch'
  | 'group_not_found'
  | 'group_conflict'
  | 'partial_group_selection'
  | 'setup_requires_reconfigure';

export class Hysteria2ClusterStateError extends Error {
  constructor(
    public readonly code: Hysteria2ClusterStateErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'Hysteria2ClusterStateError';
  }
}

interface ParsedIpAddress {
  family: 4 | 6;
  bytes: number[];
  normalized: string;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(
  code: Hysteria2ClusterStateErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new Hysteria2ClusterStateError(code, message, details);
}

function parseIpv4(value: string): ParsedIpAddress {
  const bytes = value.split('.').map(Number);
  return { family: 4, bytes, normalized: bytes.join('.') };
}

function expandIpv6(value: string): number[] {
  let source = value.toLowerCase();

  if (source.includes('.')) {
    const separator = source.lastIndexOf(':');
    const ipv4 = source.slice(separator + 1);
    if (separator < 0 || isIP(ipv4) !== 4) {
      fail('invalid_ip_address', `Некорректный IPv6-адрес: ${value}`);
    }
    const bytes = ipv4.split('.').map(Number);
    source = `${source.slice(0, separator)}:${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }

  const compressedAt = source.indexOf('::');
  if (compressedAt !== -1 && compressedAt !== source.lastIndexOf('::')) {
    fail('invalid_ip_address', `Некорректный IPv6-адрес: ${value}`);
  }

  const left = (compressedAt === -1 ? source : source.slice(0, compressedAt))
    .split(':')
    .filter(Boolean);
  const right = (compressedAt === -1 ? '' : source.slice(compressedAt + 2))
    .split(':')
    .filter(Boolean);
  let groups: string[];

  if (compressedAt === -1) {
    if (left.length !== 8) {
      fail('invalid_ip_address', `Некорректный IPv6-адрес: ${value}`);
    }
    groups = left;
  } else {
    const omitted = 8 - left.length - right.length;
    if (omitted < 1) {
      fail('invalid_ip_address', `Некорректный IPv6-адрес: ${value}`);
    }
    groups = [...left, ...Array<string>(omitted).fill('0'), ...right];
  }

  return groups.map((group) => Number.parseInt(group, 16));
}

function compressIpv6(groups: readonly number[]): string {
  let bestStart = -1;
  let bestLength = 0;

  for (let index = 0; index < groups.length; ) {
    if (groups[index] !== 0) {
      index++;
      continue;
    }
    let end = index;
    while (end < groups.length && groups[end] === 0) end++;
    const length = end - index;
    if (length >= 2 && length > bestLength) {
      bestStart = index;
      bestLength = length;
    }
    index = end;
  }

  const parts = groups.map((group) => group.toString(16));
  if (bestStart < 0) return parts.join(':');

  const left = parts.slice(0, bestStart).join(':');
  const right = parts.slice(bestStart + bestLength).join(':');
  if (!left && !right) return '::';
  if (!left) return `::${right}`;
  if (!right) return `${left}::`;
  return `${left}::${right}`;
}

function parseIpAddress(value: string): ParsedIpAddress {
  if (typeof value !== 'string') {
    fail('invalid_ip_address', 'IP-адрес должен быть строкой');
  }
  let source = value.trim();
  if (source.startsWith('[') && source.endsWith(']')) {
    source = source.slice(1, -1);
  }
  if (source.includes('%')) {
    fail('invalid_ip_address', `Некорректный IP-адрес: ${value}`, {
      address: value,
    });
  }

  const family = isIP(source);
  if (family === 4) return parseIpv4(source);
  if (family !== 6) {
    fail('invalid_ip_address', `Некорректный IP-адрес: ${value}`, {
      address: value,
    });
  }

  const groups = expandIpv6(source);
  const bytes = groups.flatMap((group) => [group >> 8, group & 255]);
  return { family: 6, bytes, normalized: compressIpv6(groups) };
}

function compareParsedAddresses(
  left: ParsedIpAddress,
  right: ParsedIpAddress,
): number {
  if (left.family !== right.family) return left.family - right.family;
  for (let index = 0; index < left.bytes.length; index++) {
    if (left.bytes[index] !== right.bytes[index]) {
      return left.bytes[index] - right.bytes[index];
    }
  }
  return 0;
}

export function normalizeIpAddress(value: string): string {
  return parseIpAddress(value).normalized;
}

export function normalizeAndSortIpAddresses(
  values: readonly string[],
): string[] {
  const unique = new Map<string, ParsedIpAddress>();
  for (const value of values) {
    const parsed = parseIpAddress(value);
    unique.set(parsed.normalized, parsed);
  }
  return [...unique.values()]
    .sort(compareParsedAddresses)
    .map((address) => address.normalized);
}

export function normalizeHysteriaDomain(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 3 ||
    value.length > 253 ||
    value !== value.trim() ||
    value !== value.toLowerCase() ||
    value.endsWith('.') ||
    !value.includes('.') ||
    isIP(value) !== 0
  ) {
    fail('invalid_domain', 'Некорректный домен Hysteria2', {
      domain: value,
    });
  }

  const labels = value.split('.');
  if (
    labels.some(
      (label) =>
        label.length < 1 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    fail('invalid_domain', 'Некорректный домен Hysteria2', {
      domain: value,
    });
  }
  return value;
}

export function normalizeHysteriaEmail(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 254 ||
    value !== value.trim()
  ) {
    fail('invalid_email', "Некорректный email для Let's Encrypt", {
      email: value,
    });
  }

  const at = value.lastIndexOf('@');
  if (at <= 0 || at !== value.indexOf('@')) {
    fail('invalid_email', "Некорректный email для Let's Encrypt", {
      email: value,
    });
  }
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (
    local.length > 64 ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    !/^[A-Za-z0-9._%+-]+$/.test(local)
  ) {
    fail('invalid_email', "Некорректный email для Let's Encrypt", {
      email: value,
    });
  }
  try {
    normalizeHysteriaDomain(domain);
  } catch {
    fail('invalid_email', "Некорректный email для Let's Encrypt", {
      email: value,
    });
  }
  return value;
}

function normalizeOpaqueId(value: string, kind: 'group' | 'node'): string {
  const code = kind === 'group' ? 'invalid_group_id' : 'invalid_node_id';
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 128 ||
    value !== value.trim() ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  ) {
    fail(code, `Некорректный ${kind === 'group' ? 'ID группы' : 'ID ноды'}`, {
      id: value,
    });
  }
  return value;
}

function normalizeNodeIds(values: readonly string[]): string[] {
  const ids = [
    ...new Set(values.map((value) => normalizeOpaqueId(value, 'node'))),
  ].sort(compareStrings);
  if (ids.length === 0) {
    fail('empty_node_selection', 'Не выбрано ни одной ноды');
  }
  return ids;
}

function normalizeTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    fail('invalid_state', 'Некорректная временная метка', { value });
  }
  return new Date(timestamp).toISOString();
}

export function chooseHysteriaCoordinator(nodeIds: readonly string[]): string {
  return normalizeNodeIds(nodeIds)[0];
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function assertState(state: Hysteria2ClusterState): void {
  if (
    !state ||
    state.version !== HYSTERIA2_CLUSTER_STATE_VERSION ||
    !Array.isArray(state.groups)
  ) {
    fail('invalid_state', 'Некорректное состояние кластеров Hysteria2');
  }
}

function immutableStateWithGroup(
  state: Hysteria2ClusterState,
  group: Hysteria2ClusterGroup,
): Hysteria2ClusterState {
  return {
    version: HYSTERIA2_CLUSTER_STATE_VERSION,
    groups: [
      ...state.groups.filter((candidate) => candidate.id !== group.id),
      { ...group, nodeIds: [...group.nodeIds] },
    ].sort((left, right) => compareStrings(left.id, right.id)),
  };
}

function groupsTouchingNodes(
  groups: readonly Hysteria2ClusterGroup[],
  nodeIds: readonly string[],
): Hysteria2ClusterGroup[] {
  const selected = new Set(nodeIds);
  return groups.filter((group) =>
    group.nodeIds.some((nodeId) => selected.has(nodeId)),
  );
}

function assertNodesBelongOnlyTo(
  groups: readonly Hysteria2ClusterGroup[],
  nodeIds: readonly string[],
  targetId?: string,
): void {
  const conflicts = groupsTouchingNodes(groups, nodeIds).filter(
    (group) => group.id !== targetId,
  );
  if (conflicts.length > 0) {
    fail('group_conflict', 'Нода уже принадлежит другой группе Hysteria2', {
      groupIds: conflicts.map((group) => group.id).sort(compareStrings),
    });
  }
}

export function createEmptyHysteria2ClusterState(): Hysteria2ClusterState {
  return { version: HYSTERIA2_CLUSTER_STATE_VERSION, groups: [] };
}

export function validateHysteria2ClusterDns(
  input: Hysteria2ClusterDnsInput,
): Hysteria2ClusterDnsValidation {
  const domain = normalizeHysteriaDomain(input.domain);
  const resolvedV4 = input.resolvedIpv4.map((address) =>
    parseIpAddress(address),
  );
  const resolvedV6 = (input.resolvedIpv6 ?? []).map((address) =>
    parseIpAddress(address),
  );
  if (resolvedV4.some((address) => address.family !== 4)) {
    fail('invalid_dns_family', 'A-запись содержит не IPv4-адрес');
  }
  if (resolvedV6.some((address) => address.family !== 6)) {
    fail('invalid_dns_family', 'AAAA-запись содержит не IPv6-адрес');
  }

  const resolvedIpv4 = normalizeAndSortIpAddresses(
    resolvedV4.map((address) => address.normalized),
  );
  const resolvedIpv6 = normalizeAndSortIpAddresses(
    resolvedV6.map((address) => address.normalized),
  );
  const resolvedAddresses = [...resolvedIpv4, ...resolvedIpv6];
  if (resolvedAddresses.length === 0) {
    fail('dns_has_no_addresses', `У домена ${domain} нет A/AAAA-записей`);
  }

  const seenNodeIds = new Set<string>();
  const seenAddresses = new Map<string, string>();
  const nodes = input.nodes.map((node) => {
    const nodeId = normalizeOpaqueId(node.nodeId, 'node');
    const address = normalizeIpAddress(node.address);
    if (seenNodeIds.has(nodeId)) {
      fail('duplicate_node_endpoint', 'Нода указана несколько раз', { nodeId });
    }
    const previousNode = seenAddresses.get(address);
    if (previousNode) {
      fail(
        'duplicate_node_endpoint',
        'Несколько выбранных нод используют один DNS-адрес',
        { address, nodeIds: [previousNode, nodeId].sort(compareStrings) },
      );
    }
    seenNodeIds.add(nodeId);
    seenAddresses.set(address, nodeId);
    return { nodeId, address };
  });
  if (nodes.length === 0) {
    fail('empty_node_selection', 'Не выбрано ни одной ноды');
  }
  nodes.sort((left, right) => compareStrings(left.nodeId, right.nodeId));
  const nodeAddresses = normalizeAndSortIpAddresses(
    nodes.map((node) => node.address),
  );

  if (!sameStrings(resolvedAddresses, nodeAddresses)) {
    const resolved = new Set(resolvedAddresses);
    const selected = new Set(nodeAddresses);
    fail(
      'dns_node_mismatch',
      `A/AAAA-записи ${domain} не совпадают с адресами выбранных нод`,
      {
        uncoveredDnsAddresses: resolvedAddresses.filter(
          (address) => !selected.has(address),
        ),
        nonDnsNodeAddresses: nodeAddresses.filter(
          (address) => !resolved.has(address),
        ),
      },
    );
  }

  return {
    domain,
    resolvedIpv4,
    resolvedIpv6,
    resolvedAddresses,
    nodeAddresses,
    nodes,
  };
}

export function upsertHysteria2SetupGroup(
  state: Hysteria2ClusterState,
  input: Hysteria2SetupGroupInput,
): Hysteria2ClusterUpsertResult {
  assertState(state);
  const domain = normalizeHysteriaDomain(input.domain);
  const email = normalizeHysteriaEmail(input.email);
  const nodeIds = normalizeNodeIds(input.nodeIds);
  const now = normalizeTimestamp(input.now);
  const groupId = input.groupId
    ? normalizeOpaqueId(input.groupId, 'group')
    : undefined;

  const candidates = state.groups.filter(
    (group) =>
      group.id === groupId ||
      group.domain === domain ||
      group.nodeIds.some((nodeId) => nodeIds.includes(nodeId)),
  );
  const candidateIds = [...new Set(candidates.map((group) => group.id))];
  if (candidateIds.length > 1) {
    fail(
      'group_conflict',
      'Выбранные ноды относятся к разным группам Hysteria2',
      {
        groupIds: candidateIds.sort(compareStrings),
      },
    );
  }

  const existing = candidates[0];
  if (existing && existing.domain !== domain) {
    fail(
      'setup_requires_reconfigure',
      'Для изменения домена используйте перенастройку группы Hysteria2',
      {
        groupId: existing.id,
        currentDomain: existing.domain,
        requestedDomain: domain,
      },
    );
  }
  if (existing && groupId && groupId !== existing.id) {
    fail('group_conflict', 'Домен уже принадлежит другой группе Hysteria2', {
      groupId: existing.id,
    });
  }
  if (!existing && !groupId) {
    fail('invalid_group_id', 'Для новой группы Hysteria2 требуется ID группы');
  }
  assertNodesBelongOnlyTo(state.groups, nodeIds, existing?.id);

  const coordinatorNodeId =
    existing && nodeIds.includes(existing.coordinatorNodeId)
      ? existing.coordinatorNodeId
      : chooseHysteriaCoordinator(nodeIds);
  const group: Hysteria2ClusterGroup = existing
    ? {
        ...existing,
        version: HYSTERIA2_CLUSTER_STATE_VERSION,
        email,
        nodeIds,
        coordinatorNodeId,
        updatedAt: now,
      }
    : {
        version: HYSTERIA2_CLUSTER_STATE_VERSION,
        id: groupId,
        domain,
        email,
        nodeIds,
        coordinatorNodeId,
        createdAt: now,
        updatedAt: now,
      };

  return {
    state: immutableStateWithGroup(state, group),
    group,
    created: !existing,
  };
}

export function upsertHysteria2ReconfigureGroup(
  state: Hysteria2ClusterState,
  input: Hysteria2ReconfigureGroupInput,
): Hysteria2ClusterUpsertResult {
  assertState(state);
  const nodeIds = normalizeNodeIds(input.nodeIds);
  const newDomain = normalizeHysteriaDomain(input.newDomain);
  const email = normalizeHysteriaEmail(input.email);
  const now = normalizeTimestamp(input.now);
  const groupId = input.groupId
    ? normalizeOpaqueId(input.groupId, 'group')
    : undefined;

  let group = groupId
    ? state.groups.find((candidate) => candidate.id === groupId)
    : undefined;
  if (groupId && !group) {
    fail('group_not_found', 'Группа Hysteria2 не найдена', { groupId });
  }
  if (!group) {
    const exact = state.groups.filter((candidate) =>
      sameStrings([...candidate.nodeIds].sort(compareStrings), nodeIds),
    );
    if (exact.length === 1) group = exact[0];
    else if (exact.length > 1) {
      fail(
        'group_conflict',
        'Набор нод неоднозначно связан с группами Hysteria2',
      );
    }
  }
  if (!group) {
    const touched = groupsTouchingNodes(state.groups, nodeIds);
    if (touched.length > 0) {
      fail(
        'partial_group_selection',
        'Для смены домена нужно выбрать все ноды одной группы Hysteria2',
        {
          groupIds: touched
            .map((candidate) => candidate.id)
            .sort(compareStrings),
        },
      );
    }
    fail(
      'group_not_found',
      'Группа Hysteria2 не найдена. Сначала запустите встроенный скрипт «Настройка Hysteria2» на всех нодах группы.',
    );
  }

  const existingNodeIds = [...group.nodeIds].sort(compareStrings);
  if (!sameStrings(existingNodeIds, nodeIds)) {
    fail(
      'partial_group_selection',
      'Для смены домена нужно выбрать все ноды одной группы Hysteria2',
      {
        groupId: group.id,
        expectedNodeIds: existingNodeIds,
        selectedNodeIds: nodeIds,
      },
    );
  }
  assertNodesBelongOnlyTo(state.groups, nodeIds, group.id);

  const domainOwner = state.groups.find(
    (candidate) => candidate.domain === newDomain && candidate.id !== group.id,
  );
  if (domainOwner) {
    fail(
      'group_conflict',
      'Новый домен уже принадлежит другой группе Hysteria2',
      {
        groupId: domainOwner.id,
      },
    );
  }

  const updated: Hysteria2ClusterGroup = {
    ...group,
    version: HYSTERIA2_CLUSTER_STATE_VERSION,
    domain: newDomain,
    email,
    previousDomain:
      newDomain === group.domain ? group.previousDomain : group.domain,
    nodeIds,
    updatedAt: now,
  };
  if (newDomain !== group.domain) {
    delete updated.certificateFingerprint;
    delete updated.certificateNotAfter;
    delete updated.lastRenewalAt;
  }
  return {
    state: immutableStateWithGroup(state, updated),
    group: updated,
    created: false,
  };
}
