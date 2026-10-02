'use client';

import type { ActionStatus, IncidentStatus, ServiceHealth, Severity } from '@aic/contracts';
import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { label } from '@/lib/format';
import { Icon } from './icons';

type Tone = 'danger' | 'warning' | 'info' | 'success' | 'neutral' | 'accent';

const TONE: Record<Tone, string> = {
  danger: 'bg-danger-surface text-danger border-danger/40',
  warning: 'bg-warning-surface text-warning border-warning/40',
  info: 'bg-info-surface text-info border-info/40',
  success: 'bg-success-surface text-success border-success/40',
  neutral: 'bg-neutral-surface text-neutral border-line',
  accent: 'bg-info-surface text-accent border-accent/40',
};

export function Badge({ tone, icon, children, title }: { tone: Tone; icon?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`badge inline-flex max-w-full shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-medium leading-5 ${TONE[tone]}`}>
      {icon && <Icon name={icon} size={16} />}
      <span className="break-normal [overflow-wrap:normal]">{children}</span>
    </span>
  );
}

// Severity and lifecycle are separate fields with distinct shapes, icons and labels.
const SEVERITY: Record<Severity, { tone: Tone; text: string }> = {
  sev1: { tone: 'danger', text: 'SEV1 Critical' },
  sev2: { tone: 'warning', text: 'SEV2 High' },
  sev3: { tone: 'info', text: 'SEV3 Medium' },
  sev4: { tone: 'neutral', text: 'SEV4 Low' },
};
// Square corners distinguish severity from rounded lifecycle pills; readable in monochrome.
export const SeverityBadge = ({ severity }: { severity: Severity }) => (
  <span className={`badge inline-flex shrink-0 items-center gap-1 rounded-[4px] border px-2 py-0.5 text-sm font-semibold leading-5 ${TONE[SEVERITY[severity].tone]}`}>
    <Icon name={severity} size={16} />
    <span className="whitespace-nowrap">{SEVERITY[severity].text}</span>
  </span>
);

const STATUS_TONE: Record<IncidentStatus, Tone> = {
  declared: 'warning',
  investigating: 'info',
  mitigating: 'info',
  monitoring: 'accent',
  resolved: 'success',
};
export const StatusBadge = ({ status }: { status: IncidentStatus }) => (
  <Badge tone={STATUS_TONE[status]} icon={status === 'resolved' ? 'check' : status === 'declared' ? 'incidents' : 'clock'}>
    {label(status)}
  </Badge>
);

const ACTION_TONE: Record<ActionStatus, { tone: Tone; icon: string; text: string }> = {
  proposed: { tone: 'neutral', icon: 'dot', text: 'Proposed' },
  awaiting_approval: { tone: 'warning', icon: 'clock', text: 'Awaiting approval' },
  approved: { tone: 'info', icon: 'check', text: 'Approved' },
  queued: { tone: 'info', icon: 'clock', text: 'Approved · queued' },
  executing: { tone: 'info', icon: 'clock', text: 'Executing' },
  succeeded: { tone: 'success', icon: 'check', text: 'Succeeded' },
  failed: { tone: 'danger', icon: 'x', text: 'Failed' },
  rejected: { tone: 'neutral', icon: 'x', text: 'Rejected' },
  expired: { tone: 'neutral', icon: 'clock', text: 'Expired' },
  cancelled: { tone: 'neutral', icon: 'x', text: 'Cancelled' },
  outcome_unknown: { tone: 'warning', icon: 'question', text: 'Outcome unknown' },
};
export const ActionStatusBadge = ({ status }: { status: ActionStatus }) => (
  <Badge tone={ACTION_TONE[status].tone} icon={ACTION_TONE[status].icon}>
    {ACTION_TONE[status].text}
  </Badge>
);

const HEALTH: Record<ServiceHealth, { tone: Tone; icon: string }> = {
  healthy: { tone: 'success', icon: 'check' },
  degraded: { tone: 'warning', icon: 'sev2' },
  unhealthy: { tone: 'danger', icon: 'sev1' },
  unknown: { tone: 'neutral', icon: 'question' },
};
export const HealthBadge = ({ status }: { status: ServiceHealth }) => (
  <Badge tone={HEALTH[status].tone} icon={HEALTH[status].icon}>
    {label(status)}
  </Badge>
);

