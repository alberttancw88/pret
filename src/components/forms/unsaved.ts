'use client';

// Idle timeout keeps unsaved work (US-ADMIN-014, wireframes G9, interaction-notes §6).
//
// Every shared form field (forms/fields.tsx, LeaveDateField) registers itself here with its
// label, current value and onChange. When the session ends (idle timeout, or a Server Action
// answering "Your session has ended"), `snapshotUnsavedWork()` writes the fields the user
// CHANGED on the page — only fields inside the page content (#main), never dialogs — to
// sessionStorage (this tab only, never the server). After signing in again the user returns
// to the same URL and <UnsavedWorkRestorer> feeds the values back through each field's own
// onChange, so React state, validation and dependent fields behave as if the user typed them.
//
// Never kept: password fields, fields marked `sensitive`, and fields whose label names an
// identifier or secret (MyKad / NRIC, passport, bank / account numbers, tax / EPF / SOCSO
// numbers, codes). The snapshot is tied to the signed-in user id and expires after 12 hours.
import * as React from 'react';

const STORAGE_KEY = 'pret.unsavedWork.v1';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** Fields that mount later (conditional sections) still receive their value for this long. */
const PENDING_WINDOW_MS = 8000;

export const SESSION_ENDED_EVENT = 'pret:session-ended';
export const SESSION_ENDED_MESSAGE = 'Your session has ended. Please sign in again.';

const SENSITIVE_LABEL =
  /password|passcode|nric|mykad|my ?kad|passport|\bic\b|bank|account|tax no|tax number|epf no|socso|eis no|card no|salary|\bpin\b|otp|one-time|verification|6-digit|code/i;

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

type Entry = {
  id: number;
  base: string;
  key: string;
  initial: string;
  get: () => Json;
  set: (v: Json) => void;
  el: () => Element | null;
  skip: () => boolean;
};

type Snapshot = { v: 1; userId: string; path: string; savedAt: number; fields: { k: string; v: Json }[] };

let seq = 0;
const entries = new Map<number, Entry>();
let pending: { values: Map<string, Json>; until: number } | null = null;

function keyFor(base: string, id: number): string {
  // Occurrence index among mounted fields with the same label, in mount order.
  let n = 0;
  for (const e of entries.values()) if (e.base === base && e.id < id) n += 1;
  return `${base}#${n}`;
}

function inPage(el: Element | null): boolean {
  if (!el) return false;
  const main = document.getElementById('main');
  return Boolean(main && main.contains(el) && !el.closest('[data-no-restore]'));
}

function readSnapshot(): Snapshot | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Snapshot;
    if (s?.v !== 1 || Date.now() - s.savedAt > MAX_AGE_MS) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function clearUnsavedWork() {
  pending = null;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function currentPath(): string {
  return window.location.pathname + window.location.search;
}

/** True when this tab holds unsaved entries waiting for the next sign-in (login page hint). */
export function hasUnsavedWork(): boolean {
  if (typeof window === 'undefined') return false;
  const s = readSnapshot();
  return Boolean(s && s.fields.length > 0);
}

/** Write the changed, non-sensitive page fields to this tab's sessionStorage. */
export function snapshotUnsavedWork(userId: string): number {
  if (typeof window === 'undefined' || !userId) return 0;
  const fields: { k: string; v: Json }[] = [];
  const sorted = [...entries.values()].sort((a, b) => a.id - b.id);
  for (const e of sorted) {
    if (e.skip() || !inPage(e.el())) continue;
    const v = e.get();
    if (JSON.stringify(v) === e.initial) continue;
    fields.push({ k: e.key, v });
  }
  try {
    if (fields.length === 0) window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, userId, path: currentPath(), savedAt: Date.now(), fields } satisfies Snapshot));
  } catch {
    return 0;
  }
  return fields.length;
}

/**
 * Restore the snapshot for this user and URL. Returns the number of values queued (0 = none).
 * Values go to fields that are mounted now and to fields that mount within a few seconds
 * (sections that only appear once an earlier field is filled in).
 */
export function restoreUnsavedWork(userId: string): number {
  const s = readSnapshot();
  if (!s || s.userId !== userId || s.path !== currentPath() || s.fields.length === 0) return 0;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  pending = { values: new Map(s.fields.map((f) => [f.k, f.v])), until: Date.now() + PENDING_WINDOW_MS };
  const sorted = [...entries.values()].sort((a, b) => a.id - b.id);
  for (const e of sorted) applyPending(e);
  return s.fields.length;
}

function applyPending(e: Entry) {
  if (!pending) return;
  if (Date.now() > pending.until) {
    pending = null;
    return;
  }
  if (!pending.values.has(e.key) || e.skip() || !inPage(e.el())) return;
  const v = pending.values.get(e.key) as Json;
  pending.values.delete(e.key);
  e.set(v);
}

export type RestorableOptions = {
  /** Label (or name) identifying the field on the page. */
  label: string;
  value: Json;
  onChange: (v: Json) => void;
  /** Never keep this field (identifiers, secrets). */
  sensitive?: boolean;
  /** Password inputs are never kept. */
  type?: string;
  disabled?: boolean;
  locked?: boolean;
};

/**
 * Register a field for G9 restore. Returns a ref for the field's root element (used to keep
 * only fields inside the page content). Cheap: one Map entry per mounted field.
 */
export function useRestorableField<T extends Element = HTMLDivElement>(o: RestorableOptions): React.RefObject<T | null> {
  const ref = React.useRef<T | null>(null);
  const latest = React.useRef(o);
  latest.current = o;

  React.useEffect(() => {
    const id = ++seq;
    const base = latest.current.label.trim() || 'field';
    const entry: Entry = {
      id,
      base,
      key: '',
      initial: JSON.stringify(latest.current.value ?? null),
      get: () => latest.current.value ?? null,
      set: (v) => latest.current.onChange(v),
      el: () => ref.current,
      skip: () => {
        const c = latest.current;
        return Boolean(c.sensitive || c.disabled || c.locked || c.type === 'password' || SENSITIVE_LABEL.test(c.label));
      },
    };
    entries.set(id, entry);
    entry.key = keyFor(base, id);
    // Deferred so the element ref is attached and earlier siblings are registered.
    const t = window.setTimeout(() => applyPending(entry), 0);
    return () => {
      window.clearTimeout(t);
      entries.delete(id);
    };
  }, []);

  return ref;
}

/** Tell the shell the session has ended (idle timeout dialog takes over). */
export function announceSessionEnded() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
}
