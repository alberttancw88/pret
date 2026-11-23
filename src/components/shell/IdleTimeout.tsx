'use client';

// Idle timeout (S-GL-11, F-ADM-14) — wireframes.md G9, interaction-notes §3/§6,
// components.md §7.5. Timeout per user (`idleTimeoutMin`: 15 ADM/SA, 30 others).
// - Activity in any tab resets the timer; while active, keepAlive() refreshes the server's
//   last_seen_at at most every few minutes (typing in a form never hits the server otherwise).
// - 2 minutes before: non-dismissible warning with a live countdown
//   (announced at 2:00, 1:00, 0:30) · [SIGN OUT] [STAY SIGNED IN].
// - At 0: sign out and show "Your session has ended. Sign in again to continue."
//   The page is left as it is behind the dialog (form values stay on screen), and the fields
//   the user changed are kept in this tab's sessionStorage (forms/unsaved.ts — never
//   passwords or identifiers) so they come back after SIGN IN returns to the same URL.
// - A Server Action answering "Your session has ended" raises the same dialog (G9).
import * as React from 'react';
import { usePathname } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { keepAlive, signOut } from '@/server/actions/auth';
import { currentPath, SESSION_ENDED_EVENT, snapshotUnsavedWork } from '../forms/unsaved';

const WARN_MS = 2 * 60 * 1000;
const KEEPALIVE_EVERY_MS = 4 * 60 * 1000;
const STORAGE_KEY = 'pret.lastActivity';
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

function fmt(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function readShared(): number {
  try {
    return Number(window.localStorage.getItem(STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}
function writeShared(t: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(t));
  } catch {
    /* storage unavailable — per-tab timer still works */
  }
}

export default function IdleTimeout({ idleTimeoutMin, userId }: { idleTimeoutMin: number; userId: string }) {
  const pathname = usePathname() ?? '/';
  const [kept, setKept] = React.useState(0);
  const [returnTo, setReturnTo] = React.useState<string>(pathname);
  const [timeoutMs, setTimeoutMs] = React.useState(Math.max(3, idleTimeoutMin) * 60 * 1000);
  const [phase, setPhase] = React.useState<'active' | 'warning' | 'ended'>('active');
  const [remaining, setRemaining] = React.useState(WARN_MS);
  const [announce, setAnnounce] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const lastActivity = React.useRef(Date.now());
  const lastKeepAlive = React.useRef(Date.now());
  const phaseRef = React.useRef(phase);
  phaseRef.current = phase;
  const announced = React.useRef<Set<number>>(new Set());

  const endSession = React.useCallback(async () => {
    if (phaseRef.current === 'ended') return;
    phaseRef.current = 'ended';
    setReturnTo(currentPath());
    setKept(snapshotUnsavedWork(userId));
    setPhase('ended');
    try {
      await signOut();
    } catch {
      /* already signed out server-side */
    }
  }, [userId]);

  // A Server Action found the session gone (useActionRunner raises the event).
  React.useEffect(() => {
    const onEnded = () => void endSession();
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
  }, [endSession]);

  const ping = React.useCallback(async () => {
    lastKeepAlive.current = Date.now();
    try {
      const res = await keepAlive();
      if (!res.ok) {
        void endSession();
        return false;
      }
      setTimeoutMs(Math.max(3, res.idleTimeoutMin) * 60 * 1000);
      return true;
    } catch {
      return true; // network blip: keep the local timer; the server stays authoritative
    }
  }, [endSession]);

  // Activity tracking (only while active — the warning must be answered explicitly).
  React.useEffect(() => {
    const onActivity = () => {
      if (phaseRef.current !== 'active') return;
      const now = Date.now();
      lastActivity.current = now;
      if (now - readShared() > 5000) writeShared(now);
      if (now - lastKeepAlive.current > KEEPALIVE_EVERY_MS) void ping();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        const t = Number(e.newValue);
        if (t > lastActivity.current) lastActivity.current = t;
        if (phaseRef.current === 'warning' && t > Date.now() - 5000) setPhase('active'); // answered in another tab
      }
    };
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    window.addEventListener('storage', onStorage);
    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity));
      window.removeEventListener('storage', onStorage);
    };
  }, [ping]);

  // Navigation is activity too (and the server already saw the request).
  React.useEffect(() => {
    lastActivity.current = Date.now();
    lastKeepAlive.current = Date.now();
  }, [pathname]);

  // 1 s tick.
  React.useEffect(() => {
    const id = window.setInterval(() => {
      if (phaseRef.current === 'ended') return;
      const last = Math.max(lastActivity.current, readShared());
      const left = last + timeoutMs - Date.now();
      if (left <= 0) {
        void endSession();
        return;
      }
      if (left <= WARN_MS) {
        if (phaseRef.current !== 'warning') {
          announced.current = new Set();
          setPhase('warning');
        }
        setRemaining(left);
        const secs = Math.ceil(left / 1000);
        for (const mark of [120, 60, 30]) {
          if (secs <= mark && !announced.current.has(mark)) {
            announced.current.add(mark);
            setAnnounce(`You'll be signed out in ${fmt(mark * 1000)} for inactivity.`);
          }
        }
      } else if (phaseRef.current === 'warning') {
        setPhase('active');
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [timeoutMs, endSession]);

  const stay = async () => {
    setBusy(true);
    const ok = await ping();
    setBusy(false);
    if (ok) {
      const now = Date.now();
      lastActivity.current = now;
      writeShared(now);
      setPhase('active');
    }
  };

  const signOutNow = async () => {
    setBusy(true);
    phaseRef.current = 'ended'; // a deliberate sign-out keeps nothing
    try {
      await signOut();
    } catch {
      /* ignore */
    }
    window.location.assign('/login');
  };

  const loginHref = `/login?expired=1&next=${encodeURIComponent(returnTo)}`;

  return (
    <>
      <Dialog
        open={phase === 'warning'}
        maxWidth="xs"
        fullWidth
        disableEscapeKeyDown
        onClose={() => undefined}
        aria-labelledby="idle-title"
        aria-describedby="idle-body"
      >
        <DialogTitle id="idle-title" component="h2">
          Still there?
        </DialogTitle>
        <DialogContent>
          <Typography id="idle-body" variant="body1">
            You&apos;ll be signed out in <span className="pret-tnum">{fmt(remaining)}</span> for inactivity.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" color="inherit" onClick={signOutNow} disabled={busy}>
            Sign out
          </Button>
          <Button variant="contained" onClick={stay} loading={busy} autoFocus>
            Stay signed in
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={phase === 'ended'} maxWidth="xs" fullWidth disableEscapeKeyDown onClose={() => undefined} aria-labelledby="ended-title">
        <DialogTitle id="ended-title" component="h2">
          Your session has ended
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1">Sign in again to continue.</Typography>
          {kept > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Your unsaved entries on this page are kept on this device and will be filled in again after you sign in
              (passwords and identity or bank numbers are never kept).
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="contained" href={loginHref} autoFocus>
            Sign in
          </Button>
        </DialogActions>
      </Dialog>

      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {phase === 'warning' ? announce : ''}
      </Box>
    </>
  );
}

const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const;
