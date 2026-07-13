# Sonar brand

The name is the metaphor. Sonar's world is the submarine PPI scope: a rotating
sweep, phosphor echoes that glow and decay, range rings, deep water. The fund's
world is research notes, citations, and order tickets. The brand is their
fusion: an instrument that finds signal in deep water. The agent literally pings
the market once a day and publishes the echoes.

## Mark

`public/brand/sonar-mark.svg` (gold, for the product) and
`public/brand/sonar-mark-ink.svg` (ink, for light surfaces). A scope mid-sweep:
outer range ring, two inner arcs with a gap where the beam passes, the sweep
needle, its phosphor wedge, and one echo blip on the trail side. The favicon
(`app/icon.svg`) is the simplified mark on an abyss tile. The wordmark
(`public/brand/sonar-wordmark.svg`) sets SONAR in mono caps beside the mark.

Rules: never rotate the mark (the sweep angle is the identity); never recolor
the echo blip separately; clear space equal to the inner ring radius.

## Color

The palette is the product's existing navy + gold, named for its role:

| Token     | Value (css var)      | Role                                    |
|-----------|----------------------|-----------------------------------------|
| --abyss   | var(--background)    | deep water; every page floor            |
| --ink     | var(--foreground)    | text                                    |
| --ping    | var(--gold)          | the instrument: sweep, mark, key stats  |
| --echo    | var(--electric)      | echo traces: links, secondary accents   |
| --depth   | var(--card)          | raised surfaces                         |

Positive/negative stay reserved for P&L data. Near-monochrome plus one decisive
gold; the phosphor glow (`.glow-ping`) is applied only to ping elements and only
where the instrument is present (the landing). The 4% grain film (`.grain`) is
landing-only.

## Type

| Role    | Face             | Use                                              |
|---------|------------------|--------------------------------------------------|
| Display | Instrument Serif | headlines, mostly italic, large, sparingly       |
| Body    | Inter            | prose                                            |
| Utility | Geist Mono       | anything that is a reading: labels, data, bearings |

The display face is the one aesthetic risk: the fund's voice is a research
note, so headlines read as an essay written on an instrument. If a heading is
data, it is mono, not serif. Scale: hero clamp(3rem, 8vw, 7.5rem) at line-height
0.95; section clamp(2rem, 4vw, 3.5rem); body clamp(1rem, 1.05vw, 1.2rem) at 1.6.
Small caps labels track +0.08em.

## Motion

One choreographed scene per page, not scattered effects. Easing
cubic-bezier(0.16, 1, 0.3, 1); reveals are masked line slides (`.rv-mask`/`.rv`)
firing once near the viewport. The landing's signature is the live canvas scope
(sweep, phosphor decay, real thesis signals as blips) that tilts into a depth
cone as you scroll. Everything else stays quiet. prefers-reduced-motion gets a
static frame and opacity-only reveals.

## Voice

Sentence case, plain verbs, specific over clever, user-side names. Numbers only
with citations. Honest scope in every claim (paper + testnet, app-level
enforcement). No em dashes.
