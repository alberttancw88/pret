import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { sql, withUserTx, type UserTxContext } from '../db';
import type { DataCategory, FileSubject } from '../db/types';
import { createSupabaseUserClient } from '../auth/supabase';

// File storage (ADR-0007, rls-policies §9): private buckets; upload only to a path the server
// pre-registered for this user (app.files intent, 10 min); download only through a logged
// file_access_grants row (DB trigger writes audit.access_log) + 60-second signed URL.
// All Storage calls are made AS THE USER (their access token), so Storage RLS applies too.

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const SUBJECT_BUCKET: Record<FileSubject, string> = {
  employee_document: 'employee-files',
  employee_photo: 'employee-files',
  leave_attachment: 'leave-files',
  claim_receipt: 'claim-files',
  change_request_doc: 'cr-files',
  privacy_notice: 'company',
  company_asset: 'company',
  import_source: 'imports',
  generated_output: 'generated',
  cp38_letter: 'employee-files',
  tp1_doc: 'employee-files',
};

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
  'application/zip': 'zip',
};

export interface UploadIntentInput {
  subject: FileSubject;
  ownerEmployeeId: string | null;
  /** path segment(s) under the subject folder, e.g. `<claimId>/<lineId>` */
  scope: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  dataCategory?: DataCategory | null;
  retentionDeleteAfter?: string | null;
}

function basePath(i: UploadIntentInput, fileUuid: string): string {
  const ext = MIME_EXT[i.mimeType];
  if (!ext) throw new Error('PRET-FILE-TYPE');
  if (!/^[0-9a-zA-Z/_-]{0,200}$/.test(i.scope) || i.scope.includes('//')) throw new Error('PRET-FILE-SCOPE');
  const scope = i.scope ? `${i.scope.replace(/^\/+|\/+$/g, '')}/` : '';
  const emp = i.ownerEmployeeId;
  switch (i.subject) {
    case 'employee_photo': return `emp/${emp}/photo/${fileUuid}.${ext}`;
    case 'employee_document': return `emp/${emp}/docs/${scope}${fileUuid}.${ext}`;
    case 'leave_attachment': return `emp/${emp}/leave/${scope}${fileUuid}.${ext}`;
    case 'claim_receipt': return `emp/${emp}/claims/${scope}${fileUuid}.${ext}`;
    case 'change_request_doc': return `emp/${emp}/cr/${scope}${fileUuid}.${ext}`;
    case 'import_source': return `imp/${scope}${fileUuid}.${ext}`;
    case 'company_asset': return `co/${scope}${fileUuid}.${ext}`;
    case 'privacy_notice': return `co/privacy/${fileUuid}.${ext}`;
    case 'generated_output': return `out/${scope}${fileUuid}.${ext}`;
    default: throw new Error('PRET-FILE-SUBJECT');
  }
}

/** Step 1: register the upload intent (RLS: app.can_upload_for) and return a signed upload URL. */
export async function requestUpload(ctx: UserTxContext, accessToken: string, input: UploadIntentInput) {
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_FILE_BYTES) {
    throw new Error('PRET-FILE-SIZE');
  }
  const bucket = SUBJECT_BUCKET[input.subject];
  const path = basePath(input, randomUUID());
  const fileId = await withUserTx(ctx, async (tx) => {
    const r = await tx
      .insertInto('app.files')
      .values({
        bucket,
        storage_path: path,
        subject: input.subject,
        owner_employee_id: input.ownerEmployeeId,
        data_category: input.dataCategory ?? null,
        original_name: input.originalName.slice(0, 200),
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        retention_delete_after: input.retentionDeleteAfter ?? null,
        created_by: ctx.claims.sub, // overwritten by the guard trigger with the app user id
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return r.id;
  });
  const supabase = createSupabaseUserClient(accessToken);
  const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) throw new Error('PRET-FILE-UPLOAD-URL');
  return { fileId, bucket, path, signedUrl: data.signedUrl, token: data.token };
}

// Magic bytes of the allowed types (FR-G-12). DOCX/XLSX/ZIP share the ZIP signature.
function sniff(head: Buffer): string | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head.length >= 5 && head.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|mif1|msf1|heim|heis)$/.test(head.subarray(8, 12).toString('latin1'))) return 'image/heic';
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return 'zip';
  return null;
}

function sniffMatches(declared: string, head: Buffer): boolean {
  const s = sniff(head);
  if (declared === 'text/csv') return s === null && !head.includes(0);
  if (s === 'zip') return declared.includes('openxmlformats') || declared === 'application/zip';
  return s === declared;
}

/**
 * Step 2 (after the browser PUT): verify magic bytes and hash, then app.confirm_upload()
 * flips the intent to active (size taken from Storage). A mismatching file is rejected.
 * NOTE: image re-encoding (EXIF/GPS strip) needs an image library (e.g. `sharp`) — not yet installed.
 */
export async function confirmUpload(ctx: UserTxContext, accessToken: string, fileId: string) {
  const file = await withUserTx(ctx, (tx) =>
    tx.selectFrom('app.files').select(['id', 'bucket', 'storage_path', 'mime_type', 'status']).where('id', '=', fileId).executeTakeFirst(),
  );
  if (!file || file.status !== 'pending_upload') throw new Error('PRET-ACC-404');
  const supabase = createSupabaseUserClient(accessToken);
  const { data, error } = await supabase.storage.from(file.bucket).download(file.storage_path);
  if (error || !data) throw new Error('PRET-FILE-MISSING');
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) throw new Error('PRET-FILE-SIZE');
  if (!sniffMatches(file.mime_type, bytes.subarray(0, 16))) throw new Error('PRET-FILE-TYPE');
  const sha = createHash('sha256').update(bytes).digest();
  await withUserTx(ctx, async (tx) => {
    await sql`select app.confirm_upload(${fileId}::uuid, ${sha})`.execute(tx);
  });
  return { fileId, sha256: sha.toString('hex') };
}

/**
 * Download: insert a grant (RLS: app.can_read_file; the DB trigger writes audit.access_log
 * with the file's data category) then a 60-second signed URL as the user.
 */
export async function getDownloadUrl(
  ctx: UserTxContext,
  accessToken: string,
  fileId: string,
  opts: { purpose?: 'view' | 'download' | 'approve_review'; reason?: string | null } = {},
) {
  const file = await withUserTx({ ...ctx, reason: opts.reason ?? ctx.reason }, async (tx) => {
    const f = await tx
      .selectFrom('app.files')
      .select(['id', 'bucket', 'storage_path', 'original_name', 'subject'])
      .where('id', '=', fileId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (!f) return null;
    if (!['employee_photo', 'privacy_notice', 'company_asset'].includes(f.subject)) {
      await tx
        .insertInto('app.file_access_grants')
        .values({
          file_id: f.id,
          user_id: sql<string>`app.current_app_user_id()`,
          purpose: opts.purpose ?? 'download',
          reason: opts.reason ?? null,
          expires_at: sql<Date>`now() + interval '2 minutes'`,
        })
        .execute();
    }
    return f;
  });
  if (!file) throw new Error('PRET-ACC-404');
  const supabase = createSupabaseUserClient(accessToken);
  const { data, error } = await supabase.storage
    .from(file.bucket)
    .createSignedUrl(file.storage_path, 60, { download: file.original_name });
  if (error || !data) throw new Error('PRET-ACC-404');
  return { url: data.signedUrl, fileName: file.original_name };
}
