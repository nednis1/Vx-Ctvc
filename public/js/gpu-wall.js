/**
 * VOSCCTV GPU Live Wall
 * Client-side WebRTC / MSE Video Grid with 100% Client GPU Hardware Acceleration
 */

(function () {
  const state = {
    currentNvr: 'nvr1',       // 'nvr1' | 'nvr2' | 'both'
    currentSplit: 4,          // 1, 4, 9, 16
    currentSubtype: 'sub',     // 'sub' (fast low-cpu) | 'hd' (1080p/4K)
    page: 0,                  // For pagination (e.g., channels 1-16 or 17-32)
    activePlayers: new Map(), // streamKey -> video-rtc element
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
   * Close all active players
   */
  function disconnectAll() {
    state.activePlayers.forEach((player) => {
      try {
        player.src = '';
        player.remove();
      } catch (e) {}
    });
    state.activePlayers.clear();
  }

  /**
   * Disconnect a single channel
   */
  function disconnectChannel(streamKey) {
    const player = state.activePlayers.get(streamKey);
    if (player) {
      try {
        player.src = '';
        player.remove();
      } catch (e) {}
      state.activePlayers.delete(streamKey);
    }
  }

  /**
   * Connect a video-rtc player to go2rtc
   */
  function connectChannel(streamKey, containerEl, spinnerEl) {
    disconnectChannel(streamKey);

    if (spinnerEl) {
      spinnerEl.style.display = 'flex';
      spinnerEl.innerHTML = `
        <div class="spinner-ring"></div>
        <span>Connecting GPU Stream...</span>
      `;
    }

    const host = window.location.host;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${host}/api/go2rtc/ws?src=${streamKey}`;

    // Create the hardware-accelerated VideoRTC element
    const player = document.createElement('video-rtc');
    player.className = 'gpu-player-el';
    player.style.width = '100%';
    player.style.height = '100%';
    player.style.display = 'block';

    state.activePlayers.set(streamKey, player);
    containerEl.appendChild(player);

    // Set src to begin WebSocket signaling
    player.src = wsUrl;

    if (player.video) {
      player.video.style.width = '100%';
      player.video.style.height = '100%';
      player.video.style.objectFit = 'contain';
      player.video.muted = true;
      player.video.autoplay = true;
      player.video.playsInline = true;

      const hideSpinner = () => {
        if (spinnerEl) spinnerEl.style.display = 'none';
      };

      player.video.addEventListener('playing', hideSpinner, { once: true });
      player.video.addEventListener('loadeddata', hideSpinner, { once: true });
    }

    // Diagnostic fallback: if still not loaded after 7 seconds
    setTimeout(() => {
      if (spinnerEl && spinnerEl.style.display !== 'none') {
        spinnerEl.innerHTML = `
          <div style="font-size:11px;color:#cbd5e1;text-align:center;">
            <div class="spinner-ring" style="margin: 0 auto 6px auto;"></div>
            <span style="color:#f59e0b;">Waiting for NVR feed...</span><br>
            <span style="font-size:10px;color:#64748b;">${streamKey}</span>
          </div>
        `;
      }
    }, 7000);
  }

  /**
   * Determine list of channels to render based on current filter & pagination
   */
  function getVisibleChannels() {
    const channels = [];

    if (state.focusedChannel) {
      return [state.focusedChannel];
    }

    const totalSlots = state.currentSplit;

    if (state.currentNvr === 'both') {
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
        <div class="gpu-card-body" id="body-${streamKey}">
          <div class="gpu-spinner" id="spinner-${streamKey}">
            <div class="spinner-ring"></div>
            <span>Connecting GPU Stream...</span>
          </div>
        </div>
      `;

      // Actions
      const cardBody = card.querySelector('.gpu-card-body');
      cardBody.addEventListener('dblclick', () => {
        toggleFocus(item);
      });

      card.querySelector('[data-act="focus"]').addEventListener('click', () => {
        toggleFocus(item);
      });

      card.querySelector('[data-act="snapshot"]').addEventListener('click', (e) => {
        e.stopPropagation();
        takeSnapshot(cardBody, title);
      });

      card.querySelector('[data-act="toggle-hd"]').addEventListener('click', (e) => {
        e.stopPropagation();
        state.currentSubtype = state.currentSubtype === 'sub' ? 'hd' : 'sub';
        renderGrid();
      });

      gridContainer.appendChild(card);

      // Connect video stream using VideoRTC
      const spinnerEl = card.querySelector(`#spinner-${streamKey}`);
      connectChannel(streamKey, cardBody, spinnerEl);
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

  function takeSnapshot(cardBodyEl, title) {
    const videoEl = cardBodyEl ? cardBodyEl.querySelector('video') : null;
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
