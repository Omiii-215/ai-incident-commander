// Pre-renders demo routes for the static showcase build only. Normal builds render on demand.
import fixture from './fixture.json';

type F = {
  workspaces: Array<{ id: string; slug: string }>;
  data: Record<string, { incidents: Record<string, unknown>; actions: Array<{ id: string }>; services: Array<{ id: string }> }>;
  reserved: { incidents: string[]; actions: string[] };
};
const FIX = fixture as unknown as F;
const DEMO = process.env.NEXT_PUBLIC_DEMO === '1';

export const workspaceParams = () => (DEMO ? FIX.workspaces.map((w) => ({ workspace: w.slug })) : []);

const wsData = (slug: string) => FIX.data[FIX.workspaces.find((w) => w.slug === slug)?.id ?? ''];

export function idParams(kind: 'incidents' | 'actions' | 'services', slug: string) {
  if (!DEMO) return [];
  const d = wsData(slug);
  const ids =
    kind === 'incidents'
      ? [...Object.keys(d?.incidents ?? {}), ...FIX.reserved.incidents]
      : kind === 'actions'
        ? [...(d?.actions ?? []).map((a) => a.id), ...FIX.reserved.actions]
        : (d?.services ?? []).map((s) => s.id);
  return ids.map((id) => ({ id }));
}