export const SimulationBadge = () => (
  <Badge tone="accent" icon="flask" title="Simulator only. No production resources change.">
    Simulation
  </Badge>
);

export const AiBadge = () => (
  <Badge tone="accent" icon="spark">
    AI suggestion
  </Badge>
);

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-accent-fill text-on-accent border-accent-fill hover:opacity-90',
  secondary: 'bg-surface text-fg border-line-control hover:bg-surface-hover',
  danger: 'bg-surface text-danger border-danger hover:bg-danger-surface',
  ghost: 'bg-transparent text-fg border-transparent hover:bg-surface-hover',
};

export function Button({
  variant = 'secondary',
  pending,
  pendingLabel,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; pending?: boolean; pendingLabel?: string }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || pending}
      aria-busy={pending || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-[6px] border px-4 py-2 text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55 sm:min-h-10 ${BTN[variant]} ${className}`}
    >
      {pending ? (pendingLabel ?? 'Working…') : children}
    </button>
  );
}

export function Card({ title, actions, children, className = '', as: As = 'section', meta }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; as?: 'section' | 'div' | 'article'; meta?: ReactNode }) {
  return (
    <As className={`card min-w-0 rounded-[10px] border border-line bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-semibold leading-6">{title}</h2>}
            {meta && <p className="text-sm text-fg-muted">{meta}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </As>
  );
}

export function Banner({ tone, title, children, action }: { tone: 'info' | 'warning' | 'danger' | 'success'; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`flex flex-wrap items-start justify-between gap-3 rounded-[10px] border px-4 py-3 ${TONE[tone]}`}>
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        {children && <div className="text-sm">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ lines = 3, label: l = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div role="status" aria-label={l} className="space-y-3">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton h-5" style={{ width: `${90 - i * 12}%` }} />
      ))}
      <span className="sr-only">{l}…</span>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[10px] border border-dashed border-line-control px-4 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-fg-secondary">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'This section could not load.' }: { error: unknown; onRetry?: () => void; title?: string }) {
  const e = error instanceof ApiError ? error : null;
  if (e?.status === 403) {
    return <Banner tone="warning" title="You do not have access to this view.">{e.message}</Banner>;
  }
  if (e?.status === 404) {
    return <Banner tone="warning" title="This item is unavailable.">It may not exist, or you may not have access to it.</Banner>;
  }
  return (
    <Banner tone="danger" title={title} action={onRetry && <Button onClick={onRetry}>Retry</Button>}>
      {e?.message ?? 'Unexpected error.'}
      {e?.requestId && <span className="block font-mono text-xs">Reference: {e.requestId}</span>}
    </Banner>
  );
}

export function Field({ id, label: l, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {l}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-fg-muted">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  'min-h-11 w-full min-w-0 rounded-[6px] border border-line-control bg-surface px-3 py-2 text-base text-fg placeholder:text-fg-muted aria-[invalid=true]:border-danger';

export function TextLink({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={`text-accent underline underline-offset-2 hover:no-underline ${className}`}>
      {children}
    </Link>
  );
}

export function Time({ iso, withDate }: { iso: string | null | undefined; withDate?: boolean }) {
  if (!iso) return <span>Unavailable</span>;
  const d = new Date(iso);
  return (
    <time dateTime={iso} title={d.toISOString()} className="tabular">
      {withDate ? `${iso.slice(0, 10)} ` : ''}
      {iso.slice(11, 16)} UTC
    </time>
  );
}

export function CommandError({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  const hint =
    e?.status === 412
      ? 'Someone changed this item. The view has been refreshed — review it and submit again.'
      : e?.code === 'IDEMPOTENCY_CONFLICT'
        ? 'This request conflicted with an earlier one. Refresh and try again.'
        : e?.uncertain
          ? 'The response was lost. Refresh to see whether the change was applied before retrying.'
          : null;
  return (
    <div role="alert" className="rounded-[6px] border border-danger/40 bg-danger-surface px-3 py-2 text-sm text-danger">
      <p className="font-semibold">{e?.message ?? 'The command failed.'}</p>
      {hint && <p>{hint}</p>}
      {e?.requestId && <p className="font-mono text-xs">Reference: {e.requestId}</p>}
    </div>
  );
}
