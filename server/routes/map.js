/**
 * Map routes — /api/map
 *
 * GET  /api/map/:campaignId            Return chunk data for the campaign map.
 * POST /api/map/:campaignId/regenerate Wipe and regenerate the map (GM/admin only).
 *
 * Each chunk has a fog level:
 *   0 = never seen (black — no data returned)
 *   1 = historically seen but outside current vision (biome only, no owner)
 *   2 = currently visible (full data)
 *
 * GMs see all chunks at fog=2.
 */
import { Router } from 'express';
import knex from '../db/knex.js';
import { requireAuth } from '../middleware/auth.js';
import { updateVisibility, generateMap } from '../services/mapgen.js';

const router = Router();
router.use(requireAuth);

const MAP_SIZES = { small: 10, medium: 15, large: 20, huge: 25 };

router.get('/:campaignId', async (req, res) => {
  try {
    const campaign = await knex('campaigns').where({ id: req.params.campaignId }).first();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });

    const isGM = campaign.gm_user_id === req.user.id || req.user.role === 'admin';
    const cp   = await knex('campaign_players')
      .where({ campaign_id: campaign.id, user_id: req.user.id })
      .first();

    if (!cp && !isGM) {
      return res.status(403).json({ error: 'You are not a member of this campaign.' });
    }

    const config = JSON.parse(campaign.config ?? '{}');
    const size   = MAP_SIZES[config.map_size ?? 'medium'] ?? 15;

    const chunks = await knex('map_chunks')
      .where({ campaign_id: campaign.id })
      .select('x', 'y', 'biome_id', 'landmark_id', 'owner_cp_id', 'is_capital');

    if (chunks.length === 0) {
      return res.json({ size, chunks: [], my_cp_id: cp?.id ?? null, not_generated: true });
    }

    // ── Compute visibility ────────────────────────────────────────────────────
    let currentVisible = null;
    let historical     = null;

    if (!isGM && cp) {
      await updateVisibility(cp, campaign);

      // Current vision = owned chunks + 1-ring neighbours
      const owned = await knex('map_chunks')
        .where({ campaign_id: campaign.id, owner_cp_id: cp.id })
        .select('x', 'y');

      currentVisible = new Set();
      for (const { x, y } of owned) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
              currentVisible.add(`${nx},${ny}`);
            }
          }
        }
      }

      const visRows = await knex('map_visibility').where({ campaign_player_id: cp.id }).select('x', 'y');
      historical = new Set(visRows.map((r) => `${r.x},${r.y}`));
    }

    // ── Resolve owner names ───────────────────────────────────────────────────
    const ownerIds = [...new Set(chunks.map((c) => c.owner_cp_id).filter(Boolean))];
    const owners   = ownerIds.length
      ? await knex('campaign_players').whereIn('id', ownerIds).select('id', 'empire_name')
      : [];
    const ownerMap = Object.fromEntries(owners.map((o) => [o.id, o.empire_name]));

    // ── Build response ────────────────────────────────────────────────────────
    const result = chunks.map((chunk) => {
      const key = `${chunk.x},${chunk.y}`;
      let fog;
      if (!currentVisible) {
        fog = 2; // GM sees all
      } else if (currentVisible.has(key)) {
        fog = 2;
      } else if (historical.has(key)) {
        fog = 1;
      } else {
        fog = 0;
      }

      return {
        x:           chunk.x,
        y:           chunk.y,
        fog,
        biome_id:    fog > 0 ? chunk.biome_id    : null,
        landmark_id: fog === 2 ? chunk.landmark_id : null,
        owner_cp_id: fog === 2 ? chunk.owner_cp_id : null,
        owner_name:  fog === 2 && chunk.owner_cp_id ? (ownerMap[chunk.owner_cp_id] ?? null) : null,
        is_capital:  fog === 2 ? Boolean(chunk.is_capital) : false,
        is_mine:     cp ? chunk.owner_cp_id === cp.id : false,
      };
    });

    return res.json({ size, chunks: result, my_cp_id: cp?.id ?? null });
  } catch (err) {
    console.error('[map/get]', err);
    return res.status(500).json({ error: 'Failed to fetch map.' });
  }
});

// ─── POST /api/map/:campaignId/regenerate ────────────────────────────────────
router.post('/:campaignId/regenerate', async (req, res) => {
  try {
    const campaign = await knex('campaigns').where({ id: req.params.campaignId }).first();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });

    const isGM = campaign.gm_user_id === req.user.id || req.user.role === 'admin';
    if (!isGM) {
      return res.status(403).json({ error: 'Only the campaign GM or an admin can regenerate the map.' });
    }

    const campaignPlayers = await knex('campaign_players')
      .where({ campaign_id: campaign.id })
      .select('id', 'user_id');

    // Wipe existing map data for this campaign
    const cpIds = campaignPlayers.map((p) => p.id);
    if (cpIds.length > 0) {
      await knex('map_visibility').whereIn('campaign_player_id', cpIds).delete();
    }
    await knex('map_chunks').where({ campaign_id: campaign.id }).delete();

    // Regenerate (generateMap is now safe to call since we cleared the table)
    await generateMap(campaign, campaignPlayers);

    return res.json({ message: 'Map regenerated successfully.' });
  } catch (err) {
    console.error('[map/regenerate]', err);
    return res.status(500).json({ error: 'Failed to regenerate map.' });
  }
});

export default router;
