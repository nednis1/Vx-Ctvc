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

## 🧠 Cognitive Minimalism Standards & Universal UI/UX Design Philosophy

> [!IMPORTANT]
> **MASTER DESIGN DIRECTIVE: COGNITIVE MINIMALISM & ZERO VISUAL FRICTION**
>
> Across all user repositories (**UbiBot**, **VosSolar / DSM**, **VosTrack**, **Employee Relations**, and **VOSCCTV**), the user's explicit design decisions and removal git history codify an uncompromising standard:
> **Every pixel must convey actionable operational value. Interfaces exist for domain operators, not marketing showcases.**

### 🚫 The 10 Explicitly Prohibited UI Anti-Patterns

1. **No Superfluous Status Badges, State Pills, or Diagnostic Chips**:
   - **Never** place decorative status pills next to titles, buttons, or inside headers (e.g., `HARDWARE SECURITY GATEWAY`, `LIVE`, `AUTO`, `MANUAL LIMITS`, `STABLE`, `ACTIVE RULES`, `CLIENT GPU`, `GPU`).
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
   - **Never** trigger toast notifications or popup banners for routine user actions or background state changes (e.g., "Switched to Light Mode", "Stream quality: Main HD", "Connecting stream...", "Feed minimized", "Filtered cameras", "Telemetry refreshed", "Digital zoom active").
   - **Ambient Inline Visual State**: Confirm user actions visually through the element itself—toggled active classes, subtle borders, depression states (`transform: scale(0.96)`), or icon state flips.
   - **Strict Toast Whitelist**: Toasts (`showToast`) are strictly reserved for:
     1. High-priority hardware alarms or critical sensor faults.
     2. Asynchronous API or network failures (`Failed to connect`, `Network offline`).
     3. Explicit destructive mutations (`Camera renamed`, `Preset deleted`).
     4. Form validation errors and clipboard confirmations (`Copied`).

6. **No Gratuitous Animations, Sci-Fi Backdrops, or Pulsing Dots**:
   - **Never** add sci-fi background scanlines, gridline overlays (`32px 32px`), radial glow vignettes, pulsing heartbeat dots, or decorative keyframes on static elements (e.g., `@keyframes pulseTour`, `@keyframes pulseDockRec`, `@keyframes pulseDotRec`).
   - Continuous CSS animations drain GPU/CPU cycles, distract the operator's eye, and degrade video streaming performance. Animations must be strictly reserved for genuine user transitions (e.g., smooth drawer opens or tab switches).

7. **No Redundant Controls or Duplicate Data Presentations**:
   - **Single Source of Truth**: If an action is served by a primary interface element (e.g. bottom dock or right-click menu), never duplicate it in secondary floating buttons, header bars, or multiple toolbars simultaneously.
   - Do not duplicate data across adjacent components (e.g., top-bar titles repeating the active sidebar view, or chart headers repeating numbers already visible on the feed card).

8. **No Explanatory Helper Paragraphs, Marketing Subtitles, or Decorative Icons**:
   - Eliminate verbose explanatory paragraphs, marketing subtitle blocks, and category headers (e.g., remove "Dahua Dual NVR Surveillance Console", "Hardware Security Gateway", "Protected Dahua Gateway").
   - Never place decorative encircled `info` icons in headers, and remove decorative emojis (`👤`, `🔒`, `👁️`, `→`, `⚡`, `📹`, `🎮`, `💾`, `⛶`, `🚪`) from form fields, headers, menus, and action buttons.
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
- **Unshrunk Scrollable Slots (`minSlotW` Sizing) — Never Cram All Slots Into One View**:
  - Default `COLS: Auto` + `SIZE: Large` (`380px+` min slot width; `XL`: `640px+`, `Medium`: `260px+`) preserves clear, unshrunk camera feeds and relies on vertical scrolling (`overflow-y: auto`) when total rows exceed viewport height.
  - On portrait phones ($\le 620\text{px}$), default `Large` renders 1 full-width column per row instead of shrinking feeds into narrow miniature columns.
  - Only explicit `SIZE: Fit Screen` (or `1x1` / `SPLIT: 1`) scales slots to fit inside a single viewport without scrolling, while explicit `COLS` overrides let operators force `1`, `2`, `3`, or `4` columns when desired.
