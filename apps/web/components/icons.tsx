// Minimal inline icon set (no remote assets). Decorative icons are aria-hidden;
// meaning is always carried by adjacent text.

const PATHS: Record<string, string> = {
  overview: 'M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 14h7v7H3z',
  incidents: 'M12 3 2 20h20L12 3zm0 6v5m0 3v.01',
  services: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  approvals: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3zm-3 9 2 2 4-4',
  runbooks: 'M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4zm14 13H7',
  audit: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm8 3-2-1 .5-2.3-2-1.2-1.7 1.6-2.3-1L12 3h-1l-.5 2.1-2.3 1L6.5 4.5l-2 1.2L5 8l-2 1v2l2 1-.5 2.3 2 1.2 1.7-1.6 2.3 1L11 21h2l.5-2.1 2.3-1 1.7 1.6 2-1.2L19 16l2-1z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6 6 18',
  sev1: 'M8 2h8l6 6v8l-6 6H8l-6-6V8zM12 7v6m0 3v.01',
  sev2: 'M12 3 2 20h20L12 3zm0 6v5m0 3v.01',
  sev3: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5v5m0 3v.01',
  sev4: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  check: 'M5 12l4 4 10-10',
  x: 'M6 6l12 12M18 6 6 18',
  question: 'M9 9a3 3 0 1 1 4 2.8c-.6.3-1 .9-1 1.6V14m0 3v.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3 2',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  flask: 'M9 3h6M10 3v6L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-10V3',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  pause: 'M8 5v14M16 5v14',
  dot: 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
};

export function Icon({ name, size = 20, className = '' }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <path d={PATHS[name] ?? PATHS.dot} />
    </svg>
  );
}
