# FFmpeg Studio — DESIGN.md

> Reverse-engineered visual design system, extracted from source (`src/style.css`, `tailwind.config.js`, `index.html`, `src/nav.ts`, and the `src/views/**` + `src/components/**` components).
> Format follows the Google Stitch `DESIGN.md` spec. Every value below is taken from the actual codebase, not guessed.

---

## 1. Visual Theme & Atmosphere

FFmpeg Studio is a **calm, tool-first desktop workbench** for audio/video processing — and it wears its "tool" identity proudly. The surface is a soft **lilac-tinted light theme** by default (page canvas `#F6F4FE`, a barely-there purple that reads as "neutral but friendly"), with a **true dark mode** that drops to a deep slate (`#0F172A`) rather than pure black. The brand accent is a single, disciplined **violet** (`#7C3AED` light / `#8B5CF6` dark) — used as the *only* chromatic anchor. Everything else is grayscale derived from the page/panel/line ramp.

This is not a marketing site. It's a **command center**: dense forms, monospace command previews, status dots, and a persistent left nav of 15+ processing modules. The aesthetic is *quiet productivity* — generous 20px card padding, 8–16px radii that feel rounded but never bubbly, and a whisper-thin card shadow (`0 1px 3px / 6%`) so panels float just barely above the canvas. The violet appears exactly where action lives: the active nav item, the primary button, focus rings, and the drag-over outline. Restraint is the whole point — a beginner could find any feature, a power user never feels boxed in.

**Key characteristics:**
- Single-hue brand (violet) on a near-achromatic neutral ramp; color is *signal*, not decoration.
- Dual-theme via CSS custom properties; light = lilac canvas, dark = deep slate. No separate palettes to maintain.
- 4px-based spacing grid (Tailwind default) with a consistent 20px card interior (`p-5`).
- Monospace (`JetBrains Mono`) reserved strictly for *commands, paths, and technical tokens* — never body copy.
- Status is shown with small filled dots + semantic text colors, never large color blocks.
- Subtle, fast transitions (150ms) on color/background; `prefers-reduced-motion` fully honored.
- Accessibility-aware: semantic text colors are stepped (700/600 light, 400 dark) to hold contrast; the violet *text* variant is lifted in dark mode to clear 5:1.

---

## 2. Color Palette & Roles

All colors are defined as **space-separated RGB components** in `:root` / `html.dark` and consumed as `rgb(var(--token) / <alpha>)`. This is what lets Tailwind's `bg-brand/20`, `text-muted`, etc. work. Below, hex is the resolved value; tokens ending in `-h` are "hover/active" shades.

### Brand & Accent
- **Brand Violet** (`--brand` → `#7C3AED` light / `#8B5CF6` dark): the one accent. Solid fills (primary buttons, active chips), left accent bar on active nav, focus rings, drag outline.
- **Violet Ink** (`--brand-fg` → `#7C3AED` light / `#A78BFA` dark): violet used for *text and icons*. Light = same as brand; **dark = lifted to violet-400** because brand-violet on a dark panel only hits ~3.5:1.
- **Deep Violet** (`--brand-h` → `#6D28D9` light / `#7C3AED` dark): hover/active shade for solid brand fills (`hover:bg-brandd`).
- **On Brand** (`--on-brand` → `#FFFFFF`): foreground on brand fills — always white.

### Background Surfaces (darkest → lightest)
- **Canvas** (`--bg` → `#F6F4FE` light / `#0F172A` dark): page background, painted on `html`/`body`/`#app` because the Tauri window itself is white.
- **Panel** (`--panel` → `#FFFFFF` light / `#1E293B` dark): cards, sidebar, inputs' *container* chrome, toasts. The "raised" surface.
- **Line / Chip** (`--line` → `#E0DAF2` light / `#334155` dark): borders, dividers, secondary "chip" surfaces, inactive button fills (`bg-panel2`).
- **Sunk** (`bg-ink/40`, `bg-ink/50`, `bg-ink/70`): inputs and nested wells sit at 40–70% of canvas alpha to read as *recessed*.

