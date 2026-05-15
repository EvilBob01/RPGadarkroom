/**
 * Action point service
 *
 * Handles:
 *  - Daily AP refresh (checks if a new refresh window has passed)
 *  - Session minute cap (tracks active play time today)
 *  - AP spending / validation
 *
 * AP costs (defaults, can be overridden in campaign config):
 *   build_building:     10
 *   demolish_building:   0
 *   assign_worker:       5
 *   unassign_worker:     2
 */
import knex from '../db/knex.js';

const DEFAULT_AP_COSTS = {
  build_building:    10,
  demolish_building:  0,
  assign_worker:      5,
  unassign_worker:    2,
};

// ─── Daily refresh ────────────────────────────────────────────────────────────

/**
 * Check whether the daily AP refresh has passed for this player and apply it
 * if needed.  Returns the updated campaign_player row.
 */
export async function refreshAPIfNeeded(campaignPlayer, campaignConfig) {
  const apPerDay      = campaignConfig.action_points_per_day ?? 100;
  const refreshHour   = campaignConfig.ap_refresh_hour_utc   ?? 6;
  const sessionMaxMin = campaignConfig.max_session_minutes   ?? 120;

  const now    = new Date();
  const lastAP = campaignPlayer.last_ap_refresh
    ? new Date(campaignPlayer.last_ap_refresh)
    : null;

  // Determine today's refresh timestamp (refreshHour:00 UTC)
  const todayRefresh = new Date(now);
  todayRefresh.setUTCHours(refreshHour, 0, 0, 0);
  if (todayRefresh > now) {
    // Refresh window hasn't arrived yet today — use yesterday's
    todayRefresh.setUTCDate(todayRefresh.getUTCDate() - 1);
  }

  const needsRefresh = !lastAP || lastAP < todayRefresh;

  if (needsRefresh) {
    await knex('campaign_players').where({ id: campaignPlayer.id }).update({
      action_points:         apPerDay,
      last_ap_refresh:       now,
      session_minutes_today: 0,
      session_day_reset:     now,
    });

    return {
      ...campaignPlayer,
      action_points:         apPerDay,
      last_ap_refresh:       now,
      session_minutes_today: 0,
    };
  }

  return campaignPlayer;
}

// ─── Session cap ──────────────────────────────────────────────────────────────

/**
 * Record that the player has been active for `minutes` more minutes today.
 * Returns { blocked: true } if they've hit the daily session cap.
 */
export async function recordSessionTime(campaignPlayer, campaignConfig, minutes = 1) {
  const sessionMaxMin = campaignConfig.max_session_minutes ?? 120;
  const current       = campaignPlayer.session_minutes_today ?? 0;

  if (current >= sessionMaxMin) {
    return { blocked: true, used: current, max: sessionMaxMin };
  }

  const updated = Math.min(current + minutes, sessionMaxMin);
  await knex('campaign_players')
    .where({ id: campaignPlayer.id })
    .update({ session_minutes_today: updated });

  return { blocked: updated >= sessionMaxMin, used: updated, max: sessionMaxMin };
}

// ─── AP spending ──────────────────────────────────────────────────────────────

/**
 * Get the AP cost for an action, respecting any campaign config overrides.
 */
export function getAPCost(action, campaignConfig) {
  const costs = { ...DEFAULT_AP_COSTS, ...(campaignConfig.ap_costs ?? {}) };
  return costs[action] ?? 0;
}

/**
 * Attempt to spend AP.  Returns { ok: true } or { ok: false, error }.
 * Applies the deduction to the DB if successful.
 */
export async function spendAP(campaignPlayer, campaignConfig, action) {
  const cost    = getAPCost(action, campaignConfig);
  const current = campaignPlayer.action_points ?? 0;

  if (cost === 0) return { ok: true, remaining: current };

  if (current < cost) {
    return {
      ok:    false,
      error: `Not enough action points. Need ${cost}, have ${current}.`,
    };
  }

  const remaining = current - cost;
  await knex('campaign_players')
    .where({ id: campaignPlayer.id })
    .update({ action_points: remaining });

  return { ok: true, remaining, cost };
}
