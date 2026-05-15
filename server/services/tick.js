/**
 * Tick service — lazy income calculation
 *
 * Rather than a server-side interval (lost on restart), income is calculated
 * on-demand when a player fetches their empire state.  We compute how many
 * ticks have elapsed since last_tick_at and apply all income / upkeep at once.
 *
 * Tick interval is stored in campaign config as tick_interval_seconds (default 10).
 */
import knex from '../db/knex.js';

const DEFAULT_TICK_SECONDS = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Reconstruct a nested { stores, buildings, workers } object from the flat
 * empire_state rows:  key = "stores.ore" → stores.ore
 */
export function reconstructState(rows) {
  const state = { stores: {}, buildings: {}, workers: {} };
  for (const { key, value } of rows) {
    const dot = key.indexOf('.');
    if (dot === -1) continue;
    const ns   = key.slice(0, dot);
    const name = key.slice(dot + 1);
    if (state[ns] !== undefined) {
      state[ns][name] = parseFloat(value) || 0;
    }
  }
  return state;
}

/**
 * Build a lookup:  operative_id → [building_id, ...]
 * for every building that has a worker_slot.
 */
function buildSlotMap(ruleset) {
  const map = {};
  for (const building of (ruleset.buildings ?? [])) {
    if (building.worker_slot?.operative_type) {
      const op = building.worker_slot.operative_type;
      if (!map[op]) map[op] = [];
      map[op].push(building.id);
    }
  }
  return map;
}

/**
 * Total population capacity provided by buildings with population_bonus.
 * Base capacity is 4 so a brand-new empire can assign a few workers.
 */
export function getPopulationCapacity(buildings, ruleset) {
  let cap = 4;
  for (const b of (ruleset.buildings ?? [])) {
    if (b.population_bonus) {
      cap += (buildings[b.id] ?? 0) * b.population_bonus;
    }
  }
  return cap;
}

/**
 * Total workers currently assigned across all operative types.
 */
export function getTotalWorkers(workers) {
  return Object.values(workers).reduce((sum, n) => sum + n, 0);
}

/**
 * Calculate per-tick income and upkeep for a given empire state + ruleset.
 * Returns { income: { resourceId: rate }, upkeep: { resourceId: rate } }
 * Rates are per single tick.
 */
export function calculateRates(state, ruleset) {
  const { buildings, workers } = state;
  const slotMap = buildSlotMap(ruleset);

  const income = {};
  const upkeep = {};

  const addTo = (obj, resource, amount) => {
    obj[resource] = (obj[resource] ?? 0) + amount;
  };

  for (const op of (ruleset.operatives ?? [])) {
    const assigned = workers[op.id] ?? 0;
    if (assigned === 0) continue;

    // Effective workers: capped by building slot availability if applicable
    const slottedBuildings = slotMap[op.id] ?? [];
    let effective = assigned;
    if (slottedBuildings.length > 0) {
      const totalSlots = slottedBuildings.reduce(
        (sum, bId) => sum + (buildings[bId] ?? 0), 0
      );
      effective = Math.min(assigned, totalSlots);
    }
    if (effective === 0) continue;

    // 1. Direct operative income (hunters, miners, etc.)
    for (const [res, rate] of Object.entries(op.income_per_tick ?? {})) {
      addTo(income, res, rate * effective);
    }

    // 2. Building-slot income (polymer_tech → polymer_plant.income_per_worker)
    for (const bId of slottedBuildings) {
      const building = ruleset.buildings.find((b) => b.id === bId);
      if (!building?.income_per_worker) continue;
      const bCount  = buildings[bId] ?? 0;
      const bEff    = Math.min(effective, bCount);
      for (const [res, rate] of Object.entries(building.income_per_worker)) {
        addTo(income, res, rate * bEff);
      }
    }

    // 3. Upkeep (all assigned workers pay upkeep, not just effective)
    for (const [res, rate] of Object.entries(op.upkeep_per_tick ?? {})) {
      addTo(upkeep, res, rate * assigned);
    }
  }

  return { income, upkeep };
}

// ─── Apply pending ticks ──────────────────────────────────────────────────────

/**
 * Calculate how many ticks have elapsed, apply income + upkeep to the DB,
 * and return the updated state.
 *
 * Safe to call every request — a no-op if < 1 tick has elapsed.
 * Only runs when campaign status is 'active'.
 */
export async function applyPendingTicks(campaignPlayer, rawRows, ruleset, campaignStatus) {
  const state = reconstructState(rawRows);

  // Don't tick if campaign hasn't started
  if (campaignStatus !== 'active') {
    return { state, ticks: 0 };
  }

  const now        = new Date();
  const lastTick   = campaignPlayer.last_tick_at
    ? new Date(campaignPlayer.last_tick_at)
    : now;
  const intervalMs = DEFAULT_TICK_SECONDS * 1000;
  const ticks      = Math.floor((now - lastTick) / intervalMs);

  if (ticks === 0) return { state, ticks: 0 };

  const { income, upkeep } = calculateRates(state, ruleset);

  // Build a resource max lookup for capping stores
  const maxStore = {};
  for (const r of (ruleset.resources ?? [])) {
    maxStore[r.id] = r.max_store ?? Infinity;
  }

  // Calculate deltas
  const updates = {};

  for (const [res, rate] of Object.entries(income)) {
    const current = state.stores[res] ?? 0;
    const cap     = maxStore[res] ?? Infinity;
    updates[`stores.${res}`] = String(Math.min(current + rate * ticks, cap));
  }

  for (const [res, rate] of Object.entries(upkeep)) {
    const key     = `stores.${res}`;
    const current = parseFloat(updates[key] ?? state.stores[res] ?? 0);
    updates[key]  = String(Math.max(current - rate * ticks, 0));
  }

  // Upsert all changed rows
  for (const [key, value] of Object.entries(updates)) {
    await knex('empire_state')
      .insert({ campaign_player_id: campaignPlayer.id, key, value, updated_at: now })
      .onConflict(['campaign_player_id', 'key'])
      .merge({ value, updated_at: now });

    // Update in-memory state too
    const dot  = key.indexOf('.');
    const ns   = key.slice(0, dot);
    const name = key.slice(dot + 1);
    if (state[ns]) state[ns][name] = parseFloat(value);
  }

  await knex('campaign_players')
    .where({ id: campaignPlayer.id })
    .update({ last_tick_at: now });

  return { state, ticks };
}