### Text & Content (brightest → dimmest)
- **Primary** (`--text` → `#1E1B33` light / `#EDF2FC` dark): body, headings, values. Dark mode is *not* pure white (slightly desaturated to avoid glare).
- **Muted** (`--muted` → `#6B6584` light / `#9CAABE` dark): labels, captions, secondary text, inactive icons. Dark muted is lifted above slate-400 so small text on `--line` chips stays legible.

### Semantic
- **Success / OK** (`--ok` → `#047857` emerald-700 light / `#34D399` emerald-400 dark): "done", success toasts. Light steps *down* to 700 (600 on white is only 3.8:1); dark steps *up* to 400.
- **Warning** (`--warn` → `#B45309` amber-700 light / `#FBBF24` amber-400 dark): warnings.
- **Danger / Error** (`--err` → `#DC2626` red-600 light / `#F87171` red-400 dark): failures, error toasts, failure counts.
- Status dots may use *solid* Tailwind defaults directly (`bg-emerald-500`, `bg-red-500`) — small, non-text, exempt from the semantic-token rule.

### Border & Divider
- **Hairline** (`--line`): the only border color. 1px on cards/inputs, 2px dashed on dropzones.
- Overlay scrim: `bg-black/50` on the mobile sidebar backdrop (light mode only; `lg:hidden`).

### Overlay & Special
- **Glow ring** (`shadow-glow`): `0 0 0 1px rgb(var(--brand)/.25), 0 8px 30px -8px rgb(var(--brand)/.35)` — dropzone hover, skip-link.
- **Nav active gradient**: `linear-gradient(90deg, rgb(var(--brand)/.22), rgb(var(--brand)/.10))` + `inset 3px 0 0 0 rgb(var(--brand))`.

---

## 3. Typography Rules

Two families only. Both loaded from Google Fonts (`index.html`), weights explicit.

- **Sans — Plus Jakarta Sans** (`"Plus Jakarta Sans", sans-serif`): every UI string. Loaded 300 / 400 / 500 / 600 / 700 / 800.
- **Mono — JetBrains Mono** (`"JetBrains Mono", monospace`): command preview (`.cmd`), file paths, technical tokens. Loaded 400 / 500. `.cmd` is fixed at `12.5px / line-height 1.7`.

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|----------------|-------|
| Display / Stat number | Sans | 24px (`text-2xl`) | 800 (extrabold) | 32px | normal | Dashboard counters |
| H1 / Page title | Sans | 20px (`text-xl`) | 700 (bold) | 28px | normal | Topbar title |
| H2 / Card title | Sans | 16px (`text-base`) | 700 (bold) | 24px | normal | `h3.font-bold` |
| H3 / Sub-section | Sans | 14px (`text-sm`) | 600 (semibold) | 20px | normal | |
| Body / Default | Sans | 14px (`text-sm`) | 400 | 20px | normal | primary reading size |
| Body Small | Sans | 12px (`text-xs`) | 400 | 16px | normal | table cells, hints |
| Label / Caption | Sans | 11px (`text-[11px]`) | 600 (semibold) | 14px | normal | `th`, micro captions |
| Button | Sans | 14px (`text-sm`) | 600/700 | 20px | normal | primary = bold |
| Code / Command | Mono | 12.5px | 400/500 | 1.7 | normal | `.cmd`, path inputs |

**Notes:** Letter-spacing is left at the font default everywhere — the system is clean, not tracked-out. Headings lean on weight (700/800) rather than size jumps. Monospace is the *only* signal that text is machine-generated (a command, a path) — never used for prose.

---

## 4. Component Stylings

All radii: `rounded-md` = 6px, `rounded-lg` = 8px, `rounded-xl` = 12px, `rounded-2xl` = 16px, `rounded-full` = pill. Every interactive element shares one focus style: `outline 2px solid brand, offset 2px, radius 6px`.

