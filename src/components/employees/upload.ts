'use client';

// Two-step uploads (ADR-0007) for employee files and change-request attachments:
// request…Upload (Server Action) → browser PUT to the signed URL → confirm…Upload (magic bytes).
import {
  DOCUMENT_MIME_TYPES,
  PHOTO_MAX_BYTES,
  PHOTO_MIME_TYPES,
  type EmployeeFilePurpose,
} from '@/server/contracts/employees';
import {
  confirmChangeRequestUpload,
  confirmEmployeeFileUpload,
  requestChangeRequestUpload,
  requestEmployeeFileUpload,
} from '@/server/actions/employees';
import { MAX_UPLOAD_BYTES, putToSignedUrl } from '@/lib/upload';

export type UploadOutcome = { ok: true; fileId: string } | { ok: false; error: string };

/** HEIC files often arrive with an empty type in the browser. */
function mimeOf(file: File): string {
  if (file.type) return file.type;
  const n = file.name.toLowerCase();
  if (n.endsWith('.heic')) return 'image/heic';
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

export const DOCUMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic,.docx';
export const IMAGE_PDF_ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic';
export const PHOTO_ACCEPT = '.jpg,.jpeg,.png';

/** EC-EMP-13: checked before upload. */
export function precheckFile(file: File, purpose: EmployeeFilePurpose | 'cr'): string | null {
  const mime = mimeOf(file);
  if (purpose === 'photo') {
    if (!(PHOTO_MIME_TYPES as readonly string[]).includes(mime)) return 'Upload a JPG or PNG photo.';
    if (file.size > PHOTO_MAX_BYTES) return 'The photo must be 5 MB or smaller.';
    return null;
  }
  const allowed: readonly string[] = purpose === 'document' ? DOCUMENT_MIME_TYPES : ['application/pdf', 'image/jpeg', 'image/png', 'image/heic'];
  if (!allowed.includes(mime)) return purpose === 'document' ? 'Allowed types: PDF, JPG, PNG, HEIC, DOCX.' : 'Allowed types: PDF, JPG, PNG, HEIC.';
  if (file.size > MAX_UPLOAD_BYTES) return 'The file must be 10 MB or smaller.';
  return null;
}

export async function uploadEmployeeFile(employeeId: string, purpose: EmployeeFilePurpose, file: File): Promise<UploadOutcome> {
  const pre = precheckFile(file, purpose);
  if (pre) return { ok: false, error: pre };
  try {
    const intent = await requestEmployeeFileUpload({ employeeId, purpose, fileName: file.name, mimeType: mimeOf(file) as (typeof DOCUMENT_MIME_TYPES)[number], sizeBytes: file.size });
    if (!intent.ok) return { ok: false, error: Object.values(intent.fieldErrors ?? {})[0] ?? intent.error };
    if (!(await putToSignedUrl(intent.signedUrl, file))) return { ok: false, error: 'Upload failed. Please try again.' };
    const done = await confirmEmployeeFileUpload({ fileId: intent.fileId });
    return done.ok ? { ok: true, fileId: done.fileId } : { ok: false, error: done.error };
  } catch {
    return { ok: false, error: 'Upload failed. Please try again.' };
  }
}

export async function uploadChangeRequestFile(file: File): Promise<UploadOutcome> {
  const pre = precheckFile(file, 'cr');
  if (pre) return { ok: false, error: pre };
  try {
    const intent = await requestChangeRequestUpload({ fileName: file.name, mimeType: mimeOf(file) as 'application/pdf', sizeBytes: file.size });
    if (!intent.ok) return { ok: false, error: Object.values(intent.fieldErrors ?? {})[0] ?? intent.error };
    if (!(await putToSignedUrl(intent.signedUrl, file))) return { ok: false, error: 'Upload failed. Please try again.' };
    const done = await confirmChangeRequestUpload({ fileId: intent.fileId });
    return done.ok ? { ok: true, fileId: done.fileId } : { ok: false, error: done.error };
  } catch {
    return { ok: false, error: 'Upload failed. Please try again.' };
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
