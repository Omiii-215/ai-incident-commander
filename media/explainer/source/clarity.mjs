import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { SCENES } from './scenes.mjs';
const key = readFileSync('.gnani.env', 'utf8').match(/GNANI_API_KEY=(.+)/)[1].trim();
const norm = (t) => t.toLowerCase().replace(/can't/g, 'cannot').replace(/[^a-z0-9 ]/g, ' ').replace(/\bfifty\b/g, '50').split(/\s+/).filter(Boolean);
function wer(ref, hyp) {
  const d = Array.from({ length: ref.length + 1 }, (_, i) => [i, ...Array(hyp.length).fill(0)]);
  for (let j = 1; j <= hyp.length; j++) d[0][j] = j;
  for (let i = 1; i <= ref.length; i++) for (let j = 1; j <= hyp.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  return d[ref.length][hyp.length] / ref.length;
}
let errs = 0, words = 0;
for (const s of SCENES.filter((x) => !process.argv[2] || x.id === process.argv[2])) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `voice/${s.id}.final.wav`, '-ar', '16000', '-ac', '1', `voice/${s.id}.16k.wav`]);
  const fd = new FormData();
  fd.append('audio_file', new Blob([readFileSync(`voice/${s.id}.16k.wav`)], { type: 'audio/wav' }), `${s.id}.wav`);
  fd.append('language_code', 'en-IN');
  let j;
  for (let a = 0; a < 5; a++) {
    const r = await fetch('https://api.vachana.ai/stt/v3', { method: 'POST', headers: { 'X-API-Key-ID': key, 'X-API-Request-ID': randomUUID() }, body: fd });
    j = await r.json();
    if (r.status !== 429) break;
    await new Promise((x) => setTimeout(x, 5000));
  }
  const ref = norm(s.say), hyp = norm(j.transcript ?? '');
  const w = wer(ref, hyp);
  errs += w * ref.length; words += ref.length;
  console.log(`${s.id.padEnd(10)} accuracy ${((1 - w) * 100).toFixed(0)}%  heard: "${j.transcript}"`);
  await new Promise((x) => setTimeout(x, 3000));
}
console.log(`overall word accuracy ${((1 - errs / words) * 100).toFixed(1)}%`);