- **Off-Canvas Mobile Drawers**:
  - Left device/camera tree collapses into an off-canvas slide-out drawer on devices $\le 1024\text{px}$, dismissed with backdrop taps or swipe-left gestures.
  - PTZ drawer acts as an off-canvas drawer on mobile, preserving full-bleed video feeds without obstruction.

---

## 📐 Cross-Platform UI/UX Engineering Standards (PC & Mobile)

Codified from **WCAG 2.2**, **Apple Human Interface Guidelines (HIG)**, **Google Material Design 3 (M3)**, **Nielsen Norman Group (NN/g)** usability heuristics, **Fitts's & Hick's Laws**, **ISO 11064-5 / High-Performance HMI (HPHMI)** control-room standards, and **Core Web Vitals (`INP`, `CLS`)**.

### 1. Universal Control-Room & Accessibility Baseline
- **WCAG 2.2 Color & Contrast (`SC 1.4.3`, `SC 1.4.11`)**:
  - Normal text must achieve **$\ge 4.5:1$ contrast** (Level AA), targeting **$\ge 7:1$** (Level AAA) for daylight Light Mode visibility.
  - Large text ($\ge 18\text{pt}$ regular or $\ge 14\text{pt}$ bold) and interactive UI components/borders/icons must achieve **$\ge 3:1$ contrast** against adjacent backgrounds.
  - **Color-Blind & CVD Redundancy**: Color must never be the sole carrier of meaning; pair status colors (`online`, `offline`, `fault`, `recording`) with crisp labels, tooltips, or shape/opacity states (e.g., strict greyed-out disabled states).
- **ISO 11064-5 / HPHMI ("Quiet Screen" Philosophy)**:
  - Use calm dark-slate chrome (`#020617` / `#0f172a` dark, `#f8fafc` / `#ffffff` daylight) with crisp `1px` flat borders instead of skeuomorphic gradients or neon glows to prevent 8–12 hour operator fatigue.
  - Reserve saturated alert hues (`red`, `amber`) strictly for abnormal hardware states, critical faults, or active recording—never decorative badges.
- **Core Web Vitals for Live Monitoring**:
  - **Interaction to Next Paint (`INP` $\le 200\text{ms}$)**: All buttons, slot selections, toggles, and drawers must respond instantaneously without main-thread stalls during concurrent live video decoding.
  - **Cumulative Layout Shift (`CLS` $= 0$)**: Always reserve fixed dock heights, header heights, and explicit grid cell dimensions (`gridAutoRows`, fixed aspect containers) so loading feeds or async labels never shift UI targets under an operator's pointer or thumb.

### 2. PC / Desktop Workstation Standards (`@media (pointer: fine)`, $\ge 1025\text{px}$)
- **Fitts's Law & Target Acquisition (`WCAG 2.2 SC 2.5.8`)**:
  - Interactive pointer hit areas must be at least **$24 \times 24\text{ CSS px}$** (spacing adjacent compact controls so 24px bounding circles never intersect), with primary toolbars/docks sized at **$30\text{px} - 36\text{px}$** height for high-accuracy density without sacrificing speed.
  - Anchor persistent strips (top header, left camera tree sidebar, bottom slot dock, right PTZ drawer) flush against viewport edges so cursor travel stops naturally at screen boundaries.
