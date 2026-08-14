export interface RemnawaveResponse<T> {
  response: T;
}

export interface RemnawaveRawInbound {
  tag?: string;
  protocol?: string;
  port?: number;
  streamSettings?: {
    realitySettings?: { serverNames?: string[] };
    tlsSettings?: { serverName?: string };
    wsSettings?: { headers?: { Host?: string } };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface RemnawaveXrayConfig {
  inbounds?: unknown[];
  [key: string]: unknown;
}

export interface RemnawaveInbound {
  uuid: string;
  profileUuid: string;
  tag: string;
  type: string;
  network: string | null;
  security: string | null;
  port: number | null;
  rawInbound: RemnawaveRawInbound | null;
}

export interface RemnawaveConfigProfile {
  uuid: string;
  viewPosition: number;
  name: string;
  config: RemnawaveXrayConfig;
  inbounds: RemnawaveInbound[];
  nodes: Array<{
    uuid: string;
    name: string;
    countryCode: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface RemnawaveNode {
  uuid: string;
  id: number;
  name: string;
  address: string;
  port: number | null;
  proxyUrl: string | null;
  isConnected: boolean;
  isDisabled: boolean;
  isConnecting: boolean;
  lastStatusChange: string | null;
  lastStatusMessage: string | null;
  countryCode: string;
  configProfile: {
    activeConfigProfileUuid: string | null;
    activeInbounds: RemnawaveInbound[];
  };
  versions: {
    xray: string;
    node: string;
  } | null;
  usersOnline: number;
}

export interface RemnawaveHostInbound {
  configProfileUuid: string | null;
  configProfileInboundUuid: string | null;
}

export interface RemnawaveHostInboundRequest {
  configProfileUuid: string;
  configProfileInboundUuid: string;
}

export interface RemnawaveHost {
  uuid: string;
  remark: string;
  address: string;
  port: number;
  inbound: RemnawaveHostInbound;
  nodes: string[];
  [key: string]: unknown;
}

export interface CreateRemnawaveHostBody {
  inbound: RemnawaveHostInboundRequest;
  remark: string;
  address: string;
  port: number;
  nodes?: string[];
}

export interface UpdateRemnawaveHostBody {
  uuid?: never;
  inbound?: RemnawaveHostInboundRequest;
  remark?: string;
  address?: string;
  port?: number;
  nodes?: string[];
  [key: string]: unknown;
}

export interface CreateRemnawaveNodeBody {
  name: string;
  address: string;
  port?: number;
  countryCode?: string;
  configProfile: {
    activeConfigProfileUuid: string;
    activeInbounds: string[];
  };
}
