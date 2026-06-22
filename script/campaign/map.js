/**
 * Campaign map — canvas renderer
 *
 * initMapView(container, campaignId, ruleset)
 *   Fetches map data, renders a pan/zoom canvas, and returns a refresh() fn.
 *
 * Fog levels:
 *   0 = never seen     → near-black
 *   1 = historically seen → dimmed biome colour
 *   2 = currently visible → full colour + owner borders
 */
import { api } from './api.js';

const BASE_CHUNK = 32; // pixels per chunk at zoom 1.0

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Mix a hex colour toward near-black at the given blend factor (0=black, 1=full colour)
function dimHex(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  return `rgb(${Math.round(r * alpha)},${Math.round(g * alpha)},${Math.round(b * alpha)})`;
}

export async function initMapView(container, campaignId, ruleset) {
  container.innerHTML = '<div style="color:var(--text-dim);font-size:12px;padding:20px">Loading map…</div>';

  let data;
  try {
    data = await api.getMap(campaignId);
  } catch (err) {
    container.innerHTML = `<div style="color:var(--red-hi);padding:20px;font-size:12px">${escHtml(err.message)}</div>`;
    return null;
  }

  if (data.not_generated || data.chunks.length === 0) {
    container.innerHTML = '<div style="color:var(--text-dim);padding:20px;font-size:12px">Map not generated yet — the GM needs to start the campaign first.</div>';
    return null;
  }

  // ── Setup ────────────────────────────────────────────────────────────────
  container.innerHTML = '';
  container.style.cssText += ';position:relative;overflow:hidden;background:#0a0a0a';

  // Build biome colour lookup from ruleset
  const biomeColor = {};
  for (const b of (ruleset.map?.biomes ?? [])) {
    biomeColor[b.id] = b.color ?? '#2a2a2a';
  }
  const biomeName = {};
  for (const b of (ruleset.map?.biomes ?? [])) {
    biomeName[b.id] = b.name ?? b.id;
  }

  // Fast chunk lookup by "x,y"
  const chunkMap = {};
  for (const c of data.chunks) chunkMap[`${c.x},${c.y}`] = c;

  // ── Canvas ───────────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;cursor:grab';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let zoom     = 1.0;
  let offsetX  = 0;
  let offsetY  = 0;
  let dragging = false;
  let dragLast = null;
  let firstDraw = true;

  // ── Tooltip ──────────────────────────────────────────────────────────────
  const tooltip = document.createElement('div');
  tooltip.style.cssText = [
    'position:absolute',
    'background:#111',
    'border:1px solid #2a2a2a',
    'padding:6px 10px',
    'font-size:11px',
    'color:#999',
    'pointer-events:none',
    'display:none',
    'font-family:Courier New,monospace',
    'line-height:1.6',
    'max-width:200px',
    'z-index:10',
  ].join(';');
  container.appendChild(tooltip);

  // ── Legend ───────────────────────────────────────────────────────────────
  const legend = document.createElement('div');
  legend.style.cssText = [
    'position:absolute',
    'bottom:10px',
    'left:10px',
    'background:#111',
    'border:1px solid #2a2a2a',
    'padding:8px 12px',
    'font-size:10px',
    'color:#555',
    'font-family:Courier New,monospace',
    'line-height:1.8',
    'z-index:10',
  ].join(';');
  const legendRows = (ruleset.map?.biomes ?? [])
    .filter((b) => b.passable !== false)
    .map((b) => `<div><span style="display:inline-block;width:10px;height:10px;background:${b.color};margin-right:6px;vertical-align:middle"></span>${escHtml(b.name)}</div>`)
    .join('');
  legend.innerHTML = legendRows || '';
  if (legendRows) container.appendChild(legend);

  // ── Draw ─────────────────────────────────────────────────────────────────
  function draw() {
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H);

    const cs = BASE_CHUNK * zoom;

    for (const chunk of data.chunks) {
      const px = Math.floor(offsetX + chunk.x * cs);
      const py = Math.floor(offsetY + chunk.y * cs);
      const sz = Math.ceil(cs);

      // Cull off-screen chunks
      if (px + sz < 0 || py + sz < 0 || px > W || py > H) continue;

      if (chunk.fog === 0) {
        // Never seen — near black with faint grid
        ctx.fillStyle = '#0d0d0d';
        ctx.fillRect(px, py, sz, sz);
      } else if (chunk.fog === 1) {
        // Historically seen — dimmed biome colour (30%)
        const col = biomeColor[chunk.biome_id] ?? '#1a1a1a';
        ctx.fillStyle = dimHex(col, 0.3);
        ctx.fillRect(px, py, sz, sz);
      } else {
        // Fully visible
        const col = biomeColor[chunk.biome_id] ?? '#1a1a1a';
        ctx.fillStyle = col;
        ctx.fillRect(px, py, sz, sz);

        // Owner border
        if (chunk.owner_cp_id) {
          const lw = Math.max(1, cs * 0.07);
          ctx.strokeStyle = chunk.is_mine ? '#c8a87a' : '#8a4a4a';
          ctx.lineWidth = lw;
          ctx.strokeRect(px + lw / 2, py + lw / 2, sz - lw, sz - lw);
        }

        // Capital marker — filled circle in centre
        if (chunk.is_capital && cs >= 8) {
          const r = Math.max(2, cs * 0.13);
          ctx.fillStyle = chunk.is_mine ? '#c8a87a' : '#ddd';
          ctx.beginPath();
          ctx.arc(px + sz / 2, py + sz / 2, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Subtle grid lines when zoomed in enough
      if (zoom >= 0.6) {
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px, py, sz, sz);
      }
    }
  }

  // ── Resize handler ───────────────────────────────────────────────────────
  function resize() {
    canvas.width  = container.clientWidth  || 600;
    canvas.height = container.clientHeight || 400;

    if (firstDraw) {
      firstDraw = false;
      const mapPx = data.size * BASE_CHUNK;
      offsetX = (canvas.width  - mapPx) / 2;
      offsetY = (canvas.height - mapPx) / 2;

      // Try to centre on the player's capital if one exists
      const capital = data.chunks.find((c) => c.is_capital && c.is_mine);
      if (capital) {
        offsetX = canvas.width  / 2 - (capital.x + 0.5) * BASE_CHUNK;
        offsetY = canvas.height / 2 - (capital.y + 0.5) * BASE_CHUNK;
      }
    }
    draw();
  }

  // ── Chunk at canvas pixel ─────────────────────────────────────────────────
  function chunkAt(mx, my) {
    const cs = BASE_CHUNK * zoom;
    const cx = Math.floor((mx - offsetX) / cs);
    const cy = Math.floor((my - offsetY) / cs);
    if (cx < 0 || cy < 0 || cx >= data.size || cy >= data.size) return null;
    return chunkMap[`${cx},${cy}`] ?? null;
  }

  // ── Mouse events ─────────────────────────────────────────────────────────
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    dragLast = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    const my   = e.clientY - rect.top;

    if (dragging && dragLast) {
      offsetX += e.clientX - dragLast.x;
      offsetY += e.clientY - dragLast.y;
      dragLast = { x: e.clientX, y: e.clientY };
      draw();
      tooltip.style.display = 'none';
      return;
    }

    const chunk = chunkAt(mx, my);
    if (!chunk || chunk.fog === 0) {
      tooltip.style.display = 'none';
      return;
    }

    const bname = biomeName[chunk.biome_id] ?? chunk.biome_id ?? '—';
    let html = `<b style="color:#ddd">${escHtml(bname)}</b>`;
    if (chunk.fog === 1) {
      html += '<br><span style="color:#444">out of sight</span>';
    } else {
      if (chunk.is_capital) html += '<br>★ Capital';
      if (chunk.is_mine)     html += '<br><span style="color:#c8a87a">Your territory</span>';
      else if (chunk.owner_name) html += `<br>Owner: ${escHtml(chunk.owner_name)}`;
      else html += '<br><span style="color:#444">Unclaimed</span>';
    }
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';

    let tx = mx + 14, ty = my + 14;
    if (tx + 210 > container.clientWidth)  tx = mx - 210;
    if (ty + 90  > container.clientHeight) ty = my - 90;
    tooltip.style.left = Math.max(0, tx) + 'px';
    tooltip.style.top  = Math.max(0, ty) + 'px';
  });

  canvas.addEventListener('mouseup', () => {
    dragging = false;
    canvas.style.cursor = 'grab';
  });

  canvas.addEventListener('mouseleave', () => {
    dragging = false;
    tooltip.style.display = 'none';
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect   = canvas.getBoundingClientRect();
    const mx     = e.clientX - rect.left;
    const my     = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.min(5, Math.max(0.2, zoom * factor));
    offsetX = mx - (mx - offsetX) * (newZoom / zoom);
    offsetY = my - (my - offsetY) * (newZoom / zoom);
    zoom = newZoom;
    draw();
  }, { passive: false });

  // ── ResizeObserver ───────────────────────────────────────────────────────
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // ── Return refresh function ───────────────────────────────────────────────
  return async function refreshMap() {
    try {
      const fresh = await api.getMap(campaignId);
      data = fresh;
      for (const c of data.chunks) chunkMap[`${c.x},${c.y}`] = c;
      draw();
    } catch { /* silent */ }
  };
}
