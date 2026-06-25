# ShriHari Vani — Design System

A warm, devotional aesthetic rooted in Indian manuscript and temple-art traditions.
The visual language should feel like reading a sacred text by candlelight — calm, reverent, unhurried.

---

## Palette

| Token         | Hex       | Usage                                        |
|---------------|-----------|----------------------------------------------|
| `--paper`     | `#f4eee2` | Page background — warm cream                 |
| `--paper-2`   | `#fdfbf6` | Card surfaces — near-white                   |
| `--paper-3`   | `#f6f0e4` | Subtle alternate backgrounds                 |
| `--ink`       | `#211d17` | Headlines, primary text                      |
| `--ink-soft`  | `#4f4839` | Body copy, secondary text                    |
| `--muted`     | `#968d7c` | Captions, meta, disabled text                |
| `--terra`     | `#d8461d` | Primary accent — terracotta (CTAs, active)   |
| `--terra-dk`  | `#b6381a` | Hover state for terra                        |
| `--saffron`   | `#e07b1d` | Secondary accent — saffron (highlights)      |
| `--gold`      | `#a47a30` | Tertiary — links, refs, subtle accents       |
| `--line`      | `#e6dbc6` | Borders, dividers                            |
| `--success`   | `#2d7d46` | Success feedback                             |
| `--error`     | `#c23b22` | Error feedback                               |

**Rule:** Never use raw hex in components. Always reference tokens.

---

## Typography

| Role        | Font              | Weight   | Size (desktop)         |
|-------------|-------------------|----------|------------------------|
| Display     | Fraunces          | 500      | clamp(1.9rem, 5vw, 2.9rem) |
| Heading     | Fraunces          | 500–600  | 1.2–1.4rem             |
| Body        | Newsreader        | 400      | 0.92–0.95rem, lh 1.65  |
| UI / Sans   | Inter             | 400–600  | 0.82–0.95rem           |
| Mono / Meta | JetBrains Mono    | 500–700  | 0.65–0.75rem           |
| Hindi       | Noto Sans Devanagari | 400–600 | inherit              |
| Gujarati    | Noto Sans Gujarati   | 400–600 | inherit              |

**Rules:**
- Max 780px content width — never wider.
- Line height: body 1.65, headings 1.3, mono 1.4.
- Letter spacing: mono labels 0.08–0.16em uppercase. Display -0.015em.

---

## Spacing scale (rem)

`0.25 · 0.4 · 0.55 · 0.75 · 1 · 1.25 · 1.5 · 2 · 3`

Section gaps: `2rem`. Card padding: `1.25–1.5rem`. Inline gaps: `0.4–0.75rem`.

---

## Radius

| Element          | Radius   |
|------------------|----------|
| Card             | `12px`   |
| Button (pill)    | `20px`   |
| Button (rect)    | `8px`    |
| Input            | `8px`    |
| Chip / pill      | `20px`   |
| Modal            | `14px`   |

---

## Shadows

| Level    | Value                                     | Usage              |
|----------|-------------------------------------------|---------------------|
| Rest     | `0 1px 3px rgba(80,50,20,0.06)`          | Cards, buttons      |
| Hover    | `0 4px 14px rgba(80,50,20,0.12)`         | Elevated hover      |
| Modal    | `0 12px 40px rgba(30,20,10,0.25)`        | Overlays, modals    |

---

## Transitions

| Property          | Duration | Easing      |
|-------------------|----------|-------------|
| Color / bg / border | 150ms  | ease        |
| Transform (hover)   | 120ms  | ease        |
| Reveal (max-height) | 400ms  | ease        |
| Opacity (fade)      | 300ms  | ease        |
| Skeleton pulse      | 1.8s   | ease-in-out, infinite |

---

## Interactive states

Every interactive element must have **all** of these:

| State    | Visual treatment                                        |
|----------|---------------------------------------------------------|
| Default  | Rest shadow, default colors                             |
| Hover    | `translateY(-1px)`, elevated shadow, color shift        |
| Focus    | `2px solid var(--saffron)` outline, `2px` offset        |
| Active   | `translateY(0)`, rest shadow                            |
| Disabled | `opacity: 0.45`, `cursor: default`, no pointer-events  |
| Loading  | Content replaced by skeleton pulse or spinner           |

