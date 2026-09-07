import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { parseGateHash, sessionToken, verifyPassword } from './hash';

const SESSION_KEY = 'ot.gate';
const REMEMBER_KEY = 'ot.gate.remember';
const MAX_ATTEMPTS_BEFORE_DELAY = 5;

/** Build-time configured gate hash. Empty => gate disabled (local dev / tests). */
export const GATE_HASH_STRING: string = (import.meta.env.VITE_GATE_HASH as string | undefined) ?? '';
export const gateEnabled = () => parseGateHash(GATE_HASH_STRING) !== null;

function readToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(REMEMBER_KEY);
  } catch {
    return null;
  }
}

export function lockGate() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* storage unavailable */
  }
  window.location.reload();
}

/**
 * Client-side password gate for the static site. Renders children only after the configured
 * PBKDF2 hash has been matched; the unlock survives the tab (sessionStorage) or the device (localStorage)
 * when "remember" is ticked. Rotating VITE_GATE_HASH invalidates every stored token.
 */
export function PasswordGate({ children }: { children: ReactNode }) {
  const gate = parseGateHash(GATE_HASH_STRING);
  const [state, setState] = useState<'checking' | 'locked' | 'open'>(gate ? 'checking' : 'open');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (!gate) return;
    let cancelled = false;
    (async () => {
      const expected = await sessionToken(GATE_HASH_STRING);
      const have = readToken();
      if (!cancelled) setState(have === expected ? 'open' : 'locked');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'open') return <>{children}</>;
  if (state === 'checking') return <div className="gate-screen" data-testid="gate-checking" aria-busy="true" />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!gate || busy) return;
    setBusy(true);
    setError(null);
    // Small client-side delay after repeated failures (deterrent only; the real limit is the PBKDF2 cost).
    if (attempts >= MAX_ATTEMPTS_BEFORE_DELAY) await new Promise((r) => setTimeout(r, 1500));
    const ok = await verifyPassword(password, gate);
    if (ok) {
      const token = await sessionToken(GATE_HASH_STRING);
      try {
        sessionStorage.setItem(SESSION_KEY, token);
        if (remember) localStorage.setItem(REMEMBER_KEY, token);
      } catch {
        /* storage unavailable: unlock for this render only */
      }
      setState('open');
    } else {
      setAttempts((n) => n + 1);
      setError('비밀번호가 올바르지 않습니다. / Incorrect password.');
      setPassword('');
    }
    setBusy(false);
  };

  return (
    <div className="gate-screen" data-testid="gate-locked">
      <form className="gate-card" onSubmit={submit} aria-labelledby="gate-title">
        <div className="gate-brand" aria-hidden="true">
          OT
        </div>
        <h1 id="gate-title">Outstanding Tracker</h1>
        <p className="gate-sub">이 페이지는 비공개입니다. 접속 비밀번호를 입력하세요.</p>
        <p className="gate-sub muted">This dashboard is private. Enter the access password to continue.</p>
        <label className="gate-label" htmlFor="gate-password">
          Password
        </label>
        <input
          id="gate-password"
          className="gate-input"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'gate-error' : undefined}
        />
        <label className="gate-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> 이 기기에서 기억 (remember on this device)
        </label>
        {error && (
          <p id="gate-error" className="gate-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn primary gate-submit" disabled={busy || password.length === 0}>
          {busy ? 'Checking…' : 'Enter'}
        </button>
        <p className="gate-foot muted">Client-side access gate for a static prototype. Figures shown are mock data unless labelled otherwise.</p>
      </form>
    </div>
  );
}
