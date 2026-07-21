/**
 * app.js — точка входа.
 */

import router from './router.js';
import auth from './auth.js';
import store from './store.js';
import { showModal } from './components/modal.js';
import { showToast } from './components/toast.js';
import { authAPI, profileAPI } from './api.js';
import { mountSidebar } from './views/sidebar.js';

const APP_VERSION = '2025-02-27-v9';
console.log(`[app] version: ${APP_VERSION}`);

// ── Восстановить данные из профиля если localStorage неполный ─────────
async function restoreSession() {
  if (!auth.isLoggedIn()) return;
  if (auth.getUserId() && auth.getRole()) return; // всё есть

  console.log('[app] token есть но userId/role пустые — загружаем профиль');
  try {
    const profile = await profileAPI.get();
    console.log('[app] profile response:', profile);
    auth.save({
      token:    auth.getToken(),
      userId:   profile.userId   ?? profile.id       ?? '',
      username: profile.username ?? '',
      role:     profile.role     ?? profile.userRole  ?? '',
    });
    console.log('[app] после восстановления:', {
      userId:   auth.getUserId(),
      username: auth.getUsername(),
      role:     auth.getRole(),
    });
  } catch (e) {
    console.warn('[app] не удалось загрузить профиль:', e.message);
  }
}

// ── Sidebar монтируется после восстановления сессии ───────────────────
restoreSession().then(() => {
  mountSidebar();
  router.init();
});

// ── ReauthModal ───────────────────────────────────────────────────────
document.addEventListener('auth:reauth-required', () => {
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-group">
      <label for="reauth-username">Логин</label>
      <input id="reauth-username" type="text" autocomplete="username" />
    </div>
    <div class="form-group">
      <label for="reauth-password">Пароль</label>
      <input id="reauth-password" type="password" autocomplete="current-password" />
    </div>
    <div class="error hidden" id="reauth-error"></div>
  `;

  showModal({
    title: 'Сессия истекла',
    description: 'Пожалуйста, войдите снова, чтобы продолжить.',
    body: form,
    actions: [
      {
        label: 'Войти',
        className: 'btn-primary',
        async onClick(close) {
          const username = form.querySelector('#reauth-username').value.trim();
          const password = form.querySelector('#reauth-password').value;
          const errEl    = form.querySelector('#reauth-error');
          if (!username || !password) {
            errEl.textContent = 'Заполните все поля';
            errEl.classList.remove('hidden');
            return false;
          }
          try {
            const data = await authAPI.login(username, password);
            auth.save(data);
            close();
            showToast('Вы снова вошли в систему', 'success');
            document.dispatchEvent(new CustomEvent('auth:changed'));
            document.dispatchEvent(new CustomEvent('auth:reauth-done'));
          } catch (err) {
            errEl.textContent = err.message ?? 'Неверный логин или пароль';
            errEl.classList.remove('hidden');
            return false;
          }
        },
      },
      {
        label: 'Выйти',
        className: 'btn',
        onClick(close) {
          auth.clear();
          close();
          document.dispatchEvent(new CustomEvent('auth:reauth-cancel'));
          document.dispatchEvent(new CustomEvent('auth:changed'));
          router.push('/login');
        },
      },
    ],
  });
});

// ── Глобальные ошибки ─────────────────────────────────────────────────
store.on('change:error', (msg) => {
  if (msg) showToast(msg, 'error');
});

// ── Диагностика шаблонов ──────────────────────────────────────────────
const REQUIRED_TEMPLATES = [
  'tpl-layout','tpl-post-card','tpl-tag-btn','tpl-comment',
  'tpl-active-filter','tpl-toast','tpl-modal','tpl-avatar-item',
];
for (const id of REQUIRED_TEMPLATES) {
  if (!document.getElementById(id)) console.error(`MISSING TEMPLATE: #${id}`);
}
