/**
 * Empire dashboard screen
 * Renders resources, buildings, workers. Polls server every 15s for updates.
 */
import { api } from './api.js';
import { initMapView } from './map.js';

const POLL_INTERVAL = 15000; // ms between state refreshes
let _pollTimer = null;
let _currentCampaignId = null;
let _state = null;
let _ruleset = null;
let _mapRefresh = null;   // set after map tab is first loaded
let _mapLoaded  = false;

// ── Notification toasts ───────────────────────────────────────────────────────
function notify(msg, type = '') {
  const wrap = document.getElementById('empire-notifications');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = `notif ${type}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fmt(n) {
  n = parseFloat(n) || 0;
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  if (n >= 100)  return Math.floor(n).toString();
  return n.toFixed(1);
}

function fmtRate(r) {
  if (!r || Math.abs(r) < 0.001) return '';
  const per_min = r * (60 / 10); // ticks are 10s
  const sign = per_min > 0 ? '+' : '';
  return `${sign}${per_min.toFixed(1)}/min`;
}

// ── AP bar ────────────────────────────────────────────────────────────────────
function renderAPBar(player) {
  const pct  = Math.min(100, Math.round((player.action_points / player.action_points_max) * 100));
  const cls  = pct <= 10 ? 'empty' : pct <= 30 ? 'low' : '';
  document.getElementById('ap-fill').style.width = pct + '%';
  document.getElementById('ap-fill').className   = `ap-bar-fill ${cls}`;
  document.getElementById('ap-count').textContent = `${player.action_points}/${player.action_points_max} AP`;

  const sessPct = Math.min(100, Math.round(
    (player.session_minutes_today / player.session_minutes_max) * 100
  ));
  document.getElementById('session-info').textContent =
    `session: ${player.session_minutes_today}/${player.session_minutes_max} min`;
}

// ── Stores panel ─────────────────────────────────────────────────────────────
function renderStores(stores, income, upkeep, ruleset) {
  if (!ruleset) return;

  // Group resources by category
  const categories = {};
  for (const r of (ruleset.resources ?? [])) {
    const amt = stores[r.id] ?? 0;
    // Only show resources the player has ever had or that are in the starting set
    // Always show all for now, dim unowned ones
    if (!categories[r.category]) categories[r.category] = [];
    categories[r.category].push(r);
  }

  const panel = document.getElementById('stores-panel');
  let html = '<h3>Resources</h3>';

  for (const [cat, resources] of Object.entries(categories)) {
    // Skip categories where all resources are at 0 and no income
    const hasAny = resources.some((r) =>
      (stores[r.id] ?? 0) > 0 || (income[r.id] ?? 0) > 0
    );
    if (!hasAny) continue;

    html += `<div class="store-category">
      <div class="store-category-label">${esc(cat)}</div>`;

    for (const r of resources) {
      const amt     = stores[r.id] ?? 0;
      if (amt === 0 && !(income[r.id] ?? 0)) continue; // hide zero/no-income
      const rate    = (income[r.id] ?? 0) - (upkeep[r.id] ?? 0);
      const rateTxt = fmtRate(rate);
      const rateCls = rate < 0 ? 'negative' : '';
      html += `
        <div class="store-row" title="${esc(r.description ?? '')}">
          <div class="store-icon-name">
            <span class="store-icon">${r.icon ?? '·'}</span>
            <span>${esc(r.name)}</span>
          </div>
          <div>
            <span class="store-amount" id="store-${r.id}">${fmt(amt)}</span>
            ${rateTxt ? `<span class="store-income ${rateCls}"> ${esc(rateTxt)}</span>` : ''}
          </div>
        </div>`;
    }
    html += '</div>';
  }

  if (html === '<h3>Resources</h3>') {
    html += '<p style="color:var(--text-dim);font-size:12px">No resources yet. Build extractors and assign operatives.</p>';
  }

  panel.innerHTML = html;
}

// ── Buildings panel ───────────────────────────────────────────────────────────
function renderBuildings(buildingCounts, stores, player, ruleset, campaignId) {
  if (!ruleset) return;
  const panel = document.getElementById('buildings-panel');
  let html = '<h3>Buildings</h3>';

  // Population bar at top
  const popCap  = _state?.population?.capacity ?? 4;
  const popUsed = _state?.population?.used      ?? 0;
  const popPct  = Math.min(100, Math.round((popUsed / popCap) * 100));
  html += `
    <div class="pop-bar-wrap" title="Population capacity from housing">
      <span style="color:var(--text-dim);font-size:10px;letter-spacing:1px;text-transform:uppercase">Pop</span>
      <div class="pop-bar"><div class="pop-bar-fill ${popPct >= 100 ? 'full' : ''}" style="width:${popPct}%"></div></div>
      <span class="pop-count">${popUsed}/${popCap}</span>
    </div>`;

  for (const b of (ruleset.buildings ?? [])) {
    const count = buildingCounts[b.id] ?? 0;
    const cost  = b.cost ?? {};
    const canAfford = Object.entries(cost).every(([res, amt]) => (stores[res] ?? 0) >= amt);
    const atMax     = b.max_count && count >= b.max_count;

    const costHtml = Object.entries(cost).map(([res, amt]) => {
      const have    = stores[res] ?? 0;
      const cls     = have >= amt ? 'ok' : 'short';
      const resObj  = (ruleset.resources ?? []).find((r) => r.id === res);
      return `<span class="${cls}">${esc(resObj?.name ?? res)}: ${amt}</span>`;
    }).join(' &nbsp; ');

    html += `
      <div class="building-item ${count === 0 ? 'unbuilt' : ''}">
        <div class="bld-top">
          <span class="bld-name">${esc(b.name)}</span>
          <span class="bld-count">${count}${b.max_count ? `/${b.max_count}` : ''}</span>
        </div>
        <div class="bld-desc">${esc(b.description ?? '')}</div>
        ${costHtml ? `<div class="bld-cost">${costHtml}</div>` : ''}
        <div class="bld-actions">
          <button class="c-btn primary build-btn"
            data-building="${b.id}"
            ${atMax || !canAfford || player.action_points < 10 ? 'disabled' : ''}>
            build ${player.action_points < 10 ? '(no AP)' : atMax ? '(max)' : ''}
          </button>
          ${count > 0 ? `<button class="c-btn danger demolish-btn" data-building="${b.id}">demolish</button>` : ''}
        </div>
      </div>`;
  }

  panel.innerHTML = html;

  // Wire buttons
  panel.querySelectorAll('.build-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const { message, ap_remaining } = await api.build(campaignId, {
          building_id: btn.dataset.building, action: 'build',
        });
        notify(message, 'success');
        await refreshState();
      } catch (err) {
        notify(err.message, 'error');
        btn.disabled = false;
      }
    });
  });

  panel.querySelectorAll('.demolish-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Demolish this building?')) return;
      btn.disabled = true;
      try {
        const { message } = await api.build(campaignId, {
          building_id: btn.dataset.building, action: 'demolish',
        });
        notify(message);
        await refreshState();
      } catch (err) {
        notify(err.message, 'error');
        btn.disabled = false;
      }
    });
  });
}

// ── Workers panel ─────────────────────────────────────────────────────────────
function renderWorkers(workerCounts, buildingCounts, player, ruleset, campaignId) {
  if (!ruleset) return;
  const panel  = document.getElementById('workers-panel');
  const popCap = _state?.population?.capacity ?? 4;
  const popUsed= _state?.population?.used     ?? 0;

  // Build slot map: operative → [building_ids]
  const slotMap = {};
  for (const b of (ruleset.buildings ?? [])) {
    if (b.worker_slot?.operative_type) {
      const op = b.worker_slot.operative_type;
      if (!slotMap[op]) slotMap[op] = [];
      slotMap[op].push(b.id);
    }
  }

  let html = '<h3>Operatives</h3>';

  for (const op of (ruleset.operatives ?? [])) {
    const assigned = workerCounts[op.id] ?? 0;

    // Max this operative can have
    const slottedBuildings = slotMap[op.id] ?? [];
    let maxWorkers;
    if (slottedBuildings.length > 0) {
      maxWorkers = slottedBuildings.reduce((s, bId) => s + (buildingCounts[bId] ?? 0), 0);
    } else {
      maxWorkers = popCap - popUsed + assigned; // limited by remaining population
    }

    // Required building for recruitment
    const reqBuilding = op.produced_at
      ? (ruleset.buildings ?? []).find((b) => b.id === op.produced_at)
      : null;
    const hasReqBuilding = !reqBuilding || (buildingCounts[reqBuilding.id] ?? 0) > 0;

    // Income preview text
    const incomeParts = Object.entries(op.income_per_tick ?? {}).map(([res, r]) => {
      const rObj = (ruleset.resources ?? []).find((x) => x.id === res);
      return `+${fmtRate(r)} ${rObj?.name ?? res}`;
    });

    const unavailable = !hasReqBuilding;
    const atMax       = assigned >= maxWorkers;

    html += `
      <div class="worker-item ${unavailable ? 'unavailable' : ''}">
        <div class="worker-info">
          <div class="worker-name">${esc(op.name)}</div>
          <div class="worker-detail">
            ${reqBuilding ? `needs: ${esc(reqBuilding.name)} · ` : ''}
            ${incomeParts.join(', ') || 'building income'}
          </div>
        </div>
        <div class="worker-controls">
          <button class="c-btn unassign-btn" data-op="${op.id}"
            ${assigned === 0 ? 'disabled' : ''}>−</button>
          <span class="worker-count">${assigned}</span>
          <button class="c-btn assign-btn" data-op="${op.id}"
            ${atMax || popUsed >= popCap || player.action_points < 5 ? 'disabled' : ''}>+</button>
        </div>
      </div>`;
  }

  panel.innerHTML = html;

  panel.querySelectorAll('.assign-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const { message } = await api.assignWorker(campaignId, {
          operative_id: btn.dataset.op, action: 'assign',
        });
        notify(message, 'success');
        await refreshState();
      } catch (err) {
        notify(err.message, 'error');
        btn.disabled = false;
      }
    });
  });

  panel.querySelectorAll('.unassign-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const { message } = await api.assignWorker(campaignId, {
          operative_id: btn.dataset.op, action: 'unassign',
        });
        notify(message);
        await refreshState();
      } catch (err) {
        notify(err.message, 'error');
        btn.disabled = false;
      }
    });
  });
}

// ── Full render ───────────────────────────────────────────────────────────────
function render(data) {
  _state = data;
  renderAPBar(data.player);
  renderStores(data.stores, data.income, data.upkeep, _ruleset);
  renderBuildings(data.buildings, data.stores, data.player, _ruleset, _currentCampaignId);
  renderWorkers(data.workers, data.buildings, data.player, _ruleset, _currentCampaignId);
}

async function refreshState() {
  try {
    const data = await api.getEmpire(_currentCampaignId);
    render(data);
  } catch (err) {
    notify('Failed to refresh state: ' + err.message, 'error');
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
export async function initEmpire(campaignId, onBack) {
  _currentCampaignId = campaignId;
  _mapLoaded  = false;
  _mapRefresh = null;
  clearInterval(_pollTimer);

  const screen = document.getElementById('empire-screen');

  screen.innerHTML = `
    <div class="empire-header">
      <div>
        <div class="emp-name" id="emp-name">Loading…</div>
        <div class="emp-faction" id="emp-faction"></div>
      </div>
      <div class="emp-campaign" id="emp-campaign"></div>
      <div class="ap-bar-wrap">
        <span class="ap-label">AP</span>
        <div class="ap-bar"><div class="ap-bar-fill" id="ap-fill" style="width:100%"></div></div>
        <span class="ap-count" id="ap-count"></span>
      </div>
      <span class="session-info" id="session-info"></span>
      <div class="empire-tabs">
        <button class="emp-tab active" data-tab="empire">Empire</button>
        <button class="emp-tab" data-tab="map">Map</button>
      </div>
      <button class="c-btn" id="emp-back">← campaigns</button>
    </div>
    <div class="empire-body">
      <div class="empire-content" id="empire-content-panel">
        <div class="emp-panel" id="stores-panel"><h3>Resources</h3><p style="color:var(--text-dim);font-size:12px">loading…</p></div>
        <div class="emp-panel" id="buildings-panel"><h3>Buildings</h3></div>
        <div class="emp-panel" id="workers-panel"><h3>Operatives</h3></div>
      </div>
      <div id="map-container" style="display:none;flex:1;overflow:hidden"></div>
    </div>
    <div id="empire-notifications"></div>
    <div id="empire-load-error" style="display:none;padding:20px;color:var(--red-hi);font-size:13px"></div>
  `;

  // Wire back button BEFORE any async work so it always functions
  document.getElementById('emp-back').addEventListener('click', () => {
    clearInterval(_pollTimer);
    onBack();
  });

  // ── Tab switching ──────────────────────────────────────────────────────────
  document.querySelectorAll('.emp-tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('.emp-tab').forEach((t) => t.classList.toggle('active', t === tab));
      const which = tab.dataset.tab;
      const empirePanel = document.getElementById('empire-content-panel');
      const mapPanel    = document.getElementById('map-container');
      if (which === 'empire') {
        empirePanel.style.display = '';
        mapPanel.style.display    = 'none';
      } else {
        empirePanel.style.display = 'none';
        mapPanel.style.display    = 'flex';
        if (!_mapLoaded && _ruleset) {
          _mapLoaded  = true;
          _mapRefresh = await initMapView(mapPanel, campaignId, _ruleset);
        }
      }
    });
  });

  // Load ruleset + initial state together
  try {
    const data = await api.getEmpire(campaignId);
    const { ruleset } = await api.getRuleset(data.campaign.ruleset_id);
    _ruleset = ruleset;

    document.getElementById('emp-name').textContent    = data.player.empire_name;
    document.getElementById('emp-faction').textContent = data.player.faction ?? '';
    document.getElementById('emp-campaign').textContent =
      `${data.campaign.name} · ${data.campaign.status}`;

    render(data);
  } catch (err) {
    // Show error in a dedicated element — never use innerHTML+= as it destroys event listeners
    const errEl = document.getElementById('empire-load-error');
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    document.getElementById('emp-name').textContent = 'Error';
    return;
  }

  // Poll for updates (empire state + map if map tab is open)
  _pollTimer = setInterval(async () => {
    await refreshState();
    if (_mapRefresh && document.getElementById('map-container')?.style.display !== 'none') {
      await _mapRefresh();
    }
  }, POLL_INTERVAL);
}
