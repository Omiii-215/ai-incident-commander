// Single source of truth for narration, on-screen words and footage.
// Rule: no em or en dashes anywhere (checked by assertNoDashes).

export const VOICE = { voice: 'Kaveri', model: 'timbre-v2.5', language: 'en-IN', speed: 0.85 };

export const SCENES = [
  {
    id: 'intro',
    kind: 'intro',
    say: "When a website breaks, real people feel it. Shoppers can't pay. And someone on the team has to fix it fast, often in the middle of the night.",
  },
  {
    id: 'problem',
    kind: 'problem',
    chapter: 'The problem',
    headline: ['Fixing it is', 'hard.'],
    points: ['Clues are spread across many tools', 'Everyone is under pressure', 'Some AI helpers guess, or change things nobody agreed to'],
    say: "That's hard. The clues are spread across many different tools. And some AI helpers guess, or even make changes that nobody agreed to.",
  },
  {
    id: 'overview',
    footage: 'overview',
    chapter: 'Meet AI Incident Commander',
    caption: ['Everything in ', { hl: 'one place' }, ', updated live'],
    say: 'Meet AI Incident Commander. It puts everything in one place. This screen shows what is broken right now, and it updates on its own.',
  },
  {
    id: 'incidents',
    footage: 'incidents',
    chapter: 'One clear list',
    caption: ['Same problem reported 50 times? ', { hl: 'You see it once.' }],
    say: 'Every problem shows up in one list. If the same problem is reported fifty times, you only see it once. The most serious ones stay at the top.',
  },
  {
    id: 'ack',
    footage: 'ack',
    chapter: 'Someone takes charge',
    caption: ['One click tells the team: ', { hl: '"I\'m on it."' }],
    say: 'Bob is on call today. Bob opens the checkout problem and clicks Acknowledge. Now the whole team knows who is on it.',
  },
  {
    id: 'diagnosis',
    footage: 'diagnosis',
    chapter: 'The AI does the homework',
    caption: ['A likely cause, with ', { hl: 'proof for every point' }],
    say: "The AI has already done the homework. It read the error messages, the recent updates, and the team's own guides. It thinks a new update probably caused the problem. And it shows the proof for every point.",
  },
  {
    id: 'secrets',
    footage: 'secrets',
    chapter: 'Private by default',
    caption: ['Passwords and keys are ', { hl: 'hidden automatically' }],
    say: 'Passwords and secret keys are hidden automatically. Nobody sees them by accident. Not even the AI.',
  },
  {
    id: 'request',
    footage: 'request',
    chapter: 'AI suggests, people decide',
    caption: ['The AI suggests. ', { hl: 'A person asks.' }, ' Nothing runs yet.'],
    say: "The AI suggests going back to the last version that worked. But the AI can't do that by itself. Bob sends it as a request. In this demo, fixes run on a safe practice system.",
  },
  {
    id: 'approve',
    footage: 'approve',
    chapter: 'Two people, every time',
    caption: ['A ', { hl: 'second person' }, ' must say yes'],
    say: "Now a second person must say yes. The person who asked can't approve it. So Carol checks the details, writes a short reason, and approves.",
  },
  {
    id: 'run',
    footage: 'run',
    chapter: 'Checked again, run once',
    caption: ['Runs ', { hl: 'once' }, '. Every step is saved.'],
    say: 'Right before the fix runs, everything is checked again. Then it runs once, and only once. And every step is saved, so anyone can see who did what, and why.',
  },
  {
    id: 'phone',
    footage: 'phone',
    chapter: 'Wherever you are',
    caption: ['Works on your ', { hl: 'phone' }, ' too'],
    say: 'It works on your phone, too. So help is always close by.',
  },
  {
    id: 'who',
    kind: 'who',
    chapter: 'Who it helps',
    cards: [
      { title: 'Engineers', text: 'Find answers faster', icon: 'bolt' },
      { title: 'Managers', text: 'A safe way to say yes', icon: 'shield' },
      { title: 'Companies', text: 'Shorter outages and a clear record', icon: 'chart' },
    ],
    say: 'Engineers find answers faster. Managers get a safe way to say yes. And companies get shorter outages, with a clear record of what happened.',
  },
  {
    id: 'outro',
    kind: 'outro',
    say: 'This is AI Incident Commander. The AI does the homework. People make the decisions.',
  },
];

export function assertNoDashes(value, where = 'scenes') {
  const text = JSON.stringify(value);
  const m = /[–—]/.exec(text);
  if (m) throw new Error(`Dash character found in ${where}: ...${text.slice(Math.max(0, m.index - 40), m.index + 40)}...`);
}
assertNoDashes(SCENES);
