/**
 * CRM adapter for Prospects data.
 *
 * v1 STUB — always returns {ok:false, reason:'unmapped', message:'CRM adapter not configured'}.
 *
 * When a real CRM integration is added, replace the body of `fetch()` with an
 * HTTP call to `process.env.CRM_API_BASE` using `ref` as the client identifier.
 * The caller (`fetchProspects`) already gates on `process.env.CRM_API_BASE` being
 * present before calling this adapter, so the env check is handled at the call site.
 *
 * Expected future signature remains identical — swap the body, not the contract.
 */

import type { DateWindow } from '../dates';
import type { SourceResult, ProspectsBundle } from '../types';

export const crmAdapter = {
  /**
   * Fetch a ProspectsBundle from the CRM for the given client reference and period.
   *
   * v1 stub: always returns not-configured. The caller gates on CRM_API_BASE being
   * present, but even if called directly this adapter returns a safe not-ok result.
   */
  async fetch(
    _ref: string,
    _period: DateWindow,
  ): Promise<SourceResult<ProspectsBundle>> {
    return {
      ok: false,
      reason: 'unmapped',
      message: 'CRM adapter not configured',
    };
  },
};
