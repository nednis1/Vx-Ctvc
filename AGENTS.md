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
  - **Feed Grid**: Explicit column mode toggles (`COLS: Auto | 2 Cols | 3 Cols`) allow forcing feeds into 2 or 3 wide columns. Container queries (`@container livewall`) reflow feeds dynamically into 2 columns on phones and 3 columns on tablets.
  - **Workspace Layout**: On desktop ($\ge 1024\text{px}$), the PTZ inspector docks as an in-flow Column 3 (`gpu-sidebar` | `gpu-main-area` | `gpu-ptz-drawer`), dynamically adjusting the central video grid without covering feeds. Collapsing the sidebar smoothly transitions the workspace to a 1 or 2 column view.
- **Mobile & Tablet Support**: Responsive layout with touch targets and collapsible sidebar for handheld devices.

### 3. Camera Name Synchronization
- Camera names can be edited inline in the device tree.
- Edits persist locally in `camera-names.json` and can be pushed directly to the Dahua NVR via `/api/rename-camera` (`configManager.cgi?action=setConfig&ChannelTitle[ch].Name=...`).

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

