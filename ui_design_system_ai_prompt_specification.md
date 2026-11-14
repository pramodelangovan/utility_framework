# Cybernetic HUD & Technical Telemetry UI System Specification

This document provides a comprehensive design system, color tokens, layout guidelines, and copy-pasteable AI system prompts for generating futuristic, high-contrast, line-style technical interfaces (inspired by Sci-Fi telemetry and HUD overlays).

---

## 1. Visual & Aesthetic Architecture

* **Core Theme**: Cybernetic Telemetry, Sci-Fi Technical HUD, Precision Vector Wireframe.
* **Background**: Pitch-black (`#07090E`) with an overlay structural grid (`40px × 40px` or `20px × 20px`).
* **Line & Border Philosophy**: Crisp `1px` borders, sharp corners (`0px` border-radius), hollow circle node markers, and technical tick marks (`|----|`).
* **Typography**:
  * **Labels & Metadata**: Ultra-wide letter-spacing (`0.2em`), uppercase, sans-serif (`Inter`, `Roboto`).
  * **Numeric Readouts & Values**: Heavy monospace (`JetBrains Mono`, `Fira Code`), high contrast, with selective neon glow (`text-shadow`).

---

## 2. Color System & Semantic Palettes

### CSS Variables
```css
:root {
  /* Surface & Grid */
  --bg-dark: #07090E;               /* Pitch black base */
  --bg-card: rgba(12, 17, 26, 0.7);  /* Translucent wireframe backdrop */
  --grid-line: rgba(255, 255, 255, 0.06); /* Technical grid background */
  --border-line: rgba(255, 255, 255, 0.15); /* Primary element borders */

  /* Primary Brand / Highlight (Cyan Neon) */
  --primary: #00D4FF;               /* Primary active telemetry cyan */
  --primary-glow: rgba(0, 212, 255, 0.4);
  --primary-dim: #007A99;

  /* Semantic System Status Colors */
  --info: #00D4FF;                  /* Cyan (Telemetry / Default Accent) */
  --info-glow: rgba(0, 212, 255, 0.35);

  --success: #00FF88;               /* Mint Green (System Ready / Pass) */
  --success-glow: rgba(0, 255, 136, 0.35);

  --warning: #FFB800;               /* Neon Amber (Caution / Drift Alert) */
  --warning-glow: rgba(255, 184, 0, 0.35);

  --danger: #FF2E63;                /* Crimson Red (Critical Failure / Out of Bounds) */
  --danger-glow: rgba(255, 46, 99, 0.35);

  /* Text & Labels */
  --text-active: #FFFFFF;           /* Crisp primary numerical value */
  --text-muted: #64748B;            /* Subdued labels & inactive lines */
}
```

---

## 3. Component Specification & Styling Guidelines

### Technical Grid Background
```css
.hud-grid-bg {
  background-color: var(--bg-dark);
  background-image: 
    linear-gradient(to right, var(--grid-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px);
  background-size: 32px 32px;
}
```

### Telemetry Container Card
```css
.hud-card {
  background: var(--bg-card);
  border: 1px solid var(--border-line);
  border-radius: 0px;
  backdrop-filter: blur(8px);
  position: relative;
  padding: 1rem;
}

/* Optional corner accent tick */
.hud-card::before {
  content: '';
  position: absolute;
  top: -1px;
  left: -1px;
  width: 6px;
  height: 6px;
  border-top: 2px solid var(--primary);
  border-left: 2px solid var(--primary);
}
```

### Technical Measurement Line (Dimension Marker)
```css
.measurement-line {
  display: flex;
  align-items: center;
  position: relative;
  height: 20px;
}
.measurement-line::before,
.measurement-line::after {
  content: '';
  width: 1px;
  height: 10px;
  background-color: var(--primary);
}
.measurement-line-bar {
  flex-grow: 1;
  height: 1px;
  background-color: var(--primary);
  box-shadow: 0 0 6px var(--primary-glow);
}
```

---

## 4. Master AI Prompts for Code Generation

Use the following prompts directly when instructing AI models (Cursor, ChatGPT, v0, Claude, GitHub Copilot) to build components or pages matching this aesthetic.

---

