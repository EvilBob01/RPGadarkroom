import knexLib from 'knex';
import { DB_CONFIG } from '../config.js';

// Single shared Knex instance for the whole application.
// SQLite uses a pool of 1 (file-based, single-connection).
// MySQL / PostgreSQL use a real connection pool.
const knex = knexLib(DB_CONFIG);

export default knex;
