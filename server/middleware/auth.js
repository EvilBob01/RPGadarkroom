/**
 * Authentication middleware
 *
 * requireAuth   — blocks unauthenticated requests (returns 401)
 * requireRole   — blocks requests where the user's role is insufficient
 * attachUser    — soft version: attaches user to req if logged in, continues either way
 */

/**
 * Block unauthenticated requests.
 * Sets req.user from the session if logged in.
 */
export function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  req.user = req.session.user;
  next();
}

/**
 * Block requests where user role is not in the allowed list.
 * Must be used after requireAuth.
 *
 * Usage: router.delete('/campaign/:id', requireAuth, requireRole('gm', 'admin'), handler)
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions.' });
    }
    next();
  };
}

/**
 * Soft auth — attach user if logged in, continue regardless.
 * Useful for routes that behave differently for authed vs. guest users.
 */
export function attachUser(req, _res, next) {
  if (req.session?.user) {
    req.user = req.session.user;
  }
  next();
}