- **Hick's Law & Multi-Column Spatial Efficiency (NN/g)**:
  - Use a non-overlapping **3-column workstation flow** (`Sidebar | Fluid Live Wall Grid | Optional PTZ Inspector`) using container-aware sizing (`container-type: inline-size` / `ResizeObserver`) so toggling panels expands usable feed width without occluding streams.
  - Consolidate complex grid modes (`Split`, `Columns`, `Slot Size`, `Aspect`, `Engine`) into compact single-select dropdowns instead of sprawling multi-button toolbars.
- **Keyboard Focus & Power-Operator Flows (`WCAG 2.2 SC 2.4.11`, `SC 2.4.13`)**:
  - Preserve high-contrast `:focus-visible` outlines ($\ge 2\text{px}$ perimeter) and ensure focused controls are never hidden underneath fixed bars or overlays (`SC 2.4.11`).
  - Support mouse hover previews, native browser tooltips (`title`), drag-and-drop camera assignment, right-click context menus (`contextmenu`), double-click `1x1` expand, and keyboard shortcuts (`Alt+T`, `Escape`, arrow navigation).
- **Zero Outer Page Scroll**: Root viewport stays locked (`100dvh`, `overflow: hidden`); only dedicated inner panes (camera tree list and multi-row video grid) scroll cleanly.

### 3. Mobile & Touch Handheld Standards (`@media (pointer: coarse)`, $\le 1024\text{px}$)
- **Touch Target Dimensions & Mis-Tap Prevention (Apple HIG, Material Design 3, WCAG `SC 2.5.5`)**:
  - Primary touch targets should target **$40 \times 40\text{px} - 48 \times 48\text{ CSS px}$** (aligning with Apple HIG **$44 \times 44\text{ pt}$** and Material Design 3 **$48 \times 48\text{ dp}$**); compact secondary buttons must remain **$\ge 34\text{px} - 38\text{px}$** with expanded touch padding and **$\ge 6\text{px} - 8\text{px}$** gaps between adjacent destructive/critical controls.
  - **Zero Hover-Only Functionality**: Every control accessible via PC `:hover` or right-click must be directly reachable via tap controls in the mobile bottom dock or drawer toggles.
- **One-Handed Thumb-Zone Ergonomics & Bottom-Bar Primacy**:
  - Primary operational controls live in the **bottom operational dock (`.gpu-dock-bar`)** inside the natural thumb arc (bottom 40% of screen); keep `.vosctv-bar` minimal and strictly single-row (`flex-wrap: nowrap`) to maximize vertical feed real estate.
  - On portrait phones ($\le 640\text{px}$), split `.gpu-dock-bar` cleanly into a two-tier ergonomic thumb cockpit (camera/slot title strip above touch-sized action buttons).
- **Dynamic Viewport Units & Hardware Safe Areas**:
  - Always size full-screen roots with **`100dvh`** (`100vh` fallback) so mobile browser URL bars appearing/disappearing never cut off the bottom dock.
  - Apply `env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`, `env(safe-area-inset-left)`, and `env(safe-area-inset-right)` across top header, drawers, and bottom dock to clear iOS notches/Dynamic Island and home-indicator swipe bars.
- **Touch Gestures, Horizontal Swipe Strips & Auto-Zoom Prevention**:
  - Apply `touch-action: manipulation` on clickable controls to eliminate tap delay and accidental double-tap browser zoom; apply `overscroll-behavior: contain` on drawers/scrollers to prevent rubber-band bleed.
  - Horizontally scrollable toolbars (`.bar-right`, `.gpu-toolbar`) must use `scrollbar-width: none`, `-webkit-overflow-scrolling: touch`, and `flex: 0 1 auto; margin-left: auto; justify-content: flex-start;` when constrained so leftmost items never clip out of scroll reach.
  - Keep text inputs on mobile **$\ge 16\text{px}$** where appropriate to prevent unintended iOS Safari auto-zoom on input focus.
