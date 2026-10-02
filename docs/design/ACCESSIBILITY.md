# Accessibility Requirements and Verification

Status: design target, 2026-10-02. Target WCAG 2.2 Level AA across complete workflows. No conformance claim is made before implementation and manual evaluation. The normative baseline is [WCAG 2.2](https://www.w3.org/TR/WCAG22/); project rules below translate it into concrete product behavior and sometimes exceed its minimums.

## 1. Ownership and release rule

Accessibility is part of each component and feature definition of done. The implementing engineer supplies keyboard and automated evidence; design review checks visual states; a reviewer manually exercises the complete task with assistive technology. A library's accessibility support does not establish application conformance.

A release is blocked when a user cannot complete sign-in, incident triage, evidence review, action review, or navigation with keyboard and supported screen-reader/browser combinations. Cosmetic issues are still recorded and prioritized. Third-party authentication and plugin configuration screens are included in complete-process review.

## 2. Semantics and navigation

- Each route has a unique descriptive document title, one page heading, named landmarks, and a visible-on-focus “Skip to main content” link.
- Keep heading order logical; do not choose heading levels for font size. Landmark names distinguish primary navigation from incident section navigation.
- Links navigate and buttons act. Use native labels, inputs, selects, tables, and lists where they fit. Do not add `role=button` to clickable generic containers.
- Use `aria-current="page"` for current navigation. Provide textual current state in breadcrumb and heading.
- On route change move focus to the page heading after meaningful navigation, except browser Back restores the previous focused item where possible.
- On in-place filters, preserve input focus and announce the updated result count. Do not send focus to the first matching incident automatically.
- Status icons have adjacent text. Decorative SVGs are hidden; meaningful charts have a summary and data alternative.
- Keep Help in the same relative location across screens and make the same assistance available on compact layouts.

## 3. Contrast, readability, and visual states

Project acceptance uses WCAG contrast thresholds: normal text at least 4.5:1; qualifying large text at least 3:1; essential UI boundaries and graphical information at least 3:1 against adjacent colors. See W3C guidance for [text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). Color never carries the only meaning. Text remains usable at 200% enlargement.

Check token pairs in both themes using the final computed colors. Low-opacity placeholder text and colored badge foregrounds are common failure points. Decorative dividers may use softer contrast only when they carry no essential component boundary or information.

Keep links recognizable without depending on color alone. Focus uses a visible 3 px outline with a 2 px offset; this is a project design rule. Forced-colors mode must preserve controls, selected tabs, and focus. Avoid background-image-only icons and suppressing the browser outline globally.

Custom text spacing must not clip labels: test line height 1.5, paragraph spacing 2 times font size, letter spacing 0.12em, and word spacing 0.16em. Provide sufficient space around badges and multi-line action buttons. These are override-test values, not mandatory default styles. [W3C text-spacing guidance](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html).

## 4. Keyboard behavior by component

| Component | Keyboard contract | Focus result |
|---|---|---|
| Link / button | Native activation; no single-letter global triggers | Remains unless a route/dialog opens |
| Filter field | Normal text editing and labeled clear control | Stays in field after filtering |
| Disclosure | Enter/Space toggles, reports expanded state | Stays on toggle |
| Tabs | Arrow keys move tab focus; chosen primitive defines activation | Visible selected tab and panel relationship |
| Menu | Trigger opens; arrows navigate; Escape closes | Returns to trigger |
| Dialog | Tab/Shift+Tab contained; Escape closes when safe | Returns to trigger or logical successor |
| Table | Tab visits actual links/buttons, not every cell | Headers remain understandable |
| Chart | Focusable data summary / data-table toggle | Access does not require pointer precision |
| Reorderable item | Buttons provide the same move operation as drag | Stays with moved item; position announced |

Keep a predictable DOM order matching reading order. Do not use positive `tabindex`. Shortcuts are optional, documented, disableable, and inactive in text inputs. No shortcut may approve, dispatch, resolve, or delete without the normal review step.

## 5. Dialogs, drawers, and focus safety

Use the [WAI-ARIA modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) for genuine modal interaction: name the dialog, make background content inert, contain focus, provide a close control, and return focus when closing. For lengthy structured content, focus a heading or introductory element instead of announcing the entire body as one description.

Approval reviews use a full route by preference. If a confirmation dialog is necessary, it opens with neutral context or Cancel focused; opening it never executes the action. Escape closes the dialog without implying cancellation of an already submitted command. Show pending server work in the underlying request page.

Only one modal layer is active. Opening citation details from a review replaces the panel or uses inline expansion; it must not create a nested focus trap. Tooltips dismiss with Escape and remain readable when hovered or focused.

Sticky elements must not fully hide focused content, as required by the AA focus-not-obscured criterion. The project additionally aims to keep the entire focused control visible using scroll padding and safe-area spacing. [W3C focus-not-obscured guidance](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).

## 6. Tables, cards, and charts

Use native HTML tables for tabular operational data, with a caption or visible associated heading and correctly scoped headers. Sort controls expose `aria-sort` on the relevant header. Tables may contain ordinary links and buttons. The [WAI table pattern](https://www.w3.org/WAI/ARIA/apg/patterns/table/) recommends native table markup where possible.

Do not apply `role=grid` simply because a table looks dense. An interactive grid requires managed arrow-key navigation and focus behavior; use it only when a defined editing workflow needs it. See the [WAI grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/).

Narrow incident cards are a labeled list containing headings and metadata. Responsive switching must not duplicate content in the accessibility tree. Charts provide units, time window, missing-data semantics, textual trend summary, and a table of the displayed data. Service dependency diagrams have a searchable text list of relationships.

## 7. Live regions and changing information

Use `role="status"` or a polite live region for completion and result-count feedback that should be heard without moving focus. Reserve assertive alerts for immediate failures that require attention. Status messages must be programmatically available without forcing focus; see [W3C status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).

- Aggregate arriving incident changes: “4 incident updates available.” Do not announce every metric tick or streamed AI token.
- Announce a completed diagnosis once; provide a heading link to its content. Keep intermediate reasoning out of live regions.
- Explain offline transitions once. A repeated failed reconnect must not repeatedly interrupt the user.
- A visual approval countdown is not a per-second live region. Announce the 2-minute warning once and expiry once.
- Pausing live display must preserve access to later updates. A “Resume updates” control names the pending count.
- If a focused action becomes forbidden, keep its explanatory context, announce the change, and move focus only if the element must be removed.

## 8. Forms, errors, timing, and authentication

Every field has a persistent visible label, purpose, required/optional state, and inline validation. Associate hints/errors through accessible descriptions. On invalid submit, focus an error summary whose links reach each field; retain entered nonsecret values and explain how to correct them.

Allow paste, password managers, and accessible authentication methods. Do not create a memory puzzle, transcription obstacle, or blocked paste operation in the application sign-in flow. Evaluate the selected OIDC provider's complete path against [W3C accessible-authentication guidance](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html).

The action spec expires after 10 minutes for revision safety. Before expiry, offer “Renew review” to a responder/commander; it requests a fresh action ID, immutable proposal, target preflight, and expiry. It never extends the old spec or transfers an approval. Preserve readable evidence and any rejection-note draft. Show both original and renewal requester; neither may approve their production renewal. The interface warns at 2 minutes and permits repeated review renewal subject to normal authorization. Engineering must assess the complete multi-person renewal behavior against [W3C timing-adjustability guidance](https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html); do not claim an automatic exception because the product is security sensitive.

Do not erase a draft when reauthentication is required. Keep it in memory where practical; exclude secrets and clear it on explicit sign-out or workspace permission loss. Reauthentication never resubmits a command automatically.

## 9. Responsive and motion requirements

Apply the exact [responsive rules](RESPONSIVE_RULES.md). Verify all required content at 320 CSS px and all input modalities. Primary controls use 44×44 CSS px targets as a project standard; every action must also remain reachable with keyboard and speech input using its visible label.

Honor reduced motion and never flash severity indicators. Sound is off by default; if introduced later, give visible equivalent feedback and independent mute controls. Avoid attention-grabbing animation on every live event.

## 10. Verification evidence

| Layer | What to verify | Required record |
|---|---|---|
| Automated component checks | Names, roles, labels, invalid ARIA, obvious contrast failures | Tool report with route/component and unresolved issues |
| Keyboard walkthrough | Sign-in to simulated request decision; filters; plugins; recovery | Steps, focused element sequence, failures |
| Screen reader desktop | VoiceOver + Safari; NVDA + Firefox or Chrome | Versions, task results, announcement issues |
| Screen reader mobile | VoiceOver + iOS Safari; TalkBack + Android Chrome | Review/approval, menu, errors, orientation |
| Visual adaptation | Both themes, forced colors, 200% text, 400% zoom | Screenshots and overflow/focus findings |
| Dynamic updates | New events, expiry, stale stream, role revocation | Announcement transcript and focus outcome |
| Content review | Labels, errors, empty states, uncertainty | Reviewed fixture set and changes |

At implementation time record actual browser/assistive technology versions instead of treating “latest” as a reproducible result. Automated tools cover only part of accessibility; manual complete-workflow results are required for release approval.

## 11. Acceptance scenarios

1. A keyboard user opens a severe incident, follows a citation, returns to the same context, and requests a simulated action.
2. A screen-reader user distinguishes AI suggestions, cited facts, stale information, and confirmed execution outcomes.
3. A commander at 400% zoom can inspect every target argument and approve or reject without hidden controls or horizontal page scrolling.
4. A user with reduced motion follows live updates through text indicators and deliberate refresh.
5. A user reviewing slowly can obtain a new review period without re-entering work, and an expired spec never executes.
6. A revoked role removes authorization and restricted content while announcing the reason without a focus trap.
