// Narration via Gnani Vachana TTS (REST). Key is read from a private env file, never logged.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { SCENES, VOICE } from './scenes.mjs';

const DIR = new URL('.', import.meta.url).pathname;
const OUT = `${DIR}voice/`;
mkdirSync(OUT, { recursive: true });
const key = readFileSync(`${DIR}.gnani.env`, 'utf8').match(/GNANI_API_KEY=(.+)/)[1].trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const force = process.argv.includes('--force');

async function synth(text) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch('https://api.vachana.ai/api/v1/tts/inference', {
      method: 'POST',
      headers: { 'X-API-Key-ID': key, 'Content-Type': 'application/json', 'X-API-Request-ID': randomUUID() },
      body: JSON.stringify({
        text,
        ...VOICE,
        audio_config: { sample_rate: 48000, encoding: 'linear_pcm', num_channels: 1, sample_width: 2, container: 'wav' },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status === 429 || res.status >= 500) {
      await sleep(4000 * (attempt + 1));
      continue;
    }
    throw new Error(`TTS failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error('TTS kept failing after retries');
}

const TEMPO = 0.93; // gentle, pitch-preserving slowdown
const GAP = 0.4; // pause between sentences (seconds)
const sentencesOf = (t) => t.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
const run = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());

const meta = {};
for (const s of SCENES) {
  const parts = sentencesOf(s.say);
  const files = [];
  const sentenceTimes = [];
  let t = 0;
  for (const [i, sentence] of parts.entries()) {
    const h = createHash('sha1').update(JSON.stringify({ sentence, VOICE })).digest('hex').slice(0, 12);
    const raw = `${OUT}cache-${h}.wav`;
    if (force || !existsSync(raw)) {
      writeFileSync(raw, await synth(sentence));
      await sleep(2500); // stay under the rate limit
    }
    const clean = `${OUT}${s.id}.${i}.wav`;
    run(['-i', raw, '-af', `silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.06,areverse,atempo=${TEMPO},aresample=48000`, '-ac', '1', clean]);
    const d = dur(clean);
    sentenceTimes.push({ text: sentence, start: t, end: t + d });
    t += d + (i < parts.length - 1 ? GAP : 0);
    files.push(clean);
  }
  // Join sentences with natural pauses.
  const inputs = files.flatMap((f) => ['-i', f]);
  const gap = `aevalsrc=0:d=${GAP}:s=48000`;
  const chain = files.map((_, i) => `[${i}:a]`).reduce((acc, lbl, i) => acc + lbl + (i < files.length - 1 ? `[g${i}]` : ''), '');
  const gaps = files.slice(0, -1).map((_, i) => `${gap}[g${i}];`).join('');
  run([...inputs, '-filter_complex', `${gaps}${chain}concat=n=${files.length * 2 - 1}:v=0:a=1[out]`, '-map', '[out]', '-ac', '1', '-ar', '48000', `${OUT}${s.id}.final.wav`]);
  const total = dur(`${OUT}${s.id}.final.wav`);
  const words = s.say.split(/\s+/).length;
  meta[s.id] = { duration: total, words, wpm: Math.round((words / total) * 60), sentences: sentenceTimes };
  console.log(`${s.id.padEnd(10)} ${total.toFixed(2)}s  ${meta[s.id].wpm} wpm`);
}
writeFileSync(`${OUT}durations.json`, JSON.stringify(meta, null, 2));
const total = Object.values(meta).reduce((a, m) => a + m.duration, 0);
const words = Object.values(meta).reduce((a, m) => a + m.words, 0);
console.log(`speech total ${total.toFixed(1)}s, average ${Math.round((words / total) * 60)} wpm`);
