'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useWorkspace } from '@/lib/workspace';

/** Shown only in the public showcase build, where the API runs in the browser. */
export function DemoBanner() {
  const { workspace, me } = useWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const sendAlert = async () => {
    setBusy(true);
    const { demoSendAlert } = await import('@/lib/demo/server');
    const res = await demoSendAlert(workspace.id);
    setBusy(false);
    setNote(res.ok ? 'A new alert arrived. Watch it appear live, then open it.' : 'The demo limit was reached. Use Reset demo.');
  };
  const switchPerson = async () => {
    const { demoFetch } = await import('@/lib/demo/server');
    await demoFetch('POST', '/auth/logout', {});
    qc.clear();
    router.replace('/login');
  };
  const reset = async () => {
    const { resetDemo } = await import('@/lib/demo/server');
    resetDemo();
    qc.clear();
    router.replace('/login');
  };

  const btn = 'min-h-10 rounded-[6px] border border-info/40 bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-hover disabled:opacity-60';
  return (
    <div role="region" aria-label="Demo controls" className="border-b border-info/30 bg-info-surface px-4 py-2 text-sm text-info md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0">
          <strong>Live demo</strong> as {me.user.displayName}. Sample data, simulated fixes, runs only in your browser.
          {note && <span className="ml-1" role="status">{note}</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={() => void sendAlert()} disabled={busy}>
            {busy ? 'Sending…' : 'Send a test alert'}
          </button>
          <button type="button" className={btn} onClick={() => void switchPerson()}>
            Switch person
          </button>
          <button type="button" className={btn} onClick={() => void reset()}>
            Reset demo
          </button>
          <a className={`${btn} inline-flex items-center`} href="/" target="_top">
            Back to site
          </a>
        </div>
      </div>
    </div>
  );
}
