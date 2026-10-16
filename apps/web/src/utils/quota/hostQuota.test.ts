import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    fetchHostCredentialQuota: vi.fn(),
  },
}));

vi.mock('@/services/api/hostQuota', () => ({
  fetchHostCredentialQuota: mocks.fetchHostCredentialQuota,
}));

import { fetchHostQuota, resolveHostQuotaAuthIndex } from './hostQuota';

const t = ((key: string) => key) as TFunction;

beforeEach(() => {
  mocks.fetchHostCredentialQuota.mockReset();
  mocks.fetchHostCredentialQuota.mockResolvedValue({
    summary: [],
    groups: [],
  });
});

describe('resolveHostQuotaAuthIndex', () => {
  it('reads the camelCase and snake_case spellings', () => {
    expect(resolveHostQuotaAuthIndex({ name: 'a.json', authIndex: 'auth-1' }, t)).toBe('auth-1');
    expect(resolveHostQuotaAuthIndex({ name: 'a.json', auth_index: 'auth-2' }, t)).toBe('auth-2');
  });

  it('reports a credential with no index instead of querying it', () => {
    expect(() => resolveHostQuotaAuthIndex({ name: 'a.json' }, t)).toThrow(
      'host_quota.missing_auth_index'
    );
  });
});

describe('fetchHostQuota', () => {
  it('asks the host for the credential and records that limits were reported', async () => {
    mocks.fetchHostCredentialQuota.mockResolvedValue({
      subscription: { plan: 'pro' },
      summary: [{ key: 'credits', label: 'Credits', value: 120 }],
      groups: [{ id: 'daily', label: 'Daily', buckets: [] }],
    });

    const data = await fetchHostQuota({ name: 'a.json', authIndex: 'auth-1' }, t);

    // Only the credential is named: the host resolves which source answers.
    expect(mocks.fetchHostCredentialQuota).toHaveBeenCalledWith({ authIndex: 'auth-1' }, undefined);
    expect(data.quotaInventoryObserved).toBe(true);
    expect(data.subscription).toEqual({ plan: 'pro' });
  });

  it('reports an empty reading as no observed inventory', async () => {
    const data = await fetchHostQuota({ name: 'a.json', authIndex: 'auth-1' }, t);

    expect(data.quotaInventoryObserved).toBe(false);
  });

  it('passes the request scope through and never calls the host without an index', async () => {
    const requestScope = { apiBase: 'https://host.example', managementKey: 'key' };

    await fetchHostQuota({ name: 'a.json', authIndex: 'auth-1' }, t, requestScope);

    expect(mocks.fetchHostCredentialQuota).toHaveBeenCalledWith(
      { authIndex: 'auth-1' },
      requestScope
    );

    mocks.fetchHostCredentialQuota.mockClear();
    await expect(fetchHostQuota({ name: 'a.json' }, t)).rejects.toThrow();
    expect(mocks.fetchHostCredentialQuota).not.toHaveBeenCalled();
  });
});
