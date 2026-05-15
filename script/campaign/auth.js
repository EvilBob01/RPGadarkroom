/**
 * Auth screen — login and register forms
 */
import { api } from './api.js';

export function initAuth(onSuccess) {
  const screen = document.getElementById('auth-screen');
  let mode = 'login'; // 'login' | 'register'

  screen.innerHTML = `
    <div class="auth-box">
      <h1>Campaign Dark Room</h1>
      <p class="auth-subtitle" id="auth-subtitle">sign in to your account</p>

      <div id="auth-fields">
        <div class="c-field" id="field-email" style="display:none">
          <label>Email</label>
          <input type="email" id="auth-email" autocomplete="email" />
        </div>
        <div class="c-field">
          <label>Username</label>
          <input type="text" id="auth-username" autocomplete="username" />
        </div>
        <div class="c-field">
          <label>Password</label>
          <input type="password" id="auth-password" autocomplete="current-password" />
        </div>
      </div>

      <button class="c-btn primary" id="auth-submit">sign in</button>
      <div class="c-error" id="auth-error"></div>
      <div class="c-notice" id="auth-notice"></div>

      <div class="auth-toggle">
        <span id="auth-toggle-text">no account?</span>
        <a id="auth-toggle-link">register</a>
      </div>
    </div>
  `;

  const emailField  = document.getElementById('field-email');
  const usernameEl  = document.getElementById('auth-username');
  const passwordEl  = document.getElementById('auth-password');
  const emailEl     = document.getElementById('auth-email');
  const submitBtn   = document.getElementById('auth-submit');
  const errorEl     = document.getElementById('auth-error');
  const noticeEl    = document.getElementById('auth-notice');
  const subtitleEl  = document.getElementById('auth-subtitle');
  const toggleLink  = document.getElementById('auth-toggle-link');
  const toggleText  = document.getElementById('auth-toggle-text');

  function setError(msg)  { errorEl.textContent = msg; noticeEl.textContent = ''; }
  function setNotice(msg) { noticeEl.textContent = msg; errorEl.textContent = ''; }
  function clearMessages(){ errorEl.textContent = ''; noticeEl.textContent = ''; }

  function switchMode(newMode) {
    mode = newMode;
    clearMessages();
    if (mode === 'register') {
      subtitleEl.textContent   = 'create an account';
      submitBtn.textContent    = 'register';
      toggleLink.textContent   = 'sign in';
      toggleText.textContent   = 'already have an account?';
      emailField.style.display = 'block';
    } else {
      subtitleEl.textContent   = 'sign in to your account';
      submitBtn.textContent    = 'sign in';
      toggleLink.textContent   = 'register';
      toggleText.textContent   = 'no account?';
      emailField.style.display = 'none';
    }
  }

  toggleLink.addEventListener('click', () =>
    switchMode(mode === 'login' ? 'register' : 'login')
  );

  // Allow Enter key to submit
  screen.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitBtn.click();
  });

  submitBtn.addEventListener('click', async () => {
    clearMessages();
    const username = usernameEl.value.trim();
    const password = passwordEl.value;
    const email    = emailEl.value.trim();

    if (!username || !password) { setError('Please fill in all fields.'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = mode === 'login' ? 'signing in…' : 'registering…';

    try {
      if (mode === 'login') {
        const { user } = await api.login({ username, password });
        onSuccess(user);
      } else {
        if (!email) { setError('Email is required.'); return; }
        await api.register({ username, email, password });
        setNotice('Account created! Check your email to verify, then sign in.');
        switchMode('login');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = mode === 'login' ? 'sign in' : 'register';
    }
  });
}