### Prompt 1: Single-Page Dashboard / HUD Layout Generator

```text
Act as a Principal Frontend Engineer and UX/UI Designer specializing in Cybernetic HUDs and Sci-Fi Data Visualizations.

Build a single-page React (Tailwind CSS) telemetry dashboard that reproduces the exact design aesthetic of technical wireframe overlays (black grid background, line-style UI elements, uppercase tracked labels, glowing cyan primary accents).

Strict Design Guidelines:
1. Color Palette:
   - Background: #07090E pitch black with CSS grid background (thin 1px grid lines at 6% opacity white).
   - Primary Cyan: #00D4FF with subtle box-shadow/text-shadow glow.
   - Semantic Palette:
     - Info: #00D4FF (Cyan)
     - Success: #00FF88 (Neon Mint)
     - Warning: #FFB800 (Amber Orange)
     - Danger: #FF2E63 (Crimson Red)
   - Neutral/In-Active: Text muted #64748B, borders rgba(255,255,255,0.15).

2. Typography Rules:
   - Labels: Uppercase, tracking-widest (0.2em letter spacing), text-xs, font-sans.
   - Readouts/Values: Bold monospace font (JetBrains Mono/Fira Code), text-2xl or larger.

3. Components to Include:
   - Top Bar: Telemetry header with episode/session details and line-style action buttons.
   - Speed Slider Widget: 1px line track, cyan hollow circular thumb with glow, clear minimum/maximum readout.
   - Telemetry Metrics Strip: 3-column metric cards showing numeric values (e.g., "0.0 M", "-10.8 M", "10.8 M") with uppercase titles above.
   - Main Viewport Card (Side View Wireframe): SVG-based wireframe illustration box with a custom linear dimension marker (`|----------| GAP 10.8 M`) and hollow point nodes (`o o o o`).
   - Secondary Viewport Card (Top View Wireframe): Matching style viewport card showing a top-down view.
   - System Status Bar: Status badges for Info, Success, Warning, and Danger alerts using the defined color palette.

4. Implementation Constraint:
   - Generate all code in a single self-contained React component file using standard Tailwind CSS classes and inline CSS for dynamic neon glow/grid parameters.
```

---

### Prompt 2: Tailwind CSS Configuration & Theme Extension

```text
Provide a `tailwind.config.js` extension block for a Cybernetic Line-Style HUD UI theme.

Include:
- Custom background colors (pitch-black #07090E, card translucent black).
- Custom neon accents: primary cyan (#00D4FF), info (#00D4FF), success (#00FF88), warning (#FFB800), danger (#FF2E63).
- Monospace font family configuration.
- Extended box-shadow and text-shadow definitions for neon glow effects.
- Custom border radius definitions (forced sharp corners: 0px).
```

---

### Prompt 3: Reusable Component Library Generator (React + Tailwind)

```text
Generate a set of reusable React components adhering to the Sci-Fi Technical Line UI design system:

1. <HudCard title="LABEL">: Translucent backdrop, 1px thin border, sharp corners, corner tick mark, uppercase label header.
2. <HudMetricLabel title="TRUCK MOVED" value="10.8 M" unit="" variant="primary|success|warning|danger">: Large monospace metric readout with appropriate color glowing accent.
3. <HudDimensionLine label="GAP 10.8 M" color="#00D4FF">: CSS/SVG technical dimension bar with end ticks (`|-------|`) and centered inline text.
4. <HudSlider min={0} max={100} value={50} label="CAMERA SPEED VS ROAD">: Technical range slider with thin line track, glowing hollow thumb, and monospace readouts.
5. <HudStatusBadge type="info|success|warning|danger" text="REAL TIME 0.39 S" />: Sharp status tag with neon border and glow.
```
```

---

### Summary of Included Prompt Tools
1. **Design Architecture & Tokens**: Fully specified CSS variables and color palettes including semantic colors (Info, Success, Warning, Danger).
2. **Layout & Component Rules**: Typography, grid overlay, card styling, and dimension line guidelines.
3. **Copy-Paste AI Prompts**: Three targeted prompts for generating a complete React telemetry dashboard, configuring Tailwind CSS, or creating individual reusable UI components.