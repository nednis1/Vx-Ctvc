/**
 * VOSCCTV Dahua-Style Dynamic GPU Live Wall Engine
 * Modifiable Central Grid (1..32) + Interactive Device Tree + Direct NVR Renaming
 * 100% Client GPU Hardware Accelerated via VideoRTC (WebRTC/MSE)
 */

(function () {
  const STORAGE_KEY = 'voscctv_gpu_wall_layout';

  const state = {
    split: 4,                  // 1, 4, 9, 16, 25, 32
    previousSplit: 4,          // For double-click 1x1 zoom toggle
    focusedSlotIndex: null,    // If zoomed to single slot (0..31)
    selectedSlotIndex: 0,      // Which slot receives next camera click
    slots: {},                 // slotIndex -> { nvrId, channel, subtype: 'sub'|'hd', playerEl }
    cameraNames: { nvr1: {}, nvr2: {} },
    drawerOpen: false,
    longPressTimer: null
  };

  /**
   * Fetch custom and official camera names from backend
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
   * Layout Persistence (Save & Restore)
   */
  function saveLayout() {
    try {
      const serializableSlots = {};
      Object.keys(state.slots).forEach((idx) => {
        const item = state.slots[idx];
        if (item) {
          serializableSlots[idx] = {
            nvrId: item.nvrId,
            channel: item.channel,
            subtype: item.subtype || 'sub'
          };
        }
      });

      const data = {
        split: state.split,
        slots: serializableSlots
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function restoreSavedLayout() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.split && [1, 4, 9, 16, 25, 32].includes(parsed.split)) {
          state.split = parsed.split;
        }
        if (parsed.slots && typeof parsed.slots === 'object') {
          state.slots = {};
          Object.keys(parsed.slots).forEach((idx) => {
            const numIdx = parseInt(idx, 10);
            if (numIdx < state.split) {
              state.slots[numIdx] = {
                nvrId: parsed.slots[idx].nvrId,
                channel: parsed.slots[idx].channel,
                subtype: parsed.slots[idx].subtype || 'sub'
              };
            }
          });
        }
      }
    } catch (e) {}
  }

  // -------------------------------------------------------------
  // Left Device Tree & Inline NVR Renaming
  // -------------------------------------------------------------

  function renderTree() {
    const container = document.getElementById('gpu-tree-container');
    if (!container) return;
    container.innerHTML = '';

    const nvrs = [
      { id: 'nvr1', name: 'NVR 1 (192.168.1.200)', total: 32 },
      { id: 'nvr2', name: 'NVR 2 (192.168.1.181)', total: 32 }
    ];

    nvrs.forEach((nvr) => {
      const groupEl = document.createElement('div');
      groupEl.className = 'gpu-tree-group';
      groupEl.id = `tree-group-${nvr.id}`;

      groupEl.innerHTML = `
        <div class="gpu-tree-group-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <span class="gpu-tree-group-arrow">▼</span>
          <span class="dot online" style="margin-right:2px;"></span>
          <span>${nvr.name}</span>
        </div>
        <div class="gpu-tree-group-items" id="tree-items-${nvr.id}"></div>
      `;

      const itemsContainer = groupEl.querySelector(`#tree-items-${nvr.id}`);

      for (let ch = 1; ch <= nvr.total; ch++) {
        const title = getCameraTitle(nvr.id, ch);
        const itemEl = document.createElement('div');
        itemEl.className = 'gpu-tree-item';
        itemEl.dataset.nvr = nvr.id;
        itemEl.dataset.ch = ch;
        itemEl.draggable = true;

        itemEl.innerHTML = `
          <span class="gpu-tree-item-icon">📹</span>
          <span class="gpu-tree-ch-tag">CH ${ch.toString().padStart(2, '0')}</span>
          <span class="gpu-tree-name-label" id="label-${nvr.id}-${ch}" title="Double-click to rename">${title}</span>
        `;

        // Click: Assign to currently selected slot
        itemEl.addEventListener('click', (e) => {
          if (itemEl.classList.contains('editing')) return;
          assignCameraToSelectedSlot(nvr.id, ch);

          // On mobile screens (<1024px), auto-close drawer so user sees video
          if (window.innerWidth <= 1024) {
            toggleDrawer(false);
          }
        });

        // Drag & Drop
        itemEl.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('application/json', JSON.stringify({ nvrId: nvr.id, channel: ch }));
        });

        // Desktop: Double-Click to Inline Rename (No pencil icons!)
        const labelEl = itemEl.querySelector('.gpu-tree-name-label');
        labelEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          startInlineRename(nvr.id, ch, itemEl, labelEl);
        });

        // Mobile/Tablet: Long-Press (hold 500ms) to Inline Rename
        itemEl.addEventListener('touchstart', (e) => {
          state.longPressTimer = setTimeout(() => {
            startInlineRename(nvr.id, ch, itemEl, labelEl);
          }, 500);
        }, { passive: true });

        itemEl.addEventListener('touchend', () => {
          if (state.longPressTimer) {
            clearTimeout(state.longPressTimer);
            state.longPressTimer = null;
          }
        });

        itemEl.addEventListener('touchmove', () => {
          if (state.longPressTimer) {
            clearTimeout(state.longPressTimer);
            state.longPressTimer = null;
          }
        });

        itemsContainer.appendChild(itemEl);
      }

      container.appendChild(groupEl);
    });
  }

  /**
   * Inline Camera Rename: Direct NVR Firmware Sync (Zero Clutter)
   */
  function startInlineRename(nvrId, channel, itemEl, labelEl) {
    if (itemEl.classList.contains('editing')) return;
    itemEl.classList.add('editing');

    const currentTitle = labelEl.textContent.trim();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'gpu-rename-input';
    input.value = currentTitle;
    input.autocomplete = 'off';
    input.spellcheck = false;

    labelEl.style.display = 'none';
    itemEl.appendChild(input);
    input.focus();
    input.select();

    let committed = false;

    async function commitRename() {
      if (committed) return;
      committed = true;

      const newName = input.value.trim();
      input.remove();
      labelEl.style.display = '';
      itemEl.classList.remove('editing');

      if (newName && newName !== currentTitle) {
        labelEl.textContent = newName;
        if (!state.cameraNames[nvrId]) state.cameraNames[nvrId] = {};
        state.cameraNames[nvrId][channel] = newName;

        // Update any active grid slots displaying this camera
        updateActiveSlotTitles(nvrId, channel, newName);

        // Push directly to Dahua NVR Firmware via backend CGI Digest Auth
        try {
          const res = await fetch('/api/rename-nvr-camera', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nvrId, channel, name: newName })
          });
          const result = await res.json();
          if (result.savedToNvr) {
            console.log(`[GPU Wall] Synced "${newName}" to NVR ${nvrId} ChannelTitle & VideoWidget OSD.`);
          }
        } catch (err) {
          console.warn('[GPU Wall] Error saving camera name to NVR:', err.message);
        }
      }
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename();
      } else if (e.key === 'Escape') {
        committed = true;
        input.remove();
        labelEl.style.display = '';
        itemEl.classList.remove('editing');
      }
    });

    input.addEventListener('blur', commitRename);
  }

  /**
   * Filter camera tree in real-time as user types in search box
   */
  function filterTree(query) {
    const q = (query || '').toLowerCase().trim();
    const items = document.querySelectorAll('.gpu-tree-item');

    items.forEach((item) => {
      const nvr = item.dataset.nvr;
      const ch = item.dataset.ch;
      const title = getCameraTitle(nvr, ch).toLowerCase();
      const match = !q || title.includes(q) || `ch ${ch}`.includes(q) || ch === q;
      item.style.display = match ? 'flex' : 'none';
    });
  }

  // -------------------------------------------------------------
  // Modifiable Central Grid (Slots 1..32)
  // -------------------------------------------------------------

  function selectSlot(slotIndex) {
    state.selectedSlotIndex = slotIndex;

    // Update glowing border outline
    document.querySelectorAll('.gpu-slot').forEach((el) => {
      const idx = parseInt(el.dataset.slotIndex, 10);
      el.classList.toggle('selected', idx === slotIndex);
    });

    // Update target pill in toolbar
    const pill = document.getElementById('gpu-active-slot-num');
    if (pill) {
      pill.textContent = `Slot ${slotIndex + 1}`;
    }
  }

  function advanceSelectedSlot() {
    const total = state.focusedSlotIndex !== null ? 1 : state.split;
    // Find next empty slot
    for (let i = 0; i < total; i++) {
      const candidate = (state.selectedSlotIndex + 1 + i) % total;
      if (!state.slots[candidate]) {
        selectSlot(candidate);
        return;
      }
    }
    // If none empty, wrap around
    selectSlot((state.selectedSlotIndex + 1) % total);
  }

  function updateActiveSlotTitles(nvrId, channel, newName) {
    Object.keys(state.slots).forEach((idx) => {
      const item = state.slots[idx];
      if (item && item.nvrId === nvrId && item.channel == channel) {
        const slotEl = document.getElementById(`gpu-slot-${idx}`);
        if (slotEl) {
          const titleEl = slotEl.querySelector('.gpu-slot-title');
          if (titleEl) titleEl.textContent = newName;
        }
      }
    });
  }

  function assignCameraToSelectedSlot(nvrId, channel, optSubtype) {
    assignCameraToSlot(state.selectedSlotIndex, nvrId, channel, optSubtype);
    advanceSelectedSlot();
  }

  function assignCameraToSlot(slotIndex, nvrId, channel, optSubtype) {
    const subtype = optSubtype || 'sub';
    clearSlot(slotIndex, false); // Clear old player in this slot if any

    state.slots[slotIndex] = {
      nvrId,
      channel: parseInt(channel, 10),
      subtype
    };

    saveLayout();
    renderSlotContent(slotIndex);
  }

  function clearSlot(slotIndex, updateStore = true) {
    const slotEl = document.getElementById(`gpu-slot-${slotIndex}`);
    if (slotEl) {
      // Disconnect and remove player element
      const player = slotEl.querySelector('video-rtc');
      if (player) {
        try {
          player.src = '';
          player.remove();
        } catch (e) {}
      }
    }

    delete state.slots[slotIndex];
    if (updateStore) saveLayout();
    renderSlotContent(slotIndex);
  }

  function clearAll() {
    const total = state.focusedSlotIndex !== null ? 1 : state.split;
    for (let i = 0; i < total; i++) {
      clearSlot(i, false);
    }
    state.slots = {};
    saveLayout();
    selectSlot(0);
  }

  function openAll(nvrId) {
    clearAll();
    const total = Math.min(32, state.split);
    for (let i = 0; i < total; i++) {
      assignCameraToSlot(i, nvrId, i + 1, 'sub');
    }
    selectSlot(0);
  }

  function toggleSubtype(slotIndex) {
    const item = state.slots[slotIndex];
    if (!item) return;
    item.subtype = item.subtype === 'sub' ? 'hd' : 'sub';
    saveLayout();
    renderSlotContent(slotIndex);
  }

  function toggleSlotZoom(slotIndex) {
    if (state.focusedSlotIndex !== null) {
      // Restore previous split
      state.focusedSlotIndex = null;
      state.split = state.previousSplit;
    } else {
      // Zoom into 1x1 full grid
      state.previousSplit = state.split;
      state.focusedSlotIndex = slotIndex;
    }
    renderGrid();
  }

  function renderSlotContent(slotIndex) {
    const slotEl = document.getElementById(`gpu-slot-${slotIndex}`);
    if (!slotEl) return;

    const item = state.slots[slotIndex];

    if (!item) {
      // Empty Slot State
      slotEl.className = `gpu-slot empty ${slotIndex === state.selectedSlotIndex ? 'selected' : ''}`;
      slotEl.innerHTML = `
        <span class="gpu-slot-watermark">${(slotIndex + 1).toString().padStart(2, '0')}</span>
        <div class="gpu-slot-empty-prompt">
          <span class="gpu-slot-plus">+</span>
          <span>Click Camera to Assign</span>
        </div>
      `;
      return;
    }

    // Active Playing Slot State
    const isNvr1 = item.nvrId === 'nvr1';
    const title = getCameraTitle(item.nvrId, item.channel);
    const streamKey = `${item.nvrId}_ch${item.channel}${item.subtype === 'hd' ? '_hd' : ''}`;

    slotEl.className = `gpu-slot playing ${slotIndex === state.selectedSlotIndex ? 'selected' : ''}`;
    slotEl.innerHTML = `
      <div class="gpu-slot-header">
        <div class="gpu-slot-info">
          <span class="gpu-slot-badge ${isNvr1 ? 'badge-nvr1' : 'badge-nvr2'}">${isNvr1 ? 'NVR 1' : 'NVR 2'}</span>
          <span class="gpu-slot-ch">CH ${item.channel.toString().padStart(2, '0')}</span>
          <span class="gpu-slot-title" title="${title}">${title}</span>
        </div>
        <div class="gpu-slot-actions">
          <button class="gpu-slot-action-btn ${item.subtype === 'hd' ? 'active-hd' : ''}" onclick="event.stopPropagation(); window.VOSCCTV_GPU_WALL.toggleSubtype(${slotIndex})" title="Toggle Sub/HD Stream">${item.subtype.toUpperCase()}</button>
          <button class="gpu-slot-action-btn" onclick="event.stopPropagation(); window.VOSCCTV_GPU_WALL.takeSnapshot(${slotIndex})" title="Snapshot">📷</button>
          <button class="gpu-slot-action-btn btn-close" onclick="event.stopPropagation(); window.VOSCCTV_GPU_WALL.clearSlot(${slotIndex})" title="Close Camera Feed">✕</button>
        </div>
      </div>
      <div class="gpu-slot-body" id="body-slot-${slotIndex}">
        <div class="gpu-slot-spinner" id="spinner-slot-${slotIndex}">
          <div class="spinner-ring"></div>
          <span>Connecting GPU Stream...</span>
        </div>
      </div>
    `;

    // Double-click to toggle full 1x1 screen
    const bodyEl = slotEl.querySelector('.gpu-slot-body');
    bodyEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      toggleSlotZoom(slotIndex);
    });

    // Mount VideoRTC hardware-accelerated video element
    const host = window.location.host;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${host}/api/go2rtc/ws?src=${streamKey}`;

    const player = document.createElement('video-rtc');
    player.className = 'gpu-player-el';
    player.style.width = '100%';
    player.style.height = '100%';
    player.style.display = 'block';

    bodyEl.appendChild(player);
    player.src = wsUrl;

    if (player.video) {
      player.video.style.width = '100%';
      player.video.style.height = '100%';
      player.video.style.objectFit = 'contain';
      player.video.muted = true;
      player.video.autoplay = true;
      player.video.playsInline = true;

      const spinnerEl = slotEl.querySelector(`#spinner-slot-${slotIndex}`);
      const hideSpinner = () => {
        if (spinnerEl) spinnerEl.style.display = 'none';
      };

      player.video.addEventListener('playing', hideSpinner, { once: true });
      player.video.addEventListener('loadeddata', hideSpinner, { once: true });
    }
  }

  function renderGrid() {
    const gridContainer = document.getElementById('gpu-grid-container');
    if (!gridContainer) return;

    // Disconnect old players when building grid
    document.querySelectorAll('.gpu-slot video-rtc').forEach((el) => {
      try { el.src = ''; el.remove(); } catch (e) {}
    });

    gridContainer.innerHTML = '';

    const effectiveSplit = state.focusedSlotIndex !== null ? 1 : state.split;
    gridContainer.className = `gpu-grid-container split-${effectiveSplit}`;

    const totalSlots = effectiveSplit;

    for (let i = 0; i < totalSlots; i++) {
      const slotIndex = state.focusedSlotIndex !== null ? state.focusedSlotIndex : i;
      const slotEl = document.createElement('div');
      slotEl.id = `gpu-slot-${slotIndex}`;
      slotEl.dataset.slotIndex = slotIndex;

      // Click to select this slot as the active assignment target
      slotEl.addEventListener('click', () => {
        selectSlot(slotIndex);
      });

      // Drag over and drop support
      slotEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        slotEl.style.borderColor = '#38bdf8';
      });

      slotEl.addEventListener('dragleave', () => {
        slotEl.style.borderColor = '';
      });

      slotEl.addEventListener('drop', (e) => {
        e.preventDefault();
        slotEl.style.borderColor = '';
        try {
          const data = JSON.parse(e.dataTransfer.getData('application/json'));
          if (data && data.nvrId && data.channel) {
            assignCameraToSlot(slotIndex, data.nvrId, data.channel);
          }
        } catch (err) {}
      });

      gridContainer.appendChild(slotEl);
      renderSlotContent(slotIndex);
    }

    // Select active slot
    const targetSlot = state.focusedSlotIndex !== null ? state.focusedSlotIndex : state.selectedSlotIndex;
    selectSlot(targetSlot >= effectiveSplit ? 0 : targetSlot);

    // Update active state in toolbar buttons
    document.querySelectorAll('.gpu-split-btn').forEach((btn) => {
      const splitVal = parseInt(btn.dataset.split, 10);
      btn.classList.toggle('active', splitVal === state.split && state.focusedSlotIndex === null);
    });
  }

  function setSplit(split) {
    state.split = split;
    state.focusedSlotIndex = null;
    saveLayout();
    renderGrid();
  }

  function takeSnapshot(slotIndex) {
    const slotEl = document.getElementById(`gpu-slot-${slotIndex}`);
    if (!slotEl) return;
    const videoEl = slotEl.querySelector('video');
    if (!videoEl || !videoEl.videoWidth) return;

    const item = state.slots[slotIndex];
    const title = item ? getCameraTitle(item.nvrId, item.channel) : `Slot_${slotIndex + 1}`;

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

  function toggleDrawer(forceState) {
    const sidebar = document.getElementById('gpu-sidebar');
    if (!sidebar) return;

    if (typeof forceState === 'boolean') {
      state.drawerOpen = forceState;
    } else {
      state.drawerOpen = !state.drawerOpen;
    }

    sidebar.classList.toggle('drawer-open', state.drawerOpen);
  }

  function stopAll() {
    document.querySelectorAll('.gpu-slot video-rtc').forEach((el) => {
      try { el.src = ''; el.remove(); } catch (e) {}
    });
  }

  /**
   * Public API exposed to window.VOSCCTV_GPU_WALL
   */
  window.VOSCCTV_GPU_WALL = {
    init: async function () {
      await loadCameraNames();
      renderTree();
      restoreSavedLayout();
      renderGrid();
    },
    setSplit,
    selectSlot,
    assignCameraToSlot,
    assignCameraToSelectedSlot,
    clearSlot,
    clearAll,
    openAll,
    toggleSubtype,
    takeSnapshot,
    toggleDrawer,
    filterTree,
    stop: stopAll
  };
})();
