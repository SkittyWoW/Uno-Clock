(function() {
  const qs = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));

  const main = qs('main.grid');
  const applyAllBtn = qs('#applyAll');
  const resetAllBtn = qs('#resetAll');
  const globalTimeInput = qs('#globalTime');
  const startPauseBtn = qs('#startPause');
  const themeSelect = qs('#themeSelect');
  const playerCountInput = qs('#playerCount');
  const applyPlayerCountBtn = qs('#applyPlayerCount');
  const incModeSelect = qs('#incMode');
  const incValueInput = qs('#incValue');
  const exportBtn = qs('#exportBtn');
  const importBtn = qs('#importBtn');
  const importFileInput = qs('#importFile');
  const leaderboardBtn = qs('#leaderboardBtn');
  const leaderboardModal = qs('#leaderboardModal');
  const leaderboardBody = qs('#leaderboardBody');
  const closeLeaderboardBtn = qs('#closeLeaderboard');
  const lockNamesCheckbox = qs('#lockNames');
  const lbScopeSelect = qs('#lbScope');
  const lbExportCsvBtn = qs('#lbExportCsv');
  const lbResetSessionBtn = qs('#lbResetSession');
  const lbArchiveResetBtn = qs('#lbArchiveReset');
  const reverseOrderBtn = qs('#reverseOrder');
  const koBonusInput = qs('#koBonus');
  const reinstateBonusInput = qs('#reinstateBonus');

  const DEFAULT_TIME_STR = globalTimeInput.value || '05:00';

  let players = [];
  let activeIndex = 0; // index into players
  let ticking = false;
  let lastTick = performance.now();
  let tickHandle = null;
  let currentDelayMs = 0; // remaining delay for current active player if mode = delay

  // Increment/Delay config
  let incMode = 'none'; // 'none' | 'increment' | 'delay'
  let incMs = 2000; // default 2 seconds

  // Knocked/Reinstate bonus config
  let koBonusMs = 60_000; // default 1:00 to everyone when knocked out
  let reinstateBonusMs = 0; // default 0:00 to reinstated player

  // Name lock state
  let lockNames = false;

  // Turn direction: 1 = forward (CW), -1 = reverse (CCW)
  let turnDir = 1;

  function applyBodyDirClass() {
    const b = document.body;
    b.classList.remove('dir-cw','dir-ccw');
    b.classList.add(turnDir === -1 ? 'dir-ccw' : 'dir-cw');
  }

  // KO/Reinstate bonus listeners and persistence
  (function initKoReinstate() {
    // Load saved values or defaults from inputs
    try {
      const savedKo = localStorage.getItem('uno_clock_ko_bonus');
      const savedRe = localStorage.getItem('uno_clock_reinstate_bonus');
      if (savedKo) koBonusMs = parseTimeString(savedKo) || koBonusMs;
      if (savedRe) reinstateBonusMs = parseTimeString(savedRe) || reinstateBonusMs;
    } catch {}
    if (koBonusInput) koBonusInput.value = msToStr(koBonusMs);
    if (reinstateBonusInput) reinstateBonusInput.value = msToStr(reinstateBonusMs);
    function saveKo() {
      koBonusMs = parseTimeString(koBonusInput.value) || koBonusMs;
      try { localStorage.setItem('uno_clock_ko_bonus', msToStr(koBonusMs)); } catch {}
    }
    function saveRe() {
      reinstateBonusMs = parseTimeString(reinstateBonusInput.value) || reinstateBonusMs;
      try { localStorage.setItem('uno_clock_reinstate_bonus', msToStr(reinstateBonusMs)); } catch {}
    }
    if (koBonusInput) koBonusInput.addEventListener('change', saveKo);
    if (reinstateBonusInput) reinstateBonusInput.addEventListener('change', saveRe);
  })();

  // Points storage (tracked by player name)
  let pointsMap = {};
  // Session-only points (resettable, not persisted across reload by design)
  let sessionPointsMap = {};
  function loadPointsMap() {
    try {
      const raw = localStorage.getItem('uno_clock_points');
      pointsMap = raw ? JSON.parse(raw) : {};
    } catch { pointsMap = {}; }
  }

  // Reverse order button
  function updateReverseButtonLabel() {
    if (!reverseOrderBtn) return;
    const label = turnDir === 1 ? 'Reverse Order (CW)' : 'Reverse Order (CCW)';
    reverseOrderBtn.textContent = label;
  }
  function toggleTurnDirection() {
    turnDir = turnDir === 1 ? -1 : 1;
    updateReverseButtonLabel();
    applyBodyDirClass();
    updateNextIndicator();
  }
  if (reverseOrderBtn) {
    updateReverseButtonLabel();
    reverseOrderBtn.addEventListener('click', toggleTurnDirection);
  }

  // Direction UI

  // Leaderboard listeners
  if (leaderboardBtn) leaderboardBtn.addEventListener('click', openLeaderboard);
  if (closeLeaderboardBtn) closeLeaderboardBtn.addEventListener('click', closeLeaderboard);
  if (leaderboardModal) leaderboardModal.addEventListener('click', (e) => {
    if (e.target && e.target.getAttribute('data-close') === 'modal') closeLeaderboard();
  });
  if (lbScopeSelect) lbScopeSelect.addEventListener('change', buildLeaderboardRows);

  // CSV export for current leaderboard view
  function exportLeaderboardCsv() {
    const scope = lbScopeSelect?.value === 'session' ? 'session' : 'all';
    const entries = getLeaderboardEntries(scope);
    const lines = [ 'Rank,Name,Points' ];
    entries.forEach((e, idx) => {
      // Escape commas/quotes in name
      const name = '"' + (e.name || '').replace(/"/g, '""') + '"';
      lines.push(`${idx+1},${name},${e.pts}`);
    });
    const blob = new Blob([lines.join('\n')], {type: 'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leaderboard_${scope}_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  }
  if (lbExportCsvBtn) lbExportCsvBtn.addEventListener('click', exportLeaderboardCsv);

  // Reset session-only points
  function resetSessionPoints() {
    sessionPointsMap = {};
    buildLeaderboardRows();
  }
  if (lbResetSessionBtn) lbResetSessionBtn.addEventListener('click', resetSessionPoints);

  // Archive current all-time map and reset
  function archiveAndResetAllTime() {
    try {
      const archivesRaw = localStorage.getItem('uno_clock_points_archives');
      const archives = archivesRaw ? JSON.parse(archivesRaw) : [];
      archives.push({ timestamp: Date.now(), points: pointsMap });
      localStorage.setItem('uno_clock_points_archives', JSON.stringify(archives));
    } catch {}
    // reset all-time points
    pointsMap = {};
    savePointsMap();
    // refresh chips and leaderboard
    players.forEach((p, idx) => { if (p.pointsEl) p.pointsEl.textContent = getPoints(p.name); updateStatus(idx); });
    buildLeaderboardRows();
  }
  if (lbArchiveResetBtn) lbArchiveResetBtn.addEventListener('click', archiveAndResetAllTime);

  // Name lock toggle
  function applyNameLockState() {
    players.forEach(p => {
      if (p.nameInput) p.nameInput.disabled = lockNames;
    });
  }
  function setLockNames(val) {
    lockNames = !!val;
    try { localStorage.setItem('uno_clock_lock_names', lockNames ? '1' : '0'); } catch {}
    applyNameLockState();
  }
  if (lockNamesCheckbox) {
    // load initial
    try { lockNames = localStorage.getItem('uno_clock_lock_names') === '1'; } catch { lockNames = false; }
    lockNamesCheckbox.checked = lockNames;
    lockNamesCheckbox.addEventListener('change', () => setLockNames(lockNamesCheckbox.checked));
  }
  function savePointsMap() {
    try { localStorage.setItem('uno_clock_points', JSON.stringify(pointsMap)); } catch {}
  }
  function getPoints(name) {
    return Math.max(0, parseInt(pointsMap[name] ?? 0, 10) || 0);
  }
  function setPoints(name, pts) {
    pointsMap[name] = Math.max(0, parseInt(pts, 10) || 0);
    savePointsMap();
  }
  function getSessionPoints(name) {
    return Math.max(0, parseInt(sessionPointsMap[name] ?? 0, 10) || 0);
  }
  function setSessionPoints(name, pts) {
    sessionPointsMap[name] = Math.max(0, parseInt(pts, 10) || 0);
  }

  function parseTimeString(str) {
    // accepts mm:ss or m:ss or ss
    const t = (str || '').trim();
    if (!t) return 0;
    if (/^\d+$/.test(t)) return Math.max(0, parseInt(t,10)) * 1000;
    const m = t.match(/^(\d{1,3}):(\d{2})$/);
    if (!m) return 0;
    const mm = parseInt(m[1],10);
    const ss = parseInt(m[2],10);
    return Math.max(0, (mm*60 + ss) * 1000);
  }

  function addWin(i) {
    const p = players[i];
    const all = getPoints(p.name) + 15;
    setPoints(p.name, all);
    const ses = getSessionPoints(p.name) + 15;
    setSessionPoints(p.name, ses);
    if (p.pointsEl) p.pointsEl.textContent = all;
  }

  function addLoss(i) {
    const p = players[i];
    const all = Math.max(0, getPoints(p.name) - 5);
    setPoints(p.name, all);
    const ses = Math.max(0, getSessionPoints(p.name) - 5);
    setSessionPoints(p.name, ses);
    if (p.pointsEl) p.pointsEl.textContent = all;
  }

  function msToStr(ms) {
    ms = Math.max(0, Math.round(ms));
    const totalSec = Math.floor(ms/1000);
    const mm = Math.floor(totalSec/60);
    const ss = totalSec % 60;
    return `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  }

  function createPlayer(i, initialMs) {
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.dataset.index = i;
    panel.innerHTML = `
      <div class="name-row">
        <input class="player-name" type="text" value="Player ${i+1}" />
        <span class="badge">P${i+1}</span>
        <span class="chip"><span class="chip-label">Pts</span><span data-role="points">0</span></span>
      </div>
      <div class="timer" data-role="timer">${msToStr(initialMs)}</div>
      <div class="meta" data-role="status">Ready</div>
      <div class="actions">
        <button class="btn btn-secondary" data-action="minus1">-1:00</button>
        <button class="btn btn-warning" data-action="pass">Pass</button>
        <button class="btn btn-secondary" data-action="plus1">+1:00</button>
        <div class="row" style="grid-column: span 3;">
          <input type="text" class="per-time" placeholder="mm:ss" />
          <button class="btn" data-action="applyTime">Set</button>
          <button class="btn btn-danger" data-action="knock">Knocked Out</button>
          <button class="btn btn-success" data-action="revive" style="display:none;">Revive (+1:00)</button>
        </div>
        <div class="row" style="grid-column: span 3;">
          <button class="btn btn-success" data-action="win">Win +15</button>
          <button class="btn btn-secondary" data-action="loss">Loss -5</button>
        </div>
      </div>
    `;

    // events
    panel.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      const idx = parseInt(panel.dataset.index,10);
      if (action === 'plus1') {
        adjustTime(idx, 60_000);
      } else if (action === 'minus1') {
        adjustTime(idx, -60_000);
      } else if (action === 'applyTime') {
        const input = panel.querySelector('input.per-time');
        const ms = parseTimeString(input.value);
        if (ms > 0) setTime(idx, ms);
      } else if (action === 'knock') {
        toggleKnock(idx);
      } else if (action === 'revive') {
        reviveFromOut(idx);
      } else if (action === 'pass') {
        nextActive();
      } else if (action === 'win') {
        addWin(idx);
      } else if (action === 'loss') {
        addLoss(idx);
      }
    });

    panel.addEventListener('dblclick', () => {
      makeActive(i);
    });

    const obj = {
      index: i,
      name: `Player ${i+1}`,
      msLeft: initialMs,
      knocked: false,
      out: false,
      el: panel,
      get nameInput() { return panel.querySelector('input.player-name'); },
      get timerEl() { return panel.querySelector('[data-role="timer"]'); },
      get statusEl() { return panel.querySelector('[data-role="status"]'); },
      get knockBtn() { return panel.querySelector('[data-action="knock"]'); },
      get reviveBtn() { return panel.querySelector('[data-action="revive"]'); },
      get pointsEl() { return panel.querySelector('[data-role="points"]'); },
    };

    obj.nameInput.addEventListener('input', () => {
      const oldName = obj.name;
      obj.name = obj.nameInput.value.trim() || `Player ${i+1}`;
      // load points for new name
      obj.pointsEl.textContent = getPoints(obj.name);
      updateStatus(i);
    });

    // initialize points display
    obj.pointsEl.textContent = getPoints(obj.name);

    // apply name lock if enabled
    if (lockNamesCheckbox) {
      obj.nameInput.disabled = lockNames;
    }

    return obj;
  }

  function updateStatus(i) {
    const p = players[i];
    const isActive = i === activeIndex;
    // update out state
    p.out = !p.knocked && p.msLeft <= 0;
    // keep points chip in sync
    if (p.pointsEl) p.pointsEl.textContent = getPoints(p.name);

    // build timer display with optional label
    const timeStr = msToStr(p.msLeft);
    let label = '';
    if (p.knocked) label = '<span class="label">Knocked Out</span>';
    else if (p.out) label = '<span class="label">Out of Time</span>';
    p.timerEl.innerHTML = `${timeStr}${label}`;

    p.el.classList.toggle('active', isActive && !p.knocked && !p.out);
    p.el.classList.toggle('knocked', !!p.knocked);
    p.el.classList.toggle('state-out', !!p.out);

    if (p.knocked) {
      p.statusEl.textContent = `${p.name} is knocked out`;
      p.knockBtn.textContent = 'Reinstate';
      p.knockBtn.classList.remove('btn-danger');
      p.knockBtn.classList.add('btn-success');
      // Revive button hidden when knocked (revive is for out-of-time)
      p.reviveBtn.style.display = 'none';
    } else {
      p.knockBtn.textContent = 'Knocked Out';
      p.knockBtn.classList.add('btn-danger');
      p.knockBtn.classList.remove('btn-success');
      if (p.out) {
        p.statusEl.textContent = `${p.name} needs revive`;
      } else if (isActive) {
        if (incMode === 'delay' && currentDelayMs > 0) {
          const ds = Math.ceil(currentDelayMs/100)/10; // one decimal sec
          p.statusEl.textContent = `${p.name}'s turn (delay ${ds.toFixed(1)}s)`;
        } else {
          p.statusEl.textContent = `${p.name}'s turn`;
        }
      } else {
        p.statusEl.textContent = `${p.name} waiting`;
      }
      // Show revive if out-of-time
      p.reviveBtn.style.display = p.out ? '' : 'none';
    }
  }

  function setTime(i, ms) {
    players[i].msLeft = Math.max(0, ms);
    updateStatus(i);
  }

  function adjustTime(i, deltaMs) {
    players[i].msLeft = Math.max(0, players[i].msLeft + deltaMs);
    updateStatus(i);
  }

  function addTimeToEveryone(ms) {
    players.forEach((p) => {
      p.msLeft = Math.max(0, p.msLeft + ms);
      updateStatus(p.index);
    });
  }

  function toggleKnock(i) {
    const wasKnocked = players[i].knocked;
    players[i].knocked = !players[i].knocked;
    updateStatus(i);

    if (!wasKnocked) {
      // newly knocked out -> add configured bonus to everyone
      if (koBonusMs > 0) addTimeToEveryone(koBonusMs);

      // If we knocked out the active player, go to next
      if (i === activeIndex) {
        nextActive();
      }
    } else {
      // reinstated from knocked: add configured bonus to reinstated player
      if (reinstateBonusMs > 0) {
        players[i].msLeft = Math.max(0, players[i].msLeft + reinstateBonusMs);
        updateStatus(i);
      }
    }
    updateNextIndicator();
  }

  function reviveFromOut(i) {
    const p = players[i];
    if (!p.knocked && p.msLeft <= 0) {
      // Revive from out-of-time grants +1:00 to that player only
      p.msLeft += 60_000;
      updateStatus(i);
    }
    updateNextIndicator();
  }

  function findNextActive(from) {
    const order = getSeatingOrder();
    if (players.every(p => p.knocked || p.msLeft <= 0)) return -1;
    const idxInOrder = order.indexOf(from);
    const n = order.length;
    for (let step = 1; step <= n; step++) {
      const k = order[(idxInOrder + step) % n];
      if (!players[k].knocked && players[k].msLeft > 0) return k;
    }
    return -1;
  }

  function makeActive(i) {
    if (players[i].knocked) return;
    activeIndex = i;
    // setup delay for new active
    currentDelayMs = (incMode === 'delay') ? incMs : 0;
    players.forEach((_, j) => updateStatus(j));
    // bump animation
    const el = players[i]?.el;
    if (el) {
      el.classList.remove('bump');
      // trigger reflow to restart animation
      void el.offsetWidth;
      el.classList.add('bump');
    }
    updateNextIndicator();
  }

  function nextActive() {
    // Apply increment to the player who just moved (if configured)
    if (incMode === 'increment') {
      const prev = players[activeIndex];
      if (prev && !prev.knocked && prev.msLeft > 0) {
        prev.msLeft += incMs;
        updateStatus(activeIndex);
      }
    }
    const next = findNextActive(activeIndex);
    if (next === -1) { pause(); return; }
    makeActive(next);
  }

  function passTurnTo(targetIndex) {
    // Apply increment to current active if needed
    if (incMode === 'increment') {
      const prev = players[activeIndex];
      if (prev && !prev.knocked && prev.msLeft > 0) {
        prev.msLeft += incMs;
        updateStatus(activeIndex);
      }
    }
    if (typeof targetIndex === 'number') {
      makeActive(targetIndex);
    } else {
      const n = findNextActive(activeIndex);
      if (n === -1) { pause(); return; }
      makeActive(n);
    }
  }

  function onOutOfTime(i) {
    // Clamp to zero
    players[i].msLeft = 0;
    updateStatus(i);

    // Add +1:00 to everyone (as requested)
    addTimeToEveryone(60_000);

    // Move on to next active player
    nextActive();
  }

  function tick(now) {
    if (!ticking) return;
    const dt = now - lastTick;
    lastTick = now;

    const p = players[activeIndex];
    if (!p || p.knocked) {
      // safety: move to next active
      const next = findNextActive(activeIndex);
      if (next === -1) { pause(); return; }
      activeIndex = next;
    } else {
      if (incMode === 'delay' && currentDelayMs > 0) {
        currentDelayMs -= dt;
      } else {
        p.msLeft -= dt;
      }
      if (p.msLeft <= 0) {
        onOutOfTime(activeIndex);
      }
      updateStatus(activeIndex);
    }

    tickHandle = requestAnimationFrame(tick);
  }

  function start() {
    if (ticking) return;
    ticking = true;
    lastTick = performance.now();
    tickHandle = requestAnimationFrame(tick);
    if (startPauseBtn) startPauseBtn.textContent = 'Pause (P)';
  }

  function pause() {
    if (!ticking) return;
    ticking = false;
    if (tickHandle) cancelAnimationFrame(tickHandle);
    tickHandle = null;
    if (startPauseBtn) startPauseBtn.textContent = 'Start (P)';
  }

  function toggleStartPause() {
    if (ticking) pause(); else start();
  }

  function resetAll() {
    pause();
    const ms = parseTimeString(globalTimeInput.value || DEFAULT_TIME_STR) || parseTimeString(DEFAULT_TIME_STR);
    players.forEach((p, i) => {
      p.msLeft = ms;
      p.knocked = false;
      p.out = false;
      updateStatus(i);
    });
    makeActive(0);
    updateNextIndicator();
  }

  function applyAll() {
    const ms = parseTimeString(globalTimeInput.value);
    if (ms <= 0) return;
    players.forEach((_, i) => setTime(i, ms));
    updateNextIndicator();
  }

  function clearMain() {
    while (main.firstChild) main.removeChild(main.firstChild);
  }

  function build(count = 4) {
    clearMain();
    players = [];
    const initMs = parseTimeString(globalTimeInput.value || DEFAULT_TIME_STR) || parseTimeString(DEFAULT_TIME_STR);
    for (let i = 0; i < count; i++) {
      const p = createPlayer(i, initMs);
      players.push(p);
      main.appendChild(p.el);
      updateStatus(i);
    }
    activeIndex = 0;
    makeActive(0);
  }

  // Next-player indicator
  function updateNextIndicator() {
    players.forEach(p => {
      p.el.classList.remove('next');
      // remove existing next label if present
      const lbl = p.timerEl?.querySelector('.label.label-next');
      if (lbl && lbl.parentNode) lbl.parentNode.removeChild(lbl);
    });
    const nextIdx = findNextActive(activeIndex);
    if (nextIdx !== -1) {
      const np = players[nextIdx];
      if (np && !np.knocked && np.msLeft > 0 && nextIdx !== activeIndex) {
        np.el.classList.add('next');
        // append red Next label under timer unless it already has KO/Out labels
        const hasStatusLabel = np.timerEl?.querySelector('.label:not(.label-next)');
        if (!hasStatusLabel && np.timerEl) {
          const span = document.createElement('span');
          span.className = 'label label-next';
          span.textContent = 'Next';
          np.timerEl.appendChild(span);
        }
      }
    }
  }

  function applyPlayerCount() {
    const val = parseInt(playerCountInput.value, 10);
    const count = Math.min(8, Math.max(2, isNaN(val) ? 4 : val));
    pause();
    build(count);
  }

  function setTheme(theme) {
    const body = document.body;
    const themes = ['theme-default','theme-sunset','theme-forest','theme-contrast'];
    themes.forEach(t => body.classList.remove(t));
    const cls = `theme-${theme}`;
    body.classList.add(themes.includes(cls) ? cls : 'theme-default');
    try { localStorage.setItem('uno_clock_theme', theme); } catch {}
  }

  // Keyboard: space to pass turn and ensure clock is running
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return; // don't hijack while typing
      e.preventDefault();
      // If not started yet, start ticking; otherwise pass to next player
      if (!ticking) start();
      else passTurnTo();
    } else if (e.code === 'KeyP') {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return;
      e.preventDefault();
      toggleStartPause();
    } else if (e.code === 'KeyR') {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return;
      e.preventDefault();
      toggleTurnDirection();
    }
  });

  // Global controls
  applyAllBtn.addEventListener('click', applyAll);
  resetAllBtn.addEventListener('click', resetAll);
  if (startPauseBtn) startPauseBtn.addEventListener('click', toggleStartPause);
  if (applyPlayerCountBtn) applyPlayerCountBtn.addEventListener('click', applyPlayerCount);
  if (themeSelect) {
    themeSelect.addEventListener('change', () => setTheme(themeSelect.value));
  }
  if (incModeSelect && incValueInput) {
    const loadInc = () => {
      try {
        const savedMode = localStorage.getItem('uno_clock_inc_mode');
        const savedVal = localStorage.getItem('uno_clock_inc_value');
        if (savedMode) incMode = savedMode;
        if (savedVal) incMs = parseTimeString(savedVal) || 2000;
      } catch {}
      // initialize inputs
      incModeSelect.value = incMode;
      incValueInput.value = msToStr(incMs);
    };
    const saveInc = () => {
      incMode = incModeSelect.value;
      incMs = parseTimeString(incValueInput.value) || incMs;
      try {
        localStorage.setItem('uno_clock_inc_mode', incMode);
        localStorage.setItem('uno_clock_inc_value', msToStr(incMs));
      } catch {}
      // reset delay for current active if necessary
      if (incMode === 'delay') currentDelayMs = incMs;
    };
    loadInc();
    incModeSelect.addEventListener('change', saveInc);
    incValueInput.addEventListener('change', saveInc);
  }

  // Export / Import
  function exportState() {
    const state = {
      version: 1,
      settings: {
        initialTime: globalTimeInput.value,
        playerCount: players.length,
        theme: (function(){ const b = document.body.className.match(/theme-[^\s]+/); return b ? b[0].replace('theme-','') : 'default'; })(),
        incMode,
        incMs,
        lockNames,
        koBonusMs,
        reinstateBonusMs,
      },
      activeIndex,
      players: players.map(p => ({ name: p.name, msLeft: Math.max(0, Math.round(p.msLeft)), knocked: !!p.knocked })),
      pointsMap,
    };
    const blob = new Blob([JSON.stringify(state, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `uno_clock_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  function importState(obj) {
    if (!obj || !obj.players || !obj.settings) return;
    pause();
    try {
      const count = Math.min(8, Math.max(2, parseInt(obj.settings.playerCount || obj.players.length, 10) || 4));
      if (typeof obj.settings.initialTime === 'string') {
        globalTimeInput.value = obj.settings.initialTime;
      }
      if (obj.settings.theme) {
        setTheme(obj.settings.theme);
        if (themeSelect) themeSelect.value = obj.settings.theme;
      }
      if (obj.settings.incMode) {
        incMode = obj.settings.incMode;
        if (incModeSelect) incModeSelect.value = incMode;
      }
      if (typeof obj.settings.incMs === 'number') {
        incMs = obj.settings.incMs;
        if (incValueInput) incValueInput.value = msToStr(incMs);
      }
      if (typeof obj.settings.koBonusMs === 'number') {
        koBonusMs = obj.settings.koBonusMs;
        if (koBonusInput) koBonusInput.value = msToStr(koBonusMs);
      }
      if (typeof obj.settings.reinstateBonusMs === 'number') {
        reinstateBonusMs = obj.settings.reinstateBonusMs;
        if (reinstateBonusInput) reinstateBonusInput.value = msToStr(reinstateBonusMs);
      }
      if (typeof obj.settings.lockNames === 'boolean') {
        lockNames = obj.settings.lockNames;
        if (lockNamesCheckbox) {
          lockNamesCheckbox.checked = lockNames;
        }
      }
      build(count);
      const minLen = Math.min(players.length, obj.players.length);
      for (let i = 0; i < minLen; i++) {
        players[i].name = obj.players[i].name || `Player ${i+1}`;
        players[i].nameInput.value = players[i].name;
        players[i].msLeft = Math.max(0, parseInt(obj.players[i].msLeft, 10) || 0);
        players[i].knocked = !!obj.players[i].knocked;
        updateStatus(i);
      }
      if (obj.pointsMap && typeof obj.pointsMap === 'object') {
        pointsMap = {};
        for (const [k,v] of Object.entries(obj.pointsMap)) {
          pointsMap[k] = Math.max(0, parseInt(v,10) || 0);
        }
        savePointsMap();
        players.forEach((p, idx) => { if (p.pointsEl) p.pointsEl.textContent = getPoints(p.name); updateStatus(idx); });
      }
      activeIndex = Math.min(players.length-1, Math.max(0, parseInt(obj.activeIndex, 10) || 0));
      makeActive(activeIndex);
    } catch (e) {
      console.error('Failed to import', e);
    }
  }

  // Leaderboard
  // previous ranks per scope to compute delta (rank change)
  const prevRanks = { all: {}, session: {} };

  function getLeaderboardEntries(scope) {
    const base = scope === 'session' ? sessionPointsMap : pointsMap;
    const entries = Object.entries(base)
      .map(([name, pts]) => ({ name, pts: Math.max(0, parseInt(pts,10) || 0) }))
      .filter(e => e.name && e.name.trim().length > 0);
    // include current players for visibility even if 0
    players.forEach(p => {
      if (!entries.find(e => e.name === p.name)) {
        const pts = scope === 'session' ? getSessionPoints(p.name) : getPoints(p.name);
        entries.push({ name: p.name, pts });
      }
    });
    entries.sort((a,b) => b.pts - a.pts || a.name.localeCompare(b.name));
    return entries;
  }

  function buildLeaderboardRows() {
    if (!leaderboardBody) return;
    const scope = lbScopeSelect?.value === 'session' ? 'session' : 'all';
    const entries = getLeaderboardEntries(scope);
    // compute deltas compared to previous view for this scope
    const prev = prevRanks[scope] || {};
    const currRanks = {};
    const rows = entries.map((e, idx) => {
      const rank = idx + 1;
      currRanks[e.name] = rank;
      const prevRank = prev[e.name];
      let deltaCell = '';
      if (prevRank == null) {
        deltaCell = '—';
      } else {
        const diff = prevRank - rank; // positive means improved rank
        if (diff > 0) deltaCell = `▲ ${diff}`;
        else if (diff < 0) deltaCell = `▼ ${-diff}`;
        else deltaCell = '•';
      }
      return `
        <tr>
          <td>${rank}</td>
          <td>${e.name}</td>
          <td>${e.pts}</td>
          <td>${deltaCell}</td>
        </tr>
      `;
    }).join('');
    leaderboardBody.innerHTML = rows;
    // store current ranks as previous for next view
    prevRanks[scope] = currRanks;
  }

  function openLeaderboard() {
    buildLeaderboardRows();
    if (leaderboardModal) {
      leaderboardModal.classList.add('show');
      leaderboardModal.style.display = 'block';
      leaderboardModal.setAttribute('aria-hidden', 'false');
    }
  }
  function closeLeaderboard() {
    if (leaderboardModal) {
      leaderboardModal.classList.remove('show');
      leaderboardModal.style.display = 'none';
      leaderboardModal.setAttribute('aria-hidden', 'true');
    }
  }

  if (exportBtn) exportBtn.addEventListener('click', exportState);
  if (importBtn && importFileInput) {
    importBtn.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { const obj = JSON.parse(reader.result); importState(obj); } catch {}
      };
      reader.readAsText(f);
      // reset input
      importFileInput.value = '';
    });
  }

  // Clicking on a panel will also start if paused
  main.addEventListener('click', (e) => {
    const panel = e.target.closest('.panel');
    if (!panel) return;
    const idx = parseInt(panel.dataset.index,10);
    passTurnTo(idx);
    if (!ticking) start();
  });

  // Initialize theme
  (function initTheme() {
    const saved = (() => { try { return localStorage.getItem('uno_clock_theme'); } catch { return null; } })();
    const theme = saved || 'default';
    setTheme(theme);
    if (themeSelect) themeSelect.value = theme;
  })();

  // Load points map
  loadPointsMap();

  // Build UI with initial player count
  const initialCount = parseInt(playerCountInput?.value || '4', 10) || 4;
  build(initialCount);

  // After build, apply lock state
  applyNameLockState();

  // Initialize body dir class for chevrons
  applyBodyDirClass();

  // Serpentine seating order helper
  function getSeatingOrder() {
    const n = players.length;
    const left = [];
    const right = [];
    for (let i = 0; i < n; i++) {
      if (i % 2 === 0) left.push(i); else right.push(i);
    }
    const forward = left.concat(right.reverse()); // down left, up right
    return (turnDir === 1) ? forward : forward.slice().reverse();
  }
})();
