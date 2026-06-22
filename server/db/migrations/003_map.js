/**
 * Migration 003 — Campaign map tables
 *
 * map_chunks:     one row per grid cell per campaign
 * map_visibility: which cells each player has ever seen (persistent exploration)
 */

export async function up(knex) {
  await knex.schema.createTable('map_chunks', (t) => {
    t.increments('id').primary();
    t.integer('campaign_id').notNullable()
      .references('id').inTable('campaigns').onDelete('CASCADE');
    t.integer('x').notNullable();
    t.integer('y').notNullable();
    t.string('biome_id',    50).notNullable();
    t.string('landmark_id', 50).nullable();
    t.integer('owner_cp_id').nullable()
      .references('id').inTable('campaign_players').onDelete('SET NULL');
    t.boolean('is_capital').notNullable().defaultTo(false);
    t.unique(['campaign_id', 'x', 'y']);
  });

  await knex.schema.createTable('map_visibility', (t) => {
    t.increments('id').primary();
    t.integer('campaign_player_id').notNullable()
      .references('id').inTable('campaign_players').onDelete('CASCADE');
    t.integer('x').notNullable();
    t.integer('y').notNullable();
    t.unique(['campaign_player_id', 'x', 'y']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('map_visibility');
  await knex.schema.dropTableIfExists('map_chunks');
}
