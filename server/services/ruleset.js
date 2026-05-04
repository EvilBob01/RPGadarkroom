/**
 * Ruleset service — loads and caches TOML ruleset files.
 *
 * Rulesets live under /rulesets/<id>/ruleset.toml
 * They are read once at startup and cached in memory.
 */
import fs from 'fs';
import path from 'path';
import { parse } from 'smol-toml';
import { PATHS } from '../config.js';

// In-memory cache: { [id]: parsedRuleset }
const _cache = new Map();

/**
 * Load a single ruleset by ID.
 * Throws if the file is missing or invalid.
 */
export function loadRuleset(id) {
  if (_cache.has(id)) return _cache.get(id);

  const filePath = path.join(PATHS.rulesets, id, 'ruleset.toml');

  if (!fs.existsSync(filePath)) {
    throw new Error(`Ruleset not found: ${id}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = parse(raw);
  _cache.set(id, parsed);
  return parsed;
}

/**
 * Return a summary list of all available rulesets.
 * Scans the /rulesets directory for sub-folders containing ruleset.toml
 */
export function listRulesets() {
  const entries = fs.readdirSync(PATHS.rulesets, { withFileTypes: true });

  return entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      try {
        const rs = loadRuleset(e.name);
        return {
          id:           rs.meta.id,
          name:         rs.meta.name,
          theme:        rs.meta.theme,
          tabletop_game: rs.meta.tabletop_game,
          version:      rs.meta.version,
          description:  rs.meta.description,
        };
      } catch {
        return null;   // skip malformed / incomplete rulesets
      }
    })
    .filter(Boolean);
}

/**
 * Validate that a ruleset ID actually exists.
 */
export function rulesetExists(id) {
  try {
    loadRuleset(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pre-warm the cache at startup so the first request isn't slow.
 */
export function warmCache() {
  const rulesets = listRulesets();
  console.log(`[ruleset] Loaded ${rulesets.length} ruleset(s): ${rulesets.map((r) => r.id).join(', ')}`);
}
