import { useId } from 'react';

/** Brand mark: a shield (safety and human approval) carrying a heartbeat line (live incidents). */
export function LogoMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" className={`shrink-0 ${className}`}>
      <defs>
        <linearGradient id={`g${id}`} x1="10" y1="3" x2="54" y2="61" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset=".52" stopColor="#6366f1" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <path d="M32 3 7 12.2v17.6C7 45.4 17.6 56.6 32 61c14.4-4.4 25-15.6 25-31.2V12.2L32 3z" fill={`url(#g${id})`} />
      <path d="M14.5 33.5h8.2l4.3-9.6 6.3 17.4 4.9-11.1 2.9 3.3h8.4" fill="none" stroke="#fff" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="flex flex-col leading-none">
        <span className="text-[0.65rem] font-bold tracking-[0.2em] text-accent">AI</span>
        <span className="font-bold tracking-tight">Incident Commander</span>
      </span>
    </span>
  );
}
