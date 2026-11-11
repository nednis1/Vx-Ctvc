/**
 * VOSCCTV Enterprise Dahua-Style Dynamic GPU Live Wall Engine
 * Modifiable Central Grid (1..32) + 100% Full-Bleed Video (0% Video Obstruction)
 * Dynamic Hardware Capability Detection (PTZ, Audio, Stream Status) with Feature Greying/Disabling
 * Controls Docked in Dedicated Bottom Bar (Dahua VMS Architecture)
 * 100% Client GPU Hardware Accelerated via VideoRTC (WebRTC/MSE)
 */

(function () {
  const STORAGE_KEY = 'voscctv_gpu_wall_layout';
  const PRESETS_STORAGE_KEY = 'voscctv_gpu_wall_presets';

  const state = {
    split: 4,                  // 1, 2, 4, 6, 9, 16, 25, 32
    previousSplit: 4,          // For double-click 1x1 zoom toggle
    columnMode: 'auto',        // 'auto', 1, 2, 3, 4
    slotSize: 'large',         // 'large' (default), 'xl', 'medium', 'fit'
    streamEngine: 'auto',      // 'auto' (MSE + WebRTC), 'mse' (instant websocket), 'webrtc' (direct UDP)
    focusedSlotIndex: null,    // If zoomed to single slot (0..31)
    selectedSlotIndex: 0,      // Which slot receives next camera click
    globalAspect: 'contain',   // 'contain' (Fit 16:9), 'fill' (Stretch), 'cover' (Crop)
    slots: {},                 // slotIndex -> slotState
    cameraNames: { nvr1: {}, nvr2: {} },
    capabilities: { nvr1: {}, nvr2: {} }, // channel -> { ptz: boolean, audio: boolean }
    viewPresets: { default: { name: 'Default', split: 4, columnMode: 'auto', slots: {} } },
    currentPresetId: 'default',
    tour: { active: false, timer: null, intervalMs: 15000, offset: 0 },
    drawerOpen: typeof window !== 'undefined' ? window.innerWidth > 1024 : true,
    longPressTimer: null
  };

  /**
   * Subtle haptic pulse for mobile touch confirmation
   */
  function triggerHaptic(duration = 10) {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(duration); } catch (e) {}
    }
  }

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

  /**
   * Fetch live hardware capabilities (PTZ, Audio) from backend
   */
  async function loadCameraCapabilities() {
    try {
      const res = await fetch('/api/camera-capabilities');
      if (res.ok) {
        state.capabilities = await res.json();
      }
    } catch (e) {
      console.warn('[GPU Wall] Could not load camera capabilities:', e);
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
   * Layout & Presets Persistence (Save & Restore)
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
            subtype: item.subtype || 'sub',
            aspect: item.aspect || null
          };
        }
      });

      const data = {
        split: state.split,
        columnMode: state.columnMode,
        slotSize: state.slotSize,
        streamEngine: state.streamEngine,
        globalAspect: state.globalAspect,
        slots: serializableSlots
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function normalizeColumnMode(mode) {
    const numCol = Number(mode);
    return [1, 2, 3, 4].includes(numCol) ? numCol : 'auto';
  }

  function restoreSavedLayout() {
    try {
      const savedPresets = localStorage.getItem(PRESETS_STORAGE_KEY);
      if (savedPresets) {
        state.viewPresets = JSON.parse(savedPresets);
        updatePresetDropdown();
      }

      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.split && [1, 2, 4, 6, 9, 16, 25, 32].includes(parsed.split)) {
          state.split = parsed.split;
        }
        if (parsed.columnMode !== undefined && parsed.columnMode !== null) {
          state.columnMode = normalizeColumnMode(parsed.columnMode);
        }
        if (parsed.slotSize && ['large', 'xl', 'medium', 'fit'].includes(parsed.slotSize)) {
          state.slotSize = parsed.slotSize;
        }
        if (parsed.streamEngine && ['auto', 'mse', 'webrtc'].includes(parsed.streamEngine)) {
          state.streamEngine = parsed.streamEngine;
        }
        if (parsed.globalAspect && ['contain', 'fill', 'cover'].includes(parsed.globalAspect)) {
          state.globalAspect = parsed.globalAspect;
          updateGlobalAspectUI();
        }
        if (parsed.slots && typeof parsed.slots === 'object') {
          state.slots = {};
          Object.keys(parsed.slots).forEach((idx) => {
            const numIdx = parseInt(idx, 10);
            if (numIdx < state.split) {
              state.slots[numIdx] = {
                nvrId: parsed.slots[idx].nvrId,
                channel: parsed.slots[idx].channel,
                subtype: parsed.slots[idx].subtype || 'sub',
                aspect: parsed.slots[idx].aspect || null,
                videoPlaying: false
              };
            }
          });
        }
      }
    } catch (e) {}
  }

  // -------------------------------------------------------------
  // Left Device Tree & Clutter-Free Inline NVR Renaming
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
          <span class="dot loading" id="dot-${nvr.id}" style="margin-right:2px;"></span>
          <span>${nvr.name}</span>
        </div>
        <div class="gpu-tree-group-items" id="tree-items-${nvr.id}"></div>
      `;

      const itemsContainer = groupEl.querySelector(`#tree-items-${nvr.id}`);

      for (let ch = 1; ch <= nvr.total; ch++) {
        const title = getCameraTitle(nvr.id, ch);
        const caps = state.capabilities[nvr.id] && state.capabilities[nvr.id][ch];
        const isPtz = caps ? caps.ptz === true : false;
        const ptzBadge = isPtz ? `<span class="gpu-tree-ptz-badge" title="PTZ Camera">PTZ</span>` : '';

        const itemEl = document.createElement('div');
        itemEl.className = 'gpu-tree-item';
        itemEl.dataset.nvr = nvr.id;
        itemEl.dataset.ch = ch;
        itemEl.draggable = true;

        itemEl.innerHTML = `
          <span class="gpu-tree-ch-tag">CH ${ch.toString().padStart(2, '0')}</span>
          <span class="gpu-tree-name-label" id="label-${nvr.id}-${ch}" title="Double-click to rename">${title}</span>
          ${ptzBadge}
          <button type="button" class="gpu-tree-rename-btn" aria-label="Rename channel ${ch}" title="Rename camera">Rename</button>
        `;

        const renameBtn = itemEl.querySelector('.gpu-tree-rename-btn');
        if (renameBtn) {
          renameBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.longPressTimer) {
              clearTimeout(state.longPressTimer);
              state.longPressTimer = null;
            }
            startInlineRename(nvr.id, ch, itemEl, labelEl);
          });
        }

        // Click: Assign to currently selected slot
        itemEl.addEventListener('click', () => {
          if (itemEl.classList.contains('editing')) return;
          if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
          }
          triggerHaptic(10);
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

        // Desktop: Double-Click to Inline Rename (Zero Clutter, No Pencil Icon!)
        const labelEl = itemEl.querySelector('.gpu-tree-name-label');
        labelEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          startInlineRename(nvr.id, ch, itemEl, labelEl);
        });

        // Mobile/Tablet: Long-Press (hold 500ms) to Inline Rename
        itemEl.addEventListener('touchstart', (e) => {
          if (e.target && e.target.closest && e.target.closest('.gpu-tree-rename-btn')) return;
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

        // Update bottom dock if this camera is selected
        updateBottomDock();

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

  function filterTree(query) {
    const q = (query || '').toLowerCase().trim();
    const clearBtn = document.getElementById('gpu-cam-search-clear');
    if (clearBtn) {
      clearBtn.classList.toggle('hidden', !q);
    }
    const items = document.querySelectorAll('.gpu-tree-item');

    items.forEach((item) => {
      const nvr = item.dataset.nvr;
      const ch = item.dataset.ch;
      const title = getCameraTitle(nvr, ch).toLowerCase();
      const match = !q || title.includes(q) || `ch ${ch}`.includes(q) || ch === q;
      item.style.display = match ? 'flex' : 'none';
    });
  }

  function clearCameraSearch() {
    const input = document.getElementById('gpu-cam-search');
    const clearBtn = document.getElementById('gpu-cam-search-clear');
    if (input) {
      input.value = '';
    }
    if (clearBtn) {
      clearBtn.classList.add('hidden');
    }
    filterTree('');
    triggerHaptic(10);
  }

  // -------------------------------------------------------------
  // Modifiable Central Grid (Slots 1..32)
  // -------------------------------------------------------------

  function selectSlot(slotIndex) {
    state.selectedSlotIndex = slotIndex;

    // Update glowing border outline on slot
    document.querySelectorAll('.gpu-slot').forEach((el) => {
      const idx = parseInt(el.dataset.slotIndex, 10);
      el.classList.toggle('selected', idx === slotIndex);
    });

    // Update the Dedicated Bottom Control Dock
    updateBottomDock();
  }

  function stepSelectedSlot(delta = 1) {
    triggerHaptic(10);
    const total = Math.max(1, state.split);
    const current = state.focusedSlotIndex !== null ? state.focusedSlotIndex : state.selectedSlotIndex;
    const nextIdx = (current + delta + total) % total;
    if (state.focusedSlotIndex !== null) {
      state.focusedSlotIndex = nextIdx;
      state.selectedSlotIndex = nextIdx;
      renderGrid();
      return;
    }
    selectSlot(nextIdx);
    const slotEl = document.getElementById(`gpu-slot-${nextIdx}`);
    if (slotEl && typeof slotEl.scrollIntoView === 'function') {
      slotEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }

  function cycleSelectedSlot() {
    stepSelectedSlot(1);
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

  function assignCameraToSelectedSlot(nvrId, channel, optSubtype) {
    assignCameraToSlot(state.selectedSlotIndex, nvrId, channel, optSubtype);
    advanceSelectedSlot();
  }

  function assignCameraToSlot(slotIndex, nvrId, channel, optSubtype) {
    const defaultSub = state.focusedSlotIndex !== null ? 'hd' : 'sub';
    const subtype = optSubtype || defaultSub;

    clearSlot(slotIndex, false);

    state.slots[slotIndex] = {
      nvrId,
      channel: parseInt(channel, 10),
      subtype,
      aspect: null,
      digitalZoom: { active: false, scale: 1, x: 0, y: 0, startX: 0, startY: 0, isDragging: false },
      recording: { active: false, recorder: null, timer: null, seconds: 0, chunks: [] },
      audioMuted: true,
      videoPlaying: false,
      lastTapTime: 0
    };

    saveLayout();
    renderSlotContent(slotIndex);
    if (slotIndex === state.selectedSlotIndex) {
      updateBottomDock();
    }
  }

  function clearSlot(slotIndex, updateStore = true) {
    const item = state.slots[slotIndex];
    if (item && item.recording && item.recording.active) {
      stopRecording(slotIndex);
    }

    const slotEl = document.getElementById(`gpu-slot-${slotIndex}`);
    if (slotEl) {
      const player = slotEl.querySelector('video-rtc');
      if (player) {
        try {
          if (typeof player.ondisconnect === 'function') player.ondisconnect();
          player.src = '';
          player.remove();
        } catch (e) {}
      }
    }

    delete state.slots[slotIndex];
    if (updateStore) saveLayout();
    renderSlotContent(slotIndex);

    if (slotIndex === state.selectedSlotIndex) {
      updateBottomDock();
    }
  }

  function clearAll() {
    const total = state.focusedSlotIndex !== null ? 1 : state.split;
    for (let i = 0; i < total; i++) {
      clearSlot(i, false);
    }
    state.slots = {};
    saveLayout();
    selectSlot(0);
    if (typeof window !== 'undefined' && window.innerWidth <= 1024 && state.drawerOpen) {
      toggleDrawer(false);
    }
  }

  function openAll(nvrId) {
    clearAll();
    const total = Math.min(32, state.split);
    for (let i = 0; i < total; i++) {
      assignCameraToSlot(i, nvrId, i + 1, 'sub');
    }
    selectSlot(0);
    if (typeof window !== 'undefined' && window.innerWidth <= 1024 && state.drawerOpen) {
      toggleDrawer(false);
    }
  }

  /**
   * Smart Resolution & Sub/HD Quality Toggle
   */
  function toggleSubtype(slotIndex) {
    const item = state.slots[slotIndex];
    if (!item) return;
    if (item.recording && item.recording.active) {
      stopRecording(slotIndex);
    }
    item.subtype = item.subtype === 'sub' ? 'hd' : 'sub';
    saveLayout();
    renderSlotContent(slotIndex);
    if (slotIndex === state.selectedSlotIndex) {
      updateBottomDock();
    }
  }

  /**
   * Double-Click 1x1 Zoom with Smart Resolution Autoscaler
   */
  function toggleSlotZoom(slotIndex) {
    if (state.focusedSlotIndex === null && !state.slots[slotIndex]) return;
    if (state.focusedSlotIndex !== null) {
      // Restore previous split & downgrade focused slot back to Sub-stream
      const prevFocused = state.slots[state.focusedSlotIndex];
      if (prevFocused && prevFocused.subtype === 'hd') {
        prevFocused.subtype = 'sub';
      }
      state.focusedSlotIndex = null;
      state.split = state.previousSplit;
    } else {
      // Zoom into 1x1 full grid & promote focused slot to Main HD
      state.previousSplit = state.split;
      state.focusedSlotIndex = slotIndex;
      const targetSlot = state.slots[slotIndex];
      if (targetSlot) {
        targetSlot.subtype = 'hd';
      }
    }
    saveLayout();
    renderGrid();
  }

  /**
   * Aspect Ratio Controls (Global & Per-Slot)
   */
  function setGlobalAspect(aspect) {
    if (!['contain', 'fill', 'cover'].includes(aspect)) return;
    state.globalAspect = aspect;
    updateGlobalAspectUI();

    Object.keys(state.slots).forEach((idx) => {
      const item = state.slots[idx];
      if (item && !item.aspect) {
        applyAspectToSlot(idx, aspect);
      }
    });
    saveLayout();
    updateBottomDock();
  }

  function updateGlobalAspectUI() {
    const select = document.getElementById('gpu-aspect-select');
    if (select) {
      select.value = state.globalAspect;
    }
    document.querySelectorAll('.gpu-aspect-btn').forEach((btn) => {
      const isActive = btn.dataset.aspect === state.globalAspect;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
  }

  function syncGridClassName() {
    const gridContainer = document.getElementById('gpu-grid-container');
    if (!gridContainer) return;
    const effectiveSplit = state.focusedSlotIndex !== null ? 1 : state.split;
    const normCol = normalizeColumnMode(state.columnMode);
    const colClass = state.focusedSlotIndex !== null || normCol === 'auto' ? 'cols-auto' : `cols-${normCol}`;
    const isScrollable = state.slotSize !== 'fit' && state.focusedSlotIndex === null && effectiveSplit > 1;
    gridContainer.className = `gpu-grid-container split-${effectiveSplit} ${colClass}${isScrollable ? ' grid-scrollable' : ''}`;
  }

  function updateColumnModeUI() {
    const select = document.getElementById('gpu-col-select');
    if (select) {
      select.value = String(state.columnMode);
    }
    document.querySelectorAll('.gpu-col-btn').forEach((btn) => {
      const mode = btn.dataset.cols;
      const isMatch = String(mode) === String(state.columnMode);
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-pressed', String(isMatch));
    });
  }

  function setColumnMode(mode) {
    state.columnMode = normalizeColumnMode(mode);
    updateColumnModeUI();
    saveLayout();
    syncGridClassName();
    adjustGridLayout();
  }

  function updateSlotSizeUI() {
    const select = document.getElementById('gpu-size-select');
    if (select) {
      select.value = state.slotSize;
    }
  }

  function setSlotSize(size) {
    if (!['large', 'xl', 'medium', 'fit'].includes(size)) return;
    state.slotSize = size;
    updateSlotSizeUI();
    saveLayout();
    syncGridClassName();
    adjustGridLayout();
  }

  function updateStreamEngineUI() {
    const select = document.getElementById('gpu-engine-select');
    if (select) {
      select.value = state.streamEngine;
    }
    document.querySelectorAll('.gpu-engine-btn').forEach((btn) => {
      const isMatch = btn.dataset.engine === state.streamEngine;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-pressed', String(isMatch));
    });
  }

  function setStreamEngine(engine) {
    if (!['auto', 'mse', 'webrtc'].includes(engine)) return;
    state.streamEngine = engine;
    updateStreamEngineUI();
    saveLayout();
    renderGrid();
  }

  function cycleSlotAspect(slotIndex) {
    const item = state.slots[slotIndex];
    if (!item) return;
    const current = item.aspect || state.globalAspect;
    const nextMap = { contain: 'fill', fill: 'cover', cover: 'contain' };
    item.aspect = nextMap[current] || 'contain';
    applyAspectToSlot(slotIndex, item.aspect);
    saveLayout();
    if (slotIndex === state.selectedSlotIndex) {
      updateBottomDock();
    }
  }

  function applyAspectToSlot(slotIndex, aspect) {
    const slotEl = document.getElementById(`gpu-slot-${slotIndex}`);
    if (!slotEl) return;
    const wrapper = slotEl.querySelector('.gpu-video-wrapper');
    if (!wrapper) return;
    wrapper.classList.remove('aspect-contain', 'aspect-fill', 'aspect-cover');
    wrapper.classList.add(`aspect-${aspect}`);
  }

  // -------------------------------------------------------------
  // HUD Toast Notification System
  // -------------------------------------------------------------

  function showToast(message, duration = 3000) {
    let container = document.getElementById('gpu-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'gpu-toast-container';
      container.className = 'gpu-toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'gpu-toast';
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        try { toast.remove(); } catch (e) {}
      }, 250);
    }, duration);
  }

  function triggerShutterFlash(slotEl) {
    if (!slotEl) return;
    slotEl.classList.remove('shutter-flash');
    void slotEl.offsetWidth; // Force DOM reflow to re-trigger CSS keyframes
    slotEl.classList.add('shutter-flash');
    setTimeout(() => {
      slotEl.classList.remove('shutter-flash');
    }, 250);
  }

  // -------------------------------------------------------------
  // Digital Zoom & ROI Pan Engine (Hardware Bounded & Leak-Free)
  // -------------------------------------------------------------

  function clampPan(slotIndex, rawX, rawY) {
    const item = state.slots[slotIndex];
    if (!item || !item.digitalZoom) return { x: 0, y: 0 };
    const scale = item.digitalZoom.scale || 1;
    if (scale <= 1.0) return { x: 0, y: 0 };

    const slotEl = document.getElementById(`gpu-slot-${slotIndex}`);
    const wrapper = slotEl ? slotEl.querySelector('.gpu-video-wrapper') : null;
    const rect = wrapper ? wrapper.getBoundingClientRect() : { width: 640, height: 360 };

    const maxPanX = Math.max(0, (rect.width * (scale - 1)) / 2);
    const maxPanY = Math.max(0, (rect.height * (scale - 1)) / 2);

    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, rawX)),
      y: Math.max(-maxPanY, Math.min(maxPanY, rawY))
    };
  }

  function toggleDigitalZoom(slotIndex) {
    const item = state.slots[slotIndex];
    if (!item || !item.videoPlaying) return;

    item.digitalZoom.active = !item.digitalZoom.active;
    const slotEl = document.getElementById(`gpu-slot-${slotIndex}`);
    if (!slotEl) return;

    const wrapper = slotEl.querySelector('.gpu-video-wrapper');

    if (item.digitalZoom.active) {
      if (item.digitalZoom.scale <= 1.0) {
        item.digitalZoom.scale = 2.0;
        const clamped = clampPan(slotIndex, 0, 0);
        item.digitalZoom.x = clamped.x;
        item.digitalZoom.y = clamped.y;
      }
      applyVideoTransform(slotIndex);
      if (wrapper) wrapper.classList.add('zoom-active');
    } else {
      item.digitalZoom.scale = 1;
      item.digitalZoom.x = 0;
      item.digitalZoom.y = 0;
      applyVideoTransform(slotIndex);
      if (wrapper) {
        wrapper.classList.remove('zoom-active', 'is-dragging');
      }
    }

    updateSlotBadges(slotIndex);
    if (slotIndex === state.selectedSlotIndex) {
      updateBottomDock();
    }
  }

  function stepDigitalZoom(slotIndex, delta) {
    const item = state.slots[slotIndex];
    if (!item || !item.videoPlaying || !item.digitalZoom || !item.digitalZoom.active) return;

    const newScale = Math.min(8.0, Math.max(1.0, Math.round((item.digitalZoom.scale + delta) * 100) / 100));
    item.digitalZoom.scale = newScale;
    if (newScale <= 1.0) {
      item.digitalZoom.scale = 1.0;
      item.digitalZoom.x = 0;
      item.digitalZoom.y = 0;
    } else {
      const clamped = clampPan(slotIndex, item.digitalZoom.x, item.digitalZoom.y);
      item.digitalZoom.x = clamped.x;
      item.digitalZoom.y = clamped.y;
    }

    applyVideoTransform(slotIndex);
    updateSlotBadges(slotIndex);
    if (slotIndex === state.selectedSlotIndex) {
      updateBottomDock();
    }
  }

  function applyVideoTransform(slotIndex) {
    const item = state.slots[slotIndex];
    if (!item) return;
    const slotEl = document.getElementById(`gpu-slot-${slotIndex}`);
    if (!slotEl) return;
    const video = slotEl.querySelector('video');
    if (video) {
      const { scale, x, y } = item.digitalZoom;
      video.style.transformOrigin = 'center center';
      video.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    }
  }

  function setupDigitalZoomListeners(slotIndex, wrapper) {
    const item = state.slots[slotIndex];
    if (!item || !wrapper) return;

    // Mouse wheel zoom with boundary-aware clamping
    wrapper.addEventListener('wheel', (e) => {
      if (!item.digitalZoom.active) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.25 : -0.25;
      const newScale = Math.min(8.0, Math.max(1.0, Math.round((item.digitalZoom.scale + delta) * 100) / 100));
      item.digitalZoom.scale = newScale;

      if (item.digitalZoom.scale <= 1.0) {
        item.digitalZoom.scale = 1.0;
        item.digitalZoom.x = 0;
        item.digitalZoom.y = 0;
      } else {
        const clamped = clampPan(slotIndex, item.digitalZoom.x, item.digitalZoom.y);
        item.digitalZoom.x = clamped.x;
        item.digitalZoom.y = clamped.y;
      }

      applyVideoTransform(slotIndex);
      updateSlotBadges(slotIndex);
      if (slotIndex === state.selectedSlotIndex) {
        updateBottomDock();
      }
    }, { passive: false });

    // Pointer-captured drag to pan (works seamlessly across mouse, stylus, and touch without window listener leaks)
    wrapper.addEventListener('pointerdown', (e) => {
      if (!item.digitalZoom.active || item.digitalZoom.scale <= 1) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      try {
        wrapper.setPointerCapture(e.pointerId);
      } catch (err) {}
      item.digitalZoom.isDragging = true;
      item.digitalZoom.startX = e.clientX - item.digitalZoom.x;
      item.digitalZoom.startY = e.clientY - item.digitalZoom.y;
      wrapper.classList.add('is-dragging');
    });

    wrapper.addEventListener('pointermove', (e) => {
      if (!item.digitalZoom.active || !item.digitalZoom.isDragging) return;
      const rawX = e.clientX - item.digitalZoom.startX;
      const rawY = e.clientY - item.digitalZoom.startY;
      const clamped = clampPan(slotIndex, rawX, rawY);
      item.digitalZoom.x = clamped.x;
      item.digitalZoom.y = clamped.y;
      applyVideoTransform(slotIndex);
    });

    const endDrag = (e) => {
      if (item.digitalZoom && item.digitalZoom.isDragging) {
        item.digitalZoom.isDragging = false;
        wrapper.classList.remove('is-dragging');
        try {
          if (wrapper.hasPointerCapture(e.pointerId)) {
            wrapper.releasePointerCapture(e.pointerId);
          }
        } catch (err) {}
      }
    };

    wrapper.addEventListener('pointerup', endDrag);
    wrapper.addEventListener('pointercancel', endDrag);

    // Touch pinch-to-zoom on multi-touch mobile devices
    let touchInitialDist = 0;
    let touchInitialScale = 1;

    wrapper.addEventListener('touchstart', (e) => {
      if (!item.digitalZoom.active) return;
      if (e.touches.length === 2) {
        touchInitialDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        touchInitialScale = item.digitalZoom.scale;
      }
    }, { passive: true });

    wrapper.addEventListener('touchmove', (e) => {
      if (!item.digitalZoom.active) return;
      if (e.touches.length === 2 && touchInitialDist > 0) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const factor = dist / touchInitialDist;
        const newScale = Math.min(8.0, Math.max(1.0, Math.round(touchInitialScale * factor * 100) / 100));
        item.digitalZoom.scale = newScale;
        if (newScale <= 1.0) {
          item.digitalZoom.x = 0;
          item.digitalZoom.y = 0;
        } else {
          const clamped = clampPan(slotIndex, item.digitalZoom.x, item.digitalZoom.y);
          item.digitalZoom.x = clamped.x;
          item.digitalZoom.y = clamped.y;
        }
        applyVideoTransform(slotIndex);
        updateSlotBadges(slotIndex);
        if (slotIndex === state.selectedSlotIndex) {
          updateBottomDock();
        }
      }
    }, { passive: false });

    wrapper.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        touchInitialDist = 0;
      }
    }, { passive: true });
  }

  // -------------------------------------------------------------
  // Dedicated Bottom Control Dock (Feature Greying & Disabling)
  // -------------------------------------------------------------

  function updateBottomDock() {
    const slotIndex = state.selectedSlotIndex;
    const item = state.slots[slotIndex];

    const slotPill = document.getElementById('gpu-dock-slot-pill');
    const camTitle = document.getElementById('gpu-dock-cam-title');
    const qualityBtn = document.getElementById('dock-btn-quality');
    const qualityLabel = document.getElementById('dock-quality-label');
    const aspectBtn = document.getElementById('dock-btn-aspect');
    const aspectLabel = document.getElementById('dock-aspect-label');
    const zoomBtn = document.getElementById('dock-btn-zoom');
    const zoomLabel = document.getElementById('dock-zoom-label');
    const zoomOutBtn = document.getElementById('dock-btn-zoom-out');
    const zoomInBtn = document.getElementById('dock-btn-zoom-in');
    const ptzBtn = document.getElementById('dock-btn-ptz');
    const audioBtn = document.getElementById('dock-btn-audio');
    const audioLabel = document.getElementById('dock-audio-label');
    const recBtn = document.getElementById('dock-btn-record');
    const recLabel = document.getElementById('dock-rec-label');
    const snapBtn = document.getElementById('dock-btn-snapshot');
    const btn1x1 = document.getElementById('dock-btn-1x1');
    const closeBtn = document.getElementById('dock-btn-close');

    if (slotPill) slotPill.textContent = `Slot ${slotIndex + 1}`;

    // Condition 1: EMPTY SLOT -> Grey out / disable all slot actions
    if (!item) {
      if (camTitle) camTitle.textContent = 'Empty Slot · Click a camera in tree to assign';
      if (qualityLabel) qualityLabel.textContent = 'SUB';
      if (aspectLabel) aspectLabel.textContent = (state.globalAspect || 'contain').toUpperCase();

      if (qualityBtn) { qualityBtn.disabled = true; qualityBtn.classList.add('disabled'); qualityBtn.classList.remove('active', 'btn-hd'); qualityBtn.setAttribute('aria-pressed', 'false'); qualityBtn.title = "No camera assigned to this slot"; }
      if (aspectBtn) { aspectBtn.disabled = true; aspectBtn.classList.add('disabled'); aspectBtn.classList.remove('active'); aspectBtn.setAttribute('aria-pressed', 'false'); aspectBtn.title = "No camera assigned to this slot"; }
      if (zoomBtn) { zoomBtn.disabled = true; zoomBtn.classList.add('disabled'); zoomBtn.classList.remove('active'); zoomBtn.setAttribute('aria-pressed', 'false'); zoomBtn.title = "No camera assigned to this slot"; }
      if (zoomLabel) zoomLabel.textContent = 'Zoom';
      if (zoomOutBtn) zoomOutBtn.classList.add('hidden');
      if (zoomInBtn) zoomInBtn.classList.add('hidden');
      if (ptzBtn) { ptzBtn.disabled = true; ptzBtn.classList.add('disabled'); ptzBtn.classList.remove('active'); ptzBtn.setAttribute('aria-expanded', 'false'); ptzBtn.title = "No camera assigned to this slot"; }
      if (audioBtn) { audioBtn.disabled = true; audioBtn.classList.add('disabled'); audioBtn.classList.remove('active', 'btn-audio'); audioBtn.setAttribute('aria-pressed', 'false'); audioBtn.title = "No camera assigned to this slot"; }
      if (audioLabel) audioLabel.textContent = 'Audio';
      if (recBtn) { recBtn.disabled = true; recBtn.classList.add('disabled'); recBtn.classList.remove('recording'); recBtn.setAttribute('aria-pressed', 'false'); recBtn.title = "No camera assigned to this slot"; }
      if (recLabel) recLabel.textContent = 'Record';
      if (snapBtn) { snapBtn.disabled = true; snapBtn.classList.add('disabled'); snapBtn.title = "No camera assigned to this slot"; }
      if (btn1x1) { btn1x1.disabled = true; btn1x1.classList.add('disabled'); btn1x1.classList.remove('active'); btn1x1.setAttribute('aria-pressed', 'false'); btn1x1.title = "No camera assigned to this slot"; }
      if (closeBtn) { closeBtn.disabled = true; closeBtn.classList.add('disabled'); closeBtn.title = "No camera to close"; }

      updatePtzDrawerControls(false);
      togglePtzDrawer(false);
      return;
    }

    // Condition 2: CAMERA IS ASSIGNED -> Check capabilities
    const title = getCameraTitle(item.nvrId, item.channel);
    if (camTitle) {
      camTitle.textContent = `${item.nvrId === 'nvr1' ? 'NVR 1' : 'NVR 2'} · CH ${item.channel.toString().padStart(2, '0')} · ${title}`;
    }

    const isHd = item.subtype === 'hd';
    if (qualityBtn) {
      qualityBtn.disabled = false;
      qualityBtn.classList.remove('disabled');
      qualityBtn.classList.toggle('active', isHd);
      qualityBtn.classList.toggle('btn-hd', isHd);
      qualityBtn.setAttribute('aria-pressed', String(isHd));
      qualityBtn.title = isHd ? "Active: Main HD Stream (Click for Sub-Stream)" : "Active: Sub-Stream (Click for Main HD)";
    }
    if (qualityLabel) qualityLabel.textContent = (item.subtype || 'sub').toUpperCase();

    if (aspectBtn) {
      aspectBtn.disabled = false;
      aspectBtn.classList.remove('disabled');
      aspectBtn.classList.toggle('active', !!item.aspect);
      aspectBtn.title = "Cycle Aspect: Fit / Stretch / Crop";
    }
    if (aspectLabel) aspectLabel.textContent = (item.aspect || state.globalAspect || 'contain').toUpperCase();

    const is1x1 = state.focusedSlotIndex !== null;
    if (btn1x1) {
      btn1x1.disabled = false;
      btn1x1.classList.remove('disabled');
      btn1x1.classList.toggle('active', is1x1);
      btn1x1.setAttribute('aria-pressed', String(is1x1));
      btn1x1.title = is1x1 ? "Exit 1x1 Focus View" : "Enter 1x1 Full Screen View";
    }
    if (closeBtn) {
      closeBtn.disabled = false;
      closeBtn.classList.remove('disabled');
      closeBtn.title = "Close Active Camera Feed";
    }

    // Capability Check: PTZ Control
    const caps = state.capabilities[item.nvrId] && state.capabilities[item.nvrId][item.channel];
    const isPtzSupported = Boolean(caps && caps.ptz === true);

    if (ptzBtn) {
      if (!isPtzSupported) {
        ptzBtn.disabled = true;
        ptzBtn.classList.add('disabled');
        ptzBtn.classList.remove('active');
        ptzBtn.setAttribute('aria-expanded', 'false');
        ptzBtn.title = "PTZ motor control not supported on this camera model (Fixed Lens)";
        togglePtzDrawer(false);
      } else {
        ptzBtn.disabled = false;
        ptzBtn.classList.remove('disabled');
        ptzBtn.title = "Open Dahua PTZ Camera Controls";
        const drawer = document.getElementById('gpu-ptz-drawer');
        const isOpen = drawer && !drawer.classList.contains('hidden');
        ptzBtn.classList.toggle('active', isOpen);
        ptzBtn.setAttribute('aria-expanded', String(isOpen));
      }
    }
    updatePtzDrawerControls(isPtzSupported);

    // Capability Check: Audio Stream (Requires camera mic + feed playing)
    const isAudioSupported = caps ? caps.audio !== false : true;
    const isFeedReady = !!item.videoPlaying;
    const isMediaRecorderSupported = typeof MediaRecorder !== 'undefined' && (
      HTMLVideoElement.prototype.captureStream || HTMLVideoElement.prototype.mozCaptureStream
    );

    if (audioBtn) {
      if (!isAudioSupported) {
        audioBtn.disabled = true;
        audioBtn.classList.add('disabled');
        audioBtn.classList.remove('active', 'btn-audio');
        audioBtn.setAttribute('aria-pressed', 'false');
        audioBtn.title = "Microphone/audio not available on this camera model (No Audio Hardware)";
        if (audioLabel) audioLabel.textContent = 'Audio';
      } else if (!isFeedReady) {
        audioBtn.disabled = true;
        audioBtn.classList.add('disabled');
        audioBtn.classList.remove('active', 'btn-audio');
        audioBtn.setAttribute('aria-pressed', 'false');
        audioBtn.title = "Waiting for live video/audio stream to connect...";
        if (audioLabel) audioLabel.textContent = 'Audio';
      } else {
        const isAudioActive = !item.audioMuted;
        audioBtn.disabled = false;
        audioBtn.classList.remove('disabled');
        audioBtn.classList.toggle('active', isAudioActive);
        audioBtn.classList.toggle('btn-audio', isAudioActive);
        audioBtn.setAttribute('aria-pressed', String(isAudioActive));
        audioBtn.title = isAudioActive ? "Mute Live Audio (Currently LIVE)" : "Unmute Live Audio (Currently MUTED)";
        if (audioLabel) audioLabel.textContent = isAudioActive ? 'Mute' : 'Audio';
      }
    }

    // Live Feed Status Check: Digital Zoom, Snapshot, and Local Clip Recording
    if (zoomBtn) {
      if (!isFeedReady) {
        zoomBtn.disabled = true;
        zoomBtn.classList.add('disabled');
        zoomBtn.classList.remove('active');
        zoomBtn.setAttribute('aria-pressed', 'false');
        zoomBtn.title = "Waiting for live video feed to connect before enabling digital zoom...";
        if (zoomLabel) zoomLabel.textContent = 'Zoom';
        if (zoomOutBtn) zoomOutBtn.classList.add('hidden');
        if (zoomInBtn) zoomInBtn.classList.add('hidden');
      } else {
        const isZoomActive = !!(item.digitalZoom && item.digitalZoom.active);
        const curScale = isZoomActive ? Math.round(item.digitalZoom.scale * 10) / 10 : 1;
        zoomBtn.disabled = false;
        zoomBtn.classList.remove('disabled');
        zoomBtn.classList.toggle('active', isZoomActive);
        zoomBtn.setAttribute('aria-pressed', String(isZoomActive));
        zoomBtn.title = isZoomActive
          ? `Digital Zoom Active (${curScale}x) - Use +/-, pinch, or wheel to zoom; drag to pan`
          : "Digital Zoom (Tap to zoom 2x, drag to pan)";
        if (zoomLabel) zoomLabel.textContent = isZoomActive ? `Zoom ${curScale}x` : 'Zoom';
        if (zoomOutBtn) {
          zoomOutBtn.classList.toggle('hidden', !isZoomActive);
          zoomOutBtn.disabled = curScale <= 1.0;
          zoomOutBtn.classList.toggle('disabled', curScale <= 1.0);
        }
        if (zoomInBtn) {
          zoomInBtn.classList.toggle('hidden', !isZoomActive);
          zoomInBtn.disabled = curScale >= 8.0;
          zoomInBtn.classList.toggle('disabled', curScale >= 8.0);
        }
      }
    }

    if (snapBtn) {
      if (!isFeedReady) {
        snapBtn.disabled = true;
        snapBtn.classList.add('disabled');
        snapBtn.title = "Waiting for live video feed to connect before capturing snapshot...";
      } else {
        snapBtn.disabled = false;
        snapBtn.classList.remove('disabled');
        snapBtn.title = "Capture High-Res Snapshot";
      }
    }

    if (recBtn) {
      if (!isMediaRecorderSupported) {
        recBtn.disabled = true;
        recBtn.classList.add('disabled');
        recBtn.classList.remove('recording');
        recBtn.setAttribute('aria-pressed', 'false');
        recBtn.title = "In-browser clip recording is not supported on this browser";
      } else if (!isFeedReady) {
        recBtn.disabled = true;
        recBtn.classList.add('disabled');
        recBtn.classList.remove('recording');
        recBtn.setAttribute('aria-pressed', 'false');
        recBtn.title = "Waiting for live video feed to connect before recording...";
      } else {
        const isRecActive = !!(item.recording && item.recording.active);
        recBtn.disabled = false;
        recBtn.classList.remove('disabled');
        recBtn.classList.toggle('recording', isRecActive);
        recBtn.setAttribute('aria-pressed', String(isRecActive));
        recBtn.title = isRecActive ? "Stop Recording Clip" : "Record Live Clip";
      }
      if (recLabel) {
        if (item.recording && item.recording.active) {
          const mins = Math.floor(item.recording.seconds / 60).toString().padStart(2, '0');
          const secs = (item.recording.seconds % 60).toString().padStart(2, '0');
          recLabel.textContent = `REC ${mins}:${secs}`;
        } else {
          recLabel.textContent = 'Record';
        }
      }
    }

    updateCameraOptionsSheet();
  }

  function dockToggleQuality() {
    const btn = document.getElementById('dock-btn-quality');
    if (btn && (btn.disabled || btn.classList.contains('disabled'))) return;
    toggleSubtype(state.selectedSlotIndex);
  }

  function dockCycleAspect() {
    const btn = document.getElementById('dock-btn-aspect');
    if (btn && (btn.disabled || btn.classList.contains('disabled'))) return;
    cycleSlotAspect(state.selectedSlotIndex);
  }

  function dockToggleDigitalZoom() {
    const btn = document.getElementById('dock-btn-zoom');
    if (btn && (btn.disabled || btn.classList.contains('disabled'))) return;
    toggleDigitalZoom(state.selectedSlotIndex);
  }

  function dockStepDigitalZoom(delta) {
    stepDigitalZoom(state.selectedSlotIndex, delta);
  }

  function dockTogglePtz(forceState) {
    const btn = document.getElementById('dock-btn-ptz');
    if (btn && (btn.disabled || btn.classList.contains('disabled')) && forceState !== false) return;
    togglePtzDrawer(forceState);
  }

  function dockToggleAudio() {
    const btn = document.getElementById('dock-btn-audio');
    if (btn && (btn.disabled || btn.classList.contains('disabled'))) return;
    toggleAudio(state.selectedSlotIndex);
  }

  function dockToggleRecord() {
    const btn = document.getElementById('dock-btn-record');
    if (btn && (btn.disabled || btn.classList.contains('disabled'))) return;
    toggleRecord(state.selectedSlotIndex);
  }

  function dockTakeSnapshot() {
    const btn = document.getElementById('dock-btn-snapshot');
    if (btn && (btn.disabled || btn.classList.contains('disabled'))) return;
    takeSnapshot(state.selectedSlotIndex);
  }

  function dockToggleZoom1x1() {
    const btn = document.getElementById('dock-btn-1x1');
    if (btn && (btn.disabled || btn.classList.contains('disabled'))) return;
    toggleSlotZoom(state.selectedSlotIndex);
  }

  function dockClearSlot() {
    const btn = document.getElementById('dock-btn-close');
    if (btn && (btn.disabled || btn.classList.contains('disabled'))) return;
    clearSlot(state.selectedSlotIndex);
  }

  // -------------------------------------------------------------
  // Dahua PTZ Camera Controller (Side Flyout Drawer)
  // -------------------------------------------------------------

  function updatePtzDrawerControls(isPtzSupported) {
    const drawer = document.getElementById('gpu-ptz-drawer');
    if (!drawer) return;
    drawer.querySelectorAll('.ptz-btn, .ptz-zoom-btn, .ptz-preset-btn').forEach(btn => {
      btn.disabled = !isPtzSupported;
      btn.classList.toggle('disabled', !isPtzSupported);
      if (!isPtzSupported) {
        btn.setAttribute('title', 'PTZ motor control not supported on this camera model (Fixed Lens)');
      } else {
        btn.removeAttribute('title');
      }
    });
  }

  function togglePtzDrawer(forceState) {
    const drawer = document.getElementById('gpu-ptz-drawer');
    const ptzBtn = document.getElementById('dock-btn-ptz');
    if (!drawer) return;

    const item = state.slots[state.selectedSlotIndex];
    const caps = item ? (state.capabilities[item.nvrId] && state.capabilities[item.nvrId][item.channel]) : null;
    const isPtzSupported = Boolean(caps && caps.ptz === true);
    if (!item || !isPtzSupported) {
      // Force closed if not supported or no camera selected
      drawer.classList.add('hidden');
      drawer.inert = true;
      if (ptzBtn) {
        ptzBtn.classList.remove('active');
        ptzBtn.setAttribute('aria-expanded', 'false');
      }
      syncMobileBackdrop();
      return;
    }

    const isHidden = drawer.classList.contains('hidden');
    const shouldOpen = typeof forceState === 'boolean' ? forceState : isHidden;

    drawer.classList.toggle('hidden', !shouldOpen);
    drawer.inert = !shouldOpen;
    if (ptzBtn) {
      ptzBtn.classList.toggle('active', shouldOpen);
      ptzBtn.setAttribute('aria-expanded', String(shouldOpen));
      ptzBtn.title = shouldOpen ? "Close Dahua PTZ Camera Controls" : "Open Dahua PTZ Camera Controls";
    }
    syncMobileBackdrop();

    const titleEl = document.getElementById('gpu-ptz-drawer-title');
    if (titleEl) {
      if (item) {
        titleEl.textContent = `PTZ CH ${item.channel.toString().padStart(2, '0')} (${item.nvrId.toUpperCase()})`;
      } else {
        titleEl.textContent = 'PTZ CONTROLLER';
      }
    }
    setTimeout(() => {
      adjustGridLayout();
    }, 180);
  }

  async function sendPtzCommand(slotIndex, code, action = 'start', arg1 = 0, arg2 = 5) {
    const item = state.slots[slotIndex];
    if (!item) return;

    const caps = state.capabilities[item.nvrId] && state.capabilities[item.nvrId][item.channel];
    if (!caps || caps.ptz !== true) {
      console.warn('[PTZ] Command blocked: camera is not PTZ capable');
      return;
    }

    try {
      await fetch('/api/ptz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nvrId: item.nvrId,
          channel: item.channel,
          code,
          action,
          arg1,
          arg2
        })
      });
    } catch (e) {
      console.warn('[PTZ] Command failed:', e);
    }
  }

  function ptzGotoPreset(presetNum) {
    const item = state.slots[state.selectedSlotIndex];
    if (!item) return;
    const caps = state.capabilities[item.nvrId] && state.capabilities[item.nvrId][item.channel];
    if (!caps || caps.ptz !== true) return;
    sendPtzCommand(state.selectedSlotIndex, 'GotoPreset', 'start', 0, presetNum);
  }

  function setupPtzButtons() {
    const drawer = document.getElementById('gpu-ptz-drawer');
    if (!drawer) return;

    drawer.querySelectorAll('[data-code]').forEach((btn) => {
      const code = btn.dataset.code;

      const start = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btn.disabled || btn.classList.contains('disabled')) return;
        btn.classList.add('active');
        sendPtzCommand(state.selectedSlotIndex, code, 'start');
      };

      const stop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.remove('active');
        sendPtzCommand(state.selectedSlotIndex, code, 'stop');
      };

      btn.addEventListener('mousedown', start);
      btn.addEventListener('mouseup', stop);
      btn.addEventListener('mouseleave', stop);
      btn.addEventListener('touchstart', start, { passive: false });
      btn.addEventListener('touchend', stop, { passive: false });
    });
  }

  // -------------------------------------------------------------
  // Live Audio Monitoring
  // -------------------------------------------------------------

  function toggleAudio(slotIndex) {
    const item = state.slots[slotIndex];
    if (!item) return;

    const caps = state.capabilities[item.nvrId] && state.capabilities[item.nvrId][item.channel];
    if (caps && caps.audio === false) return;
    if (!item.videoPlaying) return;

    const slotEl = document.getElementById(`gpu-slot-${slotIndex}`);
    if (!slotEl) return;
    const video = slotEl.querySelector('video');

    item.audioMuted = !item.audioMuted;

    // Solo audio: mute all other slots so sounds do not clash
    if (!item.audioMuted) {
      Object.keys(state.slots).forEach((idx) => {
        if (idx != slotIndex && state.slots[idx]) {
          state.slots[idx].audioMuted = true;
          const otherEl = document.getElementById(`gpu-slot-${idx}`);
          if (otherEl) {
            const otherVid = otherEl.querySelector('video');
            if (otherVid) otherVid.muted = true;
          }
          updateSlotBadges(idx);
        }
      });
    }

    if (video) {
      video.muted = item.audioMuted;
    }

    updateSlotBadges(slotIndex);
    updateBottomDock();
  }

  // -------------------------------------------------------------
  // In-Browser Video Clip Recording (MediaRecorder)
  // -------------------------------------------------------------

  function toggleRecord(slotIndex) {
    const item = state.slots[slotIndex];
    if (!item || !item.videoPlaying) return;

    const isMediaRecorderSupported = typeof MediaRecorder !== 'undefined' && (
      HTMLVideoElement.prototype.captureStream || HTMLVideoElement.prototype.mozCaptureStream
    );
    if (!isMediaRecorderSupported) return;

    if (item.recording.active) {
      stopRecording(slotIndex);
    } else {
      startRecording(slotIndex);
    }
  }

  function startRecording(slotIndex) {
    const item = state.slots[slotIndex];
    if (!item || !item.videoPlaying) return;
    const slotEl = document.getElementById(`gpu-slot-${slotIndex}`);
    if (!slotEl) return;
    const video = slotEl.querySelector('video');
    if (!video) return;

    try {
      const stream = video.captureStream ? video.captureStream(30) : (video.mozCaptureStream ? video.mozCaptureStream(30) : null);
      if (!stream) {
        showToast('Browser does not support direct stream recording');
        return;
      }

      const candidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=h264,opus',
        'video/webm',
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4'
      ];
      let mimeType = '';
      for (const c of candidates) {
        if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(c)) {
          mimeType = c;
          break;
        }
      }

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      item.recording.chunks = [];
      item.recording.mimeType = mimeType;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          item.recording.chunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        const type = item.recording.mimeType || 'video/webm';
        const ext = type.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(item.recording.chunks, { type });
        if (blob.size === 0) {
          showToast('Recording contained no data or was too short');
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const title = getCameraTitle(item.nvrId, item.channel);
        const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `${title.replace(/\s+/g, '_')}_${dateStr}.${ext}`;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        showToast(`Clip saved (${Math.round(blob.size / 1024)} KB): ${filename}`);
      };

      recorder.start(1000);
      item.recording.active = true;
      item.recording.recorder = recorder;
      item.recording.seconds = 0;

      item.recording.timer = setInterval(() => {
        item.recording.seconds++;
        updateSlotBadges(slotIndex);
        if (slotIndex === state.selectedSlotIndex) {
          updateBottomDock();
        }
      }, 1000);

      updateSlotBadges(slotIndex);
      updateBottomDock();
    } catch (err) {
      console.warn('[GPU Wall] Clip recording error:', err);
      showToast(`Clip recording error: ${err.message || 'Failed'}`);
    }
  }

  function stopRecording(slotIndex) {
    const item = state.slots[slotIndex];
    if (!item || !item.recording.active) return;

    if (item.recording.timer) {
      clearInterval(item.recording.timer);
      item.recording.timer = null;
    }
    if (item.recording.recorder && item.recording.recorder.state !== 'inactive') {
      item.recording.recorder.stop();
    }
    item.recording.active = false;
    updateSlotBadges(slotIndex);
    updateBottomDock();
  }

  // -------------------------------------------------------------
  // Touring / Carousel Mode
  // -------------------------------------------------------------

  function toggleTour() {
    state.tour.active = !state.tour.active;
    const tourBtn = document.getElementById('gpu-tour-btn');
    if (tourBtn) {
      tourBtn.classList.toggle('active', state.tour.active);
      tourBtn.setAttribute('aria-pressed', String(state.tour.active));
    }

    if (state.tour.active) {
      runTourCycle();
      state.tour.timer = setInterval(runTourCycle, state.tour.intervalMs);
    } else {
      if (state.tour.timer) {
        clearInterval(state.tour.timer);
        state.tour.timer = null;
      }
    }
  }

  function runTourCycle() {
    const totalSlots = state.focusedSlotIndex !== null ? 1 : state.split;
    for (let i = 0; i < totalSlots; i++) {
      const camNum = ((state.tour.offset + i) % 64) + 1;
      const nvrId = camNum <= 32 ? 'nvr1' : 'nvr2';
      const channel = camNum <= 32 ? camNum : camNum - 32;
      assignCameraToSlot(i, nvrId, channel, 'sub');
    }
    state.tour.offset = (state.tour.offset + totalSlots) % 64;
  }

  // -------------------------------------------------------------
  // View Presets (Favorites)
  // -------------------------------------------------------------

  function updatePresetDropdown() {
    const select = document.getElementById('gpu-view-select');
    if (!select) return;
    select.innerHTML = '';

    Object.keys(state.viewPresets).forEach((id) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `View: ${state.viewPresets[id].name}`;
      if (id === state.currentPresetId) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function openPresetDialog() {
    const dialog = document.getElementById('gpu-preset-dialog');
    if (!dialog) return;
    const input = document.getElementById('gpu-preset-name-input');
    if (input) input.value = '';
    renderPresetList();
    if (typeof dialog.showModal === 'function') {
      try {
        if (!dialog.open) dialog.showModal();
      } catch (e) {
        dialog.setAttribute('open', '');
      }
    } else {
      dialog.setAttribute('open', '');
    }
    if (input) {
      setTimeout(() => input.focus(), 80);
    }
  }

  function closePresetDialog() {
    const dialog = document.getElementById('gpu-preset-dialog');
    if (!dialog) return;
    if (typeof dialog.close === 'function') {
      try {
        if (dialog.open) dialog.close();
      } catch (e) {
        dialog.removeAttribute('open');
      }
    } else {
      dialog.removeAttribute('open');
    }
  }

  function renderPresetList() {
    const listEl = document.getElementById('gpu-preset-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const ids = Object.keys(state.viewPresets);
    if (ids.length === 0) {
      listEl.innerHTML = '<div class="gpu-preset-empty">No saved presets yet</div>';
      return;
    }

    ids.forEach((id) => {
      const preset = state.viewPresets[id];
      const item = document.createElement('div');
      item.className = 'gpu-preset-item' + (id === state.currentPresetId ? ' active' : '');

      const metaWrap = document.createElement('div');
      metaWrap.className = 'gpu-preset-meta';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'gpu-preset-name';
      nameSpan.textContent = preset.name || id;

      const infoSpan = document.createElement('span');
      infoSpan.className = 'gpu-preset-info';
      const count = preset.slots ? Object.keys(preset.slots).length : 0;
      infoSpan.textContent = `Split ${preset.split || 4} • ${count} cam${count === 1 ? '' : 's'}`;

      metaWrap.appendChild(nameSpan);
      metaWrap.appendChild(infoSpan);

      const actions = document.createElement('div');
      actions.className = 'gpu-preset-actions';

      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'gpu-preset-action-btn load';
      loadBtn.textContent = 'Load';
      loadBtn.onclick = () => {
        loadViewPreset(id);
        closePresetDialog();
      };
      actions.appendChild(loadBtn);

      if (id !== 'default') {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'gpu-preset-action-btn danger';
        delBtn.textContent = 'Delete';
        delBtn.onclick = () => {
          deletePreset(id);
        };
        actions.appendChild(delBtn);
      }

      item.appendChild(metaWrap);
      item.appendChild(actions);
      listEl.appendChild(item);
    });
  }

  function deletePreset(id) {
    if (id === 'default') return;
    delete state.viewPresets[id];
    if (state.currentPresetId === id) {
      state.currentPresetId = 'default';
    }
    try {
      localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(state.viewPresets));
    } catch (e) {}
    updatePresetDropdown();
    renderPresetList();
    showToast('Preset deleted');
  }

  function confirmSavePreset() {
    const input = document.getElementById('gpu-preset-name-input');
    const name = input ? input.value.trim() : '';
    if (!name) {
      if (input) input.focus();
      return;
    }

    const id = 'view_' + Date.now();
    const serializableSlots = {};
    Object.keys(state.slots).forEach((idx) => {
      const item = state.slots[idx];
      if (item) {
        serializableSlots[idx] = {
          nvrId: item.nvrId,
          channel: item.channel,
          subtype: item.subtype || 'sub',
          aspect: item.aspect || null
        };
      }
    });

    state.viewPresets[id] = {
      name: name.trim(),
      split: state.split,
      columnMode: state.columnMode,
      slotSize: state.slotSize,
      globalAspect: state.globalAspect,
      slots: serializableSlots
    };

    state.currentPresetId = id;
    try {
      localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(state.viewPresets));
    } catch (e) {}

    updatePresetDropdown();
    closePresetDialog();
    showToast(`Preset "${name}" saved`);
  }

  function saveCurrentViewPreset() {
    openPresetDialog();
  }

  function setupPresetDialog() {
    const dialog = document.getElementById('gpu-preset-dialog');
    if (!dialog) return;

    dialog.addEventListener('click', (e) => {
      const rect = dialog.getBoundingClientRect();
      const inDialog = (
        rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX && e.clientX <= rect.left + rect.width
      );
      if (!inDialog) {
        closePresetDialog();
      }
    });

    dialog.addEventListener('cancel', () => {
      closePresetDialog();
    });

    const input = document.getElementById('gpu-preset-name-input');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmSavePreset();
        }
      });
    }

    setupSheetSwipeDismiss('gpu-preset-dialog');
  }

  /**
   * Universal downward swipe-to-dismiss gesture for mobile bottom sheets
   */
  function setupSheetSwipeDismiss(dialogId) {
    const dialog = document.getElementById(dialogId);
    if (!dialog) return;
    const content = dialog.querySelector('.gpu-preset-dialog-content');
    if (!content) return;

    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    dialog.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      if (content.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      currentY = startY;
      isDragging = true;
    }, { passive: true });

    dialog.addEventListener('touchmove', (e) => {
      if (!isDragging || e.touches.length !== 1) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 0) {
        currentY = e.touches[0].clientY;
        content.style.transition = 'none';
        content.style.transform = `translateY(${Math.min(dy, 220)}px)`;
      }
    }, { passive: true });

    const endDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      const dy = currentY - startY;
      if (dy > 70) {
        content.style.transition = 'transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)';
        content.style.transform = 'translateY(100%)';
        setTimeout(() => {
          if (dialogId === 'gpu-preset-dialog') {
            closePresetDialog();
          } else if (dialogId === 'gpu-grid-sheet') {
            closeGridSheet();
          } else if (typeof dialog.close === 'function') {
            try { dialog.close(); } catch (err) {}
          }
          content.style.transform = '';
          content.style.transition = '';
        }, 180);
      } else {
        content.style.transition = 'transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)';
        content.style.transform = 'translateY(0)';
        setTimeout(() => {
          content.style.transform = '';
          content.style.transition = '';
        }, 180);
      }
    };

    dialog.addEventListener('touchend', endDrag, { passive: true });
    dialog.addEventListener('touchcancel', endDrag, { passive: true });
  }

  // -------------------------------------------------------------
  // Grid & Display Bottom Sheet (Thumb Zone Cockpit)
  // -------------------------------------------------------------

  function openGridSheet() {
    const dialog = document.getElementById('gpu-grid-sheet');
    if (!dialog) return;
    updateGridSheetChips();
    triggerHaptic(10);
    if (typeof dialog.showModal === 'function') {
      try {
        if (!dialog.open) dialog.showModal();
      } catch (e) {
        dialog.setAttribute('open', '');
      }
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function closeGridSheet() {
    const dialog = document.getElementById('gpu-grid-sheet');
    if (!dialog) return;
    if (typeof dialog.close === 'function') {
      try {
        if (dialog.open) dialog.close();
      } catch (e) {
        dialog.removeAttribute('open');
      }
    } else {
      dialog.removeAttribute('open');
    }
  }

  function updateGridSheetChips() {
    const splitChips = document.querySelectorAll('#sheet-split-chips .sheet-chip');
    splitChips.forEach((chip) => {
      const splitVal = parseInt(chip.dataset.split, 10);
      const isActive = (state.focusedSlotIndex !== null && splitVal === 1) || (state.focusedSlotIndex === null && splitVal === state.split);
      chip.classList.toggle('active', Boolean(isActive));
    });

    const colChips = document.querySelectorAll('#sheet-col-chips .sheet-chip');
    colChips.forEach((chip) => {
      const colVal = chip.dataset.col;
      const isColActive = String(state.columnMode) === String(colVal);
      chip.classList.toggle('active', isColActive);
    });

    const sizeChips = document.querySelectorAll('#sheet-size-chips .sheet-chip');
    sizeChips.forEach((chip) => {
      const sizeVal = chip.dataset.size;
      chip.classList.toggle('active', state.slotSize === sizeVal);
    });

    const engineChips = document.querySelectorAll('#sheet-engine-chips .sheet-chip');
    engineChips.forEach((chip) => {
      const engineVal = chip.dataset.engine;
      chip.classList.toggle('active', state.streamEngine === engineVal);
    });

    const tourChip = document.getElementById('sheet-tour-chip');
    if (tourChip) {
      tourChip.classList.toggle('active', state.tour.active);
    }
  }

  function setSplitFromSheet(split) {
    triggerHaptic(10);
    setSplit(split);
    updateGridSheetChips();
  }

  function setColumnModeFromSheet(mode) {
    triggerHaptic(10);
    setColumnMode(mode);
    updateGridSheetChips();
  }

  function setSlotSizeFromSheet(size) {
    triggerHaptic(10);
    setSlotSize(size);
    updateGridSheetChips();
  }

  function setStreamEngineFromSheet(engine) {
    triggerHaptic(10);
    setStreamEngine(engine);
    updateGridSheetChips();
  }

  function toggleTourFromSheet() {
    triggerHaptic(10);
    toggleTour();
    updateGridSheetChips();
  }

  function setupGridSheetDialog() {
    const dialog = document.getElementById('gpu-grid-sheet');
    if (!dialog) return;

    dialog.addEventListener('click', (e) => {
      const rect = dialog.getBoundingClientRect();
      const inDialog = (
        rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX && e.clientX <= rect.left + rect.width
      );
      if (!inDialog) {
        closeGridSheet();
      }
    });

    dialog.addEventListener('cancel', () => {
      closeGridSheet();
    });

    setupSheetSwipeDismiss('gpu-grid-sheet');
  }

  // -------------------------------------------------------------
  // Camera Options Mobile Bottom Sheet
  // -------------------------------------------------------------

  function updateCameraOptionsSheet() {
    const dialog = document.getElementById('gpu-options-sheet');
    if (!dialog) return;

    const subtitleEl = document.getElementById('gpu-options-sheet-subtitle');
    const item = state.slots[state.selectedSlotIndex];
    const isPlaying = item && item.videoPlaying;

    if (subtitleEl) {
      if (item) {
        subtitleEl.textContent = `Slot ${state.selectedSlotIndex + 1} • ${getCameraTitle(item.nvrId, item.channel)}`;
      } else {
        subtitleEl.textContent = `Slot ${state.selectedSlotIndex + 1} • Empty`;
      }
    }

    // 1x1 chip
    const btn1x1 = document.getElementById('sheet-btn-1x1');
    if (btn1x1) {
      const is1x1 = state.focusedSlotIndex !== null;
      btn1x1.classList.toggle('active', is1x1);
      btn1x1.disabled = !item;
    }

    // Quality chip
    const btnQuality = document.getElementById('sheet-btn-quality');
    const qualityLabel = document.getElementById('sheet-quality-label');
    if (btnQuality) {
      btnQuality.disabled = !item;
      if (qualityLabel) {
        qualityLabel.textContent = item && item.subtype === 'hd' ? 'HD' : 'SUB';
      }
      btnQuality.classList.toggle('active', item && item.subtype === 'hd');
    }

    // Aspect chip
    const btnAspect = document.getElementById('sheet-btn-aspect');
    const aspectLabel = document.getElementById('sheet-aspect-label');
    if (btnAspect) {
      btnAspect.disabled = !item;
      const curAspect = (item && item.aspect) || state.globalAspect;
      if (aspectLabel) {
        aspectLabel.textContent = curAspect === 'contain' ? 'FIT' : (curAspect === 'fill' ? 'STRETCH' : 'CROP');
      }
    }

    // Snapshot chip
    const btnSnap = document.getElementById('sheet-btn-snap');
    if (btnSnap) {
      btnSnap.disabled = !isPlaying;
    }

    // Audio chip
    const btnAudio = document.getElementById('sheet-btn-audio');
    const audioLabel = document.getElementById('sheet-audio-label');
    if (btnAudio) {
      const hasAudioHardware = item && state.capabilities[item.nvrId] && state.capabilities[item.nvrId][item.channel]
        ? state.capabilities[item.nvrId][item.channel].audio === true
        : false;
      const audioAvailable = isPlaying && hasAudioHardware;
      btnAudio.disabled = !audioAvailable;
      const isUnmuted = item && !item.audioMuted;
      btnAudio.classList.toggle('active', Boolean(isUnmuted));
      if (audioLabel) {
        audioLabel.textContent = isUnmuted ? 'Audio: Live' : 'Audio: Muted';
      }
    }

    // Record chip
    const btnRecord = document.getElementById('sheet-btn-record');
    const recordLabel = document.getElementById('sheet-record-label');
    if (btnRecord) {
      btnRecord.disabled = !isPlaying;
      const isRecording = item && item.recording && item.recording.active;
      btnRecord.classList.toggle('active', Boolean(isRecording));
      if (recordLabel) {
        recordLabel.textContent = isRecording ? `Recording (${item.recording.seconds}s)` : 'Record Clip';
      }
    }

    // Zoom chip
    const btnZoom = document.getElementById('sheet-btn-zoom');
    const zoomLabel = document.getElementById('sheet-zoom-label');
    if (btnZoom) {
      btnZoom.disabled = !isPlaying;
      const isZooming = item && item.digitalZoom && item.digitalZoom.active;
      btnZoom.classList.toggle('active', Boolean(isZooming));
      if (zoomLabel) {
        zoomLabel.textContent = isZooming ? `Zoom: ${item.digitalZoom.scale.toFixed(1)}x` : 'Digital Zoom';
      }
    }

    // PTZ chip
    const btnPtz = document.getElementById('sheet-btn-ptz');
    if (btnPtz) {
      const isPtz = item && state.capabilities[item.nvrId] && state.capabilities[item.nvrId][item.channel]
        ? state.capabilities[item.nvrId][item.channel].ptz === true
        : false;
      btnPtz.disabled = !isPtz;
    }

    // Reconnect chip
    const btnReconnect = document.getElementById('sheet-btn-reconnect');
    if (btnReconnect) {
      btnReconnect.disabled = !item;
    }

    // Close chip
    const btnClose = document.getElementById('sheet-btn-close');
    if (btnClose) {
      btnClose.disabled = !item;
    }
  }

  function openCameraOptionsSheet() {
    const dialog = document.getElementById('gpu-options-sheet');
    if (!dialog) return;
    updateCameraOptionsSheet();
    triggerHaptic(10);
    if (typeof dialog.showModal === 'function') {
      try {
        if (!dialog.open) dialog.showModal();
      } catch (e) {
        dialog.setAttribute('open', '');
      }
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function closeCameraOptionsSheet() {
    const dialog = document.getElementById('gpu-options-sheet');
    if (!dialog) return;
    if (typeof dialog.close === 'function') {
      try {
        if (dialog.open) dialog.close();
      } catch (e) {
        dialog.removeAttribute('open');
      }
    } else {
      dialog.removeAttribute('open');
    }
  }

  function reconnectSelectedSlot() {
    reconnectSlot(state.selectedSlotIndex);
  }

  function setupCameraOptionsDialog() {
    const dialog = document.getElementById('gpu-options-sheet');
    if (!dialog) return;

    dialog.addEventListener('click', (e) => {
      const rect = dialog.getBoundingClientRect();
      const inDialog = (
        rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX && e.clientX <= rect.left + rect.width
      );
      if (!inDialog) {
        closeCameraOptionsSheet();
      }
    });

    dialog.addEventListener('cancel', () => {
      closeCameraOptionsSheet();
    });

    setupSheetSwipeDismiss('gpu-options-sheet');
  }

  function loadViewPreset(id) {
    const preset = state.viewPresets[id];
    if (!preset) return;

    state.currentPresetId = id;
    clearAll();

    state.split = preset.split || 4;
    state.columnMode = normalizeColumnMode(preset.columnMode);
    state.slotSize = preset.slotSize || 'large';
    state.globalAspect = preset.globalAspect || 'contain';
    updateGlobalAspectUI();
    updateColumnModeUI();
    updateSlotSizeUI();

    if (preset.slots) {
      Object.keys(preset.slots).forEach((idx) => {
        const item = preset.slots[idx];
        if (item) {
          assignCameraToSlot(parseInt(idx, 10), item.nvrId, item.channel, item.subtype);
        }
      });
    }

    renderGrid();
  }

  // -------------------------------------------------------------
  // Context Menu Handling
  // -------------------------------------------------------------

  function setupContextMenu() {
    const menu = document.getElementById('gpu-context-menu');
    if (!menu) return;

    window.addEventListener('click', () => {
      menu.classList.add('hidden');
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') menu.classList.add('hidden');
    });
  }

  function openContextMenu(e, slotIndex) {
    e.preventDefault();
    e.stopPropagation();
    selectSlot(slotIndex);

    const menu = document.getElementById('gpu-context-menu');
    if (!menu) return;

    const item = state.slots[slotIndex];
    const caps = item ? (state.capabilities[item.nvrId] && state.capabilities[item.nvrId][item.channel]) : null;
    const isPtzSupported = Boolean(item && caps && caps.ptz === true);
    const isAudioSupported = Boolean(item && (!caps || caps.audio !== false));
    const isFeedReady = Boolean(item && item.videoPlaying);
    const isMediaRecorderSupported = typeof MediaRecorder !== 'undefined' && (
      HTMLVideoElement.prototype.captureStream || HTMLVideoElement.prototype.mozCaptureStream
    );

    menu.querySelectorAll('.gpu-menu-item').forEach(el => el.classList.remove('disabled'));

    if (!item) {
      menu.querySelectorAll('.gpu-menu-item').forEach(el => el.classList.add('disabled'));
    } else {
      if (!isPtzSupported) {
        const ptzItem = menu.querySelector('[data-menu="ptz"]');
        if (ptzItem) ptzItem.classList.add('disabled');
      }
      if (!isAudioSupported || !isFeedReady) {
        const audioItem = menu.querySelector('[data-menu="audio"]');
        if (audioItem) audioItem.classList.add('disabled');
      }
      if (!isFeedReady) {
        const zoomItem = menu.querySelector('[data-menu="zoom"]');
        const snapItem = menu.querySelector('[data-menu="snap"]');
        const recItem = menu.querySelector('[data-menu="rec"]');
        if (zoomItem) zoomItem.classList.add('disabled');
        if (snapItem) snapItem.classList.add('disabled');
        if (recItem) recItem.classList.add('disabled');
      }
      if (!isMediaRecorderSupported) {
        const recItem = menu.querySelector('[data-menu="rec"]');
        if (recItem) recItem.classList.add('disabled');
      }
    }

    // Context menu dynamic status indicators
    const m1x1 = menu.querySelector('[data-menu="1x1"]');
    if (m1x1) {
      const isFocused = state.focusedSlotIndex !== null;
      m1x1.innerHTML = `Toggle 1x1 Focus ${isFocused ? '<span class="menu-check">Active</span>' : ''}`;
    }

    const mQuality = menu.querySelector('[data-menu="quality"]');
    if (mQuality) {
      const isHd = item && item.subtype === 'hd';
      mQuality.innerHTML = `Stream Quality ${isHd ? '<span class="menu-check">HD</span>' : '<span class="menu-val">SUB</span>'}`;
    }

    const mAspect = menu.querySelector('[data-menu="aspect"]');
    if (mAspect) {
      const asp = (item && (item.aspect || state.globalAspect) || 'contain').toUpperCase();
      mAspect.innerHTML = `Aspect Ratio <span class="menu-val">[${asp}]</span>`;
    }

    const mZoom = menu.querySelector('[data-menu="zoom"]');
    if (mZoom) {
      const isZoomed = !!(item && item.digitalZoom && item.digitalZoom.active);
      const scaleVal = isZoomed ? `${Math.round(item.digitalZoom.scale * 10) / 10}x` : '';
      const statusLabel = !isFeedReady ? '(Offline)' : (isZoomed ? scaleVal : '');
      mZoom.innerHTML = `Digital Zoom ${statusLabel ? `<span class="${isZoomed ? 'menu-check' : 'menu-val'}">${statusLabel}</span>` : ''}`;
    }

    const mPtz = menu.querySelector('[data-menu="ptz"]');
    if (mPtz) {
      const drawer = document.getElementById('gpu-ptz-drawer');
      const isOpen = drawer && !drawer.classList.contains('hidden');
      const statusLabel = !isPtzSupported ? '(Fixed Lens)' : (isOpen ? 'Open' : '');
      mPtz.innerHTML = `PTZ Controller ${statusLabel ? `<span class="${isOpen ? 'menu-check' : 'menu-val'}">${statusLabel}</span>` : ''}`;
    }

    const mAudio = menu.querySelector('[data-menu="audio"]');
    if (mAudio) {
      const isLive = !!(item && !item.audioMuted);
      let statusLabel = 'Muted';
      let statusClass = 'menu-val';
      if (!isAudioSupported) {
        statusLabel = '(No Mic)';
      } else if (!isFeedReady) {
        statusLabel = '(Connecting)';
      } else if (isLive) {
        statusLabel = 'Live';
        statusClass = 'menu-check';
      }
      mAudio.innerHTML = `Live Audio <span class="${statusClass}">${statusLabel}</span>`;
    }

    const mRec = menu.querySelector('[data-menu="rec"]');
    if (mRec) {
      const isRecording = !!(item && item.recording && item.recording.active);
      let statusLabel = '';
      let statusClass = 'menu-val';
      if (!isMediaRecorderSupported) {
        statusLabel = '(Unsupported)';
      } else if (!isFeedReady) {
        statusLabel = '(Offline)';
      } else if (isRecording) {
        statusLabel = 'Recording';
        statusClass = 'menu-rec';
      }
      mRec.innerHTML = `Record Clip ${statusLabel ? `<span class="${statusClass}">${statusLabel}</span>` : ''}`;
    }

    menu.classList.remove('hidden');
    const menuW = menu.offsetWidth || 190;
    const menuH = menu.offsetHeight || 300;
    const posX = Math.max(8, Math.min(window.innerWidth - menuW - 8, e.clientX));
    const posY = Math.max(8, Math.min(window.innerHeight - menuH - 8, e.clientY));
    menu.style.left = `${posX}px`;
    menu.style.top = `${posY}px`;
  }

  // -------------------------------------------------------------
  // Slot Rendering (100% Full-Bleed Video - ZERO UI OBSTRUCTION!)
  // -------------------------------------------------------------

  function updateSlotBadges(slotIndex) {
    const badgesContainer = document.getElementById(`slot-badges-${slotIndex}`);
    if (!badgesContainer) return;

    const item = state.slots[slotIndex];
    if (!item) {
      badgesContainer.innerHTML = '';
      return;
    }

    const badges = [];

    // Main HD Badge
    if (item.subtype === 'hd') {
      badges.push('<span class="slot-badge badge-hd" title="Streaming Main HD (High Quality)">HD</span>');
    }

    // Digital Zoom Badge
    if (item.digitalZoom && item.digitalZoom.active) {
      const scaleStr = `${Math.round(item.digitalZoom.scale * 10) / 10}x`;
      badges.push(`<span class="slot-badge badge-zoom" title="Digital Zoom Active (${scaleStr})">${scaleStr}</span>`);
    }

    // Live Audio Unmuted Badge
    if (!item.audioMuted) {
      badges.push('<span class="slot-badge badge-audio" title="Audio Unmuted">AUDIO</span>');
    }

    // Video Recording Badge
    if (item.recording && item.recording.active) {
      const mins = Math.floor(item.recording.seconds / 60).toString().padStart(2, '0');
      const secs = (item.recording.seconds % 60).toString().padStart(2, '0');
      badges.push(`<span class="slot-badge badge-rec" title="Clip Recording in Progress"><span class="badge-rec-dot"></span>REC ${mins}:${secs}</span>`);
    }

    badgesContainer.innerHTML = badges.join('');
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
          <span>Slot ${slotIndex + 1}</span>
        </div>
      `;
      return;
    }

    // Active Playing Slot State: 100% Edge-to-Edge Pure Video, ZERO UI Overlays!
    const effectiveAspect = item.aspect || state.globalAspect;

    slotEl.className = `gpu-slot playing ${slotIndex === state.selectedSlotIndex ? 'selected' : ''}`;
    slotEl.innerHTML = `
      <!-- 100% Full-Bleed Video Wrapper (Zero obstruction!) -->
      <div class="gpu-video-wrapper aspect-${effectiveAspect}" id="video-wrap-${slotIndex}">
        <div class="gpu-slot-spinner" id="spinner-slot-${slotIndex}">
          <div class="spinner-ring"></div>
          <span>Connecting GPU Stream...</span>
        </div>
      </div>
      <div class="gpu-slot-badges" id="slot-badges-${slotIndex}"></div>
    `;

    const wrapper = slotEl.querySelector('.gpu-video-wrapper');
    setupDigitalZoomListeners(slotIndex, wrapper);
    if (item.digitalZoom && item.digitalZoom.active) {
      wrapper.classList.add('zoom-active');
      applyVideoTransform(slotIndex);
    }

    const handleSlotDoubleActivate = () => {
      if (item.digitalZoom && item.digitalZoom.active && item.digitalZoom.scale > 1.05) {
        item.digitalZoom.scale = 1.0;
        item.digitalZoom.x = 0;
        item.digitalZoom.y = 0;
        applyVideoTransform(slotIndex);
        updateSlotBadges(slotIndex);
        if (slotIndex === state.selectedSlotIndex) {
          updateBottomDock();
        }
        return;
      }
      toggleSlotZoom(slotIndex);
    };

    // Desktop: Double-click to reset digital zoom if zoomed, or toggle full 1x1 screen
    wrapper.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      handleSlotDoubleActivate();
    });

    // Touch Devices: Single-finger tap / double-tap (ignores scroll drags and pinch-zoom)
    let tapStartX = 0;
    let tapStartY = 0;
    let tapMoved = false;
    let tapMulti = false;

    wrapper.addEventListener('touchstart', (e) => {
      if (e.touches.length > 1) {
        tapMulti = true;
        return;
      }
      tapMulti = false;
      tapMoved = false;
      tapStartX = e.touches[0].clientX;
      tapStartY = e.touches[0].clientY;
    }, { passive: true });

    wrapper.addEventListener('touchmove', (e) => {
      if (e.touches.length > 1) {
        tapMulti = true;
        return;
      }
      if (!tapMoved && e.touches.length === 1) {
        const dx = Math.abs(e.touches[0].clientX - tapStartX);
        const dy = Math.abs(e.touches[0].clientY - tapStartY);
        if (dx > 12 || dy > 12) tapMoved = true;
      }
    }, { passive: true });

    wrapper.addEventListener('touchend', (e) => {
      if (tapMulti || tapMoved || e.changedTouches.length !== 1 || e.touches.length > 0) return;
      const now = Date.now();
      const timeSinceLast = now - (item.lastTapTime || 0);

      if (timeSinceLast > 0 && timeSinceLast < 300) {
        if (e.cancelable) e.preventDefault();
        item.lastTapTime = 0;
        handleSlotDoubleActivate();
        return;
      }
      item.lastTapTime = now;
      selectSlot(slotIndex);
    }, { passive: false });

    mountPlayer(slotIndex, slotEl, item, wrapper);
    updateSlotBadges(slotIndex);
  }

  function mountPlayer(slotIndex, slotEl, item, wrapper) {
    // Mount VideoRTC hardware-accelerated video element
    const streamKey = `${item.nvrId}_ch${item.channel}${item.subtype === 'hd' ? '_hd' : ''}`;
    const host = window.location.host;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${host}/api/go2rtc/ws?src=${streamKey}`;

    const player = document.createElement('video-rtc');
    player.className = 'gpu-player-el';

    // Stream engine mode: 'auto' (MSE fast start + WebRTC) | 'mse' (pure MediaSource WebSocket) | 'webrtc' (direct UDP)
    const engineMode = state.streamEngine === 'mse' ? 'mse' : (state.streamEngine === 'webrtc' ? 'webrtc' : 'mse,webrtc');
    player.mode = engineMode;
    player.src = wsUrl;

    wrapper.appendChild(player);

    if (player.video) {
      player.video.controls = false;
      player.video.muted = item.audioMuted;
      player.video.autoplay = true;
      player.video.playsInline = true;

      const spinnerEl = slotEl.querySelector(`#spinner-slot-${slotIndex}`);
      const onStreamReady = () => {
        if (spinnerEl) {
          spinnerEl.style.display = 'none';
          spinnerEl.classList.remove('stream-stalled');
        }
        item.videoPlaying = true;
        updateSlotBadges(slotIndex);
        if (slotIndex === state.selectedSlotIndex) {
          updateBottomDock();
        }
      };

      const onStreamFailed = () => {
        item.videoPlaying = false;
        if (spinnerEl) {
          spinnerEl.style.display = 'flex';
          spinnerEl.classList.add('stream-stalled');
          const label = spinnerEl.querySelector('span');
          if (label) label.textContent = 'Stream Offline • Tap to Reconnect';
        }
        updateSlotBadges(slotIndex);
        if (slotIndex === state.selectedSlotIndex) {
          updateBottomDock();
        }
      };

      player.video.addEventListener('playing', onStreamReady, { once: true });
      player.video.addEventListener('loadeddata', onStreamReady, { once: true });
      player.video.addEventListener('timeupdate', () => {
        if (player.video.currentTime > 0) onStreamReady();
      }, { once: true });
      player.video.addEventListener('error', onStreamFailed);
      player.video.addEventListener('ended', onStreamFailed);

      if (player.video.readyState >= 2 || player.video.currentTime > 0) {
        onStreamReady();
      }
    }
  }

  function reconnectSlot(slotIndex) {
    const item = state.slots[slotIndex];
    if (!item) return;
    triggerHaptic(10);

    const slotEl = document.getElementById(`gpu-slot-${slotIndex}`);
    if (!slotEl) return;
    const wrapper = slotEl.querySelector('.gpu-video-wrapper');
    if (!wrapper) return;

    const spinnerEl = slotEl.querySelector(`#spinner-slot-${slotIndex}`);
    if (spinnerEl) {
      spinnerEl.style.display = 'flex';
      spinnerEl.classList.remove('stream-stalled');
      const label = spinnerEl.querySelector('span');
      if (label) label.textContent = 'Reconnecting GPU Stream...';
    }

    const oldPlayer = slotEl.querySelector('video-rtc');
    if (oldPlayer) {
      try {
        if (typeof oldPlayer.ondisconnect === 'function') oldPlayer.ondisconnect();
        oldPlayer.src = '';
        oldPlayer.remove();
      } catch (e) {}
    }

    mountPlayer(slotIndex, slotEl, item, wrapper);
    showToast(`Reconnecting CAM ${item.channel.toString().padStart(2, '0')}...`);
  }

  function renderGrid() {
    const gridContainer = document.getElementById('gpu-grid-container');
    if (!gridContainer) return;

    // Safely stop any active recordings before rebuilding grid to prevent corrupted files
    Object.keys(state.slots).forEach((idx) => {
      const it = state.slots[idx];
      if (it && it.recording && it.recording.active) {
        stopRecording(Number(idx));
      }
    });

    // Disconnect old players immediately when building grid to release NVR sockets
    document.querySelectorAll('.gpu-slot video-rtc').forEach((el) => {
      try {
        if (typeof el.ondisconnect === 'function') el.ondisconnect();
        el.src = '';
        el.remove();
      } catch (e) {}
    });

    gridContainer.innerHTML = '';

    const effectiveSplit = state.focusedSlotIndex !== null ? 1 : state.split;
    syncGridClassName();

    const totalSlots = effectiveSplit;

    for (let i = 0; i < totalSlots; i++) {
      const slotIndex = state.focusedSlotIndex !== null ? state.focusedSlotIndex : i;
      const slotEl = document.createElement('div');
      slotEl.id = `gpu-slot-${slotIndex}`;
      slotEl.dataset.slotIndex = slotIndex;

      // Click to select this slot; on mobile tapping + prompt or already-selected empty slot opens camera list
      slotEl.addEventListener('click', (e) => {
        const wasSelected = state.selectedSlotIndex === slotIndex;
        const tappedPrompt = Boolean(e.target && e.target.closest && e.target.closest('.gpu-slot-empty-prompt'));
        const tappedSpinner = Boolean(e.target && e.target.closest && e.target.closest('.gpu-slot-spinner'));
        const isStalled = state.slots[slotIndex] && !state.slots[slotIndex].videoPlaying;

        selectSlot(slotIndex);

        if (isStalled && (wasSelected || tappedSpinner)) {
          reconnectSlot(slotIndex);
          return;
        }

        if (window.innerWidth <= 1024 && !state.slots[slotIndex] && (wasSelected || tappedPrompt) && !state.drawerOpen) {
          toggleDrawer(true);
        }
      });

      // Right-Click Context Menu (registered once per slot node)
      slotEl.addEventListener('contextmenu', (e) => {
        openContextMenu(e, slotIndex);
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
    const targetSlot = state.focusedSlotIndex !== null ? state.focusedSlotIndex : (state.selectedSlotIndex >= effectiveSplit ? 0 : state.selectedSlotIndex);
    selectSlot(targetSlot);

    // Update active state in toolbar buttons and split select
    const splitSelect = document.getElementById('gpu-split-select');
    if (splitSelect) {
      splitSelect.value = state.focusedSlotIndex !== null ? '1' : String(state.split);
    }
    document.querySelectorAll('.gpu-split-btn').forEach((btn) => {
      const splitVal = parseInt(btn.dataset.split, 10);
      const isActive = splitVal === state.split && state.focusedSlotIndex === null;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });

    updateGlobalAspectUI();
    updateColumnModeUI();
    updateSlotSizeUI();
    updateStreamEngineUI();
    adjustGridLayout();
  }

  const PREFERRED_COLS = {
    1: [1],
    2: [2, 1],
    4: [2, 4, 1],
    6: [3, 2, 6, 1],
    9: [3, 2, 4, 1],
    16: [4, 5, 3, 2, 8],
    25: [5, 6, 4, 3],
    32: [8, 6, 4, 3]
  };

  /**
   * Adjust grid columns and slot dimensions dynamically across phone, tablet, and desktop.
   * Respects explicit COLS overrides uniformly and uses scrollable 1fr tracks without overflow.
   */
  function adjustGridLayout() {
    const gridContainer = document.getElementById('gpu-grid-container');
    if (!gridContainer) return;

    const effectiveSplit = state.focusedSlotIndex !== null ? 1 : state.split;
    const totalSlots = effectiveSplit;
    if (totalSlots <= 0) return;

    syncGridClassName();

    const containerW = gridContainer.clientWidth;
    const containerH = gridContainer.clientHeight;
    if (containerW <= 0 || containerH <= 0) return;

    const gap = 4;
    const pad = 8; // 4px padding each side
    const availW = Math.max(containerW - pad, 60);
    const availH = Math.max(containerH - pad, 60);
    const targetAspect = 16 / 9;

    const isNarrowViewport = containerW <= 620;
    const isUltraNarrow = containerW <= 380;
    const isPhoneLandscape = (typeof window !== 'undefined' && window.innerHeight <= 540 && containerW > containerH);
    const normCol = normalizeColumnMode(state.columnMode);
    const explicitCol = normCol === 'auto' ? null : normCol;

    let bestCols = 1;
    let bestSlotW = 0;
    let bestSlotH = 0;
    let lockSingleLandscapeCap = false;

    // Focused 1x1 mode: single slot maximizes on screen without scrolling
    if (state.focusedSlotIndex !== null || effectiveSplit === 1) {
      bestCols = 1;
      bestSlotW = Math.min(availW, availH * targetAspect);
      bestSlotH = bestSlotW / targetAspect;
    } else if (explicitCol !== null) {
      // Explicit COLS override (1, 2, 3, 4) is always honored cleanly
      bestCols = explicitCol;
      bestSlotW = Math.floor((availW - (bestCols - 1) * gap) / bestCols);
      bestSlotH = Math.floor(bestSlotW / targetAspect);
    } else if (state.slotSize === 'fit') {
      // Fit Screen: strictly fit inside viewport without scrolling
      const baseCandidates = PREFERRED_COLS[effectiveSplit] || [1, 2, 3, 4];
      const candidates = isUltraNarrow
        ? [1, 2].filter(c => c <= totalSlots)
        : (isNarrowViewport ? [2, 1, 3].filter(c => c <= totalSlots) : baseCandidates);
      let bestArea = -1;

      for (const c of candidates) {
        const r = Math.ceil(totalSlots / c);
        const maxW_fromWidth = (availW - (c - 1) * gap) / c;
        const maxH_fromHeight = (availH - (r - 1) * gap) / r;
        if (maxW_fromWidth <= 0 || maxH_fromHeight <= 0) continue;

        const maxW_fromHeight = maxH_fromHeight * targetAspect;
        const slotW = Math.min(maxW_fromWidth, maxW_fromHeight);
        const slotH = slotW / targetAspect;
        const area = slotW * slotH;

        if (area > bestArea) {
          bestArea = area;
          bestCols = c;
          bestSlotW = slotW;
          bestSlotH = slotH;
        }
      }
    } else {
      // SCROLLABLE AUTO COLUMNS (Never shrinks slots to fit all rows in one screen)
      let minSlotW = 380; // Large (default): crisp readable feeds across phone & desktop
      if (state.slotSize === 'xl') {
        minSlotW = 640; // Extra Large: maximum video detail
      } else if (state.slotSize === 'medium') {
        minSlotW = 260; // Medium: denser overview with natural vertical scroll
      }

      let maxColsByWidth = Math.floor((availW + gap) / (minSlotW + gap));
      maxColsByWidth = Math.max(1, Math.min(totalSlots, maxColsByWidth));

      // Cap upper column density for balanced standard splits (never increases columns below minSlotW)
      let c = maxColsByWidth;
      if (totalSlots === 4 && c >= 3) {
        c = 2;
      } else if (totalSlots === 6 && c >= 4) {
        c = 3;
      } else if (totalSlots === 9 && c >= 4) {
        c = 3;
      } else if (totalSlots === 16 && c > 4) {
        c = 4;
      } else if (totalSlots === 25 && c > 5) {
        c = 5;
      } else if (totalSlots === 32 && c > 8) {
        c = 8;
      }

      bestCols = c;
      bestSlotW = Math.floor((availW - (c - 1) * gap) / c);
      bestSlotH = Math.floor(bestSlotW / targetAspect);

      // In shallow phone landscape, ensure a single-column feed isn't taller than the screen
      if (bestCols === 1 && isPhoneLandscape && bestSlotH > availH) {
        bestSlotH = Math.max(availH, 160);
        bestSlotW = Math.floor(bestSlotH * targetAspect);
        lockSingleLandscapeCap = true;
      }
    }

    // Fallback if container is extremely constrained
    if (bestSlotW <= 0 || bestSlotH <= 0) {
      bestCols = 1;
      bestSlotW = Math.max(availW, 120);
      bestSlotH = Math.floor(bestSlotW / targetAspect);
    }

    const totalRows = Math.ceil(totalSlots / bestCols);
    const totalGridHeight = totalRows * bestSlotH + (totalRows - 1) * gap;
    const overflowsY = totalGridHeight > availH + 2;

    gridContainer.style.alignContent = overflowsY ? 'start' : 'center';
    gridContainer.style.justifyContent = 'center';
    gridContainer.style.setProperty('--grid-cols', String(bestCols));
    gridContainer.style.setProperty('--slot-width', `${Math.floor(bestSlotW)}px`);
    gridContainer.style.setProperty('--slot-height', `${Math.floor(bestSlotH)}px`);

    const isFixedFitOrSingle = (state.slotSize === 'fit' && !overflowsY) || state.focusedSlotIndex !== null || effectiveSplit === 1 || lockSingleLandscapeCap;
    if (isFixedFitOrSingle) {
      gridContainer.classList.remove('grid-scrollable');
      gridContainer.style.gridTemplateColumns = `repeat(${bestCols}, ${Math.floor(bestSlotW)}px)`;
      gridContainer.style.gridTemplateRows = state.focusedSlotIndex !== null || effectiveSplit === 1 || state.slotSize === 'fit'
        ? `repeat(${totalRows}, ${Math.floor(bestSlotH)}px)`
        : '';
      gridContainer.style.gridAutoRows = `${Math.floor(bestSlotH)}px`;
    } else {
      gridContainer.classList.add('grid-scrollable');
      gridContainer.style.gridTemplateColumns = `repeat(${bestCols}, minmax(0, 1fr))`;
      gridContainer.style.gridTemplateRows = '';
      gridContainer.style.gridAutoRows = `${Math.floor(bestSlotH)}px`;
    }
  }

  let gridResizeObserver = null;
  let lastMobileState = typeof window !== 'undefined' ? window.innerWidth <= 1024 : false;

  function setupGridResizeObserver() {
    const gridContainer = document.getElementById('gpu-grid-container');
    if (!gridContainer || gridResizeObserver) return;

    const handleViewportChange = () => {
      if (typeof window !== 'undefined') {
        const isNowMobile = window.innerWidth <= 1024;
        if (isNowMobile !== lastMobileState) {
          lastMobileState = isNowMobile;
          toggleDrawer(!isNowMobile);
        } else {
          syncDrawerAccessibility();
          syncMobileBackdrop();
        }
      }
      requestAnimationFrame(adjustGridLayout);
    };

    if (typeof window !== 'undefined' && window.ResizeObserver) {
      let rafId = null;
      gridResizeObserver = new ResizeObserver(() => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          adjustGridLayout();
        });
      });
      gridResizeObserver.observe(gridContainer);
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleViewportChange, { passive: true });
      window.addEventListener('orientationchange', () => {
        setTimeout(handleViewportChange, 120);
      });
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
          requestAnimationFrame(adjustGridLayout);
        });
      }
    }
  }

  let sidebarSwipeBound = false;
  let mobileEscapeBound = false;

  function syncDrawerAccessibility() {
    const sidebar = document.getElementById('gpu-sidebar');
    if (!sidebar || typeof window === 'undefined') return;
    const isMobile = window.innerWidth <= 1024;
    sidebar.inert = isMobile && !state.drawerOpen;
    if (isMobile) {
      sidebar.setAttribute('role', 'dialog');
      if (state.drawerOpen) sidebar.setAttribute('aria-modal', 'true');
      else sidebar.removeAttribute('aria-modal');
    } else {
      sidebar.removeAttribute('role');
      sidebar.removeAttribute('aria-modal');
    }
  }

  function syncMobileBackdrop() {
    const backdrop = document.getElementById('gpu-drawer-backdrop');
    if (!backdrop || typeof window === 'undefined') return;
    const isMobile = window.innerWidth <= 1024;
    const ptzDrawer = document.getElementById('gpu-ptz-drawer');
    const ptzOpen = Boolean(window.innerWidth <= 1023 && ptzDrawer && !ptzDrawer.classList.contains('hidden'));
    backdrop.classList.toggle('active', Boolean(isMobile && (state.drawerOpen || ptzOpen)));
  }

  function closeMobileDrawers() {
    if (typeof window !== 'undefined' && window.innerWidth <= 1024 && state.drawerOpen) {
      toggleDrawer(false);
    }
    const ptzDrawer = document.getElementById('gpu-ptz-drawer');
    if (typeof window !== 'undefined' && window.innerWidth <= 1023 && ptzDrawer && !ptzDrawer.classList.contains('hidden')) {
      togglePtzDrawer(false);
    }
  }

  function setupMobileEscape() {
    if (mobileEscapeBound || typeof window === 'undefined') return;
    mobileEscapeBound = true;
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (window.innerWidth <= 1024 && state.drawerOpen) {
        toggleDrawer(false);
        const toggleBtn = document.getElementById('gpu-drawer-toggle');
        if (toggleBtn) toggleBtn.focus();
      }
      const ptzDrawer = document.getElementById('gpu-ptz-drawer');
      if (window.innerWidth <= 1023 && ptzDrawer && !ptzDrawer.classList.contains('hidden')) {
        togglePtzDrawer(false);
        const ptzBtn = document.getElementById('dock-btn-ptz');
        if (ptzBtn) ptzBtn.focus();
      }
    });
  }

  function setupSidebarSwipeClose() {
    if (sidebarSwipeBound) return;
    const sidebar = document.getElementById('gpu-sidebar');
    if (!sidebar) return;
    sidebarSwipeBound = true;

    let startX = 0;
    let startY = 0;
    sidebar.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });

    sidebar.addEventListener('touchend', (e) => {
      if (window.innerWidth > 1024 || !state.drawerOpen || e.changedTouches.length !== 1) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      // Intentional horizontal swipe left dismisses mobile camera drawer
      if (dx < -55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        toggleDrawer(false);
      }
    }, { passive: true });

    // Edge swipe right (from <= 32px of left edge) opens mobile camera drawer
    let edgeStartX = 0;
    let edgeStartY = 0;
    let isEdgeSwipeCandidate = false;

    window.addEventListener('touchstart', (e) => {
      if (window.innerWidth > 1024 || state.drawerOpen || e.touches.length !== 1) {
        isEdgeSwipeCandidate = false;
        return;
      }
      const t = e.touches[0];
      edgeStartX = t.clientX;
      edgeStartY = t.clientY;
      isEdgeSwipeCandidate = edgeStartX <= 32;
    }, { passive: true });

    window.addEventListener('touchend', (e) => {
      if (!isEdgeSwipeCandidate || window.innerWidth > 1024 || state.drawerOpen || e.changedTouches.length !== 1) {
        isEdgeSwipeCandidate = false;
        return;
      }
      const dx = e.changedTouches[0].clientX - edgeStartX;
      const dy = e.changedTouches[0].clientY - edgeStartY;
      isEdgeSwipeCandidate = false;
      if (dx >= 45 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        toggleDrawer(true);
      }
    }, { passive: true });

    // 1x1 Focus Mode: horizontal swipe on feed steps Prev/Next active slot
    const gridContainer = document.getElementById('gpu-grid-container');
    if (gridContainer) {
      let feedStartX = 0;
      let feedStartY = 0;
      let feedStartTime = 0;
      let isFeedSwipeCandidate = false;

      gridContainer.addEventListener('touchstart', (e) => {
        if (state.focusedSlotIndex === null) {
          isFeedSwipeCandidate = false;
          return;
        }
        const currentItem = state.slots[state.focusedSlotIndex];
        if (currentItem && currentItem.digitalZoom && currentItem.digitalZoom.active) {
          isFeedSwipeCandidate = false;
          return;
        }
        if (e.touches.length !== 1) return;
        feedStartX = e.touches[0].clientX;
        feedStartY = e.touches[0].clientY;
        feedStartTime = Date.now();
        isFeedSwipeCandidate = true;
      }, { passive: true });

      gridContainer.addEventListener('touchend', (e) => {
        if (!isFeedSwipeCandidate || state.focusedSlotIndex === null || e.changedTouches.length !== 1) {
          isFeedSwipeCandidate = false;
          return;
        }
        const currentItem = state.slots[state.focusedSlotIndex];
        if (currentItem && currentItem.digitalZoom && currentItem.digitalZoom.active) {
          isFeedSwipeCandidate = false;
          return;
        }
        const dx = e.changedTouches[0].clientX - feedStartX;
        const dy = e.changedTouches[0].clientY - feedStartY;
        const elapsed = Date.now() - feedStartTime;
        isFeedSwipeCandidate = false;

        if (elapsed < 600 && Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.3) {
          if (dx < 0) {
            stepSelectedSlot(1);
          } else {
            stepSelectedSlot(-1);
          }
        }
      }, { passive: true });
    }

    const ptzDrawer = document.getElementById('gpu-ptz-drawer');
    if (ptzDrawer) {
      let ptzStartX = 0;
      let ptzStartY = 0;
      ptzDrawer.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        ptzStartX = e.touches[0].clientX;
        ptzStartY = e.touches[0].clientY;
      }, { passive: true });

      ptzDrawer.addEventListener('touchend', (e) => {
        if (window.innerWidth > 1023 || ptzDrawer.classList.contains('hidden') || e.changedTouches.length !== 1) return;
        const dx = e.changedTouches[0].clientX - ptzStartX;
        const dy = e.changedTouches[0].clientY - ptzStartY;
        if (dx > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          togglePtzDrawer(false);
        }
      }, { passive: true });
    }
  }

  function setupScrollAffordance(el) {
    if (!el) return;
    const updateMask = () => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll <= 4) {
        el.style.maskImage = 'none';
        el.style.webkitMaskImage = 'none';
        return;
      }
      const hasLeft = el.scrollLeft > 6;
      const hasRight = el.scrollLeft < maxScroll - 6;
      if (hasLeft && hasRight) {
        const grad = 'linear-gradient(to right, transparent 0, black 20px, black calc(100% - 20px), transparent 100%)';
        el.style.maskImage = grad;
        el.style.webkitMaskImage = grad;
      } else if (hasLeft) {
        const grad = 'linear-gradient(to right, transparent 0, black 20px, black 100%)';
        el.style.maskImage = grad;
        el.style.webkitMaskImage = grad;
      } else {
        const grad = 'linear-gradient(to right, black calc(100% - 20px), transparent 100%)';
        el.style.maskImage = grad;
        el.style.webkitMaskImage = grad;
      }
    };
    el.addEventListener('scroll', updateMask, { passive: true });
    window.addEventListener('resize', updateMask, { passive: true });
    setTimeout(updateMask, 120);
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
    if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) {
      showToast('Video feed is not ready for snapshot');
      return;
    }

    const item = state.slots[slotIndex];
    const title = item ? getCameraTitle(item.nvrId, item.channel) : `Slot_${slotIndex + 1}`;
    const isZoomed = Boolean(item && item.digitalZoom && item.digitalZoom.active && item.digitalZoom.scale > 1.05);

    triggerShutterFlash(slotEl);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const vidW = videoEl.videoWidth;
    const vidH = videoEl.videoHeight;

    if (isZoomed) {
      const scale = item.digitalZoom.scale;
      const wrapper = slotEl.querySelector('.gpu-video-wrapper');
      const wrapRect = wrapper ? wrapper.getBoundingClientRect() : { width: vidW, height: vidH };

      const cropW = vidW / scale;
      const cropH = vidH / scale;

      const normPanX = item.digitalZoom.x / (wrapRect.width || 1);
      const normPanY = item.digitalZoom.y / (wrapRect.height || 1);

      let cropX = (vidW - cropW) / 2 - (normPanX * vidW);
      let cropY = (vidH - cropH) / 2 - (normPanY * vidH);

      cropX = Math.max(0, Math.min(vidW - cropW, cropX));
      cropY = Math.max(0, Math.min(vidH - cropH, cropY));

      canvas.width = Math.round(cropW);
      canvas.height = Math.round(cropH);
      ctx.drawImage(videoEl, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
    } else {
      canvas.width = vidW;
      canvas.height = vidH;
      ctx.drawImage(videoEl, 0, 0, vidW, vidH);
    }

    canvas.toBlob((blob) => {
      if (!blob) {
        showToast('Could not export snapshot image');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const zoomSuffix = isZoomed ? `_zoom${Math.round(item.digitalZoom.scale * 10) / 10}x` : '';
      const filename = `${title.replace(/\s+/g, '_')}${zoomSuffix}_${dateStr}.jpg`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      showToast(`Snapshot saved: ${filename}`);
    }, 'image/jpeg', 0.95);
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
    sidebar.classList.toggle('collapsed', !state.drawerOpen);

    const toggleBtn = document.getElementById('gpu-drawer-toggle');
    if (toggleBtn) {
      toggleBtn.classList.toggle('active', state.drawerOpen);
      toggleBtn.setAttribute('aria-expanded', String(state.drawerOpen));
    }

    const toggleIcon = document.getElementById('gpu-drawer-toggle-icon');
    if (toggleIcon) {
      toggleIcon.textContent = state.drawerOpen ? '◀' : '▶';
    }

    syncDrawerAccessibility();
    syncMobileBackdrop();

    setTimeout(() => {
      adjustGridLayout();
    }, 180);
  }

  function stopAll() {
    if (state.tour.active) toggleTour();
    Object.keys(state.slots).forEach((idx) => {
      const item = state.slots[idx];
      if (item && item.recording && item.recording.active) {
        stopRecording(idx);
      }
    });

    document.querySelectorAll('.gpu-slot video-rtc').forEach((el) => {
      try {
        if (typeof el.ondisconnect === 'function') el.ondisconnect();
        el.src = '';
        el.remove();
      } catch (e) {}
    });
  }

  /**
   * Public API exposed to window.VOSCCTV_GPU_WALL
   */
  window.VOSCCTV_GPU_WALL = {
    init: async function () {
      // 1. Immediate synchronous UI & grid render (0ms zero-latency stream start)
      restoreSavedLayout();
      updateColumnModeUI();
      updateSlotSizeUI();
      updateStreamEngineUI();
      updateGlobalAspectUI();
      setupContextMenu();
      setupPtzButtons();
      setupGridResizeObserver();
      setupSidebarSwipeClose();
      setupMobileEscape();
      setupPresetDialog();
      setupGridSheetDialog();
      setupCameraOptionsDialog();
      setupScrollAffordance(document.querySelector('.gpu-dock-center'));
      setupScrollAffordance(document.querySelector('.gpu-toolbar'));
      toggleDrawer(typeof window !== 'undefined' ? window.innerWidth > 1024 : true);
      const ptzDrawerEl = document.getElementById('gpu-ptz-drawer');
      if (ptzDrawerEl) ptzDrawerEl.inert = ptzDrawerEl.classList.contains('hidden');
      renderGrid();
      updateBottomDock();

      // 2. Fetch metadata asynchronously in background without blocking stream startup
      loadCameraNames().then(() => {
        renderTree();
        if (window.VOSCCTV_APP && typeof window.VOSCCTV_APP.syncHealthDots === 'function') {
          window.VOSCCTV_APP.syncHealthDots();
        }
        Object.keys(state.slots).forEach((idx) => updateSlotBadges(parseInt(idx, 10)));
        updateBottomDock();
      });

      loadCameraCapabilities().then(() => {
        updateBottomDock();
        const activeItem = state.slots[state.selectedSlotIndex];
        const isPtz = activeItem && state.capabilities[activeItem.nvrId] && state.capabilities[activeItem.nvrId][activeItem.channel]
          ? state.capabilities[activeItem.nvrId][activeItem.channel].ptz === true
          : false;
        updatePtzDrawerControls(isPtz);
      });
    },
    setSplit,
    setColumnMode,
    setSlotSize,
    setStreamEngine,
    selectSlot,
    assignCameraToSlot,
    assignCameraToSelectedSlot,
    clearSlot,
    clearAll,
    openAll,
    toggleSubtype,
    toggleSlotZoom,
    setGlobalAspect,
    cycleSlotAspect,
    toggleDigitalZoom,
    toggleAudio,
    toggleRecord,
    takeSnapshot,
    toggleTour,
    saveCurrentViewPreset,
    loadViewPreset,
    openPresetDialog,
    closePresetDialog,
    confirmSavePreset,
    deletePreset,
    openGridSheet,
    closeGridSheet,
    openCameraOptionsSheet,
    closeCameraOptionsSheet,
    updateCameraOptionsSheet,
    reconnectSelectedSlot,
    setSplitFromSheet,
    setColumnModeFromSheet,
    setSlotSizeFromSheet,
    setStreamEngineFromSheet,
    toggleTourFromSheet,
    clearCameraSearch,
    reconnectSlot,
    toggleDrawer,
    closeMobileDrawers,
    cycleSelectedSlot,
    stepSelectedSlot,
    adjustGridLayout,
    filterTree,
    ptzGotoPreset,
    showToast,
    // Bottom Dock Bridge Methods
    dockToggleQuality,
    dockCycleAspect,
    dockToggleDigitalZoom,
    dockStepDigitalZoom,
    dockTogglePtz,
    dockToggleAudio,
    dockToggleRecord,
    dockTakeSnapshot,
    dockToggleZoom1x1,
    dockClearSlot,
    stop: stopAll
  };
})();
