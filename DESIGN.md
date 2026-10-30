---
name: Air Check
description: A producer's desk for a weekly radio show — warm paper, ink, one green signal color
colors:
  paper: "#F5F3EE"
  sidebar: "#EDEAE2"
  surface: "#FFFFFF"
  surface-quiet: "#F0EDE5"
  line: "#DDD8CC"
  line-strong: "#CFC9BB"
  chip: "#E4E0D5"
  ink: "#1C1B18"
  ink-soft: "#3F3B33"
  muted: "#655F54"
  signal: "#0E6A5B"
  signal-deep: "#0A4F44"
  signal-soft: "#DCEDE8"
  signal-on-dark: "#5CC8B2"
  caution-bg: "#F6E7C8"
  caution-text: "#5A3E00"
  problem-bg: "#F4D9D5"
  problem-text: "#7A2019"
  on-air: "#B8322A"
typography:
  display:
    fontFamily: "Instrument Serif, serif"
    fontSize: "1.75rem"
    fontWeight: 400
    lineHeight: 1.1
  body:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "0.9375rem"
    lineHeight: 1.55
  label:
    fontFamily: "DM Mono, monospace"
    fontSize: "11px"
    letterSpacing: "0.1em"
rounded:
  control: "10px"
  card: "14px"
  pill: "9999px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "32px"
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "#FFFFFF"
    rounded: "{rounded.control}"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "44px"
  status-pill:
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "20px"
---

# Design System: Air Check

> Starting point derived from the clickable mock in `design/mockups/`. Run Impeccable against this and `PRODUCT.md` and refine; contrast values below were chosen for 4.5:1 text but must be verified.

## Overview

**Creative North Star: "The Producer's Desk"**

A calm desk where one person checks work before it goes out. Warm paper ground, near-black ink, and a single green signal color that means "ready" or "yours to act on". The interface is quiet by default. Anything that needs a decision is a white card with a clear primary button; anything informational is text on paper.

**Key characteristics:**
- Light, warm, low-glare. Depth from the 1px line and the white-on-paper step, not shadows.
- A serif for page and card titles, a clean sans for everything you read, a mono for labels, times and file names.
- Green means ready or approved. Amber means look at this. Red-brown means a problem. The broadcast red (`on-air`) is reserved for a live or in-progress state and not used elsewhere.
- Every status is a word plus a color, never color alone.

## Colors

- **Paper** (#F5F3EE): page ground. **Sidebar** (#EDEAE2) and **Surface** (#FFFFFF) step up from it.
- **Ink** (#1C1B18): primary text and the sign-in side panel. **Ink Soft** and **Muted** for secondary text; Muted (#655F54) is the lightest text allowed on Paper.
- **Signal** (#0E6A5B): primary actions, active states, the logo mark. **Signal Soft** (#DCEDE8) for ready and approved pills and tags. **Signal on Dark** (#5CC8B2) only on the dark sign-in panel.
- **Caution** (amber pair) for "needs attention", demo notices and could-not-verify. **Problem** (red-brown pair) for conflicts and blocked requests.

### Named Rules
**One Signal Rule.** Green appears on at most one primary action per card and on state pills. Not as decoration.
**Word Plus Color Rule.** Every pill, tag and row status carries a text label. Colors that must be told apart differ in lightness, not hue alone.
**Sample Honesty Rule.** Anything not real data carries a visible "Sample" tag; unknown values are bracketed placeholders like [Label]. The demo's release radar also lists a few real, already-released releases from the station's radar, with Bandcamp's own player and cover (decision 026): public facts only, still tagged Sample, never embargoed.

## Typography

- **Display:** Instrument Serif, regular. Page titles, card titles, big numbers in stat tiles.
- **Body:** DM Sans 400/500/600, 15px, line-height 1.55.
- **Label:** DM Mono, 11px, uppercase, 0.1em tracking. Section captions, file names, times, component names.

### Named Rules
**Three Voices Rule.** Serif for titles, sans for reading, mono for labels and data like `9125.wav` or `10:02:14`. No fourth face.
**No Inter Rule.** Do not substitute Inter, Roboto or Arial.

## Layout

Three zones: a left sidebar (264px, collapses to a full-width block on narrow screens), a main column, and an optional right preview panel (about 380 to 420px; stacks below the main column on narrow screens). Chat and cards sit in a column about 760px wide, centered. Tables and the digest use up to about 1,000px. The page is fluid: no horizontal page scroll at phone width, wide tables scroll inside their own box. Touch targets are at least 44px.

## Elevation and Depth

Flat at rest. White surfaces on paper with a 1px line border. No resting shadows. If an overlay is needed (sheet, dialog), it may use a single soft shadow and a dimmed backdrop.

## Shapes

Controls 10px radius, cards 14px, pills fully rounded. No sharp-cornered interactive elements.

## Components

- **Sidebar nav:** text buttons, 44px tall, active item white with weight 600 and `aria-current="page"`; a mono hint on the right (for example "2026"). Below it, a "Recent" list and a pinned footer with the demo-workspace notice and the user chip.
- **Header:** serif page title on the left; on the right a "Sandbox on" pill (green dot) and an "N hosts allowed" pill.
- **Chat message:** user messages right-aligned in a chip-colored bubble; agent messages left with a small green avatar mark.
- **Generated-UI card** (PackageCard and siblings): a quiet header strip reading "Generated UI" and the component name in mono, then content: eyebrow in mono and signal color, serif title, tag pills, a three-up stat row, a "For your review" bullet list, actions (primary Approve, secondary Review, secondary Edit), and a mono footer naming the registered components and noting that buttons call the app, not the model.
- **Approved state:** the actions are replaced by a signal-soft banner: "Approved and queued for the publisher. Demo mode: nothing is sent to Mixcloud."
- **Preview panel:** Title, Audio (mono file names), Description excerpt, Hour 1 tracklist with a `closing track` chip on the last track, and the approve button.
- **Stat tile:** serif number, muted label, on a Surface card. Number color follows status (signal, caution, problem).
- **Tables** (Episodes, Audit): mono uppercase header row, 12px row padding, status pills, minimum width with an internal horizontal scroll.
- **Digest** (Today): four cards: Ready to approve, Claims that failed verification, New Bandcamp releases, Blocked requests; plus a Telegram preview bubble. A "Sample" tag in demo mode.
- **Tracklist entry:** a monospace textarea on the left, parsed rows on the right with `H1.3` style position labels, a `closing track` chip, and a caution chip for lines that cannot be parsed.
- **Sign-in:** a dark ink panel with the wordmark, a one-line promise and three trust statements; a light panel with Google sign-in, a work-email field limited to @radiomilwaukee.org, and a separate "demo workspace" door for judges.

## Do's and Don'ts

**Do**
- Show what the agent did and what it refused, in plain words.
- Put the decision (Approve, Edit, Skip) next to the thing being decided.
- Label demo data. Keep copy short and concrete.
- Respect `prefers-reduced-motion`. Keep focus rings visible.

**Don't**
- No gradients, glows, orbs or emoji.
- No green on more than one primary action per card.
- No tracklist inside the Mixcloud description preview (it goes in sections).
- No on-air talk or social-post features.
