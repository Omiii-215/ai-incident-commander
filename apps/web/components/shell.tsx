'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, setCsrfToken } from '@/lib/api';
import { utcTime } from '@/lib/format';
import { StreamProvider, useStream, type ConnectionState } from '@/lib/realtime';
import { useWorkspace, WorkspaceProvider } from '@/lib/workspace';
import { Icon } from './icons';
import { Logo, LogoMark } from './logo';
import { DemoBanner } from './demo-banner';
import { Skeleton } from './ui';

type NavItem = { href: string; label: string; icon: string; op: string };

const NAV: NavItem[] = [
  { href: 'overview', label: 'Overview', icon: 'overview', op: 'read' },
  { href: 'incidents', label: 'Incidents', icon: 'incidents', op: 'read' },
  { href: 'services', label: 'Services', icon: 'services', op: 'read' },
  { href: 'approvals', label: 'Approvals', icon: 'approvals', op: 'action.queue.read' },
  { href: 'runbooks', label: 'Runbooks', icon: 'runbooks', op: 'read' },
  { href: 'audit', label: 'Audit log', icon: 'audit', op: 'audit.read' },
];
const FOOTER_NAV: NavItem[] = [
  { href: 'settings/plugins', label: 'Settings', icon: 'settings', op: 'plugin.manage' },
  { href: 'help', label: 'Help', icon: 'question', op: 'read' },
];

export function WorkspaceShell({ slug, children }: { slug: string; children: ReactNode }) {
  return (
    <WorkspaceProvider
      slug={slug}
      fallback={
        <div className="p-6">
          <Skeleton label="Loading workspace" />
        </div>
      }
    >
      {({ workspace }) => (
        <StreamProvider key={workspace.id} workspaceId={workspace.id}>
          <Frame>{children}</Frame>
        </StreamProvider>
      )}
    </WorkspaceProvider>
  );
}

