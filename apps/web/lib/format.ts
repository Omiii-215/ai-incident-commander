// Time is UTC internally and localized at the UI boundary. Relative times
// always come with an absolute time and visible timezone (UI_DESIGN_SYSTEM §3).

export function utcTime(iso: string | null | undefined, withDate = false): string {
  if (!iso) return 'Unavailable';
  const d = new Date(iso);
  const time = d.toISOString().slice(11, 16);
  return withDate ? `${d.toISOString().slice(0, 10)} ${time} UTC` : `${time} UTC`;
}

export function relative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'Unavailable';
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? 'ago' : 'from now';
  if (abs < 45) return diff >= 0 ? 'just now' : 'in a moment';
  if (abs < 3600) return `${Math.round(abs / 60)} min ${suffix}`;
  if (abs < 86400) {
    const h = Math.floor(abs / 3600);
    const m = Math.round((abs % 3600) / 60);
    return `${h} h${m ? ` ${m} min` : ''} ${suffix}`;
  }
  return `${Math.round(abs / 86400)} d ${suffix}`;
}

export const whenText = (iso: string | null | undefined) => (iso ? `${relative(iso)} · ${utcTime(iso, Date.now() - new Date(iso).getTime() > 86400_000)}` : 'Unavailable');

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m ? `${m} min ${String(sec).padStart(2, '0')} s` : `${sec} s`;
}

export const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
