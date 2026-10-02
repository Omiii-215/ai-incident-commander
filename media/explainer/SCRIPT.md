# Explainer video: narration script

Length 2:19 · 1920x1080 · 30 fps · narration by Gnani Vachana TTS (voice Kaveri, en-IN, model timbre-v2.5), average 158 words per minute · subtitles in captions.srt and embedded as a soft track.

All website footage is real screen recording of the local app running the seeded demo data (Acme Shop). Fixes run on the built-in simulator. The AI shown in the demo is the deterministic test model.

## 1. Opening

When a website breaks, real people feel it. Shoppers can't pay. And someone on the team has to fix it fast, often in the middle of the night.

## 2. The problem

That's hard. The clues are spread across many different tools. And some AI helpers guess, or even make changes that nobody agreed to.

## 3. Meet AI Incident Commander

**On screen:** Everything in one place, updated live

**Footage:** overview (real recording)

Meet AI Incident Commander. It puts everything in one place. This screen shows what is broken right now, and it updates on its own.

## 4. One clear list

**On screen:** Same problem reported 50 times? You see it once.

**Footage:** incidents (real recording)

Every problem shows up in one list. If the same problem is reported fifty times, you only see it once. The most serious ones stay at the top.

## 5. Someone takes charge

**On screen:** One click tells the team: "I'm on it."

**Footage:** ack (real recording)

Bob is on call today. Bob opens the checkout problem and clicks Acknowledge. Now the whole team knows who is on it.

## 6. The AI does the homework

**On screen:** A likely cause, with proof for every point

**Footage:** diagnosis (real recording)

The AI has already done the homework. It read the error messages, the recent updates, and the team's own guides. It thinks a new update probably caused the problem. And it shows the proof for every point.

## 7. Private by default

**On screen:** Passwords and keys are hidden automatically

**Footage:** secrets (real recording)

Passwords and secret keys are hidden automatically. Nobody sees them by accident. Not even the AI.

## 8. AI suggests, people decide

**On screen:** The AI suggests. A person asks. Nothing runs yet.

**Footage:** request (real recording)

The AI suggests going back to the last version that worked. But the AI can't do that by itself. Bob sends it as a request. In this demo, fixes run on a safe practice system.

## 9. Two people, every time

**On screen:** A second person must say yes

**Footage:** approve (real recording)

Now a second person must say yes. The person who asked can't approve it. So Carol checks the details, writes a short reason, and approves.

## 10. Checked again, run once

**On screen:** Runs once. Every step is saved.

**Footage:** run (real recording)

Right before the fix runs, everything is checked again. Then it runs once, and only once. And every step is saved, so anyone can see who did what, and why.

## 11. Wherever you are

**On screen:** Works on your phone too

**Footage:** phone (real recording)

It works on your phone, too. So help is always close by.

## 12. Who it helps

Engineers find answers faster. Managers get a safe way to say yes. And companies get shorter outages, with a clear record of what happened.

## 13. Closing

This is AI Incident Commander. The AI does the homework. People make the decisions.

## Rebuild

Scripts are in source/. Put your Gnani key in a private .gnani.env file (GNANI_API_KEY=...) next to the scripts, never in the repository. With the app running and freshly seeded: node tts.mjs, node clarity.mjs (optional check), node record.mjs, node render.mjs. Needs Google Chrome, ffmpeg and puppeteer-core.