function NavList({ items, compact, onNavigate }: { items: NavItem[]; compact?: boolean; onNavigate?: () => void }) {
  const { base } = useWorkspace();
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const href = `${base}/${item.href}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <li key={item.href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              title={compact ? item.label : undefined}
              className={`group relative flex min-h-11 items-center gap-3 rounded-[6px] px-3 text-base ${active ? 'bg-info-surface font-semibold text-accent' : 'text-fg-secondary hover:bg-surface-hover hover:text-fg'} ${compact ? 'justify-center px-0' : ''}`}
            >
              <Icon name={item.icon} />
              {compact ? (
                // Visible label on hover/focus; always present for assistive tech.
                <span className="pointer-events-none absolute left-full z-20 ml-2 hidden whitespace-nowrap rounded-[6px] border border-line bg-surface px-2 py-1 text-sm text-fg shadow-sm group-hover:block group-focus-visible:block">
                  {item.label}
                </span>
              ) : (
                <span>{item.label}</span>
              )}
              {compact && <span className="sr-only">{item.label}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const CONNECTION: Record<ConnectionState, { text: string; tone: string }> = {
  connecting: { text: 'Connecting', tone: 'text-fg-secondary border-line' },
  live: { text: 'Live', tone: 'text-success border-success/50 bg-success-surface' },
  reconnecting: { text: 'Reconnecting', tone: 'text-warning border-warning/50 bg-warning-surface' },
  delayed: { text: 'Updates delayed', tone: 'text-warning border-warning/50 bg-warning-surface' },
  polling: { text: 'Updates delayed', tone: 'text-warning border-warning/50 bg-warning-surface' },
  offline: { text: 'Offline', tone: 'text-danger border-danger/50 bg-danger-surface' },
  signed_out: { text: 'Signed out', tone: 'text-danger border-danger/50 bg-danger-surface' },
};

function ConnectionStatus() {
  const { state, lastSnapshotAt, reconnect } = useStream();
  const c = CONNECTION[state];
  return (
    <div className="flex items-center gap-2">
      <span className={`badge inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-medium ${c.tone}`} title={lastSnapshotAt ? `Last confirmed snapshot ${utcTime(lastSnapshotAt)}` : undefined}>
        <Icon name={state === 'live' ? 'dot' : state === 'offline' ? 'x' : 'clock'} size={16} />
        <span>{c.text}</span>
        <span className="sr-only">{lastSnapshotAt ? `, last confirmed update ${utcTime(lastSnapshotAt)}` : ''}</span>
      </span>
      {(state === 'polling' || state === 'reconnecting') && (
        <button type="button" onClick={reconnect} className="min-h-11 rounded-[6px] px-2 text-sm text-accent underline">
          Retry
        </button>
      )}
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);
  useEffect(() => setTheme((document.documentElement.dataset.theme as 'light' | 'dark') ?? 'light'), []);
  if (!theme) return null;
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="min-h-11 rounded-[6px] px-2 text-sm text-fg-secondary hover:bg-surface-hover"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem('aic-theme', next); // only nonsecret preference is persisted
        } catch {
          /* storage unavailable */
        }
        setTheme(next);
      }}
    >
      {next === 'dark' ? 'Dark theme' : 'Light theme'}
    </button>
  );
}

function AccountMenu() {
  const { me, workspace } = useWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <details className="relative">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[6px] px-2 hover:bg-surface-hover">
        <span className="inline-flex size-8 items-center justify-center rounded-full bg-info-surface text-sm font-semibold text-info" aria-hidden>
          {me.user.displayName.slice(0, 1)}
        </span>
        <span className="hidden max-w-40 truncate sm:inline">{me.user.displayName}</span>
        <span className="sr-only">Account menu</span>
      </summary>
      <div className="absolute right-0 z-30 mt-1 w-64 rounded-[10px] border border-line bg-surface p-3 shadow-md">
        <p className="font-semibold">{me.user.displayName}</p>
        <p className="text-sm text-fg-secondary">
          {workspace.name} · {workspace.roles.join(', ')}
        </p>
        {me.workspaces.length > 1 && (
          <div className="mt-2 border-t border-line pt-2">
            <p className="text-sm text-fg-muted">Switch workspace</p>
            {me.workspaces
              .filter((w) => w.id !== workspace.id)
              .map((w) => (
                <Link key={w.id} href={`/w/${w.slug}/overview`} className="block min-h-11 py-2 text-accent underline">
                  {w.name}
                </Link>
              ))}
          </div>
        )}
        <button
          type="button"
          disabled={busy}
          className="mt-2 min-h-11 w-full rounded-[6px] border border-line-control px-3 text-left hover:bg-surface-hover"
          onClick={async () => {
            setBusy(true);
            try {
              await api.post('/auth/logout');
            } finally {
              setCsrfToken(null);
              qc.clear(); // close stream, drop caches and drafts
              router.replace('/login');
            }
          }}
        >
          Sign out
        </button>
      </div>
    </details>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { workspace, can } = useWorkspace();
  const { state } = useStream();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const items = NAV.filter((n) => can(n.op));
  const footer = FOOTER_NAV.filter((n) => can(n.op));

  useEffect(() => {
    if (state === 'signed_out') router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }, [state, router]);

  const closeMenu = () => {
    dialog.current?.close();
    menuButton.current?.focus(); // return focus
  };

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-[6px] focus:bg-surface focus:px-3 focus:py-2">
        Skip to main content
      </a>

      {/* Desktop sidebar (>=1024) */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-surface lg:flex" aria-label="Primary">
        <div className="flex h-14 items-center border-b border-line px-4">
          <Logo size={30} />
        </div>
        <nav aria-label="Primary navigation" className="flex flex-1 flex-col justify-between p-3">
          <NavList items={items} />
          <NavList items={footer} />
        </nav>
      </aside>

      {/* Tablet rail (768–1023) */}
      <aside className="fixed inset-y-0 left-0 hidden w-[72px] flex-col border-r border-line bg-surface md:flex lg:hidden" aria-label="Primary">
        <div className="flex h-14 items-center justify-center border-b border-line">
          <LogoMark size={30} />
          <span className="sr-only">AI Incident Commander</span>
        </div>
        <nav aria-label="Primary navigation" className="flex flex-1 flex-col justify-between p-2">
          <NavList items={items} compact />
          <NavList items={footer} compact />
        </nav>
      </aside>

      <div className="md:pl-[72px] lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b border-line bg-surface px-4 md:h-[72px] md:px-6 lg:h-14">
          <div className="flex min-w-0 items-center gap-2">
            <button
              ref={menuButton}
              type="button"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[6px] hover:bg-surface-hover lg:hidden"
              aria-haspopup="dialog"
              onClick={() => dialog.current?.showModal()}
            >
              <Icon name="menu" />
              <span className="sr-only">Menu</span>
            </button>
            <p className="min-w-0 truncate font-semibold">
              {workspace.name} <span className="font-normal text-fg-muted">· demo</span>
            </p>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <ConnectionStatus />
            <span className="hidden sm:inline">
              <ThemeToggle />
            </span>
            <AccountMenu />
          </div>
        </header>
        {process.env.NEXT_PUBLIC_DEMO === '1' && <DemoBanner />}
        {workspace.dispatchStopped && (
          <div role="status" className="border-b border-warning/40 bg-warning-surface px-4 py-2 text-sm text-warning md:px-6">
            Action dispatch is stopped for this workspace. Approved requests will not execute until a commander or admin resumes dispatch.
          </div>
        )}
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1680px] px-4 py-6 sm:px-5 md:px-6 xl:px-8">
          {children}
        </main>
      </div>

      {/* Compact/tablet full menu */}
      <dialog
        ref={dialog}
        aria-label="Navigation menu"
        className="m-0 h-dvh max-h-none w-full max-w-sm bg-surface p-0 text-fg backdrop:bg-black/40"
        onClick={(e) => e.target === dialog.current && closeMenu()}
      >
        <div className="flex h-14 items-center justify-between border-b border-line px-4">
          <span className="font-semibold">Menu</span>
          <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[6px] hover:bg-surface-hover" onClick={closeMenu}>
            <Icon name="close" />
            <span className="sr-only">Close menu</span>
          </button>
        </div>
        <nav aria-label="Primary navigation" className="space-y-4 p-3">
          <NavList items={items} onNavigate={closeMenu} />
          <div className="border-t border-line pt-3">
            <NavList items={footer} onNavigate={closeMenu} />
          </div>
          <ThemeToggle />
        </nav>
      </dialog>
    </div>
  );
}
