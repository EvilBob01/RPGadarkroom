/**
 * Empire routes — /api/empire/:campaignId
 *
 * GET  /api/empire/:campaignId            Full empire state (applies ticks first)
 * POST /api/empire/:campaignId/build      Build or demolish a building
 * POST /api/empire/:campaignId/workers    Assign or unassign a worker
 * GET  /api/empire/:campaignId/income     Income/upkeep preview (no state change)
 */
import { Router } from 'express';
import knex from '../db/knex.js';
import { requireAuth } from '../middleware/auth.js';
import { loadRuleset } from '../services/ruleset.js';
import {
  applyPendingTicks,
  reconstructState,
  calculateRates,
  getPopulationCapacity,
  getTotalWorkers,
} from '../services/tick.js';
import {
  refreshAPIfNeeded,
  spendAP,
  getAPCost,
} from '../services/actionPoints.js';

const router = Router();
router.use(requireAuth);

// ─── Middleware: resolve campaignPlayer ───────────────────────────────────────

async function resolveCampaignPlayer(req, res, next) {
  const campaign = await knex('campaigns')
    .where({ id: req.params.campaignId })
    .first();

  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });

  const cp = await knex('campaign_players')
    .where({ campaign_id: campaign.id, user_id: req.user.id })
    .first();

  if (!cp) {
    return res.status(403).json({ error: 'You are not a member of this campaign.' });
  }
  if (cp.status === 'eliminated') {
    return res.status(403).json({ error: 'Your empire has been eliminated.' });
  }

  req.campaign       = campaign;
  req.campaignConfig = JSON.parse(campaign.config ?? '{}');
  req.campaignPlayer = cp;
  next();
}

// ─── GET /api/empire/:campaignId ─────────────────────────────────────────────
router.get('/:campaignId', resolveCampaignPlayer, async (req, res) => {
  try {
    let cp = req.campaignPlayer;

    // Refresh daily AP if the window has passed
    cp = await refreshAPIfNeeded(cp, req.campaignConfig);

    // Load raw empire state rows
    const rows = await knex('empire_state')
      .where({ campaign_player_id: cp.id });

    // Apply any pending income ticks
    const ruleset = loadRuleset(req.campaign.ruleset_id);
    const { state } = await applyPendingTicks(cp, rows, ruleset, req.campaign.status);

    // Calculate live income/upkeep rates for display
    const { income, upkeep } = calculateRates(state, ruleset);
    const popCap    = getPopulationCapacity(state.buildings, ruleset);
    const popUsed   = getTotalWorkers(state.workers);

    return res.json({
      player: {
        id:                    cp.id,
        empire_name:           cp.empire_name,
        faction:               cp.faction,
        action_points:         cp.action_points,
        action_points_max:     req.campaignConfig.action_points_per_day ?? 100,
        session_minutes_today: cp.session_minutes_today ?? 0,
        session_minutes_max:   req.campaignConfig.max_session_minutes ?? 120,
        status:                cp.status,
      },
      stores:    state.stores,
      buildings: state.buildings,
      workers:   state.workers,
      population: { capacity: popCap, used: popUsed },
      income,
      upkeep,
      campaign: {
        id:        req.campaign.id,
        name:      req.campaign.name,
        status:    req.campaign.status,
        ruleset_id: req.campaign.ruleset_id,
        theme:     req.campaign.theme,
      },
    });
  } catch (err) {
    console.error('[empire/get]', err);
    return res.status(500).json({ error: 'Failed to fetch empire state.' });
  }
});

