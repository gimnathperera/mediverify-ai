import { DEMO_DISCLAIMER } from '@mediverify/shared';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical, LogOut, ShieldCheck } from 'lucide-react';
import type * as React from 'react';
import { Link, useNavigate } from 'react-router';

import { api } from '../lib/api';
import { qk, useConfig, useMe } from '../lib/queries';

import { Button } from './ui/primitives';

export function AppShell({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const config = useConfig();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const logout = async () => {
    await api.logout().catch(() => undefined);
    qc.clear();
    qc.setQueryData(qk.me, null);
    void navigate('/login');
  };

  return (
    <div className="flex min-h-screen flex-col">
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
          <Link to="/documents" className="flex items-center gap-2 font-semibold text-slate-900">
            <ShieldCheck className="h-6 w-6 text-brand-700" aria-hidden />
            MediVerify <span className="hidden text-slate-400 sm:inline">AI</span>
          </Link>
          {me.data && (
            <div className="flex items-center gap-3">
              <span
                className="hidden max-w-[240px] truncate text-sm text-slate-600 sm:inline"
                title={me.data.email}
              >
                {me.data.email}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void logout()}>
                <LogOut className="h-4 w-4" aria-hidden /> Sign out
              </Button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