### Buttons
**Primary** — `w-full py-3 rounded-lg bg-brand text-white font-bold hover:bg-brandd transition-colors disabled:opacity-50`
- bg `#7C3AED` (light) / `#8B5CF6` (dark), white text, bold; hover → `--brand-h`; disabled → opacity .5.

**Secondary** — `flex-1 py-2.5 rounded-lg bg-panel2 hover:bg-brand/20 text-sm font-medium`
- default: bg `--line`, text `--text`; hover → 20% brand tint.

**Danger (icon)** — `w-7 h-7 rounded-lg bg-panel2 hover:bg-red-500/30 text-muted hover:text-err`
- square 28px; hover → red tint + red text.

**Text link** (`.lk`) — `cursor:pointer; hover { background:transparent; opacity:.65 }`. No fill, just fade.

**Ghost / border action** — `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-panel2 text-sm hover:border-brand hover:bg-brand/5 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed`
- outlined tertiary button (toolbar actions: pause / retry / clear). Hover only re-tints border + 5% brand wash; never fills.

**Inline text action** — `inline-flex items-center gap-1 text-xs text-muted hover:text-brand hover:bg-brand/10 rounded-md px-1.5 py-1 transition-colors`
- compact row action (view / retry / remove in task list).

### Cards
`.card` = `bg-panel + 1px solid line + card-shadow`, then `rounded-2xl p-5` (16px radius, 20px padding). Stat cards shrink to `p-4`. Hover is *not* on cards — only interactive children react.
**Command card** (CommandCard) — same `.card`, with a header row (title `font-semibold text-sm` + a "复制" text button `text-muted hover:text-brand`) and a `<pre class="cmd bg-ink/70 rounded-xl p-3 text-brand whitespace-pre-wrap break-all">` command block (brand-colored mono on sunk bg), plus a full-width `py-2.5 rounded-lg bg-brand text-white font-bold hover:bg-brandd` run button.

### Inputs & Selects
`w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none`
- recessed (canvas-tinted bg), 1px line border, focus → brand border. Path/command fields add `font-mono`.

### Slider (range)
`<input type="range" class="slider w-full">`, styled by `.slider { accent-color: rgb(var(--brand)) }`. Native control, but track + thumb are recolored to brand violet. No custom track height (4px native).

### Checkbox / Toggle
`<input type="checkbox" class="accent-brand" />` — native checkbox recolored to brand via `accent-color`; honors `:disabled`. The project uses checkboxes as on/off toggles ("normalize", "faststart", "deint"…) rather than custom switches — no separate switch component exists.

### Segmented control (SegGroup)
`.seg-btn px-3 py-1 rounded-md border border-panel2 text-xs` per option; active → `.seg-btn.active` (`bg-brand, color white (rgb(var(--on-brand))), font-weight 600, border-color brand`). `disabled` → `opacity-50 cursor-not-allowed`. Mutually-exclusive small choices.

### Navigation item (sidebar)
`px-3 py-2 rounded-lg hover:bg-panel2/50` + active `.nav-active`:
- active: gradient `brand/22 → brand/10` bg, text `--brand-fg`, `inset 3px 0 0 0 brand` left bar, icon turns brand.
- icon default color = `--muted`.

### Dropzone
`rounded-xl border-2 border-dashed border-panel2 bg-ink/40 p-6/8 text-center hover:border-brand hover:bg-brand/5 hover:shadow-glow transition-all`
- drag-over → `.drop-ring`: `outline 2px dashed brand, offset 4px`.

### Progress bar
Track: `h-1 rounded-full bg-panel2 overflow-hidden mt-1.5`. Fill: `h-full bg-brand transition-all duration-300` + inline `width:%`. Indeterminate (progress < 0) → add `animate-pulse`. Used in the task queue for running jobs.

### Topbar (app header)
`h-16 shrink-0 flex items-center justify-between px-6 border-b border-panel2 bg-panel/80 backdrop-blur`. Title `font-bold text-lg` + `text-xs text-muted` subtitle. Uses **80%** panel opacity (not 60%) — at 60% the darker page greys it out. Native backdrop blur.

