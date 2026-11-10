# AGENTS.md

Instructions, operational constraints, and architecture guidelines for AI agents working in this repository.

---

## ⚠️ Critical Rule: Server Execution

> [!CAUTION]
> **NEVER START THE SERVER AUTOMATICALLY.**
>
> - **Do NOT** run `node server.js`, `npm start`, `npm run dev`, or launch any background process or daemon that starts the server unless the user **explicitly and directly requests it** in their prompt (e.g., *"start the server"*, *"run the app"*).
> - **Do NOT** restart or boot up the server as a side-effect of editing files, building, or checking code.
> - For syntax verification, use static checks only:
>   ```powershell
>   node --check server.js
>   node --check public/js/gpu-wall.js
>   node --check public/js/app.js
>   ```
> - When finishing changes or answering questions, inform the user of what was updated so they can start or restart the server themselves when ready.

---

## 🔄 Git Workflow: Detailed Commit & Push Policy

> [!IMPORTANT]
> **COMMIT AND PUSH AFTER EVERY SYSTEM CHANGE.**
>
> - After every system change, feature implementation, bug fix, or configuration update, AI agents **MUST commit and push** all affected files to the remote repository (`main`).
> - Commit messages must be **properly detailed and descriptive**, adhering to conventional commit guidelines (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`) to clearly state what was modified and why.
> - Never leave finished work uncommitted or unpushed in the workspace.
>
> **Standard execution workflow:**
> ```powershell
> # 1. Static validation (never boot the server)
> node --check server.js
> node --check public/js/gpu-wall.js
> node --check public/js/app.js
>
> # 2. Stage modified and new files
> git add <files>
>
> # 3. Detailed commit
> git commit -m "<type>(<scope>): <properly detailed explanation of changes>"
>
> # 4. Push to remote
> git push origin main
> ```

---

## 🏛️ System Architecture

This project is a high-performance **VOSCTV / AnyDesk-style CCTV NVR Wall & Remote Console Dashboard** designed for dual Dahua NVRs:

| Component | Target IP / Host | Default Port | Description |
| :--- | :--- | :--- | :--- |
| **VOSCTV Dashboard** | `localhost` | `8090` | Web UI, API routes, Digest auth relays |
| **NVR 1 Proxy** | `192.168.1.200` | `8091` | Gateway proxy with WebSocket upgrade for NVR 1 |
| **NVR 2 Proxy** | `192.168.1.181` | `8092` | Gateway proxy with WebSocket upgrade for NVR 2 |
| **go2rtc Gateway** | `127.0.0.1` | `1984` / `8555` | WebRTC / RTSP low-latency GPU bridge |

---

## 🎨 Universal UI/UX Design Philosophy & Master Rules

> [!IMPORTANT]
> **MASTER DESIGN DIRECTIVE: COGNITIVE MINIMALISM & ZERO VISUAL FRICTION**
>
> Across all user repositories (**UbiBot**, **VosSolar / DSM**, **VosTrack**, **Employee Relations**, and **VOSCCTV**), the user's explicit design decisions and removal git history codify an uncompromising standard:
> **Every pixel must convey actionable operational value. Interfaces exist for domain operators, not marketing showcases.**

### 🚫 The 10 Explicitly Prohibited UI Anti-Patterns

1. **No Superfluous Status Badges, State Pills, or Diagnostic Chips**:
   - **Never** place decorative status pills next to titles, buttons, or inside headers (e.g., `HARDWARE SECURITY GATEWAY`, `LIVE`, `AUTO`, `MANUAL LIMITS`, `STABLE`, `ACTIVE RULES`).
   - System state must be conveyed naturally through the controls themselves (e.g. an active toggle, dropdown selection, or direct form values). Badges create visual noise, draw false focus, and duplicate obvious state.
   - *Exception*: Badges are strictly reserved for actionable operational states, critical hardware errors, faults, or genuine device health alerts (`Offline`, `Fault`, `Warning`).

2. **No "Boxes Within Boxes" (Nesting Anti-Pattern)**:
   - **Never** nest cards within cards within container panels (e.g., outer card ➔ inner enclosure box ➔ inner panel ➔ individual input cards).
   - Surfaces must render directly as clean, standalone, flat planes without multi-layered stacked borders or nested card margins.
   - Form inputs must be direct controls with embedded labels/units, never wrapped in individual mini-card enclosures.

3. **No Horizontal Sprawl — Prioritize Vertical Hierarchy & Thumb Ergonomics**:
   - Reject stretched horizontal arrangements and sprawling rows of buttons.
   - Consolidate sprawling horizontal button strips into sleek, compact dropdown selectors (e.g., `Split: 1 | 2 | 4 | 6...` ➔ dropdown; `Cols: Auto | 2 | 3` ➔ dropdown).
   - Arrange directional limits and parameters in intuitive vertical "thermometer" order (Max / High Limit on top, Min / Low Limit on bottom), never horizontal side-by-side grids.
   - **Mobile Thumb Ergonomics & Bottom-Bar Primacy**:
     - **The user explicitly prefers the bottom-bar on mobile view**: All primary operational controls must reside in the dedicated bottom bar (`.gpu-dock-bar`).
     - **Mobile view must be dynamic and ergonomic**: Smartphone surveillance interfaces must be operable with one hand within the natural reach zone (bottom 40% viewport).
     - Controls must feature generous touch targets ($\ge 34\text{px} - 44\text{px}$), finger-friendly padding, safe-area inset preservation (`env(safe-area-inset-bottom)`), and smooth horizontal swipe navigation.

4. **No Alarming, Hysterical, or Flashing Visual Feedback**:
   - **Never** use flashing card borders, bright red outline rings, shaking keyframe animations (`@keyframes shake`), or screaming amber/red full-card backgrounds.
   - Missing or connecting feeds must be rendered as calm, quiet placeholders or subtle dashes (`---`), never panic-inducing warning boxes or flashing banners.
   - Alerts and excursions must use quiet in-place data coloring (e.g., text transitioning cleanly to rose-red or steady semantic status dots) rather than jarring animations.

5. **No Disruptive Popups, Routine Toasts, or Action Spam**:
   - **Never** trigger toast notifications or popup banners for routine user actions or background state changes (e.g., "Switched to Light Mode", "Connecting stream...", "Feed minimized", "Filtered cameras", "Telemetry refreshed").
   - **Ambient Inline Visual State**: Confirm user actions visually through the element itself—toggled active classes, subtle borders, depression states (`transform: scale(0.96)`), or icon state flips.
   - **Strict Toast Whitelist**: Toasts (`showToast`) are strictly reserved for:
     1. High-priority hardware alarms or critical sensor faults.
     2. Asynchronous API or network failures (`Failed to connect`, `Network offline`).
     3. Explicit destructive mutations (`Camera renamed`, `Preset deleted`).
     4. Form validation errors and clipboard confirmations (`Copied`).

6. **No Gratuitous Animations, Sci-Fi Backdrops, or Pulsing Dots**:
   - **Never** add sci-fi background scanlines, gridline overlays (`32px 32px`), radial glow vignettes, pulsing heartbeat dots, or decorative keyframes on static elements.
   - Continuous CSS animations drain GPU/CPU cycles, distract the operator's eye, and degrade video streaming performance. Animations must be strictly reserved for genuine user transitions (e.g., smooth drawer opens or tab switches).

7. **No Redundant Controls or Duplicate Data Presentations**:
   - **Single Source of Truth**: If an action is served by a primary interface element (e.g. bottom dock or right-click menu), never duplicate it in secondary floating buttons, header bars, or multiple toolbars simultaneously.
   - Do not duplicate data across adjacent components (e.g., top-bar titles repeating the active sidebar view, or chart headers repeating numbers already visible on the feed card).

8. **No Explanatory Helper Paragraphs, Marketing Subtitles, or Decorative Icons**:
   - Eliminate verbose explanatory paragraphs, marketing subtitle blocks, and category headers (e.g., remove "Dahua Dual NVR Surveillance Console", "Hardware Security Gateway", "Protected Dahua Gateway").
   - Never place decorative encircled `info` icons in headers, and remove decorative emojis (`👤`, `🔒`, `👁️`, `→`) from form fields and action buttons.
   - Secondary explanations, unit formulas, and technical guides belong inside native browser hover tooltips (`title` attribute) on the relevant label or icon—never occupying layout space.

9. **Zero "AI Slop", Synthetic Controls, or Fake Data**:
   - Never introduce speculative controls, synthetic charts, fake physics/demo tickers, or simulated buttons not connected to real hardware.
   - Never use "AI" as a decorative buzzword prefix (e.g., use "Auto Columns", not "AI Smart Columns").
   - Telemetry and status must represent 100% verified hardware state. When data is unavailable or offline, render honest placeholders (`---`), never plausible synthetic numbers.

10. **Non-Destructive Workflows & Respect for Operator Inputs**:
    - Forms and dialogs must never wipe input out from under the user. On sign-in failure, preserve the username and only clear/refocus the password.
    - Video playback and live monitoring must never be interrupted by sudden modal takeovers or layout shifting.
    - Touch targets, drag-and-drop assignments, keyboard shortcuts, and right-click context menus must be responsive, fast, and predictable.

---

### 🎨 Visual & Theme Standards

#### A. Canvas / Feed Primacy (Zero Video Obstruction)
- **The Video Feed is the Primary Product**: All surveillance slots must display video unobstructed.
- Never render persistent top bars, overlay buttons, opaque headers, or controls over the video canvas.
- All controls live docked in the dedicated bottom bar (`.gpu-dock-bar`) or slide-out drawer, preserving 100% full-bleed feeds.

#### B. Dual-Theme Optimization & Semantic Contrast
- **Dark Mode (`#020617` / `#0f172a`)**: Default for low-light surveillance control rooms. High contrast without eye-straining bright panels, neon glows, or heavy drop shadows. Crisp 1px borders (`#1e293b`).
- **Light Mode (`#f8fafc` / `#ffffff`)**: Crisp, high-contrast theme maintaining WCAG AAA daylight legibility (`#0f172a` text on `#ffffff` surfaces) for operators in direct sunlight.
- **Zero Hardcoded Colors**: Always use theme variables (`var(--bg-dark)`, `var(--bg-card)`, `var(--text-main)`, `var(--border-card)`) rather than hardcoded hex values.

#### C. Progressive Disclosure of Information
Structure information across three progressive levels to prevent operator cognitive overload:
- **Level 1 (At-a-Glance Canvas)**: 100% video feed, camera name, and subtle hardware state indicator (LED dot).
- **Level 2 (Dock Controls)**: Stream quality, aspect ratio, 1x1 focus, snapshot, record, audio, zoom, and PTZ triggers.
- **Level 3 (Deep Diagnostics & Management)**: In-flow PTZ drawer (Column 3), NVR stream proxies, bitrates, WebRTC gateway stats, and Dahua channel configurations.

#### D. Mobile Dynamic Layout & Ergonomic Bottom-Bar
- **The Bottom Bar is the Preferred Mobile Cockpit**: The user explicitly loves and prioritizes the bottom-bar on mobile view. The bottom dock (`.gpu-dock-bar`) houses all active slot manipulations (slot switcher, camera title, stream quality, aspect ratio, snapshot, record, audio, zoom, 1x1 focus, and PTZ triggers) within easy thumb reach.
- **Dynamic Mobile Viewport Ergonomics**:
  - Smartphone surveillance interfaces must be fully operable with one hand within the natural reach zone (bottom 40% viewport).
  - Touch targets must be generous ($\ge 34\text{px} - 44\text{px}$) with comfortable tap spacing.
  - Safe-area insets (`padding-bottom: max(6px, env(safe-area-inset-bottom))`) prevent collisions with edge-to-edge phone navigation bars.
  - Horizontal swipe navigation: Both `.gpu-dock-bar` and `.gpu-toolbar` must support smooth momentum-based horizontal scrolling (`-webkit-overflow-scrolling: touch`) with hidden scrollbars (`scrollbar-width: none`), never wrapping awkwardly onto multiple staggered lines.
- **Dynamic Container Query Reflow (`@container livewall`)**:
  - Single slot on ultra-narrow portrait devices ($\le 380\text{px}$).
  - 2 columns dynamic reflow on mobile phones ($\le 620\text{px}$).
  - 3 columns dynamic reflow on tablets and compact viewports ($621\text{px} - 1080\text{px}$).
- **Off-Canvas Mobile Drawers**:
  - Left device/camera tree collapses into an off-canvas slide-out drawer on devices $\le 1024\text{px}$, dismissed with smooth backdrop taps.
  - PTZ drawer acts as an off-canvas drawer on mobile, preserving full-bleed video feeds without obstruction.

---

## 🎯 Key Design & Functional Rules

### 1. PTZ & Capability Detection
- **Physical Camera Reality**: Cameras currently connected are fixed ONVIF H42 IP cameras (`DeviceType=H42, Vendor=Onvif`). None are motorized PTZ cameras.
- **Dahua Speed Dome Bug**: Do **not** use `ptz.cgi?action=getCurrentProtocolCaps` alone for detection. Dahua NVRs return `caps.Pan=true` based on their internal firmware template driver (`DH-SD`), even for fixed cameras or empty slots.
- **Authoritative PTZ Check**: Always check `table.Ptz[ch].ProtocolName` from `/cgi-bin/configManager.cgi?action=getConfig&name=Ptz`. A channel is only PTZ-capable if `ProtocolName` is not `"NONE"` and not empty.
- **UI Disabling**: Fixed cameras must have their PTZ dock button, drawer, and context menu items strictly greyed out (`opacity: 0.28`, `cursor: not-allowed`, `pointer-events: none`). PTZ badges must not appear on fixed cameras in the tree.

### 2. Video Feed Layout & UX
- **100% Full-Bleed Video (Zero Obstruction)**: Feed slots must display video unobstructed. No persistent top bars, overlay buttons, or controls over the video canvas.
- **Docked Controls**: All active slot controls (1x1 focus, snapshot, manual record, aspect ratio, quality stream selector, digital zoom, PTZ, audio, close) reside in the dedicated bottom bar (`.gpu-dock-bar`).
- **Aspect Ratio Control**: Support cycle between `contain` (Fit), `fill` (Stretch), and `cover` (Crop).
- **Grid Layouts & Dynamic Columns**: Central grid supports 1, 2, 4, 6, 9, 16, 25, and 32 split views.
- **2-Column & 3-Column Dynamic UI**:
  - **Feed Grid**: Explicit column mode dropdowns (`COLS: Auto | 2 Cols | 3 Cols`) allow forcing feeds into 2 or 3 wide columns. Container queries (`@container livewall`) reflow feeds dynamically into 2 columns on phones and 3 columns on tablets.
  - **Workspace Layout**: On desktop ($\ge 1024\text{px}$), the PTZ inspector docks as an in-flow Column 3 (`gpu-sidebar` | `gpu-main-area` | `gpu-ptz-drawer`), dynamically adjusting the central video grid without covering feeds. Collapsing the sidebar smoothly transitions the workspace to a 1 or 2 column view.
- **Mobile & Tablet Support**: Responsive layout with touch targets and collapsible sidebar for handheld devices.

### 3. Camera Name Synchronization
- Camera names can be edited inline in the device tree.
- Edits persist locally in `camera-names.json` and can be pushed directly to the Dahua NVR via `/api/rename-camera` (`configManager.cgi?action=setConfig&ChannelTitle[ch].Name=...`).

### 4. Feature Capability & UI Greying-Out Policy
- **Strict Greying-Out**: If a camera cannot use a feature (due to missing hardware, fixed lens, audio absence, offline feed, or empty slot), the control **must be strictly greyed out and disabled**:
  - Apply `disabled = true`, class `.disabled`, `opacity: 0.28 !important`, `cursor: not-allowed !important`, `pointer-events: none !important`, and `filter: grayscale(1) !important`.
  - Dim any associated status LED dots and provide an informative tooltip explaining why the feature is unavailable.
- **Feature Capability Matrix**:
  - **PTZ**: Greyed out if camera is fixed-lens (`ProtocolName === "NONE"` or empty). Controls in bottom dock, right-click context menu, and PTZ drawer are fully disabled.
  - **Live Audio**: Greyed out if camera lacks microphone hardware (`caps.audio === false`) or if the live stream is connecting/offline (`!videoPlaying`).
  - **Digital Zoom, Snapshot, Local Recording**: Greyed out whenever the live video feed is connecting or offline (`!videoPlaying`), or if the client browser lacks `MediaRecorder`/stream capture APIs.
  - **Empty Slots**: All slot actions (quality, aspect, zoom, PTZ, audio, record, snapshot, 1x1, close) must be completely greyed out and unclickable.

---

## 🛠️ Validation Commands

Always run non-destructive checks when editing code:
```powershell
# Validate JavaScript syntax without starting any service
node --check server.js
node --check public/js/gpu-wall.js
node --check public/js/app.js

# Git status
git status -s
```
