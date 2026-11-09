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
    columnMode: 'auto',        // 'auto', 2, 3
    focusedSlotIndex: null,    // If zoomed to single slot (0..31)
    selectedSlotIndex: 0,      // Which slot receives next camera click
    globalAspect: 'contain',   // 'contain' (Fit 16:9), 'fill' (Stretch), 'cover' (Crop)
    slots: {},                 // slotIndex -> slotState
    cameraNames: { nvr1: {}, nvr2: {} },
    capabilities: { nvr1: {}, nvr2: {} }, // channel -> { ptz: boolean, audio: boolean }
    viewPresets: { default: { name: 'Default', split: 4, columnMode: 'auto', slots: {} } },
    currentPresetId: 'default',
    tour: { active: false, timer: null, intervalMs: 15000, offset: 0 },
    drawerOpen: true,
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
        globalAspect: state.globalAspect,
        slots: serializableSlots
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
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
        if (parsed.columnMode && ['auto', 2, 3].includes(parsed.columnMode)) {
          state.columnMode = parsed.columnMode;
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
          <span class="dot online" style="margin-right:2px;"></span>
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
          <span class="gpu-tree-item-icon">📹</span>
          <span class="gpu-tree-ch-tag">CH ${ch.toString().padStart(2, '0')}</span>
          <span class="gpu-tree-name-label" id="label-${nvr.id}-${ch}" title="Double-click to rename">${title}</span>
          ${ptzBadge}
        `;

        // Click: Assign to currently selected slot
        itemEl.addEventListener('click', () => {
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

        // Desktop: Double-Click to Inline Rename (Zero Clutter, No Pencil Icon!)
        const labelEl = itemEl.querySelector('.gpu-tree-name-label');
        labelEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          startInlineRename(nvr.id, ch, itemEl, labelEl);
        });

        // Mobile/Tablet: Long-Press (hold 500ms) to Inline Rename
        itemEl.addEventListener('touchstart', () => {
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

    // Update glowing border outline on slot
    document.querySelectorAll('.gpu-slot').forEach((el) => {
      const idx = parseInt(el.dataset.slotIndex, 10);
      el.classList.toggle('selected', idx === slotIndex);
    });

    // Update target pill in toolbar
    const pill = document.getElementById('gpu-active-slot-num');
    if (pill) {
      pill.textContent = `Slot ${slotIndex + 1}`;
    }

    // Update the Dedicated Bottom Control Dock
    updateBottomDock();
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
  }

  function openAll(nvrId) {
    clearAll();
    const total = Math.min(32, state.split);
    for (let i = 0; i < total; i++) {
      assignCameraToSlot(i, nvrId, i + 1, 'sub');
    }
    selectSlot(0);
  }

  /**
   * Smart Resolution & Sub/HD Quality Toggle
   */
  function toggleSubtype(slotIndex) {
    const item = state.slots[slotIndex];
    if (!item) return;
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
    document.querySelectorAll('.gpu-aspect-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.aspect === state.globalAspect);
    });
  }

  function updateColumnModeUI() {
    document.querySelectorAll('.gpu-col-btn').forEach((btn) => {
      const mode = btn.dataset.cols;
      const isMatch = (mode === 'auto' && state.columnMode === 'auto') ||
                      (mode === '2' && state.columnMode === 2) ||
                      (mode === '3' && state.columnMode === 3);
      btn.classList.toggle('active', isMatch);
    });
  }

  function setColumnMode(mode) {
    if (mode === 2 || mode === '2') {
      state.columnMode = 2;
    } else if (mode === 3 || mode === '3') {
      state.columnMode = 3;
    } else {
      state.columnMode = 'auto';
    }
    updateColumnModeUI();
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
  // Digital Zoom & ROI Pan Engine
  // -------------------------------------------------------------

  function toggleDigitalZoom(slotIndex) {
    const item = state.slots[slotIndex];
    if (!item || !item.videoPlaying) return;

    item.digitalZoom.active = !item.digitalZoom.active;
    const slotEl = document.getElementById(`gpu-slot-${slotIndex}`);
    if (!slotEl) return;

    const wrapper = slotEl.querySelector('.gpu-video-wrapper');

    if (item.digitalZoom.active) {
      if (wrapper) wrapper.classList.add('zoom-active');
    } else {
      item.digitalZoom.scale = 1;
      item.digitalZoom.x = 0;
      item.digitalZoom.y = 0;
      applyVideoTransform(slotIndex);
      if (wrapper) wrapper.classList.remove('zoom-active');
    }

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
      video.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    }
  }

  function setupDigitalZoomListeners(slotIndex, wrapper) {
    const item = state.slots[slotIndex];
    if (!item) return;

    // Mouse wheel zoom
    wrapper.addEventListener('wheel', (e) => {
      if (!item.digitalZoom.active) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.25 : -0.25;
      item.digitalZoom.scale = Math.min(8.0, Math.max(1.0, item.digitalZoom.scale + delta));
      if (item.digitalZoom.scale === 1.0) {
        item.digitalZoom.x = 0;
        item.digitalZoom.y = 0;
      }
      applyVideoTransform(slotIndex);
    }, { passive: false });

    // Drag to pan
    wrapper.addEventListener('mousedown', (e) => {
      if (!item.digitalZoom.active || item.digitalZoom.scale <= 1) return;
      item.digitalZoom.isDragging = true;
      item.digitalZoom.startX = e.clientX - item.digitalZoom.x;
      item.digitalZoom.startY = e.clientY - item.digitalZoom.y;
    });

    window.addEventListener('mousemove', (e) => {
      if (!item.digitalZoom.active || !item.digitalZoom.isDragging) return;
      item.digitalZoom.x = e.clientX - item.digitalZoom.startX;
      item.digitalZoom.y = e.clientY - item.digitalZoom.startY;
      applyVideoTransform(slotIndex);
    });

    window.addEventListener('mouseup', () => {
      if (item.digitalZoom) item.digitalZoom.isDragging = false;
    });
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
    const ptzBtn = document.getElementById('dock-btn-ptz');
    const audioBtn = document.getElementById('dock-btn-audio');
    const audioIcon = document.getElementById('dock-audio-icon');
    const recBtn = document.getElementById('dock-btn-record');
    const recIcon = document.getElementById('dock-rec-icon');
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

      if (qualityBtn) { qualityBtn.disabled = true; qualityBtn.title = "No camera assigned to this slot"; }
      if (aspectBtn) { aspectBtn.disabled = true; aspectBtn.title = "No camera assigned to this slot"; }
      if (zoomBtn) { zoomBtn.disabled = true; zoomBtn.classList.remove('active'); zoomBtn.title = "No camera assigned to this slot"; }
      if (ptzBtn) { ptzBtn.disabled = true; ptzBtn.classList.remove('active'); ptzBtn.title = "No camera assigned to this slot"; }
      if (audioBtn) { audioBtn.disabled = true; audioBtn.classList.remove('active'); audioBtn.title = "No camera assigned to this slot"; }
      if (audioIcon) audioIcon.textContent = '🔇';
      if (recBtn) { recBtn.disabled = true; recBtn.classList.remove('recording'); recBtn.title = "No camera assigned to this slot"; }
      if (recIcon) recIcon.textContent = '⏺';
      if (recLabel) recLabel.textContent = 'Record';
      if (snapBtn) { snapBtn.disabled = true; snapBtn.title = "No camera assigned to this slot"; }
      if (btn1x1) { btn1x1.disabled = true; btn1x1.classList.toggle('active', state.focusedSlotIndex !== null); }
      if (closeBtn) { closeBtn.disabled = true; closeBtn.title = "No camera to close"; }

      togglePtzDrawer(false);
      return;
    }

    // Condition 2: CAMERA IS ASSIGNED -> Check capabilities
    const title = getCameraTitle(item.nvrId, item.channel);
    if (camTitle) {
      camTitle.textContent = `${item.nvrId === 'nvr1' ? 'NVR 1' : 'NVR 2'} · CH ${item.channel.toString().padStart(2, '0')} · ${title}`;
    }

    if (qualityBtn) { qualityBtn.disabled = false; qualityBtn.title = "Toggle Main HD / Sub-Stream"; }
    if (qualityLabel) qualityLabel.textContent = (item.subtype || 'sub').toUpperCase();

    if (aspectBtn) { aspectBtn.disabled = false; aspectBtn.title = "Cycle Aspect: Fit / Stretch / Crop"; }
    if (aspectLabel) aspectLabel.textContent = (item.aspect || state.globalAspect || 'contain').toUpperCase();

    if (btn1x1) { btn1x1.disabled = false; btn1x1.classList.toggle('active', state.focusedSlotIndex !== null); }
    if (closeBtn) { closeBtn.disabled = false; closeBtn.title = "Close Active Camera Feed"; }

    // Capability Check: PTZ Control
    const caps = state.capabilities[item.nvrId] && state.capabilities[item.nvrId][item.channel];
    const isPtzSupported = Boolean(caps && caps.ptz === true);

    if (ptzBtn) {
      if (!isPtzSupported) {
        ptzBtn.disabled = true;
        ptzBtn.classList.remove('active');
        ptzBtn.title = "PTZ motor control not supported on this camera model (Fixed Lens)";
        togglePtzDrawer(false);
      } else {
        ptzBtn.disabled = false;
        ptzBtn.title = "Open Dahua PTZ Camera Controls";
        const drawer = document.getElementById('gpu-ptz-drawer');
        ptzBtn.classList.toggle('active', drawer && !drawer.classList.contains('hidden'));
      }
    }

    // Capability Check: Audio Stream
    const isAudioSupported = caps ? caps.audio !== false : true;
    if (audioBtn) {
      if (!isAudioSupported) {
        audioBtn.disabled = true;
        audioBtn.classList.remove('active');
        audioBtn.title = "Microphone/audio not available on this camera";
        if (audioIcon) audioIcon.textContent = '🔇';
      } else {
        audioBtn.disabled = false;
        audioBtn.classList.toggle('active', !item.audioMuted);
        audioBtn.title = item.audioMuted ? "Unmute Live Audio" : "Mute Live Audio";
        if (audioIcon) audioIcon.textContent = item.audioMuted ? '🔇' : '🔊';
      }
    }

    // Live Feed Status Check: Digital Zoom, Snapshot, and Local Clip Recording
    const isFeedReady = !!item.videoPlaying;

    if (zoomBtn) {
      if (!isFeedReady) {
        zoomBtn.disabled = true;
        zoomBtn.title = "Waiting for live video feed to connect...";
      } else {
        zoomBtn.disabled = false;
        zoomBtn.classList.toggle('active', !!(item.digitalZoom && item.digitalZoom.active));
        zoomBtn.title = "Digital Zoom (Mouse wheel or drag to pan)";
      }
    }

    if (snapBtn) {
      if (!isFeedReady) {
        snapBtn.disabled = true;
        snapBtn.title = "Waiting for live video feed to connect...";
      } else {
        snapBtn.disabled = false;
        snapBtn.title = "Capture High-Res Snapshot";
      }
    }

    if (recBtn) {
      if (!isFeedReady) {
        recBtn.disabled = true;
        recBtn.title = "Waiting for live video feed to connect...";
      } else {
        recBtn.disabled = false;
        recBtn.classList.toggle('recording', !!(item.recording && item.recording.active));
        recBtn.title = item.recording && item.recording.active ? "Stop Recording Clip" : "Record Live Clip";
      }
      if (recIcon) recIcon.textContent = item.recording && item.recording.active ? '⏹' : '⏺';
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
  }

  function dockToggleQuality() {
    toggleSubtype(state.selectedSlotIndex);
  }

  function dockCycleAspect() {
    cycleSlotAspect(state.selectedSlotIndex);
  }

  function dockToggleDigitalZoom() {
    toggleDigitalZoom(state.selectedSlotIndex);
  }

  function dockTogglePtz(forceState) {
    togglePtzDrawer(forceState);
  }

  function dockToggleAudio() {
    toggleAudio(state.selectedSlotIndex);
  }

  function dockToggleRecord() {
    toggleRecord(state.selectedSlotIndex);
  }

  function dockTakeSnapshot() {
    takeSnapshot(state.selectedSlotIndex);
  }

  function dockToggleZoom1x1() {
    toggleSlotZoom(state.selectedSlotIndex);
  }

  function dockClearSlot() {
    clearSlot(state.selectedSlotIndex);
  }

  // -------------------------------------------------------------
  // Dahua PTZ Camera Controller (Side Flyout Drawer)
  // -------------------------------------------------------------

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
      if (ptzBtn) ptzBtn.classList.remove('active');
      return;
    }

    const isHidden = drawer.classList.contains('hidden');
    const shouldOpen = typeof forceState === 'boolean' ? forceState : isHidden;

    drawer.classList.toggle('hidden', !shouldOpen);
    if (ptzBtn) ptzBtn.classList.toggle('active', shouldOpen);

    const titleEl = document.getElementById('gpu-ptz-drawer-title');
    if (titleEl) {
      if (item) {
        titleEl.textContent = `🎮 PTZ CH ${item.channel.toString().padStart(2, '0')} (${item.nvrId.toUpperCase()})`;
      } else {
        titleEl.textContent = '🎮 PTZ CONTROLLER';
      }
    }
  }

  async function sendPtzCommand(slotIndex, code, action = 'start', arg1 = 0, arg2 = 5) {
    const item = state.slots[slotIndex];
    if (!item) return;

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
        }
      });
    }

    if (video) {
      video.muted = item.audioMuted;
    }

    updateBottomDock();
  }

  // -------------------------------------------------------------
  // In-Browser Video Clip Recording (MediaRecorder)
  // -------------------------------------------------------------

  function toggleRecord(slotIndex) {
    const item = state.slots[slotIndex];
    if (!item || !item.videoPlaying) return;

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
      const stream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
      if (!stream) {
        alert('Browser does not support direct stream recording.');
        return;
      }

      let mimeType = 'video/webm;codecs=vp8,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      item.recording.chunks = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          item.recording.chunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(item.recording.chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const title = getCameraTitle(item.nvrId, item.channel);
        const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
        a.download = `${title.replace(/\s+/g, '_')}_${dateStr}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      };

      recorder.start(1000);
      item.recording.active = true;
      item.recording.recorder = recorder;
      item.recording.seconds = 0;

      item.recording.timer = setInterval(() => {
        item.recording.seconds++;
        if (slotIndex === state.selectedSlotIndex) {
          updateBottomDock();
        }
      }, 1000);

      updateBottomDock();
    } catch (err) {
      console.warn('[GPU Wall] Clip recording error:', err);
    }
  }

  function stopRecording(slotIndex) {
    const item = state.slots[slotIndex];
    if (!item || !item.recording.active) return;

    if (item.recording.recorder && item.recording.recorder.state !== 'inactive') {
      item.recording.recorder.stop();
    }
    if (item.recording.timer) {
      clearInterval(item.recording.timer);
      item.recording.timer = null;
    }
    item.recording.active = false;
    updateBottomDock();
  }

  // -------------------------------------------------------------
  // Touring / Carousel Mode
  // -------------------------------------------------------------

  function toggleTour() {
    state.tour.active = !state.tour.active;
    const tourBtn = document.getElementById('gpu-tour-btn');
    if (tourBtn) tourBtn.classList.toggle('active', state.tour.active);

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

  function saveCurrentViewPreset() {
    const name = prompt('Enter a name for this custom view layout:');
    if (!name || !name.trim()) return;

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
      globalAspect: state.globalAspect,
      slots: serializableSlots
    };

    state.currentPresetId = id;
    try {
      localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(state.viewPresets));
    } catch (e) {}

    updatePresetDropdown();
  }

  function loadViewPreset(id) {
    const preset = state.viewPresets[id];
    if (!preset) return;

    state.currentPresetId = id;
    clearAll();

    state.split = preset.split || 4;
    state.columnMode = preset.columnMode || 'auto';
    state.globalAspect = preset.globalAspect || 'contain';
    updateGlobalAspectUI();
    updateColumnModeUI();

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
    const isAudioSupported = item && (!caps || caps.audio !== false);
    const isFeedReady = item && !!item.videoPlaying;

    menu.querySelectorAll('.gpu-menu-item').forEach(el => el.classList.remove('disabled'));

    if (!item) {
      menu.querySelectorAll('.gpu-menu-item:not(.danger)').forEach(el => el.classList.add('disabled'));
    } else {
      if (!isPtzSupported) {
        const ptzItem = menu.querySelector('[data-menu="ptz"]');
        if (ptzItem) ptzItem.classList.add('disabled');
      }
      if (!isAudioSupported) {
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
    }

    menu.style.left = `${Math.min(window.innerWidth - 190, e.clientX)}px`;
    menu.style.top = `${Math.min(window.innerHeight - 320, e.clientY)}px`;
    menu.classList.remove('hidden');
  }

  // -------------------------------------------------------------
  // Slot Rendering (100% Full-Bleed Video - ZERO UI OBSTRUCTION!)
  // -------------------------------------------------------------

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
    `;

    const wrapper = slotEl.querySelector('.gpu-video-wrapper');
    setupDigitalZoomListeners(slotIndex, wrapper);

    // Desktop: Double-click to toggle full 1x1 screen
    wrapper.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      toggleSlotZoom(slotIndex);
    });

    // Right-Click Context Menu (like Dahua SmartPSS desktop app)
    slotEl.addEventListener('contextmenu', (e) => {
      openContextMenu(e, slotIndex);
    });

    // Touch Devices: Double-tap to toggle 1x1 zoom
    slotEl.addEventListener('touchstart', (e) => {
      const now = Date.now();
      const timeSinceLast = now - (item.lastTapTime || 0);

      if (timeSinceLast > 0 && timeSinceLast < 300) {
        e.preventDefault();
        toggleSlotZoom(slotIndex);
        return;
      }
      item.lastTapTime = now;
      selectSlot(slotIndex);
    }, { passive: true });

    // Mount VideoRTC hardware-accelerated video element
    const streamKey = `${item.nvrId}_ch${item.channel}${item.subtype === 'hd' ? '_hd' : ''}`;
    const host = window.location.host;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${host}/api/go2rtc/ws?src=${streamKey}`;

    const player = document.createElement('video-rtc');
    player.className = 'gpu-player-el';

    wrapper.appendChild(player);
    player.src = wsUrl;

    if (player.video) {
      player.video.controls = false;
      player.video.muted = item.audioMuted;
      player.video.autoplay = true;
      player.video.playsInline = true;

      const spinnerEl = slotEl.querySelector(`#spinner-slot-${slotIndex}`);
      const onStreamReady = () => {
        if (spinnerEl) spinnerEl.style.display = 'none';
        item.videoPlaying = true;
        if (slotIndex === state.selectedSlotIndex) {
          updateBottomDock();
        }
      };

      player.video.addEventListener('playing', onStreamReady, { once: true });
      player.video.addEventListener('loadeddata', onStreamReady, { once: true });
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
    const colClass = state.focusedSlotIndex !== null
      ? 'cols-auto'
      : (state.columnMode === 2 ? 'cols-2' : state.columnMode === 3 ? 'cols-3' : 'cols-auto');
    gridContainer.className = `gpu-grid-container split-${effectiveSplit} ${colClass}`;

    const totalSlots = effectiveSplit;

    for (let i = 0; i < totalSlots; i++) {
      const slotIndex = state.focusedSlotIndex !== null ? state.focusedSlotIndex : i;
      const slotEl = document.createElement('div');
      slotEl.id = `gpu-slot-${slotIndex}`;
      slotEl.dataset.slotIndex = slotIndex;

      // Click to select this slot as active assignment target
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

    updateGlobalAspectUI();
    updateColumnModeUI();
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
    sidebar.classList.toggle('collapsed', !state.drawerOpen);

    const toggleIcon = document.getElementById('gpu-drawer-toggle-icon');
    if (toggleIcon) {
      toggleIcon.textContent = state.drawerOpen ? '◀' : '▶';
    }
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
      try { el.src = ''; el.remove(); } catch (e) {}
    });
  }

  /**
   * Public API exposed to window.VOSCCTV_GPU_WALL
   */
  window.VOSCCTV_GPU_WALL = {
    init: async function () {
      await Promise.all([loadCameraNames(), loadCameraCapabilities()]);
      renderTree();
      restoreSavedLayout();
      updateColumnModeUI();
      setupContextMenu();
      setupPtzButtons();
      renderGrid();
      updateBottomDock();
    },
    setSplit,
    setColumnMode,
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
    toggleDrawer,
    filterTree,
    ptzGotoPreset,
    // Bottom Dock Bridge Methods
    dockToggleQuality,
    dockCycleAspect,
    dockToggleDigitalZoom,
    dockTogglePtz,
    dockToggleAudio,
    dockToggleRecord,
    dockTakeSnapshot,
    dockToggleZoom1x1,
    dockClearSlot,
    stop: stopAll
  };
})();
