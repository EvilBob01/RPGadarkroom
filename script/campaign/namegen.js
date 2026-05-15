/**
 * Name generators for campaigns and empires.
 * Theme-aware for empire names; generic epic style for campaign names.
 */

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ── Campaign names ────────────────────────────────────────────────────────────
const CAMPAIGN_PREFIXES = [
  'The', 'Operation', 'War of the', 'The Fall of', 'Rise of the',
  'Battle for', 'Conquest of', 'Chronicle of', 'The Age of', 'Siege of',
];

const CAMPAIGN_ADJECTIVES = [
  'Iron', 'Crimson', 'Silent', 'Forgotten', 'Shattered', 'Ancient',
  'Dark', 'Hollow', 'Eternal', 'Burning', 'Lost', 'Final', 'Broken',
  'Dying', 'Risen', 'Sunken', 'Cursed', 'Forsaken', 'Bloody', 'Cold',
];

const CAMPAIGN_NOUNS = [
  'Crusade', 'Storm', 'Reckoning', 'Dawn', 'Accord', 'Front', 'Throne',
  'Compact', 'Tide', 'Veil', 'Vigil', 'March', 'Pact', 'Siege', 'Hour',
  'Shadow', 'Sun', 'Flame', 'Void', 'Covenant', 'Passage', 'Gate',
];

export function generateCampaignName() {
  const roll = Math.random();
  if (roll < 0.4) {
    // "The Crimson Storm"
    return `${pick(CAMPAIGN_PREFIXES)} ${pick(CAMPAIGN_ADJECTIVES)} ${pick(CAMPAIGN_NOUNS)}`;
  } else if (roll < 0.7) {
    // "Operation Iron Dawn"
    return `Operation ${pick(CAMPAIGN_ADJECTIVES)} ${pick(CAMPAIGN_NOUNS)}`;
  } else {
    // "The Reckoning" / "Crimson Tide"
    return Math.random() < 0.5
      ? `The ${pick(CAMPAIGN_ADJECTIVES)} ${pick(CAMPAIGN_NOUNS)}`
      : `${pick(CAMPAIGN_ADJECTIVES)} ${pick(CAMPAIGN_NOUNS)}`;
  }
}

// ── Empire names — Space theme (Epic Warpath) ─────────────────────────────────
const SPACE_PREFIX = [
  'Iron', 'Void', 'Steel', 'Shadow', 'Nova', 'Forge', 'Dark', 'Crimson',
  'Silent', 'Obsidian', 'Null', 'Burning', 'Storm', 'Hollow', 'Eternal',
  'Chrome', 'Onyx', 'Shattered', 'Phantom', 'Binary',
];

const SPACE_SUFFIX = [
  'Dominion', 'Imperium', 'Covenant', 'Collective', 'Alliance', 'Compact',
  'Hegemony', 'Protectorate', 'Conclave', 'Order', 'Sovereignty', 'Accord',
  'Syndicate', 'Directorate', 'Authority', 'Assembly', 'Front', 'Vanguard',
];

// ── Empire names — Fantasy / Age of Sail (Blood & Plunder) ───────────────────
const SAIL_ADJECTIVE = [
  'Black', 'Silver', 'Golden', 'Storm', 'Crimson', 'Sea', 'Red', 'Dark',
  'Thunder', 'Iron', 'Salt', 'Broken', 'Sunken', 'Tattered', 'Bloody',
  'Cursed', 'Jade', 'Copper', 'Pale', 'Scarlet',
];

const SAIL_NOUN = [
  'Coast', 'Company', 'Fleet', 'Brotherhood', 'Covenant', 'Republic',
  'Syndicate', 'League', 'Council', 'Accord', 'Tide', 'Horizon', 'Shore',
  'Harbour', 'Banner', 'Flag', 'Wake', 'Gale', 'Reef', 'Passage',
];

// ── Generic / neutral names (for when theme is unknown) ───────────────────────
const NEUTRAL_PREFIX = [
  'Iron', 'Crimson', 'Silent', 'Storm', 'Dark', 'Golden', 'Shadow',
  'Steel', 'Obsidian', 'Silver', 'Burning', 'Hollow', 'Ancient', 'Forge',
];

const NEUTRAL_SUFFIX = [
  'Dominion', 'Covenant', 'Alliance', 'Company', 'Republic', 'Order',
  'League', 'Compact', 'Council', 'Brotherhood', 'Syndicate', 'Front',
];

/**
 * Generate an empire / colony name.
 * @param {string} theme - 'space' | 'fantasy' | undefined
 */
export function generateEmpireName(theme) {
  if (theme === 'space') {
    return `${pick(SPACE_PREFIX)} ${pick(SPACE_SUFFIX)}`;
  }
  if (theme === 'fantasy') {
    return `${pick(SAIL_ADJECTIVE)} ${pick(SAIL_NOUN)}`;
  }
  // Unknown theme — pick from neutral list
  return `${pick(NEUTRAL_PREFIX)} ${pick(NEUTRAL_SUFFIX)}`;
}
