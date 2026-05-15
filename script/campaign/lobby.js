/**
 * Campaign lobby screen
 * Shows the player's campaigns and lets them join or create one.
 */
import { api } from './api.js';
import { generateCampaignName, generateEmpireName } from './namegen.js';

export function initLobby(user, onEnterCampaign, onLogout) {
  const screen = document.getElementById('lobby-screen');

  screen.innerHTML = `
    <div class="lobby-header">
      <span class="site-title">Campaign Dark Room</span>
      <div class="user-info">
        signed in as <span>${escHtml(user.username)}</span>
        <button class="c-btn" id="lobby-logout">logout</button>
      </div>
    </div>

    <div class="lobby-content">
      <!-- Your campaigns -->
      <div class="lobby-col" style="flex:2">
        <h2>Your Campaigns</h2>
        <div id="campaigns-list"><span style="color:var(--text-dim);font-size:12px">loading…</span></div>
      </div>

      <!-- Join -->
      <div class="lobby-col">
        <h2>Join a Campaign</h2>
        <div class="c-form-group">
          <label>Invite Code</label>
          <input type="text" id="join-code" placeholder="XXXX-XXXX-XXXX"
                 style="text-transform:uppercase;letter-spacing:2px" maxlength="14"/>
        </div>
        <div class="c-form-group">
          <label>Empire Name <button type="button" class="dice-btn" id="dice-empire" title="Random name">🎲</button></label>
          <input type="text" id="join-empire" placeholder="Iron Dominion" maxlength="80"/>
        </div>
        <div class="c-form-group" id="join-faction-wrap" style="display:none">
          <label>Faction</label>
          <select id="join-faction"></select>
        </div>
        <button class="c-btn primary" id="join-btn">join campaign</button>
        <div class="c-error" id="join-error"></div>
        <div class="c-notice" id="join-notice"></div>
      </div>

      <!-- Create (GM/admin only) -->
      <div class="lobby-col" id="create-col" style="display:none">
        <h2>Create Campaign</h2>
        <div class="c-form-group">
          <label>Campaign Name <button type="button" class="dice-btn" id="dice-campaign" title="Random name">🎲</button></label>
          <input type="text" id="create-name" placeholder="First Contact" maxlength="100"/>
        </div>
        <div class="c-form-group">
          <label>Ruleset</label>
          <select id="create-ruleset"></select>
        </div>
        <button class="c-btn primary" id="create-btn">create campaign</button>
        <div class="c-error" id="create-error"></div>
        <div class="c-notice" id="create-notice"></div>
        <div id="invite-code-box" style="display:none;margin-top:14px">
          <div style="color:var(--text-dim);font-size:11px;margin-bottom:4px">Invite Code</div>
          <div id="invite-code-display"
               style="font-family:var(--font-mono);font-size:20px;letter-spacing:4px;color:var(--accent-hi)"></div>
          <div style="color:var(--text-dim);font-size:11px;margin-top:4px">Share this with your players.</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('lobby-logout').addEventListener('click', async () => {
    await api.logout().catch(() => {});
    onLogout();
  });

  // ── Load campaigns ──────────────────────────────────────────────────────
  async function loadCampaigns() {
    try {
      const { campaigns } = await api.listCampaigns();
      const list = document.getElementById('campaigns-list');

      if (!campaigns.length) {
        list.innerHTML = '<p style="color:var(--text-dim);font-size:12px">No campaigns yet. Join one with an invite code.</p>';
        return;
      }

      list.innerHTML = campaigns.map((c) => {
        const gmOnly = !c.empire_name;
        const isGM   = c.is_gm;
        return `
        <div class="campaign-card ${gmOnly ? 'gm-only' : ''}" data-id="${c.id}"
             data-gm-only="${gmOnly}" data-code="${escHtml(c.invite_code ?? '')}">
          <div class="bld-top">
            <div class="cc-name">${escHtml(c.name)}</div>
            <div style="display:flex;gap:8px;align-items:center">
              <span class="cc-status ${c.status}">${c.status}</span>
              ${isGM ? `<button class="dice-btn settings-btn" data-id="${c.id}" title="Campaign settings">⚙</button>` : ''}
            </div>
          </div>
          ${c.empire_name
            ? `<div class="cc-empire">${escHtml(c.empire_name)}${c.faction ? ` · ${escHtml(c.faction)}` : ''}</div>`
            : `<div class="cc-empire" style="color:var(--text-dim)">GM — <span style="color:var(--accent)">join to set up your empire ↓</span></div>`}
          <div class="cc-meta">
            <span>${escHtml(c.ruleset_id)}</span>
            ${c.invite_code ? `<span>Code: <b style="color:var(--accent);letter-spacing:1px">${c.invite_code}</b></span>` : ''}
          </div>
        </div>`;
      }).join('');

      list.querySelectorAll('.campaign-card').forEach((card) => {
        card.addEventListener('click', (e) => {
          // Settings gear — open settings, don't navigate
          if (e.target.classList.contains('settings-btn')) {
            openSettings(Number(e.target.dataset.id), campaigns);
            return;
          }
          if (card.dataset.gmOnly === 'true') {
            const codeEl = document.getElementById('join-code');
            if (codeEl) {
              codeEl.value = card.dataset.code;
              codeEl.dispatchEvent(new Event('input'));
              document.getElementById('join-empire')?.focus();
            }
            return;
          }
          onEnterCampaign(Number(card.dataset.id));
        });
      });
    } catch (err) {
      document.getElementById('campaigns-list').innerHTML =
        `<p style="color:var(--red-hi);font-size:12px">${escHtml(err.message)}</p>`;
    }
  }

  loadCampaigns();

  // ── Name generators ─────────────────────────────────────────────────────
  // Empire name dice (theme unknown at join time, use neutral list)
  document.getElementById('dice-empire').addEventListener('click', () => {
    document.getElementById('join-empire').value = generateEmpireName();
  });

  // ── Join ────────────────────────────────────────────────────────────────
  const joinCodeEl    = document.getElementById('join-code');
  const joinEmpireEl  = document.getElementById('join-empire');
  const joinFactionEl = document.getElementById('join-faction');
  const joinFWrap     = document.getElementById('join-faction-wrap');
  const joinBtn       = document.getElementById('join-btn');
  const joinError     = document.getElementById('join-error');
  const joinNotice    = document.getElementById('join-notice');

  // When code is typed, look up the campaign to show factions
  let factionLookupTimer = null;
  joinCodeEl.addEventListener('input', () => {
    clearTimeout(factionLookupTimer);
    const code = joinCodeEl.value.trim().toUpperCase();
    if (code.length < 14) { joinFWrap.style.display = 'none'; return; }
    factionLookupTimer = setTimeout(() => loadFactionsForCode(code), 400);
  });

  async function loadFactionsForCode(code) {
    try {
      // Find the campaign by trying to get rulesets via campaigns list
      const { campaigns } = await api.listCampaigns();
      // We can't look up by code from the client without an endpoint, so
      // we'll load all rulesets instead and populate after join attempt
      const { rulesets } = await api.listRulesets();
      // Just offer all faction options after typing a code — server validates
      joinFWrap.style.display = 'none'; // simplified: show faction after ruleset known
    } catch {}
  }

  joinBtn.addEventListener('click', async () => {
    joinError.textContent  = '';
    joinNotice.textContent = '';
    const code    = joinCodeEl.value.trim().toUpperCase();
    const empire  = joinEmpireEl.value.trim();
    const faction = joinFactionEl.value || undefined;

    if (!code)   { joinError.textContent = 'Enter an invite code.'; return; }
    if (!empire) { joinError.textContent = 'Enter an empire name.'; return; }

    joinBtn.disabled = true;
    joinBtn.textContent = 'joining…';
    try {
      await api.joinCampaign({ code, empire_name: empire, faction });
      joinNotice.textContent = 'Joined! Loading your empire…';
      await loadCampaigns();
      joinCodeEl.value   = '';
      joinEmpireEl.value = '';
    } catch (err) {
      joinError.textContent = err.message;
    } finally {
      joinBtn.disabled = false;
      joinBtn.textContent = 'join campaign';
    }
  });

  // ── Create (GM / admin) ──────────────────────────────────────────────────
  if (user.role === 'gm' || user.role === 'admin') {
    document.getElementById('create-col').style.display = 'block';

    // Campaign name dice
    document.getElementById('dice-campaign').addEventListener('click', () => {
      document.getElementById('create-name').value = generateCampaignName();
    });

    // Load rulesets into dropdown
    api.listRulesets().then(({ rulesets }) => {
      const sel = document.getElementById('create-ruleset');
      rulesets.forEach((r) => {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = `${r.name} (${r.theme})`;
        sel.appendChild(opt);
      });
    }).catch(() => {});

    document.getElementById('create-btn').addEventListener('click', async () => {
      const createError  = document.getElementById('create-error');
      const createNotice = document.getElementById('create-notice');
      createError.textContent  = '';
      createNotice.textContent = '';

      const name      = document.getElementById('create-name').value.trim();
      const rulesetId = document.getElementById('create-ruleset').value;

      if (!name)      { createError.textContent = 'Enter a campaign name.'; return; }
      if (!rulesetId) { createError.textContent = 'Select a ruleset.'; return; }

      const btn = document.getElementById('create-btn');
      btn.disabled = true;
      btn.textContent = 'creating…';
      try {
        const { campaign } = await api.createCampaign({ name, ruleset_id: rulesetId });
        document.getElementById('invite-code-display').textContent = campaign.invite_code;
        document.getElementById('invite-code-box').style.display = 'block';
        createNotice.textContent = `Campaign "${campaign.name}" created.`;
        await loadCampaigns();
      } catch (err) {
        createError.textContent = err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = 'create campaign';
      }
    });
  } // end GM/admin block

  // ── Campaign settings modal (available to all GMs via the ⚙ button) ────
  function openSettings(campaignId, campaigns) {
    const c      = campaigns.find((x) => x.id === campaignId);
    if (!c) return;
    const cfg    = c.config ?? {};

    // Remove any existing modal
    document.getElementById('settings-modal')?.remove();

    const modal = document.createElement('div');
    modal.id    = 'settings-modal';
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-box">
        <div class="modal-header">
          <span>Campaign Settings — ${escHtml(c.name)}</span>
          <button class="dice-btn" id="modal-close" title="Close">✕</button>
        </div>

        <div class="modal-body">
          <div class="c-form-group">
            <label>Campaign Name</label>
            <input type="text" id="set-name" value="${escHtml(c.name)}" maxlength="100"/>
          </div>
          <div class="modal-row">
            <div class="c-form-group">
              <label>Action Points / Day</label>
              <input type="number" id="set-ap" value="${cfg.action_points_per_day ?? 100}" min="10" max="1000"/>
            </div>
            <div class="c-form-group">
              <label>AP Refresh Hour (UTC)</label>
              <input type="number" id="set-ap-hour" value="${cfg.ap_refresh_hour_utc ?? 6}" min="0" max="23"/>
            </div>
          </div>
          <div class="modal-row">
            <div class="c-form-group">
              <label>Max Session (minutes/day)</label>
              <input type="number" id="set-session" value="${cfg.max_session_minutes ?? 120}" min="15" max="1440"/>
            </div>
            <div class="c-form-group">
              <label>Max Players</label>
              <input type="number" id="set-maxplayers" value="${cfg.max_players ?? 20}" min="2" max="100"/>
            </div>
          </div>

          <div class="modal-section-label">Invite Code</div>
          <div style="font-family:var(--font-mono);font-size:18px;letter-spacing:3px;color:var(--accent-hi);margin-bottom:14px">
            ${escHtml(c.invite_code ?? '—')}
          </div>

          <div class="modal-section-label">Campaign Status</div>
          <div style="display:flex;gap:8px;margin-bottom:14px">
            ${c.status === 'setup'
              ? `<button class="c-btn primary" id="set-start">Start Campaign</button>`
              : c.status === 'active'
              ? `<button class="c-btn" id="set-pause">Pause Campaign</button>`
              : c.status === 'paused'
              ? `<button class="c-btn primary" id="set-resume">Resume Campaign</button>`
              : `<span style="color:var(--text-dim);font-size:12px">Campaign has ended.</span>`
            }
          </div>

          <div class="c-error"  id="set-error"></div>
          <div class="c-notice" id="set-notice"></div>

          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="c-btn primary" id="set-save">Save Changes</button>
            <button class="c-btn"         id="set-cancel">Cancel</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const close = () => { modal.remove(); loadCampaigns(); };
    document.getElementById('modal-close').addEventListener('click', close);
    document.getElementById('set-cancel').addEventListener('click', close);
    modal.querySelector('.modal-backdrop').addEventListener('click', close);

    // Save
    document.getElementById('set-save').addEventListener('click', async () => {
      const errEl    = document.getElementById('set-error');
      const noticeEl = document.getElementById('set-notice');
      errEl.textContent = ''; noticeEl.textContent = '';

      const newName = document.getElementById('set-name').value.trim();
      if (!newName) { errEl.textContent = 'Name cannot be empty.'; return; }

      const newConfig = {
        action_points_per_day: parseInt(document.getElementById('set-ap').value) || 100,
        ap_refresh_hour_utc:   parseInt(document.getElementById('set-ap-hour').value) || 6,
        max_session_minutes:   parseInt(document.getElementById('set-session').value) || 120,
        max_players:           parseInt(document.getElementById('set-maxplayers').value) || 20,
      };

      try {
        await api.updateCampaign(campaignId, { name: newName, config: newConfig });
        noticeEl.textContent = 'Saved.';
        setTimeout(close, 800);
      } catch (err) {
        errEl.textContent = err.message;
      }
    });

    // Start / pause / resume
    document.getElementById('set-start')?.addEventListener('click', async () => {
      try {
        await api.startCampaign(campaignId);
        close();
      } catch (err) {
        document.getElementById('set-error').textContent = err.message;
      }
    });

    document.getElementById('set-pause')?.addEventListener('click', async () => {
      try {
        await api.pauseCampaign(campaignId);
        close();
      } catch (err) {
        document.getElementById('set-error').textContent = err.message;
      }
    });

    document.getElementById('set-resume')?.addEventListener('click', async () => {
      try {
        await api.pauseCampaign(campaignId); // toggle
        close();
      } catch (err) {
        document.getElementById('set-error').textContent = err.message;
      }
    });
  }
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
