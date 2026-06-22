/**
 * Map generation and fog-of-war visibility service.
 *
 * generateMap(campaign, campaignPlayers)
 *   Procedurally fills map_chunks for a campaign and seeds initial
 *   visibility (capital + 1-ring) for each player. Idempotent.
 *
 * updateVisibility(cp, campaign)
 *   Expands a player's map_visibility to include all chunks currently
 *   in their vision range (owned chunks + 1-ring neighbours).
 */

import knex from '../db/knex.js';
import { loadRuleset } from './ruleset.js';

const MAP_SIZES = { small: 10, medium: 15, large: 20, huge: 25 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function weightedPick(items) {
  const total = items.reduce((s, i) => s + (i.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight ?? 1;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

// Spread N starting positions across an S×S grid, one per sector.
function spreadPositions(count, size) {
  const cols   = Math.ceil(Math.sqrt(count));
  const rows   = Math.ceil(count / cols);
  const cellW  = size / cols;
  const cellH  = size / rows;
  const result = [];

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = Math.floor(col * cellW + cellW * 0.2 + Math.random() * cellW * 0.6);
    const y = Math.floor(row * cellH + cellH * 0.2 + Math.random() * cellH * 0.6);
    result.push({
      x: Math.min(size - 1, Math.max(0, x)),
      y: Math.min(size - 1, Math.max(0, y)),
    });
  }
  return result;
}

// ─── generateMap ──────────────────────────────────────────────────────────────

export async function generateMap(campaign, campaignPlayers) {
  // Idempotent — bail if map already exists
  const existing = await knex('map_chunks').where({ campaign_id: campaign.id }).first();
  if (existing) return;

  const ruleset = loadRuleset(campaign.ruleset_id);
  const config  = JSON.parse(campaign.config ?? '{}');
  const size    = MAP_SIZES[config.map_size ?? 'medium'] ?? 15;
  const biomes  = ruleset.map?.biomes ?? [];

  if (biomes.length === 0) {
    console.warn(`[mapgen] Ruleset "${campaign.ruleset_id}" has no map.biomes — skipping map generation`);
    return;
  }

  const passable = biomes.filter((b) => b.passable !== false);
  if (passable.length === 0) {
    console.warn('[mapgen] No passable biomes found');
    return;
  }

  // Capital biome: lowest-weight passable biome (rarest good starting ground)
  const homeBiome = [...passable].sort((a, b) => (a.weight ?? 1) - (b.weight ?? 1))[0];

  // ── Generate base grid ────────────────────────────────────────────────────
  const chunks = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let biome = weightedPick(biomes);
      // Replace impassable biomes with a random passable one
      if (biome.passable === false) biome = weightedPick(passable);
      chunks.push({
        campaign_id:  campaign.id,
        x, y,
        biome_id:     biome.id,
        landmark_id:  null,
        owner_cp_id:  null,
        is_capital:   false,
      });
    }
  }

  // ── Place player capitals ─────────────────────────────────────────────────
  const positions = spreadPositions(campaignPlayers.length, size);
  for (let i = 0; i < campaignPlayers.length; i++) {
    const { x, y }   = positions[i];
    const idx        = y * size + x;
    chunks[idx].biome_id    = homeBiome.id;
    chunks[idx].owner_cp_id = campaignPlayers[i].id;
    chunks[idx].is_capital  = true;
  }

  // batchInsert avoids SQLite's per-statement parameter limit (~999)
  await knex.batchInsert('map_chunks', chunks, 100);

  // ── Seed initial visibility (capital + 1-ring) for each player ────────────
  const visRows = [];
  for (let i = 0; i < campaignPlayers.length; i++) {
    const { x, y } = positions[i];
    const cpId     = campaignPlayers[i].id;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
          visRows.push({ campaign_player_id: cpId, x: nx, y: ny });
        }
      }
    }
  }
  if (visRows.length > 0) {
    await knex.batchInsert('map_visibility', visRows, 100);
  }

  console.log(`[mapgen] Generated ${size}×${size} map for campaign ${campaign.id}`);
}

// ─── updateVisibility ─────────────────────────────────────────────────────────

export async function updateVisibility(cp, campaign) {
  const config = JSON.parse(campaign.config ?? '{}');
  const size   = MAP_SIZES[config.map_size ?? 'medium'] ?? 15;

  const owned = await knex('map_chunks')
    .where({ campaign_id: campaign.id, owner_cp_id: cp.id })
    .select('x', 'y');

  const toReveal = new Set();
  for (const { x, y } of owned) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
          toReveal.add(`${nx},${ny}`);
        }
      }
    }
  }

  if (toReveal.size === 0) return;

  const existing    = await knex('map_visibility').where({ campaign_player_id: cp.id }).select('x', 'y');
  const existingSet = new Set(existing.map((r) => `${r.x},${r.y}`));

  const newRows = [];
  for (const key of toReveal) {
    if (!existingSet.has(key)) {
      const [x, y] = key.split(',').map(Number);
      newRows.push({ campaign_player_id: cp.id, x, y });
    }
  }

  if (newRows.length > 0) {
    await knex.batchInsert('map_visibility', newRows, 100);
  }
}