**Focus rule:** `:focus-visible` only (not on click). Outline color: `var(--saffron)`.

---

## Loading states

| Component      | Loading treatment                                     |
|----------------|-------------------------------------------------------|
| Daily verse    | Skeleton: title bar + 3 text lines + ref pill         |
| Answer         | Pulsing dots animation below question                 |
| Mood sheet     | Skeleton: 3 card placeholders                         |
| Maharaj Asks   | Skeleton: question line + ref line                    |
| Browse cards   | Already server-rendered — no skeleton needed          |
| Question chips | Already static — no skeleton needed                   |

Skeleton color: `var(--line)` with `var(--paper-3)` pulse.

---

## Error states

| Scenario           | Treatment                                               |
|--------------------|---------------------------------------------------------|
| Gemini unavailable | Inline banner: "Our AI is resting. Try again shortly."  |
| Network failure    | Same banner with retry button                           |
| Empty search       | Friendly message: "No teachings found. Try rephrasing." |
| API timeout        | Auto-retry once, then show error with retry             |

Error banner: `var(--error)` left border, `var(--paper-2)` background. Never use alert().

---

## Empty states

| Section              | Empty treatment                                     |
|----------------------|-----------------------------------------------------|
| Saved answers (0)    | "No saved answers yet. Ask a question to begin."    |
| Search results (0)   | "We couldn't find a match. Try different words."    |

---

## Component patterns

### Cards
- Background: `var(--paper-2)`
- Border: `1px solid var(--line)`
- Radius: `12px`
- Padding: `1.25rem`
- Hover: lift + shadow

### Buttons — Primary
- Background: `var(--terra)`
- Color: `#fff`
- Radius: `8px` (rect) or `20px` (pill)
- Hover: `var(--terra-dk)`, lift
- Disabled: `opacity: 0.45`
- Loading: text replaced with spinner

### Buttons — Ghost
- Background: transparent
- Border: `1px solid var(--line)`
- Hover: `var(--paper-2)` bg, `var(--terra)` text

### Inputs
- Background: `var(--paper-2)`
- Border: `1px solid var(--line)`
- Radius: `8px`
- Focus: `var(--saffron)` border, subtle glow
- Placeholder: `var(--muted)`

### Chips
- Background: `var(--paper-2)`
- Border: `1px solid var(--line)`
- Radius: `20px`
- Hover: lift, border darkens

### Modals
- Overlay: `rgba(30,20,10,0.55)` + `backdrop-filter: blur(4px)`
- Panel: `var(--paper)`, radius `14px`, shadow level 3
- Close button: top-right, `var(--gold)` text

### Eyebrow labels
- Font: mono, 0.7rem, uppercase
- Letter spacing: 0.12–0.16em
- Color: `var(--terra)`

---

## Accessibility

- All interactive elements: focusable, `:focus-visible` outline
- Icon buttons: `aria-label` describing action
- Images: `alt` text or `role="presentation"`
- Modals: `aria-modal="true"`, focus trap, Esc to close
- Color contrast: minimum 4.5:1 for text, 3:1 for large text
- Touch targets: minimum 44px × 44px on mobile
- Skip-to-content link for keyboard users
- `prefers-reduced-motion`: disable animations

---

## Responsive breakpoints

| Name    | Max-width | Notes                                |
|---------|-----------|--------------------------------------|
| Desktop | —         | 780px max content, 5-col mood grid   |
| Tablet  | 768px     | Same layout, tighter padding         |
| Mobile  | 500px     | 4-col mood grid, stacked header      |
| Tiny    | 360px     | 3-col mood grid                      |

---

## Animations

- **Entrance:** `translateY(10px) → 0`, `opacity 0 → 1`, 350ms ease, staggered 45ms
- **Hover lift:** `translateY(-1px)`, 120ms
- **Skeleton pulse:** `@keyframes pulse { 0%,100%{opacity:0.4} 50%{opacity:0.8} }`, 1.8s
- **Reveal:** `max-height: 0 → 600px`, `opacity: 0 → 1`, 400ms ease
- **Respect `prefers-reduced-motion`:** all animations → `animation: none`, transitions → 0ms
