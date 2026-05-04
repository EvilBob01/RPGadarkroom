/**
 * Ruleset routes — /api/rulesets
 *
 * GET /api/rulesets        List all available rulesets (summary)
 * GET /api/rulesets/:id    Full ruleset data (resources, buildings, factions, etc.)
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listRulesets, loadRuleset, rulesetExists } from '../services/ruleset.js';

const router = Router();

// ─── GET /api/rulesets ────────────────────────────────────────────────────────
router.get('/', requireAuth, (_req, res) => {
  try {
    const rulesets = listRulesets();
    return res.json({ rulesets });
  } catch (err) {
    console.error('[rulesets/list]', err);
    return res.status(500).json({ error: 'Failed to list rulesets.' });
  }
});

// ─── GET /api/rulesets/:id ────────────────────────────────────────────────────
router.get('/:id', requireAuth, (req, res) => {
  try {
    if (!rulesetExists(req.params.id)) {
      return res.status(404).json({ error: `Ruleset "${req.params.id}" not found.` });
    }
    const ruleset = loadRuleset(req.params.id);
    return res.json({ ruleset });
  } catch (err) {
    console.error('[rulesets/get]', err);
    return res.status(500).json({ error: 'Failed to load ruleset.' });
  }
});

export default router;