// ─── POST /api/empire/:campaignId/build ──────────────────────────────────────
router.post('/:campaignId/build', resolveCampaignPlayer, async (req, res) => {
  try {
    const { building_id, action = 'build' } = req.body ?? {};

    if (!building_id) return res.status(400).json({ error: 'building_id is required.' });
    if (!['build', 'demolish'].includes(action)) {
      return res.status(400).json({ error: 'action must be "build" or "demolish".' });
    }

    const ruleset  = loadRuleset(req.campaign.ruleset_id);
    const building = (ruleset.buildings ?? []).find((b) => b.id === building_id);

    if (!building) {
      return res.status(400).json({ error: `Unknown building: "${building_id}".` });
    }

    // Load current state (apply ticks first so costs are checked against current resources)
    let cp   = req.campaignPlayer;
    cp       = await refreshAPIfNeeded(cp, req.campaignConfig);
    const rows  = await knex('empire_state').where({ campaign_player_id: cp.id });
    const { state } = await applyPendingTicks(cp, rows, ruleset, req.campaign.status);

    const currentCount = state.buildings[building_id] ?? 0;

    if (action === 'build') {
      // Check maximum
      if (building.max_count && currentCount >= building.max_count) {
        return res.status(400).json({
          error: `You already have the maximum number of ${building.name} (${building.max_count}).`,
        });
      }

      // Check AP
      const apResult = await spendAP(cp, req.campaignConfig, 'build_building');
      if (!apResult.ok) return res.status(400).json({ error: apResult.error });

      // Check resource costs
      const cost = building.cost ?? {};
      for (const [res, amount] of Object.entries(cost)) {
        const have = state.stores[res] ?? 0;
        if (have < amount) {
          // Refund AP
          await knex('campaign_players').where({ id: cp.id })
            .update({ action_points: apResult.remaining + getAPCost('build_building', req.campaignConfig) });
          return res.status(400).json({
            error: `Not enough ${res}. Need ${amount}, have ${Math.floor(have)}.`,
          });
        }
      }

      // Deduct resources
      const storeUpdates = [];
      for (const [res, amount] of Object.entries(cost)) {
        const newVal = String((state.stores[res] ?? 0) - amount);
        storeUpdates.push(
          knex('empire_state')
            .insert({ campaign_player_id: cp.id, key: `stores.${res}`, value: newVal, updated_at: new Date() })
            .onConflict(['campaign_player_id', 'key'])
            .merge({ value: newVal, updated_at: new Date() })
        );
      }

      // Increment building count
      const newCount = String(currentCount + 1);
      storeUpdates.push(
        knex('empire_state')
          .insert({ campaign_player_id: cp.id, key: `buildings.${building_id}`, value: newCount, updated_at: new Date() })
          .onConflict(['campaign_player_id', 'key'])
          .merge({ value: newCount, updated_at: new Date() })
      );

      await Promise.all(storeUpdates);

      return res.json({
        message:   `${building.name} constructed.`,
        building:  building_id,
        count:     currentCount + 1,
        ap_remaining: apResult.remaining,
      });

    } else {
      // Demolish — refund 50% of build cost (floored)
      if (currentCount === 0) {
        return res.status(400).json({ error: `You have no ${building.name} to demolish.` });
      }

      const cost = building.cost ?? {};
      const refundOps = [];
      const refundParts = [];

      for (const [res, amount] of Object.entries(cost)) {
        const refund  = Math.floor(amount * 0.5);
        if (refund <= 0) continue;
        const maxStore = (ruleset.resources ?? []).find((r) => r.id === res)?.max_store ?? Infinity;
        const current  = state.stores[res] ?? 0;
        const newVal   = String(Math.min(current + refund, maxStore));
        refundOps.push(
          knex('empire_state')
            .insert({ campaign_player_id: cp.id, key: `stores.${res}`, value: newVal, updated_at: new Date() })
            .onConflict(['campaign_player_id', 'key'])
            .merge({ value: newVal, updated_at: new Date() })
        );
        const resName = (ruleset.resources ?? []).find((r) => r.id === res)?.name ?? res;
        refundParts.push(`${refund} ${resName}`);
      }

      // Decrement building count
      refundOps.push(
        knex('empire_state')
          .insert({ campaign_player_id: cp.id, key: `buildings.${building_id}`, value: String(currentCount - 1), updated_at: new Date() })
          .onConflict(['campaign_player_id', 'key'])
          .merge({ value: String(currentCount - 1), updated_at: new Date() })
      );

      await Promise.all(refundOps);

      const refundMsg = refundParts.length ? ` Recovered: ${refundParts.join(', ')}.` : '';
      return res.json({
        message:  `${building.name} demolished.${refundMsg}`,
        building: building_id,
        count:    currentCount - 1,
        refund:   Object.fromEntries(
          Object.entries(cost).map(([r, a]) => [r, Math.floor(a * 0.5)])
        ),
      });
    }
  } catch (err) {
    console.error('[empire/build]', err);
    return res.status(500).json({ error: 'Build action failed.' });
  }
});

