# UI Design System

Status: proposed implementation contract, 2026-10-02. This document specifies the interface; no components have been built or validated yet. Read with [Dashboard UX](DASHBOARD_UX.md), [Responsive rules](RESPONSIVE_RULES.md), and [Accessibility](ACCESSIBILITY.md).

## 1. Visual direction

AI Incident Commander is an operational workspace. It should make affected services, evidence freshness, ownership, and next decisions easy to scan during an incident.

- Use a restrained slate base, blue for navigation and primary interaction, and semantic colors for severity and outcomes.
- Reserve the largest visual emphasis for the incident title, severity, environment, and current operational state.
- Show the source and age beside every diagnosis and health summary. AI output always carries an “AI suggestion” label.
- Keep one primary action per local task area. Give secondary actions visible labels; use overflow menus for infrequent actions.
- Use flat surfaces with borders and modest corner radii. Avoid decorative gradients, animated backgrounds, glass effects, and status glow.
- Use real operational examples in fixtures; label synthetic environments with a persistent “Simulation” badge.

## 2. Semantic color tokens

Implement the following as semantic CSS custom properties. Components consume token names, never raw hex values. These are proposed palette values; verify actual foreground/background combinations, including hover and disabled states, before release.

| Token | Light | Dark | Use |
|---|---|---|---|
| `canvas` | `#F8FAFC` | `#0B1220` | Page background |
| `surface` | `#FFFFFF` | `#111C2E` | Main cards, dialogs |
| `surface-subtle` | `#F1F5F9` | `#19273B` | Secondary panels and table headings |
| `surface-hover` | `#E2E8F0` | `#25354B` | Hover background |
| `text-primary` | `#0F172A` | `#F1F5F9` | Titles and values |
| `text-secondary` | `#475569` | `#CBD5E1` | Supporting copy |
| `text-muted` | `#526078` | `#94A3B8` | Timestamps and annotations |
| `border-subtle` | `#CBD5E1` | `#334155` | Decorative surface dividers |
| `border-control` | `#64748B` | `#94A3B8` | Input boundaries and essential shapes |
| `accent` | `#1D4ED8` | `#93C5FD` | Links and selected navigation |
| `accent-fill` | `#1D4ED8` | `#93C5FD` | Primary button background |
| `on-accent` | `#FFFFFF` | `#0B1220` | Primary button text |
| `focus` | `#1D4ED8` | `#FDE047` | Keyboard outline |
| `danger-text` / `danger-surface` | `#991B1B` / `#FEF2F2` | `#FECACA` / `#450A0A` | SEV1, failed, destructive intent |
| `warning-text` / `warning-surface` | `#92400E` / `#FFFBEB` | `#FDE68A` / `#451A03` | SEV2, degraded, needs attention |
| `info-text` / `info-surface` | `#1E40AF` / `#EFF6FF` | `#BFDBFE` / `#172554` | SEV3, investigation, pending |
| `success-text` / `success-surface` | `#166534` / `#F0FDF4` | `#BBF7D0` / `#052E16` | Healthy, succeeded, resolved |
| `neutral-text` / `neutral-surface` | `#334155` / `#F1F5F9` | `#CBD5E1` / `#1E293B` | SEV4, unknown, cancelled |

Severity and lifecycle are separate fields. A resolved SEV1 incident retains its SEV1 severity badge and a separate “Resolved” state. Unknown health uses a question-mark icon and “Unknown,” never healthy green.

Dark mode follows the operating system on first visit; an explicit user choice overrides it. Persist only theme preference locally. Set the theme before first paint using the approved app mechanism; do not flash the opposite theme. Honor forced colors with system colors and visible borders.

## 3. Type, spacing, and shape

| Token family | Values | Rule |
|---|---|---|
| Font | System UI sans; system monospace for identifiers | Avoid remote font dependency in MVP |
| Body | `1rem`, line height `1.5` | Default readable text; controls inherit |
| Compact data | `0.875rem`, line height `1.45` | Only dense table metadata; never mobile form inputs |
| Page title | `clamp(1.5rem, 1.1rem + 1vw, 2rem)` | Wrap, with no fixed height |
| Section title | `1.125rem`, weight 600 | Logical heading order |
| Metric value | `1.75rem` to `2rem`, weight 650 | Tabular numerals; unit remains explicit |
| Spacing | 4, 8, 12, 16, 24, 32, 48 px | Convert to rem; select from this scale |
| Radius | 6 px input; 10 px card; 12 px dialog; pill badge | Avoid nested rounded containers without grouping purpose |
| Shadow | None by default; one subtle elevation for floating layers | Border remains visible in both themes |
| Focus outline | 3 px, 2 px offset | Never removed without an equivalent indicator |
| Icon | 20 px default; 16 px in metadata | Decorative icons hidden from accessibility tree |

Limit prose to 70–80 characters per line. Operational tables may use the full content width. Time values use tabular numerals. Relative time includes an accessible absolute time and visible timezone on detail views, for example “2 min ago · 14:32 UTC.” Users may choose local time; exported evidence remains UTC.

