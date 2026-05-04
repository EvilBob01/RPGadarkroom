/**
 * Auth routes — /api/auth
 *
 * POST /api/auth/register        Create a new player account
 * POST /api/auth/login           Log in
 * POST /api/auth/logout          Log out
 * GET  /api/auth/me              Current user info
 * POST /api/auth/verify-email    Consume an email verification token
 * POST /api/auth/forgot-password Request a password reset email
 * POST /api/auth/reset-password  Consume a reset token and set new password
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import knex from '../db/knex.js';
import { requireAuth } from '../middleware/auth.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/email.js';

const router = Router();

const BCRYPT_ROUNDS      = 12;
const VERIFY_EXPIRY_MS   = 24 * 60 * 60 * 1000;   // 24 hours
const RESET_EXPIRY_MS    = 1  * 60 * 60 * 1000;   //  1 hour

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitize(user) {
  // Never return the password hash to the client
  const { password_hash, ...safe } = user;
  return safe;
}

function validateUsername(u) {
  if (!u || typeof u !== 'string') return 'Username is required.';
  if (u.length < 3 || u.length > 50) return 'Username must be 3–50 characters.';
  if (!/^[a-zA-Z0-9_\-]+$/.test(u)) return 'Username may only contain letters, numbers, _ and -.';
  return null;
}

function validateEmail(e) {
  if (!e || typeof e !== 'string') return 'Email is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'Invalid email address.';
  return null;
}

function validatePassword(p) {
  if (!p || typeof p !== 'string') return 'Password is required.';
  if (p.length < 8) return 'Password must be at least 8 characters.';
  return null;
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body ?? {};

    const usernameErr = validateUsername(username);
    if (usernameErr) return res.status(400).json({ error: usernameErr });

    const emailErr = validateEmail(email);
    if (emailErr) return res.status(400).json({ error: emailErr });

    const passwordErr = validatePassword(password);
    if (passwordErr) return res.status(400).json({ error: passwordErr });

    // Check uniqueness
    const existing = await knex('users')
      .where('username', username.trim())
      .orWhere('email', email.trim().toLowerCase())
      .first();

    if (existing) {
      const field = existing.username.toLowerCase() === username.trim().toLowerCase()
        ? 'Username'
        : 'Email';
      return res.status(409).json({ error: `${field} is already in use.` });
    }

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const [userId] = await knex('users').insert({
      username:      username.trim(),
      email:         email.trim().toLowerCase(),
      password_hash,
      role:          'player',
      email_verified: false,
    });

    // Create email verification token
    const token     = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + VERIFY_EXPIRY_MS);

    await knex('email_verifications').insert({
      user_id:    userId,
      token,
      expires_at: expiresAt,
    });

    const user = await knex('users').where({ id: userId }).first();

    await sendVerificationEmail(user, token);

    return res.status(201).json({
      message: 'Account created. Check your email to verify your address.',
      user:    sanitize(user),
    });
  } catch (err) {
    console.error('[auth/register]', err);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body ?? {};

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    // Allow login by username or email
    const user = await knex('users')
      .where('username', username.trim())
      .orWhere('email', username.trim().toLowerCase())
      .first();

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Update last login
    await knex('users').where({ id: user.id }).update({ last_login_at: new Date() });

    // Store minimal user info in session
    req.session.user = {
      id:             user.id,
      username:       user.username,
      email:          user.email,
      role:           user.role,
      email_verified: Boolean(user.email_verified),
    };

    return res.json({ user: sanitize(user) });
  } catch (err) {
    console.error('[auth/login]', err);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[auth/logout]', err);
      return res.status(500).json({ error: 'Logout failed.' });
    }
    res.clearCookie('connect.sid');
    return res.json({ message: 'Logged out successfully.' });
  });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await knex('users').where({ id: req.user.id }).first();
    if (!user) return res.status(404).json({ error: 'User not found.' });
    return res.json({ user: sanitize(user) });
  } catch (err) {
    console.error('[auth/me]', err);
    return res.status(500).json({ error: 'Failed to fetch user.' });
  }
});

// ─── POST /api/auth/verify-email ─────────────────────────────────────────────
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body ?? {};
    if (!token) return res.status(400).json({ error: 'Token is required.' });

    const record = await knex('email_verifications').where({ token }).first();

    if (!record) return res.status(400).json({ error: 'Invalid or expired token.' });
    if (record.used_at) return res.status(400).json({ error: 'Token already used.' });
    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Token has expired. Please request a new verification email.' });
    }

    await knex('email_verifications').where({ id: record.id }).update({ used_at: new Date() });
    await knex('users').where({ id: record.user_id }).update({ email_verified: true });

    // Refresh session if the user is currently logged in
    if (req.session?.user?.id === record.user_id) {
      req.session.user.email_verified = true;
    }

    return res.json({ message: 'Email verified successfully.' });
  } catch (err) {
    console.error('[auth/verify-email]', err);
    return res.status(500).json({ error: 'Verification failed.' });
  }
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body ?? {};
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const user = await knex('users').where({ email: email.trim().toLowerCase() }).first();

    // Always respond with success to prevent email enumeration
    if (!user) {
      return res.json({ message: 'If an account with that email exists, a reset link has been sent.' });
    }

    // Invalidate any existing reset tokens
    await knex('password_resets').where({ user_id: user.id, used_at: null }).delete();

    const token     = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + RESET_EXPIRY_MS);

    await knex('password_resets').insert({
      user_id:    user.id,
      token,
      expires_at: expiresAt,
    });

    await sendPasswordResetEmail(user, token);

    return res.json({ message: 'If an account with that email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('[auth/forgot-password]', err);
    return res.status(500).json({ error: 'Failed to process request.' });
  }
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body ?? {};
    if (!token) return res.status(400).json({ error: 'Token is required.' });

    const passwordErr = validatePassword(password);
    if (passwordErr) return res.status(400).json({ error: passwordErr });

    const record = await knex('password_resets').where({ token }).first();

    if (!record) return res.status(400).json({ error: 'Invalid or expired token.' });
    if (record.used_at) return res.status(400).json({ error: 'Token already used.' });
    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Token has expired. Please request a new reset.' });
    }

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await knex('users').where({ id: record.user_id }).update({ password_hash });
    await knex('password_resets').where({ id: record.id }).update({ used_at: new Date() });

    // Destroy any active sessions for this user (force re-login)
    // Note: with a DB-backed session store, you could look up and destroy by user_id.
    // For now we just invalidate the current session if it matches.
    if (req.session?.user?.id === record.user_id) {
      req.session.destroy(() => {});
    }

    return res.json({ message: 'Password reset successfully. Please log in.' });
  } catch (err) {
    console.error('[auth/reset-password]', err);
    return res.status(500).json({ error: 'Password reset failed.' });
  }
});

export default router;
