/**
 * Campaign API client
 * Thin fetch wrapper. All methods return { data } on success or throw an
 * Error with message from the server.
 */

const BASE = '/api';

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res  = await fetch(BASE + path, opts);
  const json = await res.json().catch(() => ({}));

  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export const api = {
  // ── Auth ────────────────────────────────────────────────────────────────
  me:             ()           => req('GET',  '/auth/me'),
  login:          (b)          => req('POST', '/auth/login', b),
  register:       (b)          => req('POST', '/auth/register', b),
  logout:         ()           => req('POST', '/auth/logout'),
  verifyEmail:    (token)      => req('POST', '/auth/verify-email', { token }),
  forgotPassword: (email)      => req('POST', '/auth/forgot-password', { email }),
  resetPassword:  (b)          => req('POST', '/auth/reset-password', b),

  // ── Campaigns ───────────────────────────────────────────────────────────
  listCampaigns:   ()          => req('GET',  '/campaigns'),
  getCampaign:     (id)        => req('GET',  `/campaigns/${id}`),
  createCampaign:  (b)         => req('POST', '/campaigns', b),
  joinCampaign:    (b)         => req('POST',  '/campaigns/join', b),
  getPlayers:      (id)        => req('GET',   `/campaigns/${id}/players`),
  updateCampaign:  (id, b)     => req('PATCH', `/campaigns/${id}`, b),
  startCampaign:   (id)        => req('POST',  `/campaigns/${id}/start`),
  pauseCampaign:   (id)        => req('POST',  `/campaigns/${id}/pause`),

  // ── Rulesets ────────────────────────────────────────────────────────────
  listRulesets:    ()          => req('GET',  '/rulesets'),
  getRuleset:      (id)        => req('GET',  `/rulesets/${id}`),

  // ── Map ─────────────────────────────────────────────────────────────────
  getMap:          (cid)       => req('GET',  `/map/${cid}`),

  // ── Empire ──────────────────────────────────────────────────────────────
  getEmpire:       (cid)       => req('GET',  `/empire/${cid}`),
  build:           (cid, b)    => req('POST', `/empire/${cid}/build`, b),
  assignWorker:    (cid, b)    => req('POST', `/empire/${cid}/workers`, b),
};
