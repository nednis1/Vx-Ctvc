/**
 * VOSCCTV GPU Live Wall
 * Client-side WebRTC Video Grid with 100% Client GPU Hardware Acceleration
 */

(function () {
  const state = {
    currentNvr: 'nvr1',       // 'nvr1' | 'nvr2' | 'both'
    currentSplit: 4,          // 1, 4, 9, 16, 32
    currentSubtype: 'sub',     // 'sub' (fast low-cpu) | 'hd' (1080p/4K)
    page: 0,                  // For pagination (e.g., channels 1-16 or 17-32)
    peerConnections: new Map(), // channelKey -> RTCPeerConnection
    cameraNames: { nvr1: {}, nvr2: {} },
    focusedChannel: null,
    previousSplit: 4
  };

  /**
   * Fetch custom camera names from server
   */
  async function loadCameraNames() {
    try {
      const res = await fetch('/api/camera-names');
      if (res.ok) {
        state.cameraNames = await res.json();
      }
    } catch (e) {
      console.warn('[GPU Wall] Could not load camera names:', e);
    }
  }

  function getCameraTitle(nvrId, channel) {
    if (state.cameraNames[nvrId] && state.cameraNames[nvrId][channel]) {
      return state.cameraNames[nvrId][channel];
    }
    const nvrLabel = nvrId === 'nvr1' ? 'NVR 1' : 'NVR 2';
    return `${nvrLabel} - CAM ${channel.toString().padStart(2, '0')}`;
  }

  /**
   * Close all active WebRTC peer connections
   */
  function disconnectAll() {
    state.peerConnections.forEach((pc, key) => {
      try {
        pc.close();
      } catch (e) {}
    });
    state.peerConnections.clear();
  }

  /**
   * Disconnect a single channel
   */
  function disconnectChannel(streamKey) {
    const pc = state.peerConnections.get(streamKey);
    if (pc) {
      try { pc.close(); } catch (e) {}
      state.peerConnections.delete(streamKey);
    }
  }

  /**
   * Connect a video element to a go2rtc WebRTC stream
   */
  async function connectWebRtc(streamKey, videoEl, spinnerEl) {
    disconnectChannel(streamKey);

    try {
      if (spinnerEl) spinnerEl.style.display = 'flex';

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      state.peerConnections.set(streamKey, pc);

      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          videoEl.srcObject = event.streams[0];
          videoEl.play().catch(() => {});
          if (spinnerEl) spinnerEl.style.display = 'none';
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
          console.warn(`[GPU Wall] WebRTC ${streamKey} state: ${pc.iceConnectionState}`);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const res = await fetch(`/api/go2rtc/webrtc?src=${streamKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp
      });

      if (!res.ok) {
        throw new Error(`Gateway returned HTTP ${res.status}`);
      }

      const answerSdp = await res.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (err) {
      console.warn(`[GPU Wall] Connection error for ${streamKey}:`, err.message);
      if (spinnerEl) {
        spinnerEl.innerHTML = `<span style="color:#ef4444;font-size:11px;">Feed Offline</span>`;
      }
    }
  }

  /**
   * Determine list of channels to render based on current filter & pagination
   */
  function getVisibleChannels() {
    const channels = [];

    if (state.focusedChannel) {
      return [state.focusedChannel];
    }

    const nvrList = state.currentNvr === 'both' ? ['nvr1', 'nvr2'] : [state.currentNvr];
    const totalSlots = state.currentSplit;

    if (state.currentNvr === 'both') {
      // Split between NVR 1 and NVR 2
      const perNvr = Math.max(1, Math.floor(totalSlots / 2));
      for (let ch = 1; ch <= perNvr && ch <= 32; ch++) {
        channels.push({ nvrId: 'nvr1', channel: ch });
        channels.push({ nvrId: 'nvr2', channel: ch });
      }
    } else {
      const startCh = (state.page * totalSlots) + 1;
      for (let i = 0; i < totalSlots; i++) {
        const ch = startCh + i;
        if (ch <= 32) {
          channels.push({ nvrId: state.currentNvr, channel: ch });
        }
      }
    }

    return channels;
  }

  /**
   * Render the video grid
   */
  async function renderGrid() {
    const gridContainer = document.getElementById('gpu-grid-container');
    if (!gridContainer) return;

    disconnectAll();
    gridContainer.innerHTML = '';

    const channels = getVisibleChannels();
    const split = state.focusedChannel ? 1 : state.currentSplit;

    // Apply grid class based on split
    gridContainer.className = `gpu-grid split-${split}`;

    channels.forEach((item) => {
      const streamKey = `${item.nvrId}_ch${item.channel}${state.currentSubtype === 'hd' ? '_hd' : ''}`;
      const title = getCameraTitle(item.nvrId, item.channel);
      const isNvr1 = item.nvrId === 'nvr1';

      const card = document.createElement('div');
      card.className = 'gpu-card';
      card.dataset.channel = item.channel;
      card.dataset.nvr = item.nvrId;

      card.innerHTML = `
        <div class="gpu-card-header">
          <div class="gpu-cam-info">
            <span class="gpu-cam-badge ${isNvr1 ? 'badge-nvr1' : 'badge-nvr2'}">${isNvr1 ? 'NVR 1' : 'NVR 2'}</span>
            <span class="gpu-cam-ch">CH ${item.channel.toString().padStart(2, '0')}</span>
            <span class="gpu-cam-title" title="${title}">${title}</span>
          </div>
          <div class="gpu-cam-actions">
            <button class="gpu-action-btn ${state.currentSubtype === 'hd' ? 'active-hd' : ''}" data-act="toggle-hd" title="Toggle HD/Sub Stream">${state.currentSubtype.toUpperCase()}</button>
            <button class="gpu-action-btn" data-act="snapshot" title="Take Snapshot">📷</button>
            <button class="gpu-action-btn" data-act="focus" title="Expand Camera">⛶</button>
          </div>
        </div>
        <div class="gpu-card-body">
          <div class="gpu-spinner">
            <div class="spinner-ring"></div>
            <span>Connecting GPU Stream...</span>
          </div>
          <video class="gpu-video" autoplay playsinline muted></video>
        </div>
      `;

      // Double-click to toggle 1x1 full-grid focus
      card.querySelector('.gpu-card-body').addEventListener('dblclick', () => {
        toggleFocus(item);
      });

      // Actions
      card.querySelector('[data-act="focus"]').addEventListener('click', () => {
        toggleFocus(item);
      });

      card.querySelector('[data-act="snapshot"]').addEventListener('click', (e) => {
        e.stopPropagation();
        takeSnapshot(card.querySelector('.gpu-video'), title);
      });

      card.querySelector('[data-act="toggle-hd"]').addEventListener('click', (e) => {
        e.stopPropagation();
        state.currentSubtype = state.currentSubtype === 'sub' ? 'hd' : 'sub';
        renderGrid();
      });

      gridContainer.appendChild(card);

      // Connect WebRTC stream
      const videoEl = card.querySelector('.gpu-video');
      const spinnerEl = card.querySelector('.gpu-spinner');
      connectWebRtc(streamKey, videoEl, spinnerEl);
    });

    updateControlBar();
  }

  function toggleFocus(item) {
    if (state.focusedChannel) {
      state.focusedChannel = null;
      state.currentSplit = state.previousSplit;
    } else {
      state.previousSplit = state.currentSplit;
      state.focusedChannel = item;
      state.currentSplit = 1;
    }
    renderGrid();
  }

  function takeSnapshot(videoEl, title) {
    if (!videoEl || !videoEl.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/jpeg', 0.95);
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `${title.replace(/\s+/g, '_')}_${dateStr}.jpg`;
    a.click();
  }

  function updateControlBar() {
    const pageIndicator = document.getElementById('gpu-page-indicator');
    if (pageIndicator) {
      if (state.currentNvr === 'both') {
        pageIndicator.textContent = `Dual Split (NVR 1 & NVR 2)`;
      } else {
        const start = (state.page * state.currentSplit) + 1;
        const end = Math.min(32, start + state.currentSplit - 1);
        pageIndicator.textContent = `Channels ${start}–${end} of 32`;
      }
    }

    // Active states on split buttons
    document.querySelectorAll('.gpu-split-btn').forEach((btn) => {
      const splitVal = parseInt(btn.dataset.split, 10);
      btn.classList.toggle('active', splitVal === state.currentSplit && !state.focusedChannel);
    });

    // Active state on source selector buttons
    document.querySelectorAll('.gpu-source-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.nvr === state.currentNvr);
    });
  }

  /**
   * Public interface
   */
  window.VOSCCTV_GPU_WALL = {
    init: async function () {
      await loadCameraNames();
      renderGrid();
    },
    setNvr: function (nvrId) {
      state.currentNvr = nvrId;
      state.page = 0;
      state.focusedChannel = null;
      renderGrid();
    },
    setSplit: function (split) {
      state.currentSplit = split;
      state.focusedChannel = null;
      renderGrid();
    },
    prevPage: function () {
      if (state.page > 0) {
        state.page--;
        renderGrid();
      }
    },
    nextPage: function () {
      const maxPages = Math.ceil(32 / state.currentSplit) - 1;
      if (state.page < maxPages) {
        state.page++;
        renderGrid();
      }
    },
    toggleSubtype: function (type) {
      state.currentSubtype = type;
      renderGrid();
    },
    stop: function () {
      disconnectAll();
    }
  };
})();