- **Portrait vs. Landscape & Off-Canvas Adaptation**:
  - **Portrait Phones ($\le 620\text{px}$)**: Default `COLS: Auto` + `SIZE: Large` (`380px+`) renders 1 full-width column per row with smooth vertical scroll instead of shrinking multi-camera tiles below readable size.
  - **Landscape Phones (`max-height: 540px` & `orientation: landscape`)**: Compact the top header and toolbar (`34px`) so wide 16:9 streams retain maximum vertical viewing area.
  - **Off-Canvas Drawers**: Tree sidebar ($\le 1024\text{px}$) and PTZ controls open as slide-over drawers with tap-backdrop and swipe-dismiss support.

### 4. Codified Mobile Ergonomic Mandates (Thumb-Zone & Gesture Architecture)
To deliver true single-handed surveillance operations on smartphones ($\le 640\text{px}$), the mobile interface strictly follows nine ergonomic mandates:
1. **Single-Row Bottom Cockpit Primacy**:
   - The mobile bottom bar (`.gpu-dock-bar`) flattens into a clean, single-row 40px cockpit (`[ Cameras ] [ Grid ] ── Title ── [ Camera Options ]`).
   - All core drawer triggers and options reside within the bottom 40% thumb zone, preserving maximum vertical feed real estate.
2. **Direct Canvas Slot Selection & Zero Stepper Redundancy**:
   - Grid slots are selected directly by tapping on the video feeds themselves, with 1x1 focus mode cycled via double-tap or horizontal feed swipe.
   - Redundant in-dock slot steppers (`◀`, `Slot 1`, `▶`) and slot pills are eliminated from the mobile bottom bar.
3. **Unified Camera Options Bottom Sheet (`#gpu-options-sheet`)**:
   - Sprawling horizontal button strips in the dock are collapsed into a single thumb trigger (`#dock-btn-cam-options`).
   - Tapping `Camera Options` opens a non-blocking bottom sheet housing all per-slot controls:
     `1x1 Focus`, `Quality: SUB/HD`, `Aspect: Fit/Stretch/Crop`, `Snapshot`, `Audio`, `Record Clip`, `Digital Zoom`, `PTZ Controls`, `NVR Playback`, `Reconnect Stream`, and `Close Feed`.
   - Each control provides live inline visual feedback of active hardware state.
4. **Scroll Affordances & Horizontal Edge Fades**:
   - Horizontally scrollable strips (`.gpu-dock-center`, `.gpu-toolbar`) must feature CSS alpha edge masks (`mask-image: linear-gradient(...)`) to signal hidden overflow cleanly without permanent scrollbars.
5. **Natural Touch & Swipe Gestures**:
   - **Edge Swipe**: Swiping right from the left edge of the screen ($\le 30\text{px}$) smoothly opens the off-canvas Cameras tree drawer.
   - **Feed Swipe in 1x1 Focus**: Swiping left or right across a camera feed in `1x1` Focus mode (when digital zoom is not active) advances or retreats to the next active slot.
6. **Destructive Protection & Non-Blocking Modals**:
   - Destructive buttons (e.g., `Logout`) must maintain a minimum of $8\text{px}$ separation from adjacent controls to prevent mis-taps.
   - Never use blocking browser dialogs (`window.prompt()`, `window.alert()`). Presets, layouts, and mutations must use styled, non-blocking bottom sheets or `<dialog>` elements with inline name entry and deletion.
   - Toolbar inputs and dropdowns must use `font-size: 16px` on coarse pointers to avoid unwanted iOS Safari viewport auto-zooming.
7. **Thumb-Zone Grid & Split Quick Sheet (`#gpu-grid-sheet`)**:
   - Central grid configuration (Split 1/2/4/6/9/16, Columns Auto/1/2/3/4, Slot Size Large/Fit, Presets, and Batch Quick Actions) must be accessible from within the bottom 40% thumb zone on mobile via `#dock-btn-grid`. Operators must never be forced to stretch to the sub-top toolbar on smartphones.
