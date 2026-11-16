import 'server-only';
import { sql, type Tx } from '../db';
import type { AuditAction, DataCategory } from '../db/types';

// Server-side access-log events (ADR-0008): reveals, exports, sensitive report columns and —
// for external administrators — every employee record opened (BR-ADM-22). The actor is taken
// from the session inside audit.write_access(); it is never a parameter.
// Data changes are logged by the database trigger audit.tg_log_change(), not here.

export interface AccessEvent {
  action: Extract<AuditAction, 'view_sensitive' | 'reveal' | 'download' | 'export' | 'import' | 'record_open'>;
  entityType: string;
  entityId?: string | null;
  entityRef?: string | null;
  employeeIds?: string[];
  fields?: string[];
  categories?: DataCategory[];
  reason?: string | null;
  recordCount?: number | null;
  fileId?: string | null;
  exportFileId?: string | null;
}

/** Write one access-log row inside the caller's withUserTx transaction (before revealing data). */
export async function writeAccess(tx: Tx, e: AccessEvent): Promise<void> {
  await sql`select audit.write_access(
      ${e.action}::app.audit_action, ${e.entityType}, ${e.entityId ?? null}::uuid,
      ${e.employeeIds ?? []}::uuid[], ${e.fields ?? []}::text[], ${e.categories ?? []}::app.data_category[],
      ${e.reason ?? null}, ${e.entityRef ?? null}, ${e.recordCount ?? null}::int,
      ${e.fileId ?? null}::uuid, ${e.exportFileId ?? null}::uuid)`.execute(tx);
}

/** BR-ADM-22: external administrators' record opens are always logged. */
export async function logRecordOpen(
  tx: Tx,
  user: { isExternal: boolean },
  entityType: string,
  entityId: string,
  employeeId: string | null,
): Promise<void> {
  if (!user.isExternal) return;
  await writeAccess(tx, {
    action: 'record_open',
    entityType,
    entityId,
    employeeIds: employeeId ? [employeeId] : [],
  });
}
