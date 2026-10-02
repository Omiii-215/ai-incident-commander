import type { ReactNode } from 'react';

const GITHUB = 'https://github.com/Omiii-215/ai-incident-commander';

function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="10" y1="3" x2="54" y2="61" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset=".52" stopColor="#6366f1" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <path d="M32 3 7 12.2v17.6C7 45.4 17.6 56.6 32 61c14.4-4.4 25-15.6 25-31.2V12.2L32 3z" fill="url(#lg)" />
      <path d="M14.5 33.5h8.2l4.3-9.6 6.3 17.4 4.9-11.1 2.9 3.3h8.4" fill="none" stroke="#fff" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Frame({ src, alt, className = '', label = 'AI Incident Commander · Acme Shop demo' }: { src: string; alt: string; className?: string; label?: string }) {
  return (
    <figure className={`frame ${className}`}>
      <div className="frame-bar" aria-hidden="true">
        <i style={{ background: '#f87171' }} />
        <i style={{ background: '#fbbf24' }} />
        <i style={{ background: '#34d399' }} />
        <span className="ml-3 truncate text-xs text-soft">{label}</span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading="lazy" width={2160} height={1350} className="block h-auto w-full" />
    </figure>
  );
}

function Section({ id, kicker, title, intro, children }: { id: string; kicker: string; title: ReactNode; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mx-auto w-full max-w-7xl scroll-mt-24 px-5 py-20 sm:px-8 lg:py-28">
      <p className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-[#a5b4fc]">
        <span className="h-2.5 w-2.5 rounded-[3px] bg-gradient-to-br from-cyan to-violet" aria-hidden="true" />
        {kicker}
      </p>
      <h2 id={`${id}-h`} className="max-w-3xl text-3xl font-extrabold tracking-tight sm:text-5xl">
        {title}
      </h2>
      {intro && <p className="mt-5 max-w-2xl text-lg leading-relaxed text-soft">{intro}</p>}
      <div className="mt-12">{children}</div>
    </section>
  );
}

const PEOPLE = [
  { id: '00000000-0000-4000-8000-000000000002', name: 'Bob', role: 'Commander and responder', ws: 'Acme Shop', tryThis: 'Acknowledge the checkout incident and ask for the AI suggested rollback. Then try to approve it yourself.', tone: 'from-cyan to-indigo' },
  { id: '00000000-0000-4000-8000-000000000003', name: 'Carol', role: 'Commander', ws: 'Acme Shop', tryThis: "Review and approve Bob's request, then watch the fix run. The Payments request shows how an uncertain result is reconciled.", tone: 'from-indigo to-violet' },
  { id: '00000000-0000-4000-8000-000000000001', name: 'Alice', role: 'Responder', ws: 'Acme Shop', tryThis: 'Acknowledge incidents, comment, ask for a fresh diagnosis. Approvals and the audit log are off limits.', tone: 'from-sky-400 to-cyan' },
  { id: '00000000-0000-4000-8000-000000000005', name: 'Erin', role: 'Auditor', ws: 'Acme Shop', tryThis: 'Read the audit log and every approval. Look, but nothing can be changed.', tone: 'from-emerald-400 to-cyan' },
  { id: '00000000-0000-4000-8000-000000000004', name: 'Dave', role: 'Admin', ws: 'Acme Shop', tryThis: 'Manage plugins: test a connector, narrow its grants or switch it off. Admins cannot approve fixes.', tone: 'from-amber-400 to-pink-500' },
  { id: '00000000-0000-4000-8000-000000000008', name: 'Gina', role: 'Commander', ws: 'Globex Corp', tryThis: 'A different company in the same app. Gina sees only Globex and cannot open any Acme page.', tone: 'from-pink-500 to-violet' },
];

const STEPS = [
  {
    title: 'Alerts become one clear incident',
    text: 'Monitoring tools send signed alerts. If the same problem is reported fifty times, the team sees one incident, with the most serious problems at the top. The dashboard updates live.',
    img: '/images/incidents-light.png',
    alt: 'Incidents list sorted by severity, showing SEV1 and SEV2 incidents with their state and owner.',
  },
  {
    title: 'The AI does the homework',
    text: 'It reads the error logs, the recent deployments, metrics and the team runbooks, then explains the likely cause. Facts and guesses are kept apart, and every claim links to its evidence.',
    img: '/images/diagnosis-light.png',
    alt: 'Diagnosis panel with observed facts, two hypotheses with supporting and contradicting evidence links, and known gaps.',
  },
  {
    title: 'Secrets stay hidden',
    text: 'Passwords and keys are blacked out automatically before anyone sees them, including the AI. Text that tries to give the AI instructions is flagged and never used to justify a change.',
    img: '/images/evidence-redacted-light.png',
    alt: 'Log excerpt where a password and an API token are replaced by REDACTED markers.',
  },
  {
    title: 'Two people, every time',
    text: 'The AI can only suggest. A person turns it into a request, and a different commander must approve it. The approval is locked to that exact change and expires in ten minutes.',
    img: '/images/approval-review-dark.png',
    alt: 'Approval review showing the exact tool, target, arguments, risk, expiry and a decision panel with a confirmation checkbox.',
  },
  {
    title: 'Checked again, run once',
    text: 'Just before running, everything is checked again: permissions, the target, the plan and the stop switch. The fix runs exactly once. An uncertain result is verified, never blindly retried.',
    img: '/images/execution-succeeded-dark.png',
    alt: 'Approval page showing the action succeeded with a receipt, requester, approver and decision reason.',
  },
  {
    title: 'Everything is on the record',
    text: 'Every step lands on one timeline and in a permanent audit log: who did what, when and why, including attempts that were blocked. Hand-offs and write-ups become easy.',
    img: '/images/audit-log-dark.png',
    alt: 'Audit log table listing actors, operations, entities, outcomes and request references.',
  },
];

const FEATURES = [
  ['Live dashboard', 'Open incidents, approvals and service health update in real time, with honest Live or Delayed status.'],
  ['Cited AI diagnosis', 'Structured facts, hypotheses, known gaps and next checks, each tied to evidence.'],
  ['Two-person approval', 'Requesters can never approve their own change. Approvals expire and cannot be reused.'],
  ['Exactly-once actions', 'Duplicate messages never repeat a change. Unknown outcomes are reconciled first.'],
  ['Secret redaction', 'Keys, tokens and passwords are removed before storage, display or AI use.'],
  ['Prompt-injection guard', 'Suspicious text in logs or runbooks is flagged and excluded from justifying actions.'],
  ['Versioned runbooks', 'Upload, index, then publish. Search only ever returns the published version.'],
  ['Reviewed plugins', 'Connectors get narrow, per-workspace permissions that can be revoked at any time.'],
  ['Tenant isolation', 'Every record and query is scoped to one workspace. Other teams see a plain "not found".'],
  ['Postmortem drafts', 'One click turns the timeline into a draft that separates confirmed facts from open questions.'],
  ['Works on a phone', 'Every screen adapts from 320 px phones to wide desktops, with keyboard and screen reader support.'],
  ['Works without AI', 'If the AI provider is down, the full manual workflow still works.'],
];

const STACK = [
  ['Next.js 16 and React 19', 'The dashboard you click around in, written in TypeScript.'],
  ['Tailwind CSS 4', 'Design tokens for light and dark themes and responsive layouts.'],
  ['TanStack Query', 'Keeps data on screen fresh and in sync with the server.'],
  ['Express 5 API', 'Checks who you are and what you may do, then runs each command.'],
  ['Zod', 'Validates every request and every AI answer against a strict shape.'],
  ['MongoDB 8 replica set', 'The source of truth. Each change, its history and its follow-up work are saved together in one transaction.'],
  ['Redis and BullMQ', 'A job queue for background work. Jobs may be delivered twice; the app makes that harmless.'],
  ['Server-Sent Events', 'Pushes small change notices to the browser so screens refresh themselves.'],
  ['Background worker', 'Runs investigations and approved actions in a separate process from the API.'],
  ['AI provider layer', 'Swappable model adapters inside a bounded, budgeted workflow with citation checks.'],
  ['Policy gateway', 'Every tool call must pass workspace, plugin, target and approval checks.'],
  ['Vitest', '77 automated tests, including cross-tenant leaks, approval races and duplicate delivery.'],
];

export default function Home() {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-ink">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur">
        <nav aria-label="Main" className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <a href="#top" className="flex items-center gap-2.5 font-bold">
            <LogoMark size={32} />
            <span className="leading-none">
              <span className="block text-[0.6rem] tracking-[0.22em] text-[#a5b4fc]">AI</span>
              <span className="text-[1.05rem]">Incident Commander</span>
            </span>
          </a>
          <ul className="hidden items-center gap-7 text-sm text-soft md:flex">
            <li><a className="hover:text-white" href="#demo">Live demo</a></li>
            <li><a className="hover:text-white" href="#video">Video</a></li>
            <li><a className="hover:text-white" href="#how">How it works</a></li>
            <li><a className="hover:text-white" href="#features">Features</a></li>
            <li><a className="hover:text-white" href="#stack">Tech stack</a></li>
          </ul>
          <a href={GITHUB} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-white/5 px-4 text-sm font-semibold hover:bg-white/10">
            <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" /></svg>
            GitHub
          </a>
        </nav>
      </header>

      <main id="main">
        {/* Hero */}
        <section id="top" className="relative overflow-hidden">
          <div className="grid-floor" aria-hidden="true" />
          <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-5 pb-24 pt-16 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:pt-24">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-2 rounded-full border border-line bg-white/5 px-3 py-1 text-sm text-[#c7d2fe]">
                <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
                Open source · Human-approved AI
              </p>
              <h1 className="mt-6 break-words text-[2.6rem] font-extrabold leading-[1.04] tracking-tight sm:text-6xl xl:text-7xl">
                Find what broke. <span className="grad-text">Fix it safely.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-soft sm:text-xl">
                When a website breaks, real people feel it. AI Incident Commander gives on-call teams one place to see the problem, get an AI explanation with proof, and approve a fix with a second person. Every step is on the record.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <a href="#video" className="inline-flex min-h-12 items-center gap-2 rounded-full bg-gradient-to-r from-cyan via-indigo to-violet px-6 font-semibold text-white shadow-lg shadow-indigo/40 hover:opacity-95">
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  Watch the 2 minute video
                </a>
                <a href="#demo" className="inline-flex min-h-12 items-center rounded-full border border-line bg-white/5 px-6 font-semibold hover:bg-white/10">
                  Try the live demo
                </a>
                <a href={GITHUB} className="inline-flex min-h-12 items-center rounded-full px-4 font-semibold text-soft underline-offset-4 hover:text-white hover:underline">
                  View the code
                </a>
              </div>
            </div>
            <div className="float min-w-0">
              <Frame className="tilt" src="/images/overview-dark.png" alt="AI Incident Commander overview: open SEV1 count, open incidents, pending approvals, unknown health, and the active incidents table." />
            </div>
          </div>
        </section>

        {/* Live demo */}
        <Section
          id="demo"
          kicker="Try it yourself"
          title={<>Sign in as anyone. <span className="grad-text">Try every role.</span></>}
          intro="This is the real dashboard running in your browser with sample data. Pick a person: each role sees different things and can do different things. Nothing you do leaves your browser, and you can reset it any time."
        >
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PEOPLE.map((p) => (
              <li key={p.id} className="glass flex flex-col rounded-2xl p-6">
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className={`inline-flex size-12 items-center justify-center rounded-full bg-gradient-to-br ${p.tone} text-lg font-bold`}>
                    {p.name[0]}
                  </span>
                  <div>
                    <h3 className="text-lg font-bold">{p.name}</h3>
                    <p className="text-sm text-[#c7d2fe]">
                      {p.role} · {p.ws}
                    </p>
                  </div>
                </div>
                <p className="mt-4 flex-1 leading-relaxed text-soft">{p.tryThis}</p>
                <a
                  href={`/demo/login/?as=${p.id}`}
                  className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-gradient-to-r from-cyan via-indigo to-violet px-5 font-semibold text-white hover:opacity-95"
                >
                  Sign in as {p.name}
                </a>
              </li>
            ))}
          </ul>

          <div className="glass mt-10 rounded-2xl p-6 sm:p-8">
            <h3 className="text-xl font-bold">A two-minute story to try</h3>
            <ol className="mt-4 grid gap-3 text-soft md:grid-cols-2 lg:grid-cols-5">
              {[
                ['Bob', 'Click "Send a test alert" and watch it appear live.'],
                ['Bob', 'Open the Checkout incident, acknowledge it, and request the rollback.'],
                ['Bob', 'Try to approve it. The app refuses: someone else must decide.'],
                ['Carol', 'Use "Switch person", sign in as Carol and approve. Watch it run.'],
                ['Erin', 'Open the audit log and see every step, including the refusal.'],
              ].map(([who, step], i) => (
                <li key={i} className="rounded-xl border border-line p-4">
                  <span className="text-sm font-bold text-[#a5b4fc]">
                    {i + 1}. {who}
                  </span>
                  <p className="mt-1 text-[0.95rem] leading-relaxed">{step}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-10">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <p className="text-soft">Or explore it right here:</p>
              <a href="/demo/" className="font-semibold text-[#c7d2fe] underline underline-offset-4 hover:text-white">
                Open the demo full screen
              </a>
            </div>
            <div className="frame">
              <div className="frame-bar" aria-hidden="true">
                <i style={{ background: '#f87171' }} />
                <i style={{ background: '#fbbf24' }} />
                <i style={{ background: '#34d399' }} />
                <span className="ml-3 truncate text-xs text-soft">AI Incident Commander · live demo</span>
              </div>
              <iframe
                src="/demo/"
                title="Interactive demo of the AI Incident Commander dashboard"
                loading="lazy"
                className="block h-[640px] w-full bg-white sm:h-[760px] lg:h-[820px]"
              />
            </div>
          </div>
        </Section>

        {/* Video */}
        <Section id="video" kicker="See it in action" title={<>A 2 minute tour, <span className="grad-text">start to finish</span></>} intro="Real footage of the app: an alert arrives, the AI explains it with proof, one person asks for a fix and another approves it.">
          <div className="frame mx-auto max-w-5xl">
            <video controls preload="metadata" playsInline poster="/media/poster.jpg" className="block aspect-video w-full bg-black">
              <source src="/media/ai-incident-commander-explainer.mp4" type="video/mp4" />
              <track kind="captions" src="/media/captions.vtt" srcLang="en" label="English" default />
              Your browser cannot play this video. <a href="/media/ai-incident-commander-explainer.mp4">Download it instead</a>.
            </video>
          </div>
        </Section>

        {/* Problem */}
        <Section id="why" kicker="Why it exists" title={<>Fixing an outage is <span className="grad-text">hard</span></>}>
          <ul className="grid gap-5 md:grid-cols-3">
            {[
              ['Clues are everywhere', 'Alerts, chat, dashboards, logs and old docs, all at once, under pressure, often at night.'],
              ['AI can guess', 'AI helpers can sound confident without proof, or even make changes nobody agreed to.'],
              ['No clear record', 'Afterwards, it is hard to say who decided what, based on which evidence.'],
            ].map(([t, d]) => (
              <li key={t} className="glass rounded-2xl p-7">
                <h3 className="text-xl font-bold">{t}</h3>
                <p className="mt-2 leading-relaxed text-soft">{d}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* How it works */}
        <Section id="how" kicker="How it works" title={<>AI does the homework. <span className="grad-text">People decide.</span></>}>
          <ol className="flex flex-col gap-24">
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
                <div className={`min-w-0 ${i % 2 ? 'lg:order-2' : ''}`}>
                  <span className="text-5xl font-extrabold text-transparent [-webkit-text-stroke:1.5px_#818cf8]">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="mt-3 text-2xl font-bold sm:text-3xl">{s.title}</h3>
                  <p className="mt-4 max-w-xl text-lg leading-relaxed text-soft">{s.text}</p>
                </div>
                <Frame src={s.img} alt={s.alt} />
              </li>
            ))}
          </ol>
        </Section>

        {/* Mobile */}
        <Section id="mobile" kicker="Wherever you are" title={<>Works on <span className="grad-text">your phone</span> too</>} intro="Incidents do not wait for a laptop. Every screen adapts down to 320 px, and the approval review never hides required details on small screens.">
          <div className="flex flex-wrap justify-center gap-10">
            {[
              ['/images/mobile-incidents-dark.png', 'Incident cards on a phone with severity, state, owner and an Acknowledge button.'],
              ['/images/mobile-incident-dark.png', 'Incident detail on a phone with status, owner and response actions.'],
            ].map(([src, alt]) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt={alt} loading="lazy" width={780} height={1688} className="h-auto w-64 rounded-[2.5rem] border-[10px] border-[#1f2937] shadow-2xl shadow-indigo/30 sm:w-72" />
            ))}
          </div>
        </Section>

        {/* Features */}
        <Section id="features" kicker="Features" title={<>Built for <span className="grad-text">real incidents</span></>}>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(([t, d]) => (
              <li key={t} className="glass rounded-2xl p-6">
                <h3 className="font-bold">{t}</h3>
                <p className="mt-1.5 text-[0.95rem] leading-relaxed text-soft">{d}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* Who */}
        <Section id="who" kicker="Who it helps" title={<>Faster answers, <span className="grad-text">safer fixes</span></>}>
          <ul className="grid gap-5 md:grid-cols-3">
            {[
              ['Engineers', 'Find answers faster, with the evidence attached instead of guesses.'],
              ['Managers', 'A safe, two-person way to say yes to a fix, with a deadline and a reason.'],
              ['Companies', 'Shorter outages and a clear record for customers, auditors and postmortems.'],
            ].map(([t, d]) => (
              <li key={t} className="glass rounded-2xl p-7">
                <h3 className="text-2xl font-bold">{t}</h3>
                <p className="mt-2 leading-relaxed text-soft">{d}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* Stack */}
        <Section id="stack" kicker="Tech stack" title={<>What it is <span className="grad-text">built with</span></>} intro="A TypeScript monorepo: a web app, an API and a background worker that share one set of rules.">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STACK.map(([t, d]) => (
              <li key={t} className="rounded-2xl border border-line bg-white/[0.03] p-6">
                <h3 className="font-bold text-[#c7d2fe]">{t}</h3>
                <p className="mt-1.5 text-[0.95rem] leading-relaxed text-soft">{d}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* Run */}
        <Section id="run" kicker="Try it" title={<>Run it <span className="grad-text">locally</span></>} intro="Needs Node 22+ and Redis. MongoDB runs as a local replica set; no paid services are required.">
          <pre className="glass overflow-x-auto rounded-2xl p-6 font-mono text-sm leading-7 text-[#e2e8f0]"><code>{`git clone ${GITHUB}.git
cd ai-incident-commander
cp .env.example .env
npx pnpm@12.8.1 install
npx pnpm@12.8.1 dev:mongo     # terminal 1
npx pnpm@12.8.1 seed          # terminal 2 (with redis-server running)
npx pnpm@12.8.1 dev           # open http://localhost:3000`}</code></pre>
        </Section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-12 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <LogoMark size={28} />
            <p className="text-sm text-muted">
              AI Incident Commander. The demo uses sample data, a test AI model and a practice system for fixes. Production actions are not enabled.
            </p>
          </div>
          <a href={GITHUB} className="text-sm font-semibold text-[#c7d2fe] underline underline-offset-4 hover:text-white">
            Source on GitHub
          </a>
        </div>
      </footer>
    </>
  );
}
