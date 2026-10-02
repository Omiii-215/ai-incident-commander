// Motion-graphics render: footage + animated stage → per-scene MP4 → crossfaded film with narration and subtitles.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { assertNoDashes, SCENES } from './scenes.mjs';

const DIR = new URL('.', import.meta.url).pathname;
const OUT = `${DIR}out/`;
mkdirSync(`${OUT}scenes`, { recursive: true });
const FPS = 30;
const X = 0.6; // crossfade between scenes
const VOICE = JSON.parse(readFileSync(`${DIR}voice/durations.json`, 'utf8'));
const args = process.argv.slice(2);
const ONLY = args.find((a) => !a.startsWith('--'));
const PREVIEW = args.includes('--preview'); // render a few stills only
const POOL = 5;

assertNoDashes(readFileSync(`${DIR}stage.html`, 'utf8'), 'stage.html');

// ---- footage frames --------------------------------------------------------
const footageNames = SCENES.filter((s) => s.footage).map((s) => s.footage);
for (const n of footageNames) {
  const dir = `${DIR}frames/${n}`;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    execFileSync('ffmpeg', ['-v', 'error', '-i', `${DIR}footage/${n}.webm`, '-vf', `fps=${FPS}`, '-q:v', '2', `${dir}/%05d.jpg`]);
  }
}
const marks = (n) => JSON.parse(readFileSync(`${DIR}footage/${n}.json`, 'utf8')).marks;
const rectOf = (n, label) => marks(n).find((m) => m.label === label)?.rect;

// ---- camera focus events (times are scene-local seconds) ----------------------
const FOCUS = {
  overview: [{ rect: rectOf('overview', 'metric-updated'), start: 5.6, hold: 1.2, zoom: 1.6, label: 'Updates live' }],
  incidents: [{ rect: { x: 273, y: 384, w: 470, h: 330 }, start: 3.4, hold: 3.4, zoom: 1.45, label: 'Grouped and sorted' }],
  ack: [
    { rect: rectOf('ack', 'ack-button'), start: 1.9, hold: 1.0, zoom: 1.7, label: 'Acknowledge' },
    { rect: rectOf('ack', 'status'), start: 4.6, hold: 2.6, zoom: 1.8, label: 'Now investigating' },
  ],
  diagnosis: [
    { rect: rectOf('diagnosis', 'summary'), start: 2.3, hold: 4.6, zoom: 1.45, label: 'Likely cause' },
    { rect: rectOf('diagnosis', 'proof'), start: 11.6, hold: 2.6, zoom: 1.5, label: 'Proof for every point' },
  ],
  secrets: [{ rect: rectOf('secrets', 'redacted'), start: 2.1, hold: 4.4, zoom: 1.45, label: 'Secrets hidden' }],
  request: [
    { rect: rectOf('request', 'submit'), start: 7.0, hold: 0.6, zoom: 1.6, label: 'Send as a request' },
    { rect: rectOf('request', 'blocked'), start: 11.5, hold: 1.9, zoom: 1.8, label: "Can't approve your own request" },
  ],
  approve: [{ rect: rectOf('approve', 'approve-button'), start: 5.6, hold: 4.8, zoom: 1.35, label: 'A second person approves', below: true }],
  run: [
    { rect: rectOf('run', 'success'), start: 0.6, hold: 2.4, zoom: 1.3, label: 'It ran once, and it worked' },
    { rect: rectOf('run', 'record'), start: 5.9, hold: 0.4, zoom: 1.3, label: 'Receipt saved' },
  ],
};
assertNoDashes(FOCUS, 'callouts');

// ---- timeline -----------------------------------------------------------------
const LEAD = { intro: 1.9, outro: 0.9 };
const TAIL = { approve: 2.4, outro: 2.6 };
let numbering = 0;
let cursor = 0;
const timeline = SCENES.map((s) => {
  const lead = LEAD[s.id] ?? 0.6;
  const tail = TAIL[s.id] ?? 1.1;
  const speech = VOICE[s.id].duration;
  const duration = lead + speech + tail;
  const absStart = cursor;
  cursor += duration - X;
  const layout = s.kind ?? (s.footage === 'phone' ? 'phone' : 'footage');
  const num = ['intro', 'outro'].includes(s.id) ? '' : String(++numbering).padStart(2, '0');
  const frames = s.footage ? { dir: `file://${DIR}frames/${s.footage}`, count: readdirSync(`${DIR}frames/${s.footage}`).length } : undefined;
  return {
    ...s,
    layout,
    num,
    lead,
    duration,
    absStart,
    speechStart: lead,
    sentences: VOICE[s.id].sentences,
    focus: (FOCUS[s.id] ?? []).map((f) => ({ ...f, cx: f.rect.x + f.rect.w / 2, cy: f.rect.y + f.rect.h / 2 })),
    frames,
    footOffset: 0,
    ghost: s.footage === 'phone' ? `file://${DIR}frames/overview/00090.jpg` : undefined,
  };
});
const TOTAL = cursor + X;
timeline.forEach((s) => (s.total = TOTAL));
console.log(`timeline ${TOTAL.toFixed(1)}s (${Math.floor(TOTAL / 60)}:${String(Math.round(TOTAL % 60)).padStart(2, '0')})`);
timeline.forEach((s) => console.log(`  ${s.id.padEnd(10)} start ${s.absStart.toFixed(2).padStart(6)}  len ${s.duration.toFixed(2)}`));

