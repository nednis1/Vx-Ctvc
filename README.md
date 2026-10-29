# AnyDesk CCTV NVR Remote Console Dashboard

A custom **AnyDesk-style Remote Control Dashboard** designed for dual Dahua NVR systems:
- **NVR 1 (Main Operations)**: `192.168.1.200`
- **NVR 2 (Secondary Operations)**: `192.168.1.181`

---

## 🚀 Features

- **1:1 AnyDesk Experience**:
  - Live interactive remote desktop session for each Dahua NVR.
  - Complete remote input control: click, drag, PTZ, search, review playback, and configure system settings without leaving the unified dashboard.
  - Bypasses browser `X-Frame-Options: SAMEORIGIN` and `Content-Security-Policy` via dedicated low-latency gateway proxies.
  - Full bidirectional **WebSocket (`ws://`)** proxying to ensure Dahua Web 5.0 live video streams operate without interruption.
- **Dual NVR Tabs & Split Screen**:
  - **NVR 1 Tab**: Dedicated remote console for `192.168.1.200`.
  - **NVR 2 Tab**: Dedicated remote console for `192.168.1.181`.
  - **Dual Split-View**: Side-by-side or stacked multi-monitor view to monitor both NVRs simultaneously.
- **AnyDesk Remote Action Ribbon**:
  - Fullscreen toggle (`F11` or button).
  - Session Reconnect / Refresh.
  - Display scale modes (`Fit Screen`, `100% Original`, `Stretch`).
  - Popout button to open NVR in a dedicated browser window.
  - Credentials Helper with 1-click copy buttons for `admin` and saved passwords.
- **Floating Physical PTZ Joystick Controller**:
  - Draggable & collapsible overlay widget.
  - 8-direction D-Pad (Up, Down, Left, Right, Diagonals) with continuous press-to-pan.
  - Optical Zoom (`+` / `-`), Focus (`Near` / `Far`), and Iris controls.
  - Speed slider (1–8) and Preset quick recall (Presets 1–4).
  - Relays commands directly via Dahua CGI API.
- **Health & RTSP Stream Matrix**:
  - Real-time TCP port health monitoring for HTTP (`:80`), RTSP (`:554`), and Dahua Private Protocol (`:37777`).
  - Live latency ping meter.
  - Pre-generated RTSP stream URLs for external viewers like VLC, OBS, or Milestone.

---

## 📦 Ports & Architecture

| Port | Service | Target |
| :--- | :--- | :--- |
| **8090** | AnyDesk Dashboard & API | Web UI (`http://localhost:8090`) |
| **8091** | NVR 1 Gateway Proxy | `http://192.168.1.200:80` (with WS upgrade) |
| **8092** | NVR 2 Gateway Proxy | `http://192.168.1.181:80` (with WS upgrade) |

---

## ⚡ Quick Start

### 1. Start the Server
From this directory, run:
```bash
npm start
```
*(Or `node server.js`)*

### 2. Open the Dashboard
Open your browser and navigate to:
```
http://localhost:8090
```
*(Or from any device on the local network: `http://<your-machine-ip>:8090`)*

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Alt + 1` | Switch to NVR 1 (192.168.1.200) |
| `Alt + 2` | Switch to NVR 2 (192.168.1.181) |
| `Alt + S` | Switch to Dual Split-View |
| `Alt + M` | Switch to Health & RTSP Matrix |
| `Alt + P` | Toggle Floating PTZ Joystick |
| `F11` | Toggle Immersive Fullscreen |
