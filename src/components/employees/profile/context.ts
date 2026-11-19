'use client';

// Shared props for the E3 profile tabs.
import type { EmployeeFormOptions, EmployeeProfile, RevealField } from '@/server/contracts/employees';
import type { OrgOptions } from '@/server/contracts/org';
import { revealEmployeeValue } from '@/server/actions/employees';
import type { RevealMode, RevealReason } from '../MaskedValue';

export type ProfileCtx = {
  profile: EmployeeProfile;
  org: OrgOptions;
  formOptions: EmployeeFormOptions;
  isSuperAdmin: boolean;
  /** 'sa' (confirm only) or 'adm' (reason required) — E10 */
  revealMode: RevealMode;
};

/** FR-EMP-12 / EC-EMP-10 — shown on E→CR fields of an Admin's own record. */
export const OWN_LOCK = 'Use a change request for your own record.';

export function revealer(employeeId: string, field: RevealField, rowId?: string | null) {
  return async (reason: RevealReason | null) => {
    const res = await revealEmployeeValue({
      employeeId,
      field,
      rowId: rowId ?? undefined,
      reasonCode: (reason?.reasonCode as 'other' | undefined) ?? undefined,
      reasonText: reason?.reasonText ?? null,
    });
    return res.ok ? { ok: true as const, value: res.value } : { ok: false as const, error: res.error };
  };
}
