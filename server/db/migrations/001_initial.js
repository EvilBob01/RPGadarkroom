/**
 * Migration 001 — Initial schema
 *
 * Creates all core tables for Phase 1:
 *   users, email_verifications, password_resets,
 *   campaigns, campaign_players, empire_state
 *
 * Uses knex schema builder throughout so it works identically
 * on SQLite (dev), MariaDB/MySQL (standard), and PostgreSQL (large prod).
 */

export async function up(knex) {
  // ── Users ────────────────────────────────────────────────────────────────
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('username', 50).notNullable().unique();
    t.string('email', 255).notNullable().unique();
    t.string('password_hash', 255).notNullable();
    // role: 'player' | 'gm' | 'admin'
    t.string('role', 20).notNullable().defaultTo('player');
    t.boolean('email_verified').notNullable().defaultTo(false);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('last_login_at').nullable();
  });

  // ── Email verifications ───────────────────────────────────────────────────
  await knex.schema.createTable('email_verifications', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token', 128).notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamp('used_at').nullable();
  });

  // ── Password resets ───────────────────────────────────────────────────────
  await knex.schema.createTable('password_resets', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token', 128).notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamp('used_at').nullable();
  });

  // ── Campaigns ─────────────────────────────────────────────────────────────
  await knex.schema.createTable('campaigns', (t) => {
    t.increments('id').primary();
    t.string('name', 100).notNullable();
    // ruleset_id matches the folder name under /rulesets (e.g. 'epic-warpath')
    t.string('ruleset_id', 50).notNullable();
    // theme: 'space' | 'fantasy'
    t.string('theme', 20).notNullable();
    t.integer('gm_user_id').notNullable().references('id').inTable('users');
    // status: 'setup' | 'active' | 'paused' | 'ended'
    t.string('status', 20).notNullable().defaultTo('setup');
    // JSON blob for campaign-level config (AP per day, map size, etc.)
    t.text('config').notNullable().defaultTo('{}');
    // Human-readable join code, e.g. "FIRE-LOCK-2049"
    t.string('invite_code', 30).notNullable().unique();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('started_at').nullable();
    t.timestamp('ended_at').nullable();
  });

  // ── Campaign players (one row = one player's empire in one campaign) ───────
  await knex.schema.createTable('campaign_players', (t) => {
    t.increments('id').primary();
    t.integer('campaign_id').notNullable().references('id').inTable('campaigns').onDelete('CASCADE');
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('empire_name', 80).notNullable();
    // Faction chosen from the ruleset (e.g. 'pirates', 'enforcers')
    t.string('faction', 50).nullable();
    // status: 'active' | 'eliminated' | 'withdrawn'
    t.string('status', 20).notNullable().defaultTo('active');
    // Remaining action points for today
    t.integer('action_points').notNullable().defaultTo(0);
    t.timestamp('last_ap_refresh').nullable();
    // Cumulative minutes played today (enforces session cap)
    t.integer('session_minutes_today').notNullable().defaultTo(0);
    t.timestamp('session_day_reset').nullable();
    t.timestamp('joined_at').defaultTo(knex.fn.now());
    // A player can only be in a campaign once
    t.unique(['campaign_id', 'user_id']);
  });

  // ── Empire state (key-value store for resources, buildings, workers) ───────
  // Each resource / building / worker count is one row keyed as:
  //   "stores.timber", "buildings.forge", "workers.smith", etc.
  await knex.schema.createTable('empire_state', (t) => {
    t.increments('id').primary();
    t.integer('campaign_player_id')
      .notNullable()
      .references('id')
      .inTable('campaign_players')
      .onDelete('CASCADE');
    t.string('key', 100).notNullable();
    // Value stored as text; application layer parses as float
    t.string('value', 50).notNullable().defaultTo('0');
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.unique(['campaign_player_id', 'key']);
  });

  // ── Sessions (managed by connect-session-knex) ───────────────────────────
  // connect-session-knex will create this table itself if missing, but
  // defining it here keeps schema management consistent.
  await knex.schema.createTable('sessions', (t) => {
    t.string('sid', 255).primary();
    t.text('sess').notNullable();
    t.timestamp('expired').notNullable().index();
  });
}

export async function down(knex) {
  // Drop in reverse dependency order
  await knex.schema.dropTableIfExists('sessions');
  await knex.schema.dropTableIfExists('empire_state');
  await knex.schema.dropTableIfExists('campaign_players');
  await knex.schema.dropTableIfExists('campaigns');
  await knex.schema.dropTableIfExists('password_resets');
  await knex.schema.dropTableIfExists('email_verifications');
  await knex.schema.dropTableIfExists('users');
}