// ---- render ---------------------------------------------------------------------
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 600_000,
  args: ['--allow-file-access-from-files', '--force-color-profile=srgb', '--disable-web-security', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});

async function renderScene(spec) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(`file://${DIR}stage.html`, { waitUntil: 'load' });
  await page.evaluate((s) => window.setupScene(s), spec);
  const n = Math.round(spec.duration * FPS);
  if (PREVIEW) {
    mkdirSync(`${OUT}preview`, { recursive: true });
    for (const frac of [0.08, 0.35, 0.6, 0.85]) {
      const t = spec.duration * frac;
      await page.evaluate((x) => window.renderFrame(x), t);
      await page.screenshot({ path: `${OUT}preview/${spec.id}-${Math.round(frac * 100)}.jpg`, type: 'jpeg', quality: 85 });
    }
    await page.close();
    return;
  }
  const file = `${OUT}scenes/${spec.id}.mp4`;
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))));
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await page.evaluate((x) => window.renderFrame(x), i / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 93, optimizeForSpeed: true });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;
  await page.close();
  console.log(`rendered ${spec.id} (${n} frames, ${((Date.now() - t0) / n).toFixed(0)} ms/frame)`);
}

const FORCE = args.includes('--force');
const valid = (f, expected) => existsSync(f) && Math.abs(Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString() || 0) - Math.round(expected * FPS) / FPS) < 0.05;
const queue = timeline.filter((s) => (!ONLY || s.id === ONLY) && (FORCE || PREVIEW || !valid(`${OUT}scenes/${s.id}.mp4`, s.duration)));
console.log(`scenes to render: ${queue.map((s) => s.id).join(', ') || 'none'}`);
await Promise.all(
  Array.from({ length: Math.min(POOL, queue.length) }, async () => {
    while (queue.length) await renderScene(queue.shift());
  }),
);
await browser.close();
if (PREVIEW || ONLY) process.exit(0);

// ---- assemble: crossfades + narration + subtitles -----------------------------------
const vIn = timeline.flatMap((s) => ['-i', `${OUT}scenes/${s.id}.mp4`]);
let chain = '';
let prev = '[0:v]';
timeline.slice(1).forEach((s, i) => {
  const lbl = `[v${i + 1}]`;
  chain += `${prev}[${i + 1}:v]xfade=transition=fade:duration=${X}:offset=${s.absStart.toFixed(3)}${lbl};`;
  prev = lbl;
});
const aBase = timeline.length;
const aIn = timeline.flatMap((s) => ['-i', `${DIR}voice/${s.id}.final.wav`]);
const aChain = timeline.map((s, i) => `[${aBase + i}:a]adelay=${Math.round((s.absStart + s.lead) * 1000)}:all=1[a${i}];`).join('');
const mix = `${timeline.map((_, i) => `[a${i}]`).join('')}amix=inputs=${timeline.length}:normalize=0:duration=longest,apad=whole_dur=${TOTAL.toFixed(3)},atrim=0:${TOTAL.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`;

// Subtitles: one cue per sentence at its real spoken time.
const ts = (t) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (v, w = 2) => String(v).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${p(ms % 1000, 3)}`;
};
let srt = '', cue = 1;
for (const s of timeline) for (const x of s.sentences) srt += `${cue++}\n${ts(s.absStart + s.lead + x.start)} --> ${ts(s.absStart + s.lead + x.end + 0.15)}\n${x.text}\n\n`;
assertNoDashes(srt, 'subtitles');
writeFileSync(`${OUT}captions.srt`, srt);

const final = `${OUT}ai-incident-commander-explainer.mp4`;
execFileSync('ffmpeg', ['-v', 'error', '-y', ...vIn, ...aIn, '-i', `${OUT}captions.srt`,
  '-filter_complex', `${chain}${aChain}${mix}`,
  '-map', prev, '-map', '[aout]', '-map', `${timeline.length * 2}:s`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '192k', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng',
  '-metadata', 'title=AI Incident Commander: what it is and why it helps', '-movflags', '+faststart', '-t', TOTAL.toFixed(3), final], { stdio: 'inherit' });
console.log(`done: ${final}`);
