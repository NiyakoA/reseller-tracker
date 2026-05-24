const Auth = {
  isLoggedIn() { return !!localStorage.getItem('rt_token'); },

  async login(email, password) {
    const { token } = await API.login(email, password);
    localStorage.setItem('rt_token', token);
  },

  async register(email, password) {
    const { token } = await API.register(email, password);
    localStorage.setItem('rt_token', token);
  },

  logout() {
    localStorage.removeItem('rt_token');
    location.reload();
  },

  mount() {
    const screen = document.getElementById('auth-screen');
    screen.style.display = '';
    screen.innerHTML = `
      <div class="auth-card">
        <h1>Reseller Tracker</h1>
        <p class="auth-tagline">Sign in to your account</p>
        <div class="auth-tabs">
          <button type="button" data-mode="login"  class="auth-tab is-active">Sign in</button>
          <button type="button" data-mode="signup" class="auth-tab">Create account</button>
        </div>
        <form id="auth-form" class="auth-form" novalidate>
          <input type="email"    id="auth-email"            placeholder="Email"             required>
          <input type="password" id="auth-password"         placeholder="Password"          required minlength="6">
          <input type="password" id="auth-password-confirm" placeholder="Confirm password"  style="display:none" minlength="6">
          <button type="submit" class="btn btn-primary" id="auth-submit">Sign in</button>
          <div id="auth-error" class="auth-error"></div>
        </form>
      </div>`;

    let mode = 'login';
    const submit  = screen.querySelector('#auth-submit');
    const confirm = screen.querySelector('#auth-password-confirm');
    const errEl   = screen.querySelector('#auth-error');

    screen.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        mode = tab.dataset.mode;
        screen.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('is-active', t === tab));
        confirm.style.display = mode === 'signup' ? '' : 'none';
        confirm.required = mode === 'signup';
        submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
        errEl.textContent = '';
      });
    });

    screen.querySelector('#auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.textContent = '';
      const email = screen.querySelector('#auth-email').value.trim();
      const password = screen.querySelector('#auth-password').value;
      if (mode === 'signup') {
        const confirmVal = confirm.value;
        if (password !== confirmVal) { errEl.textContent = 'Passwords do not match.'; return; }
      }
      submit.disabled = true;
      const originalText = submit.textContent;
      submit.textContent = mode === 'signup' ? 'Creating account…' : 'Signing in…';
      try {
        if (mode === 'signup') await Auth.register(email, password);
        else                   await Auth.login(email, password);
        screen.style.display = 'none';
        screen.innerHTML = '';
        await App.start();
      } catch (err) {
        errEl.textContent = err.body?.message || err.message || 'Something went wrong.';
      } finally {
        submit.disabled = false;
        submit.textContent = originalText;
      }
    });
  },
};

window.Auth = Auth;

window.addEventListener('rt:unauthorized', () => {
  document.getElementById('app').style.display = 'none';
  Auth.mount();
});

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('logout-btn');
  if (btn) btn.addEventListener('click', () => Auth.logout());
});
