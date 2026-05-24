const App = {
  async start() {
    if (!Auth.isLoggedIn()) {
      document.getElementById('app').style.display = 'none';
      Auth.mount();
      return;
    }
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app').style.display = 'none';
    App._showLoadingOverlay();
    try {
      await DB.init();
      App._hideLoadingOverlay();
      document.getElementById('app').style.display = '';
      App._renderInitialPage();
    } catch (e) {
      App._hideLoadingOverlay();
      if (e.status === 401) { Auth.mount(); return; }
      App.showRetryScreen(e);
    }
  },

  _renderInitialPage() {
    if (typeof applyRoute === 'function') applyRoute();
    else throw new Error('applyRoute() is not defined — confirm index.html exposes it globally.');
  },

  showRetryScreen(err) {
    const app = document.getElementById('app');
    app.style.display = '';
    app.innerHTML = `
      <div class="retry-screen" style="padding:40px;text-align:center">
        <h2>Couldn't load your data</h2>
        <p style="color:var(--text-muted)">${err?.message || 'Network error'}</p>
        <button class="btn btn-primary" id="retry-btn">Retry</button>
        <button class="btn btn-secondary" id="logout-btn-retry" style="margin-left:8px">Log out</button>
      </div>`;
    document.getElementById('retry-btn').addEventListener('click', () => location.reload());
    document.getElementById('logout-btn-retry').addEventListener('click', () => Auth.logout());
  },

  _showLoadingOverlay() {
    let overlay = document.getElementById('app-loading');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'app-loading';
      overlay.className = 'app-loading';
      overlay.innerHTML = '<div class="spinner"></div><p>Loading your data…</p>';
      document.body.appendChild(overlay);
    }
    overlay.style.display = '';
  },

  _hideLoadingOverlay() {
    const overlay = document.getElementById('app-loading');
    if (overlay) overlay.style.display = 'none';
  },
};

window.App = App;

window.addEventListener('DOMContentLoaded', () => App.start());

window.addEventListener('focus', () => {
  if (Auth.isLoggedIn()) DB.init().catch(() => {});
});
