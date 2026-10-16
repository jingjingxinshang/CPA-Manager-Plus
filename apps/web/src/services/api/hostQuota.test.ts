import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('./client', () => ({
  apiClient: {
    get: mocks.get,
    post: mocks.post,
  },
}));

import {
  fetchHostCredentialQuota,
  fetchHostQuotaProviders,
  normalizeHostQuotaProviders,
  normalizeHostQuotaResponse,
} from './hostQuota';

beforeEach(() => {
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.get.mockResolvedValue({ providers: [] });
  mocks.post.mockResolvedValue({ summary: [], groups: [] });
});

describe('normalizeHostQuotaProviders', () => {
  it('reads the provider list in either spelling', () => {
    expect(
      normalizeHostQuotaProviders({
        providers: [
          {
            plugin_id: 'plugin-a',
            provider: 'alpha',
            display_name: 'Alpha',
            supported_providers: ['alpha', 'alpha-lite'],
            supports_reset: true,
          },
          {
            pluginId: 'plugin-b',
            provider: 'beta',
            displayName: 'Beta',
            supportedProviders: ['beta'],
            supportsReset: false,
          },
        ],
      })
    ).toEqual([
      {
        pluginId: 'plugin-a',
        provider: 'alpha',
        displayName: 'Alpha',
        supportedProviders: ['alpha', 'alpha-lite'],
        supportsReset: true,
      },
      {
        pluginId: 'plugin-b',
        provider: 'beta',
        displayName: 'Beta',
        supportedProviders: ['beta'],
        supportsReset: false,
      },
    ]);
  });

  it('keeps an entry that names no plugin and drops one that names no provider', () => {
    expect(
      normalizeHostQuotaProviders({
        providers: [{ provider: 'alpha' }, { plugin_id: 'plugin-b' }, null, 7],
      })
    ).toEqual([
      {
        pluginId: '',
        provider: 'alpha',
        displayName: undefined,
        supportedProviders: [],
        supportsReset: false,
      },
    ]);
  });

  it('reads a bare array and tolerates a missing list', () => {
    expect(normalizeHostQuotaProviders([{ provider: 'alpha' }])).toHaveLength(1);
    expect(normalizeHostQuotaProviders(undefined)).toEqual([]);
    expect(normalizeHostQuotaProviders({ providers: 'nope' })).toEqual([]);
  });
});

describe('normalizeHostQuotaResponse', () => {
  it('reads groups, buckets, summary and subscription', () => {
    expect(
      normalizeHostQuotaResponse({
        subscription: { plan: 'pro', tier_name: 'Tier 2', tier_id: 't2' },
        summary: [{ key: 'credits', label: 'Credits', value: 120, unit: 'credits' }],
        server_time_offset_ms: 1500,
        groups: [
          {
            id: 'daily',
            label: 'Daily',
            buckets: [
              {
                id: 'window',
                label: 'Window',
                window: '5h',
                remaining_fraction: 0.25,
                reset_time: '2030-01-01T00:00:00Z',
                description: 'resets soon',
              },
            ],
          },
        ],
      })
    ).toEqual({
      subscription: { plan: 'pro', tierName: 'Tier 2', tierId: 't2' },
      summary: [{ key: 'credits', label: 'Credits', value: 120, unit: 'credits' }],
      serverTimeOffsetMs: 1500,
      groups: [
        {
          id: 'daily',
          label: 'Daily',
          description: undefined,
          buckets: [
            {
              id: 'window',
              label: 'Window',
              window: '5h',
              remainingFraction: 0.25,
              resetTime: '2030-01-01T00:00:00Z',
              description: 'resets soon',
            },
          ],
        },
      ],
    });
  });

  it('clamps a fraction and reports a bucket without one as exhausted', () => {
    const response = normalizeHostQuotaResponse({
      groups: [
        {
          displayName: 'Only a display name',
          buckets: [
            { id: 'over', remainingFraction: 4 },
            { id: 'under', remainingFraction: -2 },
            { id: 'absent' },
          ],
        },
      ],
    });

    expect(response.groups[0]?.label).toBe('Only a display name');
    expect(response.groups[0]?.buckets.map((bucket) => bucket.remainingFraction)).toEqual([
      1, 0, 0,
    ]);
  });

  it('drops entries it cannot name and never throws on a malformed payload', () => {
    expect(
      normalizeHostQuotaResponse({
        summary: [{ label: 'no key', value: 1 }, { key: 'no value' }],
        groups: [{ buckets: [] }, 'nope', { id: 'ok', buckets: 'nope' }],
      })
    ).toEqual({
      summary: [],
      groups: [{ id: 'ok', label: 'ok', description: undefined, buckets: [] }],
      subscription: undefined,
      serverTimeOffsetMs: undefined,
    });

    expect(normalizeHostQuotaResponse(null)).toEqual({
      summary: [],
      groups: [],
    });
  });

  it('treats an unnamed subscription as absent', () => {
    expect(normalizeHostQuotaResponse({ subscription: {} }).subscription).toBe(undefined);
  });
});

describe('fetchHostQuotaProviders', () => {
  it('reads the provider list from the host', async () => {
    mocks.get.mockResolvedValue({ providers: [{ provider: 'alpha' }] });

    await expect(fetchHostQuotaProviders()).resolves.toEqual([
      {
        pluginId: '',
        provider: 'alpha',
        displayName: undefined,
        supportedProviders: [],
        supportsReset: false,
      },
    ]);
    expect(mocks.get).toHaveBeenCalledWith('/quota/providers', undefined);
  });
});

describe('fetchHostCredentialQuota', () => {
  it('posts the credential index the host expects', async () => {
    await fetchHostCredentialQuota({ authIndex: ' auth-1 ' });

    expect(mocks.post).toHaveBeenCalledWith('/quota/fetch', { auth_index: 'auth-1' }, undefined);
  });

  it('passes an optional provider and plugin through', async () => {
    await fetchHostCredentialQuota({
      authIndex: 'auth-1',
      provider: 'alpha',
      pluginId: 'plugin-a',
    });

    expect(mocks.post).toHaveBeenCalledWith(
      '/quota/fetch',
      { auth_index: 'auth-1', provider: 'alpha', plugin_id: 'plugin-a' },
      undefined
    );
  });

  it('refuses an empty credential index before calling the host', async () => {
    await expect(fetchHostCredentialQuota({ authIndex: '   ' })).rejects.toThrow(
      'auth_index is required'
    );
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
