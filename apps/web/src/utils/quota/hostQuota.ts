/**
 * Host-provided credential quota.
 *
 * The host reports quota for any credential whose provider it has a quota
 * source for, in one normalized shape. This module turns that shape into the
 * data the account views render, so a credential the panel has no dedicated
 * provider view for still shows its limits — and shows the same limits the host
 * itself reports.
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, HostQuotaData } from '@/types';
import type { AuthFilesApiRequestScope } from '@/services/api/authFiles';
import { fetchHostCredentialQuota } from '@/services/api/hostQuota';
import { normalizeAuthIndex } from '@/utils/authIndex';

/**
 * The credential index the host answers quota requests with. A credential
 * without one cannot be queried, and the reason is reported rather than
 * swallowed into an empty view.
 */
export const resolveHostQuotaAuthIndex = (file: AuthFileItem, t: TFunction): string => {
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  if (!authIndex) {
    throw new Error(t('host_quota.missing_auth_index'));
  }
  return authIndex;
};

/**
 * Reads the quota the host reports for one credential.
 *
 * The request names only the credential: the host resolves which quota source
 * answers for it, which keeps one credential's report identical to the host's
 * own view. `quotaInventoryObserved` records whether the host reported any
 * limit at all, which an empty view must not be confused with.
 */
export const fetchHostQuota = async (
  file: AuthFileItem,
  t: TFunction,
  requestScope?: AuthFilesApiRequestScope
): Promise<HostQuotaData> => {
  const authIndex = resolveHostQuotaAuthIndex(file, t);
  const data = await fetchHostCredentialQuota({ authIndex }, requestScope);
  return {
    ...data,
    quotaInventoryObserved: data.groups.length > 0 || data.summary.length > 0,
  };
};
