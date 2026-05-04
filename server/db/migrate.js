/**
 * Migration runner — called via:
 *   npm run migrate           → apply all pending migrations
 *   npm run migrate:rollback  → roll back the last batch
 */
import knex from './knex.js';

const command = process.argv[2] ?? 'latest';

try {
  if (command === 'rollback') {
    const [batch, migrations] = await knex.migrate.rollback();
    if (migrations.length === 0) {
      console.log('No migrations to roll back.');
    } else {
      console.log(`Rolled back batch ${batch}:`);
      migrations.forEach((m) => console.log(`  ✗ ${m}`));
    }
  } else {
    const [batch, migrations] = await knex.migrate.latest();
    if (migrations.length === 0) {
      console.log('Already up to date.');
    } else {
      console.log(`Applied batch ${batch}:`);
      migrations.forEach((m) => console.log(`  ✓ ${m}`));
    }
  }
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exit(1);
} finally {
  await knex.destroy();
}
