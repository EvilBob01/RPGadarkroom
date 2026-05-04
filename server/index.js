/**
 * Campaign Dark Room — Server Entry Point
 *
 * Starts the Express server, configures middleware, mounts API routes,
 * and serves the static frontend.
 */
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

import express from 'express';
import session from 'express-session';

import { PORT, SESSION_SECRET, IS_DEV, PATHS, DB_CONFIG } from './config.js';
import knex from './db/knex.js';
import { warmCache } from './services/ruleset.js';

import authRoutes      from './routes/auth.js';
import campaignRoutes  from './routes/campaigns.js';
import rulesetRoutes   from './routes/rulesets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Session store ────────────────────────────────────────────────────────────
// connect-session-knex is CommonJS — use createRequire to import it.
const require = createRequire(import.meta.url);
const KnexSessionStore = require('connect-session-knex')(session);

const sessionStore = new KnexSessionStore({
  knex,
  tablename: 'sessions',
  createtable: false,   // we manage the table in our migration
  clearInterval: 60 * 60 * 1000,   // clear expired sessions every hour
});

// ─── App setup ────────────────────────────────────────────────────────────────
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(session({
  store:             sessionStore,
  secret:            SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   !IS_DEV,        // HTTPS only in production
    sameSite: 'lax',
    maxAge:   7 * 24 * 60 * 60 * 1000,   // 7 days
  },
}));

// ─── API routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/rulesets',  rulesetRoutes);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', env: IS_DEV ? 'development' : 'production' });
});

// ─── Static frontend ──────────────────────────────────────────────────────────
// Serves the original A Dark Room frontend + future campaign UI from root.
app.use(express.static(PATHS.public));

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  // Return JSON for API requests, otherwise fall through to frontend.
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found.' });
  }
  // SPA fallback — serve index.html for client-side routes
  res.sendFile(path.join(PATHS.public, 'index.html'));
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[server error]', err);
  res.status(500).json({ error: IS_DEV ? err.message : 'Internal server error.' });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
async function start() {
  // Ensure data directory exists (for SQLite)
  if (DB_CONFIG.client === 'sqlite3') {
    const dbPath = DB_CONFIG.connection.filename;
    const dbDir  = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log(`[db] Created data directory: ${dbDir}`);
    }
  }

  // Run pending migrations automatically on startup
  try {
    const [batch, migrations] = await knex.migrate.latest();
    if (migrations.length > 0) {
      console.log(`[db] Applied ${migrations.length} migration(s) in batch ${batch}`);
    } else {
      console.log('[db] Database schema is up to date');
    }
  } catch (err) {
    console.error('[db] Migration failed — server cannot start:', err.message);
    process.exit(1);
  }

  // Pre-load all rulesets into memory
  warmCache();

  app.listen(PORT, () => {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  Campaign Dark Room`);
    console.log(`  Listening on http://localhost:${PORT}`);
    console.log(`  Mode: ${IS_DEV ? 'development' : 'production'}`);
    console.log(`  DB:   ${DB_CONFIG.client}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  });
}

start();