8. **Bottom Sheet Downward Swipe Dismiss & Virtual Keyboard Auto-Retract**:
   - Bottom sheets (`#gpu-preset-dialog`, `#gpu-grid-sheet`) must support downward swipe-to-dismiss (`dy > 70px`) with touch drag handles (`.sheet-drag-handle`).
   - Camera search input must feature an inline one-tap clear button (`✕`, `#gpu-cam-search-clear`).
   - Tapping any camera in the device drawer must immediately blur the active input (`document.activeElement.blur()`), auto-retracting the virtual keyboard before closing the drawer.
9. **One-Tap Stalled Stream Recovery & Tactile Micro-Haptics**:
   - Stalled or disconnected video feeds (e.g. following cellular or Wi-Fi handoffs) must display a calm "Stream Offline • Tap to Reconnect" affordance.
   - Tapping directly on a stalled slot immediately re-initiates its individual WebRTC/MSE socket without full-page reloads or disruption of sibling camera feeds.
   - Core touch operations (steppers, slot switching, 1x1 toggle, camera selection, and reconnect) deliver subtle 10ms micro-haptic feedback (`navigator.vibrate`) on supported handheld devices.

### 5. Quick-Reference Standard Matrix (PC vs. Mobile)

| Dimension | PC / Desktop (`pointer: fine`) | Mobile / Touch (`pointer: coarse`) |
| :--- | :--- | :--- |
| **Target Size Minimum** | $\ge 24 \times 24\text{ CSS px}$ (`SC 2.5.8`); $30\text{–}36\text{px}$ toolbar height | $40 \times 40\text{px}$ to $48 \times 48\text{px}$ (HIG `44pt` / M3 `48dp`; $\ge 34\text{px}$ dense strips) |
| **Target Spacing** | Clean $4\text{–}8\text{px}$ gaps; non-intersecting 24px bounds | $\ge 6\text{–}8\text{px}$ spacing around destructive/critical buttons |
| **Primary Control Zone** | Screen-edge docks & 3-column in-flow workspace | Bottom Operational Dock (bottom 40% thumb zone) + single-row header |
| **Secondary Inputs** | Keyboard shortcuts, `:hover` tooltips, drag-drop, right-click menu | Tap buttons, off-canvas drawers, backdrop tap & horizontal swipe gestures |
| **Grid Density Default** | Multi-column auto-grid based on pane width (`380px+` per slot) | 1 full-width column per row on portrait phones (`<= 620px`) |
| **Viewport & Edge Safety** | `100dvh` fixed shell; `ResizeObserver` + container queries | `100dvh` + `env(safe-area-inset-*)` on top bar, drawers & bottom dock |
| **Touch / Click Latency** | Instant `INP <= 200ms`, zero layout shift (`CLS = 0`) | `touch-action: manipulation`, `overscroll-behavior: contain`, `INP <= 200ms` |
| **Contrast (WCAG 2.2)** | $\ge 4.5:1$ text / $\ge 3:1$ UI controls (Dark control room) | $\ge 7:1$ target in Light Mode for direct outdoor daylight legibility |

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
- **Grid Layouts & Dynamic Columns**: Central grid supports 1, 2, 4, 6, 9, 16, 25, and 32 split views with scrollable full-size feeds by default (`SIZE: Large` = `380px+`).
- **Flexible Columns & Workspace Layout**:
  - **Feed Grid**: Explicit dropdowns (`COLS: Auto | 1 | 2 | 3 | 4` and `SIZE: Large | Extra Large | Medium | Fit Screen`) let operators choose scrollable unshrunk feeds (default) or explicit `Fit Screen`.
  - **Workspace Layout**: On desktop ($\ge 1024\text{px}$), the PTZ inspector docks as an in-flow Column 3 (`gpu-sidebar` | `gpu-main-area` | `gpu-ptz-drawer`), dynamically adjusting the central video grid without covering feeds. Collapsing the sidebar smoothly expands usable grid width without shrinking feeds.
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