// ─── POST /api/empire/:campaignId/workers ────────────────────────────────────
router.post('/:campaignId/workers', resolveCampaignPlayer, async (req, res) => {
  try {
    const { operative_id, action = 'assign' } = req.body ?? {};

    if (!operative_id) return res.status(400).json({ error: 'operative_id is required.' });
    if (!['assign', 'unassign'].includes(action)) {
      return res.status(400).json({ error: 'action must be "assign" or "unassign".' });
    }

    const ruleset   = loadRuleset(req.campaign.ruleset_id);
    const operative = (ruleset.operatives ?? []).find((o) => o.id === operative_id);

    if (!operative) {
      return res.status(400).json({ error: `Unknown operative: "${operative_id}".` });
    }

    let cp = req.campaignPlayer;
    cp     = await refreshAPIfNeeded(cp, req.campaignConfig);
    const rows  = await knex('empire_state').where({ campaign_player_id: cp.id });
    const { state } = await applyPendingTicks(cp, rows, ruleset, req.campaign.status);

    const currentCount = state.workers[operative_id] ?? 0;
    const popCap       = getPopulationCapacity(state.buildings, ruleset);
    const popUsed      = getTotalWorkers(state.workers);

    if (action === 'assign') {
      // Population cap
      if (popUsed >= popCap) {
        return res.status(400).json({
          error: `Population capacity reached (${popCap}). Build more housing first.`,
        });
      }

      // Check the operative's required building exists (produced_at)
      const requiredBuilding = operative.produced_at;
      if (requiredBuilding) {
        const bCount = state.buildings[requiredBuilding] ?? 0;
        if (bCount === 0) {
          const b = (ruleset.buildings ?? []).find((b) => b.id === requiredBuilding);
          return res.status(400).json({
            error: `Requires a ${b?.name ?? requiredBuilding} before you can assign this operative.`,
          });
        }
      }

      // Spend AP
      const apResult = await spendAP(cp, req.campaignConfig, 'assign_worker');
      if (!apResult.ok) return res.status(400).json({ error: apResult.error });

      const newCount = String(currentCount + 1);
      await knex('empire_state')
        .insert({ campaign_player_id: cp.id, key: `workers.${operative_id}`, value: newCount, updated_at: new Date() })
        .onConflict(['campaign_player_id', 'key'])
        .merge({ value: newCount, updated_at: new Date() });

      return res.json({
        message:      `${operative.name} assigned.`,
        operative_id,
        count:        currentCount + 1,
        ap_remaining: apResult.remaining,
      });

    } else {
      // Unassign
      if (currentCount === 0) {
        return res.status(400).json({ error: `No ${operative.name} assigned to unassign.` });
      }

      const apResult = await spendAP(cp, req.campaignConfig, 'unassign_worker');
      if (!apResult.ok) return res.status(400).json({ error: apResult.error });

      const newCount = String(currentCount - 1);
      await knex('empire_state')
        .insert({ campaign_player_id: cp.id, key: `workers.${operative_id}`, value: newCount, updated_at: new Date() })
        .onConflict(['campaign_player_id', 'key'])
        .merge({ value: newCount, updated_at: new Date() });

      return res.json({
        message:      `${operative.name} unassigned.`,
        operative_id,
        count:        currentCount - 1,
        ap_remaining: apResult.remaining,
      });
    }
  } catch (err) {
    console.error('[empire/workers]', err);
    return res.status(500).json({ error: 'Worker action failed.' });
  }
});

// ─── GET /api/empire/:campaignId/income ──────────────────────────────────────
router.get('/:campaignId/income', resolveCampaignPlayer, async (req, res) => {
  try {
    const ruleset = loadRuleset(req.campaign.ruleset_id);
    const rows    = await knex('empire_state').where({ campaign_player_id: req.campaignPlayer.id });
    const state   = reconstructState(rows);
    const rates   = calculateRates(state, ruleset);

    return res.json({
      tick_seconds: 10,
      ...rates,
    });
  } catch (err) {
    console.error('[empire/income]', err);
    return res.status(500).json({ error: 'Failed to calculate income.' });
  }
});

export default router;
