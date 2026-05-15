/**
 * Campaign Dark Room — entry point
 * Handles screen routing: auth → lobby → empire
 */
import { api }        from './api.js';
import { initAuth }   from './auth.js';
import { initLobby }  from './lobby.js';
import { initEmpire } from './empire.js';

let _user = null;

function showScreen(id) {
  document.querySelectorAll('.c-screen').forEach((el) => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function hideLoading() {
  const el = document.getElementById('c-loading');
  if (el) el.remove();
}

function goToLobby() {
  showScreen('lobby-screen');
  initLobby(_user, goToEmpire, goToAuth);
}

function goToAuth() {
  _user = null;
  showScreen('auth-screen');
  initAuth((user) => {
    _user = user;
    goToLobby();
  });
}

function goToEmpire(campaignId) {
  showScreen('empire-screen');
  initEmpire(campaignId, goToLobby);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
(async () => {
  try {
    const { user } = await api.me();
    _user = user;
    hideLoading();

    // Check for ?join=CODE in URL (from invite email link)
    const params    = new URLSearchParams(window.location.search);
    const joinCode  = params.get('join') || params.get('code');
    const campaignParam = params.get('campaign');

    if (joinCode || campaignParam) {
      // Clean up URL
      window.history.replaceState({}, '', '/');
    }

    goToLobby();

    // If a campaign ID was in the URL, jump straight to it
    if (campaignParam) {
      goToEmpire(Number(campaignParam));
    }
  } catch {
    // Not logged in
    hideLoading();
    goToAuth();
  }
})();
