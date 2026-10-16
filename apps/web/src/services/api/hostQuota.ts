/**
 * Host-provided credential quota.
 *
 * The host reports the quota of a credential in a single normalized shape, so a
 * client can render it without knowing which provider the credential belongs
 * to. These helpers read that shape rather than re-implementing a provider:
 *
 *   GET  /quota/providers  providers the host can report quota for
 *   POST /quota/fetch      quota of one credential
 *   POST /quota/reset      asks the host to reset one credential
 *
 * Reading quota this way means a credential whose provider the panel has no
 * dedicated view for still gets a quota reading, and that reading is the same
 * one the host itself reports.
 */

import type {
  HostQuotaBucket,
  HostQuotaData,
  HostQuotaGroup,
  HostQuotaMetric,
  HostQuotaSubscription,
} from '@/types';
import { isRecord } from '@/utils/helpers';
import { apiClient, createScopedApiRequestConfig, type ApiClientRequestScope } from './client';

export const HOST_QUOTA_ENDPOINTS = {
  PROVIDERS: '/quota/providers',
  FETCH: '/quota/fetch',
  RESET: '/quota/reset',
} as const;

/** One provider the host can report quota for. */
export interface HostQuotaProviderInfo {
  /** Plugin that owns the provider, when the host reports one. */
  pluginId: string;
  /** Provider key a credential is routed by. */
  provider: string;
  /** Optional user-facing label for the provider. */
  displayName?: string;
  /** Credential providers this entry answers for. */
  supportedProviders: string[];
  supportsReset: boolean;
}

export type HostQuotaFetchParams = {
  authIndex: string;
  /** Optional: narrow the request to a provider or owning plugin. */
  provider?: string;
  pluginId?: string;
};

const asString = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : String(value);
};

const asFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/**
 * Reads the first present key. The host emits camelCase and also accepts
 * snake_case, so both spellings are read.
 */
const readField = (source: Record<string, unknown>, keys: string[]): unknown => {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
};

const readStringField = (source: Record<string, unknown>, keys: string[]): string =>
  asString(readField(source, keys)).trim();

const normalizeBucket = (value: unknown): HostQuotaBucket | null => {
  if (!isRecord(value)) return null;
  const remainingFraction = asFiniteNumber(
    readField(value, ['remainingFraction', 'remaining_fraction'])
  );
  const label = readStringField(value, ['label', 'window']);
  const id = readStringField(value, ['id', 'window']) || label;
  if (!id) return null;
  return {
    id,
    label: label || id,
    window: readStringField(value, ['window']) || undefined,
    // A bucket without a fraction is still a bucket: report it as exhausted
    // rather than dropping a limit the provider chose to publish.
    remainingFraction: remainingFraction === null ? 0 : Math.min(1, Math.max(0, remainingFraction)),
    resetTime: readStringField(value, ['resetTime', 'reset_time']) || undefined,
    description: readStringField(value, ['description']) || undefined,
  };
};

const normalizeGroup = (value: unknown): HostQuotaGroup | null => {
  if (!isRecord(value)) return null;
  const rawBuckets = readField(value, ['buckets']);
  const buckets = Array.isArray(rawBuckets)
    ? rawBuckets
        .map((bucket) => normalizeBucket(bucket))
        .filter((bucket): bucket is HostQuotaBucket => Boolean(bucket))
    : [];
  const displayName = readStringField(value, ['displayName', 'display_name']);
  const label = readStringField(value, ['label']) || displayName;
  const id = readStringField(value, ['id']) || label || displayName;
  if (!id) return null;
  return {
    id,
    label: label || id,
    description: readStringField(value, ['description']) || displayName || undefined,
    buckets,
  };
};

const normalizeMetric = (value: unknown): HostQuotaMetric | null => {
  if (!isRecord(value)) return null;
  const key = readStringField(value, ['key']);
  const numeric = asFiniteNumber(readField(value, ['value']));
  if (!key || numeric === null) return null;
  return {
    key,
    label: readStringField(value, ['label']) || key,
    value: numeric,
    unit: readStringField(value, ['unit']) || undefined,
    format: readStringField(value, ['format']) || undefined,
    currency: readStringField(value, ['currency']) || undefined,
  };
};

