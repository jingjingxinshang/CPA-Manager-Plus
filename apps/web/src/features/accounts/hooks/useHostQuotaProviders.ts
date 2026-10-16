/**
 * Provider keys the host reports quota for.
 *
 * The host answers quota for any credential whose provider it has a quota,
 * balance or billing source for. Reading the list lets the accounts workspace
 * offer a quota view for such a provider without a build-time list of its own,
 * so a provider this panel does not implement is not a dead end.
 *
 * A host that reports nothing, or a request that fails, yields an empty set:
 * quota support then falls back to the providers the panel implements itself.
 */

import { useEffect, useState } from 'react';
import type { AuthFilesApiRequestScope } from '@/services/api/authFiles';
import { fetchHostQuotaProviders } from '@/services/api/hostQuota';
import { normalizeProviderKey } from '@/features/authFiles/constants';

/** Every provider key one host quota entry answers for. */
const providerKeysOf = (providers: Awaited<ReturnType<typeof fetchHostQuotaProviders>>) => {
  const keys = new Set<string>();
  for (const entry of providers) {
    for (const key of [entry.provider, ...entry.supportedProviders]) {
      const normalized = normalizeProviderKey(key);
      if (normalized) keys.add(normalized);
    }
  }
  return keys;
};

const EMPTY_PROVIDER_KEYS: ReadonlySet<string> = new Set<string>();

export const useHostQuotaProviders = (
  requestScope: AuthFilesApiRequestScope | undefined
): ReadonlySet<string> => {
  // Keys are stored with the scope they were read for, so a stale reading is
  // never used after the panel points at another host and no state is written
  // while rendering or straight from an effect body.
  const [reading, setReading] = useState<{ scope: string; keys: ReadonlySet<string> }>({
    scope: '',
    keys: EMPTY_PROVIDER_KEYS,
  });
  // The scope object is rebuilt per render, so the effect keys off its fields:
  // they are what actually changes when the panel points at another host.
  const apiBase = requestScope?.apiBase ?? '';
  const managementKey = requestScope?.managementKey ?? '';
  const scopeKey = `${apiBase}\u0000${managementKey}`;

  useEffect(() => {
    let cancelled = false;
    const scope = apiBase ? { apiBase, managementKey } : undefined;
    void (async () => {
      try {
        const providers = await fetchHostQuotaProviders(scope);
        if (cancelled) return;
        setReading({ scope: scopeKey, keys: providerKeysOf(providers) });
      } catch {
        if (!cancelled) setReading({ scope: scopeKey, keys: EMPTY_PROVIDER_KEYS });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, managementKey, scopeKey]);

  return reading.scope === scopeKey ? reading.keys : EMPTY_PROVIDER_KEYS;
};