### Icon button
`w-9 h-9 rounded-lg border border-panel2 flex items-center justify-center hover:border-brand transition-colors cursor-pointer` (icon `text-muted`). Square 36px, 1px line border, hover → brand border. Theme toggle / menu / tasks buttons share this.

### Notification badge (on icon)
`absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center` — small count pill over an icon button (e.g. task-queue count).

### Badges / Pills
Running-task count: `text-[11px] font-semibold text-white bg-brand rounded-full min-w-[18px] h-[18px] px-1.5 flex items-center justify-center`. Same pattern reused for the nav badge.

### Info table
`.info-table`: `width:100%; border-collapse:separate; font-size:13px`. `th` = `text-[11px] font-semibold text-muted`, **sticky top**, `bg-panel` + 4% text tint, `border-bottom line`. `td` = `px-10/7 py, border-bottom line`. Key column `.k` = muted, `white-space:nowrap`, `width:1%`. Row hover → `bg-brand/5`. Last row no border. Used for media-info property tables and stream lists.

### Toast
`fixed bottom-6 right-6 max-w-xs bg-panel border border-panel2 shadow-lg rounded-xl px-4 py-3 text-sm` + leading status dot (`bg-emerald-500` / `bg-brand` / `bg-red-500`). Entrance: `toastIn` 0.22s ease-out (translateY 12px→0).

### Status dot & mapping
`w-2 h-2 rounded-full` dot (icon-badge variant `w-4 h-4`). Engine-ready = brand, down = red-500; toast = emerald/brand/red. Task-status mapping: **running → brand**, **done → ok (emerald)**, **failed/canceled → err (red)**, **queued → muted**.

---

## 5. Layout Principles

- **App shell:** `flex h-screen overflow-hidden`. Left `Sidebar` (`w-64` = 256px) + `main flex-1 flex flex-col`; content scroll area is `flex-1 overflow-y-auto p-6` (24px padding).
- **Sidebar:** 256px wide, `bg-panel border-r line`. Header `h-16` (64px) with logo tile (`w-9 h-9 rounded-xl bg-brand/15`). Nav body `py-3 px-3 space-y-1`. Footer: settings + engine-status row.
- **Topbar:** 64px tall, `bg-panel/80 + backdrop-blur`, bottom hairline. Holds page title + subtitle (left) and theme/tasks icon buttons (right).
- **No global max-width** on the content column — it fills the window (desktop app). Internal grids manage density.
- **Grid patterns observed:**
  - Stat cards: `grid-cols-2 md:grid-cols-4 gap-4`.
  - Quick-start buttons: `grid-cols-2 md:grid-cols-4 gap-3`.
  - Dashboard main: `lg:grid-cols-3` with a `lg:col-span-2` feature block + 1 sidebar column, `gap-6`.

### Spacing scale (Tailwind 4px base — token → px → usage)
| Token | px | Usage |
|-------|----|-------|
| `p-4` | 16 | stat cards, list wells |
| `p-5` | 20 | standard card interior |
| `p-6` | 24 | content scroll area, large blocks |
| `px-3 py-2` | 12 / 8 | inputs, nav items, chips |
| `px-4 py-3` | 16 / 12 | toasts, primary-ish buttons |
| `py-2.5` / `py-3` | 10 / 12 | button heights |
| `gap-3` | 12 | inline groups, list rows |
| `gap-4` | 16 | stat grid |
| `gap-6` | 24 | section grid |
| `space-y-4/5/6` | 16/20/24 | vertical stacks inside cards |

**Whitespace philosophy:** breathe. Cards never crowd — 20px interior, 16–24px between sections. Forms stack with 16–24px rhythm. The canvas lilac does the heavy lifting of separating panels, so borders stay hairline-thin.

---

## 6. Depth & Elevation

The system is **almost flat by default** — elevation is a signal, used sparingly.

