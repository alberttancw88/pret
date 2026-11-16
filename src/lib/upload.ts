// Browser side of the signed-upload flow (ADR-0007): request…Upload (Server Action) returns an
// UploadIntent → the browser PUTs the file to signedUrl → confirm…Upload (Server Action) checks
// magic bytes and activates the file. Client-only helper; no secrets involved.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** PUT the file to a Supabase Storage signed upload URL. Returns false on failure. */
export async function putToSignedUrl(signedUrl: string, file: File): Promise<boolean> {
  try {
    const res = await fetch(signedUrl, {
      method: 'PUT',
      body: file,
      headers: { 'content-type': file.type || 'application/octet-stream', 'x-upsert': 'false' },
    });
    return res.ok;
  } catch {
    return false;
  }
}