const normalizeSubscription = (value: unknown): HostQuotaSubscription | undefined => {
  if (!isRecord(value)) return undefined;
  const subscription: HostQuotaSubscription = {
    plan: readStringField(value, ['plan']) || undefined,
    tierName: readStringField(value, ['tierName', 'tier_name']) || undefined,
    tierId: readStringField(value, ['tierId', 'tier_id']) || undefined,
  };
  return subscription.plan || subscription.tierName || subscription.tierId
    ? subscription
    : undefined;
};

/** Reads the normalized quota payload the host returns for one credential. */
export const normalizeHostQuotaResponse = (value: unknown): HostQuotaData => {
  if (!isRecord(value)) {
    return { summary: [], groups: [] };
  }
  const rawSummary = readField(value, ['summary']);
  const rawGroups = readField(value, ['groups']);
  const offset = asFiniteNumber(readField(value, ['serverTimeOffsetMs', 'server_time_offset_ms']));
  return {
    subscription: normalizeSubscription(readField(value, ['subscription'])),
    summary: Array.isArray(rawSummary)
      ? rawSummary
          .map((metric) => normalizeMetric(metric))
          .filter((metric): metric is HostQuotaMetric => Boolean(metric))
      : [],
    groups: Array.isArray(rawGroups)
      ? rawGroups
          .map((group) => normalizeGroup(group))
          .filter((group): group is HostQuotaGroup => Boolean(group))
      : [],
    serverTimeOffsetMs: offset ?? undefined,
  };
};

/** Reads the provider list the host can report quota for. */
export const normalizeHostQuotaProviders = (value: unknown): HostQuotaProviderInfo[] => {
  const rawProviders = isRecord(value) ? readField(value, ['providers']) : value;
  if (!Array.isArray(rawProviders)) return [];
  const providers: HostQuotaProviderInfo[] = [];
  for (const entry of rawProviders) {
    if (!isRecord(entry)) continue;
    const provider = readStringField(entry, ['provider', 'identifier', 'id']);
    if (!provider) continue;
    const rawSupported = readField(entry, ['supportedProviders', 'supported_providers']);
    providers.push({
      pluginId: readStringField(entry, ['pluginId', 'plugin_id']),
      provider,
      displayName: readStringField(entry, ['displayName', 'display_name']) || undefined,
      supportedProviders: Array.isArray(rawSupported)
        ? rawSupported.map((item) => asString(item).trim()).filter(Boolean)
        : [],
      supportsReset: readField(entry, ['supportsReset', 'supports_reset']) === true,
    });
  }
  return providers;
};

/**
 * Provider keys the host can report quota for, including the credential
 * providers each entry answers for.
 */
export const fetchHostQuotaProviders = async (
  requestScope?: ApiClientRequestScope
): Promise<HostQuotaProviderInfo[]> => {
  const data = await apiClient.get<unknown>(
    HOST_QUOTA_ENDPOINTS.PROVIDERS,
    requestScope ? createScopedApiRequestConfig(requestScope) : undefined
  );
  return normalizeHostQuotaProviders(data);
};

/** Reads the normalized quota the host reports for one credential. */
export const fetchHostCredentialQuota = async (
  params: HostQuotaFetchParams,
  requestScope?: ApiClientRequestScope
): Promise<HostQuotaData> => {
  const authIndex = params.authIndex.trim();
  if (!authIndex) {
    throw new Error('auth_index is required');
  }
  const body: Record<string, string> = { auth_index: authIndex };
  if (params.provider?.trim()) body.provider = params.provider.trim();
  if (params.pluginId?.trim()) body.plugin_id = params.pluginId.trim();
  const data = await apiClient.post<unknown>(
    HOST_QUOTA_ENDPOINTS.FETCH,
    body,
    requestScope ? createScopedApiRequestConfig(requestScope) : undefined
  );
  return normalizeHostQuotaResponse(data);
};