### Shadow system
| Level | Token / CSS | Usage |
|-------|-------------|-------|
| Flat (resting) | `--card-shadow`: `0 1px 3px rgb(30 27 51 / .06)` (light) / `0 1px 3px rgb(0 0 0 / .35)` (dark) | cards, inputs, wells |
| Raised | `shadow-lg` (Tailwind): `0 10px 15px -3px rgb(0 0 0/.1), 0 4px 6px -4px rgb(0 0 0/.1)` | toast |
| Floating / Glow | `shadow-glow`: `0 0 0 1px rgb(var(--brand)/.25), 0 8px 30px -8px rgb(var(--brand)/.35)` | dropzone hover, skip-link |
| Inset accent | `inset 3px 0 0 0 rgb(var(--brand))` | active nav left bar |
| Focus | `outline 2px solid brand, offset 2px` | all interactive focus-visible |

### Surface hierarchy (darkest → highest)
1. **Canvas** `#F6F4FE` / `#0F172A` — the floor.
2. **Sunk wells** `bg-ink/40–70` — inputs, nested lists (recessed).
3. **Panel** `#FFFFFF` / `#1E293B` — cards, sidebar (the standard raised surface).
4. **Line / Chip** `#E0DAF2` / `#334155` — inactive buttons, dividers.
5. **Brand fill** `#7C3AED` / `#8B5CF6` — primary actions (highest chromatic weight).
6. **Overlay** `bg-black/50` scrim (mobile sidebar) → toast floats above all.

> Critical: in **dark mode the card shadow must be black**, not `rgb(var(--text))` — using `--text` (near-white) paints a white halo. The codebase encodes this explicitly per theme.

---

## 7. Do's and Don'ts

**✅ Do**
- Drive **every** color from the CSS-variable tokens (`bg-brand`, `text-muted`, `border-panel2`). Never hardcode a raw hex in components.
- Use violet **only** for action/state. Keep the rest grayscale.
- Step semantic text colors per theme: **700/600 light, 400 dark** — contrast is non-negotiable.
- Use `--brand-fg` (not `--brand`) for violet **text/icons** in dark mode.
- Paint `bg-ink` on every page/root — the Tauri window is white and will show through.
- Reserve `font-mono` strictly for commands/paths.
- Recess inputs with `bg-ink/40`; raise cards with `bg-panel`.
- Honor `prefers-reduced-motion` (the codebase kills all transitions/animations).

**❌ Don't**
- Don't use `--brand` as text/icon color in dark mode (3.5:1 fail) — use `--brand-fg`.
- Don't hardcode `text-red-500` / `text-amber-500` / `text-emerald-500` for *status text* — they fail contrast on one theme. Use `--ok/--warn/--err`. (Solid `bg-*` dots/tints are fine.)
- Don't shadow with `rgb(var(--text))` in dark — you'll get a white halo. Use `--card-shadow`.
- Don't add a global `:active { transform: translateY(1px) }` — it overrides real transforms (e.g. centered `-translate-x-1/2` buttons jump).
- Don't make a view component **multi-root** (Fragment) if it's toggled with `v-show` — the directive silently fails and content leaks to every page.
- Don't fake a control: if a param can't take effect, disable it or say so — UI must tell the truth.
- Don't hand-maintain the nav list in more than one place — it lives only in `src/nav.ts`.

---

## 8. Responsive Behavior

Breakpoints are Tailwind defaults: `sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536`. The app is **desktop-first** (Tauri window) but degrades to a usable narrow layout.

| Name | Width | Behavior |
|------|-------|----------|
| Mobile / narrow | < 1024 | Sidebar becomes `fixed` overlay (`-translate-x-full`), toggled from Topbar; backdrop `bg-black/50` scrim (`lg:hidden`); stat grid → 2 cols |
| `md` | ≥ 768 | Stat cards & quick-start buttons → 4 cols; grids expand |
| `lg` | ≥ 1024 | Sidebar `static` (always visible); main splits into 3-col dashboard (2 + 1) |

