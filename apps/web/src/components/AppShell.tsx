import { DEMO_DISCLAIMER } from '@mediverify/shared/client';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical, LogOut, ShieldCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';

import { api } from '../lib/api';
import { qk, useConfig, useMe } from '../lib/queries';

import { BackToTop } from './BackToTop';
import { ConfirmDialog } from './ui/confirm-dialog';
import { Button } from './ui/primitives';

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const config = useConfig();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const logout = async () => {
    setSigningOut(true);
    // Even if the request fails (e.g. server down), the local session is cleared.
    await api.logout().catch(() => undefined);
    qc.clear();
    qc.setQueryData(qk.me, null);
    void navigate('/login');
  };

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-white px-3 py-2 text-sm font-medium text-brand-800 shadow focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
      <div className="bg-slate-900 px-4 py-1.5 text-center text-xs text-slate-200">
        {DEMO_DISCLAIMER}
      </div>
      {config.data?.fixtureMode && (
        <div
          className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900"
          role="status"
        >
          <FlaskConical className="h-3.5 w-3.5" aria-hidden />
          FIXTURE MODE — model outputs come from hand-authored test fixtures, not a live LLM.
          Parsing, retrieval and checks run for real.
        </div>
      )}
      {config.data && !config.data.llmConfigured && (
        <div
          className="bg-rose-100 px-4 py-1.5 text-center text-xs font-medium text-rose-900"
          role="alert"
        >
          Model unavailable: no LLM is configured on the server. Uploads will fail at the
          summarization stage until OPENAI_API_KEY is set.
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-4 px-4">
          <Link
            to="/documents"
            className="flex items-center gap-2 font-semibold text-slate-900"
            aria-label="MediVerify AI — your documents"
          >
            <ShieldCheck className="h-6 w-6 text-brand-700" aria-hidden />
            MediVerify <span className="hidden text-slate-500 sm:inline">AI</span>
          </Link>
          {me.data && (
            <div className="flex items-center gap-3">
              <span
                className="hidden max-w-60 truncate text-sm text-slate-600 sm:inline"
                title={me.data.email}
              >
                {me.data.email}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(true)}>
                <LogOut className="h-4 w-4" aria-hidden /> Sign out
              </Button>
            </div>
          )}
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            icon={<LogOut className="h-4 w-4" />}
            title="Sign out of MediVerify?"
            description="You'll return to the sign-in page. Your documents and results stay saved, and any verification in progress keeps running."
            confirmLabel="Sign out"
            onConfirm={() => void logout()}
            busy={signingOut}
            destructive
          />
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 focus:outline-none"
      >
        {children}
      </main>
      <BackToTop />
    </div>
  );
}
