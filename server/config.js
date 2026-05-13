import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── Server ───────────────────────────────────────────────────────────────────
export const PORT        = parseInt(process.env.PORT ?? '3000', 10);
export const NODE_ENV    = process.env.NODE_ENV ?? 'development';
export const IS_DEV      = NODE_ENV === 'development';
export const APP_URL     = process.env.APP_URL ?? `http://localhost:${PORT}`;

// ─── Session ──────────────────────────────────────────────────────────────────
export const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev_secret_change_me';

if (!IS_DEV && SESSION_SECRET === 'dev_secret_change_me') {
  throw new Error('SESSION_SECRET must be set in production');
}

// ─── Database ─────────────────────────────────────────────────────────────────
// DB_CLIENT options: better-sqlite3 | mysql2 | pg
const DB_CLIENT = process.env.DB_CLIENT ?? 'better-sqlite3';

// Both SQLite drivers use a local file; all others use a TCP connection.
const IS_SQLITE = DB_CLIENT === 'better-sqlite3' || DB_CLIENT === 'sqlite3';

function buildDbConnection() {
  if (IS_SQLITE) {
    const filename = process.env.DB_FILENAME ?? path.join(ROOT, 'data', 'campaign.sqlite');
    return { filename };
  }
  // MariaDB (mysql2) or PostgreSQL (pg) share the same connection shape
  return {
    host:     process.env.DB_HOST     ?? 'localhost',
    port:     parseInt(process.env.DB_PORT ?? (DB_CLIENT === 'pg' ? '5432' : '3306'), 10),
    database: process.env.DB_NAME     ?? 'campaign_darkroom',
    user:     process.env.DB_USER     ?? 'campaign_user',
    password: process.env.DB_PASSWORD ?? '',
  };
}

export const DB_CONFIG = {
  client:     DB_CLIENT,
  connection: buildDbConnection(),
  useNullAsDefault: IS_SQLITE,   // required for SQLite (both drivers)
  pool: IS_SQLITE
    ? { min: 1, max: 1 }         // SQLite is single-connection
    : { min: 2, max: 20 },
  migrations: {
    directory: path.join(ROOT, 'server', 'db', 'migrations'),
    extension: 'js',
  },
};

// ─── Email ────────────────────────────────────────────────────────────────────
export const MAIL = {
  driver:   process.env.MAIL_DRIVER   ?? 'console',
  host:     process.env.MAIL_HOST     ?? '',
  port:     parseInt(process.env.MAIL_PORT ?? '587', 10),
  user:     process.env.MAIL_USER     ?? '',
  password: process.env.MAIL_PASSWORD ?? '',
  from:     process.env.MAIL_FROM     ?? 'Campaign Dark Room <noreply@example.com>',
};

// ─── Paths ────────────────────────────────────────────────────────────────────
export const PATHS = {
  root:      ROOT,
  rulesets:  path.join(ROOT, 'rulesets'),
  public:    ROOT,   // express.static root (serves legacy frontend)
};