**Touch targets:** primary/secondary buttons `py-2.5–3` (~40–44px); nav items `py-2 + px-3` (~36px); quick-start buttons `py-3`. Icon-only danger buttons are 28px (desktop-acceptable, not mobile-optimized).

**Collapsing strategy:**
- **Nav:** full sidebar → off-canvas drawer with scrim below `lg`.
- **Card grids:** 4-col → 2-col (`md`/`grid-cols-2`) on narrow.
- **Dashboard sections:** 3-col (2+1) → single stacked column below `lg`.
- **Hero text / headings:** size is fixed (no fluid scaling) — desktop app assumes a minimum window width.

---

## 9. Agent Prompt Guide

### Quick Color Reference (copy-paste)
```css
/* Light */
--bg:#F6F4FE; --panel:#FFFFFF; --line:#E0DAF2; --text:#1E1B33; --muted:#6B6584;
--brand:#7C3AED; --brand-fg:#7C3AED; --brand-h:#6D28D9; --on-brand:#FFFFFF;
--ok:#047857; --warn:#B45309; --err:#DC2626;

/* Dark */
--bg:#0F172A; --panel:#1E293B; --line:#334155; --text:#EDF2FC; --muted:#9CAABE;
--brand:#8B5CF6; --brand-fg:#A78BFA; --brand-h:#7C3AED; --on-brand:#FFFFFF;
--ok:#34D399; --warn:#FBBF24; --err:#F87171;
```
Fonts: `"Plus Jakarta Sans", sans-serif` (300–800) · `"JetBrains Mono", monospace` (400/500). Radius: md 6 / lg 8 / xl 12 / 2xl 16. Spacing base 4px.

### Ready-to-use prompts
1. **Dashboard / overview page** — *"Build a dashboard with a 4-up stat row (today done / running / queued / failed) using white cards on a `#F6F4FE` canvas, each with an 11px muted label, a 24px extrabold number, and a small brand-colored sub-label. Below, a 3-column grid: a 2-col-span dropzone card (dashed border, hover turns brand + glow) plus a 'recent files' card. Use Plus Jakarta Sans, 20px card padding, 16px radii."*

2. **Processing / form page** — *"Create a processing panel: a white `.card` (16px radius, 20px padding, hairline border, 6% shadow) containing a recessed `bg-ink/40` dropzone at top, then a vertical form stack (16–24px rhythm) of label + recessed input (`border line, focus → brand, font-mono for paths`). End with a full-width primary button: violet `#7C3AED` bg, white bold text, hover → `#6D28D9`, disabled opacity .5. Desktop-first, sidebar layout."*

3. **Sidebar nav item** — *"Render a nav list item: 14px text, `px-3 py-2 rounded-lg`, muted icon by default. Active state = left inset 3px brand bar + `linear-gradient(90deg, rgba(124,58,237,.22), rgba(124,58,237,.10))` bg + brand-colored text/icon. Hover (inactive) = 50% line tint."*

4. **Status / toast component** — *"Make a bottom-right toast: white panel, 1px line border, `shadow-lg`, 12px radius, 16/12 padding, 14px text, with a 8px status dot (emerald for success, violet for info, red for error) and a 0.22s slide-up entrance. Honor prefers-reduced-motion."*

5. **Command card** — *"Build a command-preview card: white panel, 16px radius, 20px padding. Header row with a `font-semibold` title and a muted '复制' text button (hover → brand). Body is a `<pre>` in JetBrains Mono, 12.5px, brand-colored text on `bg-ink/70`, rounded-xl, padded, wrapping. Footer is a full-width violet button '加入队列并运行'."*

6. **Task row with progress** — *"Render a task list row: panel card, 16px radius. Left a 8px status dot (running=brand, done=emerald, failed=red, queued=muted). Title + meta line in 14px. When running, a 4px-tall track (`bg-line rounded-full overflow-hidden`) with a brand fill whose width = progress%, pulse when indeterminate. Row action icons are 12px muted, hover → brand."*
