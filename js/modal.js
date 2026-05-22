// modal.js — shared modal overlay + toast notifications

const Modal = {
  _onSave: null,

  init() {
    document.getElementById('modal-close').addEventListener('click',  () => this.close());
    document.getElementById('modal-cancel').addEventListener('click', () => this.close());
    document.getElementById('modal-save').addEventListener('click',   () => this.save());
    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('modal-overlay')) this.close();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.ctrlKey && this._onSave) this.save();
    });
  },

  open(title, bodyHtml, onSave) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    this._onSave = onSave;
    setTimeout(() => {
      document.querySelector('#modal-body input:not([readonly]), #modal-body select')?.focus();
    }, 60);
  },

  close() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.getElementById('modal-body').innerHTML = '';
    document.body.style.overflow = '';
    this._onSave = null;
  },

  save() {
    if (this._onSave && this._onSave() !== false) this.close();
  },
};

const Toast = {
  show(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
    setTimeout(() => {
      el.classList.remove('visible');
      setTimeout(() => el.remove(), 350);
    }, 3000);
  },
  error(msg) { this.show(msg, 'error'); },
};
