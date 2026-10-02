// Copies screenshots, brand files and the explainer video into public/ so the
// repository keeps one copy of each asset.
import { cpSync, mkdirSync } from 'node:fs';
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
console.log('assets copied');
