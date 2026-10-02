// Copies screenshots, brand files and the explainer video into public/ so the
// repository keeps one copy of each asset.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(site, '../..');
const pub = path.join(site, 'public');
mkdirSync(path.join(pub, 'media'), { recursive: true });
cpSync(path.join(root, 'docs/images'), path.join(pub, 'images'), { recursive: true });
cpSync(path.join(root, 'docs/brand'), path.join(pub, 'brand'), { recursive: true });
for (const f of ['ai-incident-commander-explainer.mp4', 'poster.jpg', 'captions.vtt']) {
  cpSync(path.join(root, 'media/explainer', f), path.join(pub, 'media', f));
}
cpSync(path.join(root, 'docs/brand/favicon.svg'), path.join(site, 'app/icon.svg'));
cpSync(path.join(root, 'docs/brand/favicon.ico'), path.join(site, 'app/favicon.ico'));
cpSync(path.join(root, 'docs/brand/apple-touch-icon.png'), path.join(site, 'app/apple-icon.png'));
// Interactive demo: the real dashboard built as static files (apps/web, `pnpm --filter @aic/web build:demo`).
const demo = path.join(root, 'apps/web/out-demo');
if (!existsSync(path.join(demo, 'index.html'))) {
  throw new Error('Demo build missing. Run: cd apps/web && npm run build:demo');
}
rmSync(path.join(pub, 'demo'), { recursive: true, force: true });
cpSync(demo, path.join(pub, 'demo'), { recursive: true, filter: (src) => !/[\\/](cache|types|server|diagnostics|trace)([\\/]|$)/.test(src.slice(demo.length)) });
console.log('assets copied');
