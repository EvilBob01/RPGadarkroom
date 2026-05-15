/**
 * Migration 002 — Empire tick fields
 *
 * Adds last_tick_at to campaign_players so the lazy tick system can
 * calculate elapsed income without a running server-side interval.
 */

export async function up(knex) {
  await knex.schema.alterTable('campaign_players', (t) => {
    t.timestamp('last_tick_at').nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('campaign_players', (t) => {
    t.dropColumn('last_tick_at');
  });
}
