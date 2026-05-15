/**
 * Campaign routes — /api/campaigns
 *
 * POST   /api/campaigns               Create a new campaign (GM/admin only)
 * GET    /api/campaigns               List campaigns the current user belongs to
 * GET    /api/campaigns/:id           Get campaign details
 * POST   /api/campaigns/join          Join a campaign via invite code
 * GET    /api/campaigns/:id/players   List players in a campaign
 * PATCH  /api/campaigns/:id           Update campaign settings (GM/admin only)
 * POST   /api/campaigns/:id/start     Start a campaign (GM/admin only)
 * POST   /api/campaigns/:id/pause     Pause/unpause a campaign (GM/admin only)
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import knex from '../db/knex.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { rulesetExists, loadRuleset } from '../services/ruleset.js';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a human-readable invite code like "FIRE-LOCK-2049"
 * Uses alphanumeric characters only; avoids ambiguous chars (0/O, 1/I/l).
 */
function generateInviteCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const seg = (len) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${seg(4)}-${seg(4)}-${seg(4)}`;
}

/**
 * Default campaign config values (can be overridden by GM at creation).
 */
function defaultConfig(overrides = {}) {
  return {
    max_players:            20,
    action_points_per_day:  100,
    ap_refresh_hour_utc:    6,
    max_session_minutes:    120,
    map_size:               'medium',    // small | medium | large | huge
    fog_of_war:             true,
    friendly_fire:          false,
    victory_condition:      'domination', // domination | score | time_limit
    ...overrides,
  };
}

/**
 * Seed starting resources for a new empire based on the ruleset.
 */
async function seedEmpireState(campaignPlayerId, rulesetId) {
  const ruleset = loadRuleset(rulesetId);
  const starting = ruleset.balance?.starting_resources ?? {};

  if (Object.keys(starting).length === 0) return;

  const rows = Object.entries(starting).map(([key, value]) => ({
    campaign_player_id: campaignPlayerId,
    key:                `stores.${key}`,
    value:              String(value),
  }));

  await knex('empire_state').insert(rows);
}

/**
 * Pull a campaign row and verify the requesting user is the GM or an admin.
 */
async function assertGMAccess(campaignId, userId, role) {
  const campaign = await knex('campaigns').where({ id: campaignId }).first();
  if (!campaign) return { error: 'Campaign not found.', status: 404 };
  if (campaign.gm_user_id !== userId && role !== 'admin') {
    return { error: 'Only the campaign GM or an admin can perform this action.', status: 403 };
  }
  return { campaign };
}

// ─── POST /api/campaigns ──────────────────────────────────────────────────────
router.post('/', requireAuth, requireRole('gm', 'admin'), async (req, res) => {
  try {
    const { name, ruleset_id, config: configOverrides = {} } = req.body ?? {};

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'Campaign name must be at least 2 characters.' });
    }
    if (!ruleset_id) {
      return res.status(400).json({ error: 'ruleset_id is required.' });
    }
    if (!rulesetExists(ruleset_id)) {
      return res.status(400).json({ error: `Unknown ruleset: "${ruleset_id}".` });
    }

    const ruleset = loadRuleset(ruleset_id);
    const config  = defaultConfig(configOverrides);

    // Ensure invite code is unique (retry on collision)
    let invite_code;
    for (let i = 0; i < 10; i++) {
      const candidate = generateInviteCode();
      const exists = await knex('campaigns').where({ invite_code: candidate }).first();
      if (!exists) { invite_code = candidate; break; }
    }
    if (!invite_code) {
      return res.status(500).json({ error: 'Failed to generate unique invite code. Please try again.' });
    }

    const [id] = await knex('campaigns').insert({
      name:        name.trim(),
      ruleset_id,
      theme:       ruleset.meta.theme,
      gm_user_id:  req.user.id,
      status:      'setup',
      config:      JSON.stringify(config),
      invite_code,
    });

    const campaign = await knex('campaigns').where({ id }).first();

    return res.status(201).json({
      message:  'Campaign created.',
      campaign: { ...campaign, config: JSON.parse(campaign.config) },
    });
  } catch (err) {
    console.error('[campaigns/create]', err);
    return res.status(500).json({ error: 'Failed to create campaign.' });
  }
});

// ─── GET /api/campaigns ───────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    // Player entries take priority — they carry empire_name + faction.
    // GM-only entries (no player row yet) are added after.
    const asPlayer = await knex('campaigns')
      .join('campaign_players', 'campaigns.id', 'campaign_players.campaign_id')
      .where('campaign_players.user_id', req.user.id)
      .select(
        'campaigns.*',
        'campaign_players.empire_name',
        'campaign_players.faction',
        'campaign_players.id as cp_id',
      );

    const asGM = await knex('campaigns')
      .where({ gm_user_id: req.user.id })
      .select('*');

    // Use a Set of GM campaign IDs for reliable is_gm detection (avoids
    // integer vs string type mismatch from session vs DB comparisons).
    const gmCampaignIds = new Set(asGM.map((c) => c.id));

    // Build map from player entries first (they have empire_name)
    const map = new Map();
    for (const c of asPlayer) {
      map.set(c.id, {
        ...c,
        is_gm:  gmCampaignIds.has(c.id),
        config: JSON.parse(c.config ?? '{}'),
      });
    }
    // Add GM-only campaigns the user hasn't joined as a player yet
    for (const c of asGM) {
      if (!map.has(c.id)) {
        map.set(c.id, {
          ...c,
          is_gm:       true,
          empire_name: null,
          faction:     null,
          config:      JSON.parse(c.config ?? '{}'),
        });
      }
    }

    return res.json({ campaigns: [...map.values()] });
  } catch (err) {
    console.error('[campaigns/list]', err);
    return res.status(500).json({ error: 'Failed to list campaigns.' });
  }
});

// ─── GET /api/campaigns/:id ───────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const campaign = await knex('campaigns').where({ id: req.params.id }).first();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });

    // Only members and the GM can view a campaign
    const isMember = await knex('campaign_players')
      .where({ campaign_id: campaign.id, user_id: req.user.id })
      .first();

    if (!isMember && campaign.gm_user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You are not a member of this campaign.' });
    }

    return res.json({ campaign: { ...campaign, config: JSON.parse(campaign.config ?? '{}') } });
  } catch (err) {
    console.error('[campaigns/get]', err);
    return res.status(500).json({ error: 'Failed to fetch campaign.' });
  }
});

// ─── POST /api/campaigns/join ─────────────────────────────────────────────────
router.post('/join', requireAuth, async (req, res) => {
  try {
    const { code, empire_name, faction } = req.body ?? {};

    if (!code) return res.status(400).json({ error: 'Invite code is required.' });
    if (!empire_name || empire_name.trim().length < 2) {
      return res.status(400).json({ error: 'Empire name must be at least 2 characters.' });
    }

    const campaign = await knex('campaigns')
      .where({ invite_code: code.trim().toUpperCase() })
      .first();

    if (!campaign) return res.status(404).json({ error: 'Invalid invite code.' });
    if (campaign.status === 'ended') {
      return res.status(400).json({ error: 'This campaign has ended.' });
    }

    // Prevent duplicate membership
    const already = await knex('campaign_players')
      .where({ campaign_id: campaign.id, user_id: req.user.id })
      .first();
    if (already) {
      return res.status(409).json({ error: 'You are already a member of this campaign.' });
    }

    // Respect max_players limit
    const config      = JSON.parse(campaign.config ?? '{}');
    const playerCount = await knex('campaign_players')
      .where({ campaign_id: campaign.id })
      .count('id as n')
      .first();

    if (config.max_players && Number(playerCount.n) >= config.max_players) {
      return res.status(400).json({ error: 'This campaign is full.' });
    }

    // Validate faction if provided
    if (faction) {
      const ruleset = loadRuleset(campaign.ruleset_id);
      const validFactions = (ruleset.factions ?? []).map((f) => f.id);
      if (!validFactions.includes(faction)) {
        return res.status(400).json({ error: `Unknown faction: "${faction}". Valid options: ${validFactions.join(', ')}` });
      }
    }

    const [cpId] = await knex('campaign_players').insert({
      campaign_id:   campaign.id,
      user_id:       req.user.id,
      empire_name:   empire_name.trim(),
      faction:       faction ?? null,
      status:        'active',
      action_points: config.action_points_per_day ?? 100,
    });

    await seedEmpireState(cpId, campaign.ruleset_id);

    const cp = await knex('campaign_players').where({ id: cpId }).first();

    return res.status(201).json({
      message:         'Joined campaign successfully.',
      campaign_player: cp,
      campaign:        { ...campaign, config },
    });
  } catch (err) {
    console.error('[campaigns/join]', err);
    return res.status(500).json({ error: 'Failed to join campaign.' });
  }
});

// ─── GET /api/campaigns/:id/players ──────────────────────────────────────────
router.get('/:id/players', requireAuth, async (req, res) => {
  try {
    const campaign = await knex('campaigns').where({ id: req.params.id }).first();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });

    const isMember = await knex('campaign_players')
      .where({ campaign_id: campaign.id, user_id: req.user.id })
      .first();

    if (!isMember && campaign.gm_user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You are not a member of this campaign.' });
    }

    const players = await knex('campaign_players')
      .join('users', 'campaign_players.user_id', 'users.id')
      .where('campaign_players.campaign_id', campaign.id)
      .select(
        'campaign_players.id',
        'campaign_players.empire_name',
        'campaign_players.faction',
        'campaign_players.status',
        'campaign_players.action_points',
        'campaign_players.joined_at',
        'users.username',
      );

    return res.json({ players });
  } catch (err) {
    console.error('[campaigns/players]', err);
    return res.status(500).json({ error: 'Failed to fetch players.' });
  }
});

// ─── PATCH /api/campaigns/:id ─────────────────────────────────────────────────
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { campaign, error, status } = await assertGMAccess(req.params.id, req.user.id, req.user.role);
    if (error) return res.status(status).json({ error });

    if (campaign.status === 'ended') {
      return res.status(400).json({ error: 'Cannot modify an ended campaign.' });
    }

    const allowed = ['name', 'config'];
    const updates = {};

    if (req.body.name) {
      if (req.body.name.trim().length < 2) {
        return res.status(400).json({ error: 'Campaign name must be at least 2 characters.' });
      }
      updates.name = req.body.name.trim();
    }

    if (req.body.config && typeof req.body.config === 'object') {
      const existing = JSON.parse(campaign.config ?? '{}');
      updates.config = JSON.stringify({ ...existing, ...req.body.config });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update.' });
    }

    await knex('campaigns').where({ id: campaign.id }).update(updates);
    const updated = await knex('campaigns').where({ id: campaign.id }).first();

    return res.json({
      message:  'Campaign updated.',
      campaign: { ...updated, config: JSON.parse(updated.config ?? '{}') },
    });
  } catch (err) {
    console.error('[campaigns/update]', err);
    return res.status(500).json({ error: 'Failed to update campaign.' });
  }
});

// ─── POST /api/campaigns/:id/start ───────────────────────────────────────────
router.post('/:id/start', requireAuth, async (req, res) => {
  try {
    const { campaign, error, status } = await assertGMAccess(req.params.id, req.user.id, req.user.role);
    if (error) return res.status(status).json({ error });

    if (campaign.status !== 'setup') {
      return res.status(400).json({ error: `Campaign is already ${campaign.status}.` });
    }

    const playerCount = await knex('campaign_players')
      .where({ campaign_id: campaign.id })
      .count('id as n')
      .first();

    if (Number(playerCount.n) < 2) {
      return res.status(400).json({ error: 'A campaign needs at least 2 players to start.' });
    }

    await knex('campaigns').where({ id: campaign.id }).update({
      status:     'active',
      started_at: new Date(),
    });

    return res.json({ message: 'Campaign started!', status: 'active' });
  } catch (err) {
    console.error('[campaigns/start]', err);
    return res.status(500).json({ error: 'Failed to start campaign.' });
  }
});

// ─── POST /api/campaigns/:id/pause ───────────────────────────────────────────
router.post('/:id/pause', requireAuth, async (req, res) => {
  try {
    const { campaign, error, status } = await assertGMAccess(req.params.id, req.user.id, req.user.role);
    if (error) return res.status(status).json({ error });

    if (!['active', 'paused'].includes(campaign.status)) {
      return res.status(400).json({ error: `Cannot pause/unpause a campaign with status "${campaign.status}".` });
    }

    const newStatus = campaign.status === 'active' ? 'paused' : 'active';
    await knex('campaigns').where({ id: campaign.id }).update({ status: newStatus });

    return res.json({ message: `Campaign ${newStatus}.`, status: newStatus });
  } catch (err) {
    console.error('[campaigns/pause]', err);
    return res.status(500).json({ error: 'Failed to update campaign status.' });
  }
});

export default router;