## 4. Component contracts

| Component | Required states | Required behavior |
|---|---|---|
| Button | Default, hover, focus, pressed, pending, disabled | Label the outcome: “Acknowledge incident”; preserve width while pending; never color alone |
| Status badge | Text + icon + semantic color | State labels match API vocabulary; not clickable unless explicitly a filter |
| Text input | Empty, filled, focus, invalid, disabled | Persistent label, hint, inline error; no placeholder-only label |
| Select / combobox | Loading, selected, empty, error | Searchable for large service lists; accessible keyboard support; selection does not submit |
| Card | Loading, ready, empty, error, stale | Heading and source timestamp; click target is an explicit link or button |
| Table | Loading, empty, filtered-empty, partial, failure | Native table semantics; explicit sorting; pagination; stable row keys |
| Chart | Ready, no samples, delayed, error | Legend, units, time range, summary and accessible data table |
| Toast | Success, neutral, failure | Nonessential acknowledgement only; critical failures remain inline |
| Banner | Info, stale, offline, permission change | Persistent until resolved; short explanation and relevant next action |
| Dialog | Open, validating, submitting, failed | Named heading, contained focus, visible close action, return focus |
| Tabs | Active, inactive, loading panel | Arrow-key behavior follows chosen accessible primitive; use links for route changes |
| Skeleton | Initial loading | Approximate final shape; no fake metric values or animated shimmer with reduced motion |

Accessible primitives reduce repeated behavior work, but the application still owns labels, meaningful content, color choices, and validation. Radix documents this split of responsibility in its [accessibility guidance](https://www.radix-ui.com/primitives/docs/overview/accessibility).

## 5. Data presentation

- Incident rows show severity, title, service/environment, state, owner, last change, and age. A title is a link; clicking whitespace does not execute commands.
- Long names wrap to two lines in summary cards. If a table truncates them visually, the full accessible name and a deliberate “View details” path remain available.
- Numeric zero is valid data. Missing values display “Unavailable” or “No samples,” not zero, a green badge, or an unexplained dash.
- Every aggregate states its scope: “Open incidents · production · all services.” Filters apply consistently to metrics and the list, or the scope difference is explicit.
- Use line charts for time series, bars for categorical comparisons, and text plus status indicators for current service health. Avoid pie charts for incident priority.
- Chart series use distinguishable line patterns and direct labels as well as color. Hover tooltips also open on keyboard focus and tap.
- Durations use readable units; show `1 h 12 min`, not a raw millisecond count. Empty percentage denominators display “Insufficient data.”
- Plugin capability badges show “Read evidence,” “Propose actions,” or “Production write.” Marketing descriptions never replace granted scopes.

## 6. Motion and feedback

Use 120–180 ms for simple opacity or panel transitions. Motion must not be required to understand state. Respect `prefers-reduced-motion`: remove animated transitions and shimmer; preserve static pending indicators and text.

Do not move focused rows when live events arrive. Show “3 new updates” and let the operator apply list reorder; update clearly scoped counts in place. No automatic scrolling unless the operator enabled “Follow latest” and is already at the newest timeline item.

Toast success may dismiss after 5 seconds; provide a persistent equivalent in the timeline. Error banners and approval failures do not auto-dismiss. Do not show success until the server has accepted the command; distinguish “Approved,” “Queued,” and “Succeeded.”

## 7. Content and trust rules

| Situation | Recommended copy |
|---|---|
| Suggestion supported by sources | “AI suggestion · based on 3 runbook passages and 2 recent alerts” |
| Missing evidence | “There is not enough evidence to recommend an action. Review the available logs.” |
| Stale stream | “Live updates are delayed. Last confirmed update: 14:32 UTC.” |
| Production action | “Approve restart of checkout-api in production” |
| Simulation | “Run simulation. No production resources will change.” |
| Permission denied | “You need the commander role to approve this request.” |
| Self approval blocked | “Another commander must review this request.” |
| Revision changed | “The plan changed during review. Read the updated request before approving.” |
| Unknown outcome | “Execution outcome is unknown. Reconciliation is in progress.” |

Never present uncalibrated model confidence as a percentage. Present evidence counts, source dates, known gaps, and disagreement. AI text and retrieved runbooks are untrusted content: render sanitized Markdown, reject embedded HTML, and do not convert textual instructions into executable buttons.

## 8. Design acceptance

- Every component is specified at light/dark, default/error/disabled/focus, and narrow/wide states.
- All text meets the contrast gate in [Accessibility](ACCESSIBILITY.md); essential control boundaries remain visible.
- Severity is readable in monochrome; all icon-only controls have a visible tooltip and accessible name.
- Browser text enlargement and translated long labels do not clip action controls.
- Screens distinguish synthetic data, live data, cached data, and unavailable data.
- The same semantic tokens are used by pages, charts, dialogs, and plugin configuration forms.
- Design review includes one SEV1 with a long title, an unavailable provider, an expired approval, and an empty workspace.
