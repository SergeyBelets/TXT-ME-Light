console.log('[api.js] v: 2026-02-27-v9');
/**
 * api.js — единственный слой работы с сетью.
 * Все остальные модули импортируют только его.
 * Использует нативный fetch().
 */

import storage from './utils/storage.js';
import { BASE_URL } from './config.js';

// Глобальный обработчик 401 — устанавливается из auth.js
let _on401 = null;
export function set401Handler(fn) { _on401 = fn; }

// Очередь ожидающих повтора после реавторизации
let _reauthPromise = null;

/**
 * Ждём реавторизации. Если уже ждём — присоединяемся к той же очереди.
 * Resolve вызывается из app.js после успешного логина через auth:reauth-done.
 */
function _waitForReauth() {
  if (!_reauthPromise) {
    _reauthPromise = new Promise((resolve, reject) => {
      function onDone()   { cleanup(); resolve(); }
      function onCancel() { cleanup(); reject(Object.assign(new Error('Авторизация отменена'), { status: 401, noRetry: true })); }
      function cleanup()  {
        _reauthPromise = null;
        document.removeEventListener('auth:reauth-done',   onDone);
        document.removeEventListener('auth:reauth-cancel', onCancel);
      }
      document.addEventListener('auth:reauth-done',   onDone,   { once: true });
      document.addEventListener('auth:reauth-cancel', onCancel, { once: true });
    });
  }
  return _reauthPromise;
}

// ── Базовый запрос ────────────────────────────────────────────────────

/**
 * @param {'GET'|'POST'|'PUT'|'DELETE'} method
 * @param {string} path
 * @param {object|null} [body]
 * @param {boolean} [requiresAuth=false]
 * @returns {Promise<any>}
 */
async function request(method, path, body = null, requiresAuth = false, retries = 2) {
  const headers = { 'Content-Type': 'application/json' };

  if (requiresAuth) {
    const token = storage.get('token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const init = { method, headers };
  if (body !== null) init.body = JSON.stringify(body);

  try {
    const response = await fetch(BASE_URL + path, init);

    // Cold start Lambda / таймаут API Gateway
    if (response.status === 504 && retries > 0) {
      console.warn(`[api] 504 Gateway Timeout. Ретрай... Осталось: ${retries}`);
      await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
      return request(method, path, body, requiresAuth, retries - 1);
    }

    if (response.status === 401) {
      if (_on401) _on401();
      // Ждём пока пользователь войдёт заново, потом повторяем запрос
      try {
        await _waitForReauth();
        return request(method, path, body, requiresAuth, 0); // повтор без доп. ретраев
      } catch (reauthErr) {
        storage.clear();
        throw reauthErr;
      }
    }

    if (response.status === 204) return null;

    let data;
    try { data = await response.json(); } catch { data = null; }

    if (!response.ok) {
      const message = data?.message ?? data?.error ?? `Ошибка ${response.status}`;
      throw Object.assign(new Error(message), { status: response.status, noRetry: true });
    }

    return data;

  } catch (err) {
    // Не ретраим намеренные ошибки (401, 4xx и т.п.)
    if (err.noRetry) throw err;

    // Сетевой сбой (интернет моргнул, ПВО) — ретрай
    if (retries > 0 && (err.name === 'TypeError' || err.message?.includes('fetch'))) {
      console.warn(`[api] Сетевой сбой. Ретрай... Осталось: ${retries}`);
      await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
      return request(method, path, body, requiresAuth, retries - 1);
    }

    throw err;
  }
}

// ── Auth ──────────────────────────────────────────────────────────────

export const authAPI = {
  /** @returns {Promise<{token, userId, username, role}>} */
  register: (username, password) =>
    request('POST', '/auth/register', { username, password }),

  /** @returns {Promise<{token, userId, username, role}>} */
  login: (username, password) =>
    request('POST', '/auth/login', { username, password }),
};

// ── Posts ─────────────────────────────────────────────────────────────

export const postsAPI = {
  /**
   * GET /v2/posts
   * @param {{since?, until?, day?, tag?, author?}} params
   * @returns {Promise<{items, page}>}
   */
  getV2: (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))
    ).toString();
    return request('GET', `/v2/posts${qs ? '?' + qs : ''}`, null, true);
  },

  /** GET /posts/:id — API возвращает { post: {...} } */
  getById: async (postId) => {
    const data = await request('GET', `/posts/${postId}`, null, true);
    // Бэкенд может вернуть { post: {...} } или сам объект поста
    return data?.post ?? data;
  },

  /** POST /posts */
  create: async (data) => {
    const res = await request('POST', '/posts', data, true);
    return res?.post ?? res;
  },

  /** PUT /posts/:id */
  update: async (postId, data) => {
    const res = await request('PUT', `/posts/${postId}`, data, true);
    return res?.post ?? res;
  },

  /** DELETE /posts/:id */
  delete: (postId) => request('DELETE', `/posts/${postId}`, null, true),
};

// ── Comments ──────────────────────────────────────────────────────────

export const commentsAPI = {
  /** GET /posts/:id/comments */
  getByPost: (postId) => {
    console.log('[commentsAPI] getByPost url:', `/posts/${postId}/comments`);
    return request('GET', `/posts/${postId}/comments`, null, true);
  },

  /** POST /posts/:id/comments */
  create: (postId, data) => request('POST', `/posts/${postId}/comments`, data, true),

  /** PUT /posts/:id/comments/:cId */
  update: (postId, commentId, data) =>
    request('PUT', `/posts/${postId}/comments/${commentId}`, data, true),

  /** DELETE /posts/:id/comments/:cId */
  delete: (postId, commentId) =>
    request('DELETE', `/posts/${postId}/comments/${commentId}`, null, true),
};

// ── Profile ───────────────────────────────────────────────────────────

export const profileAPI = {
  /** GET /admin/users/profile */
  get: () => request('GET', '/admin/users/profile', null, true),

  /** PUT /admin/users/profile/email */
  updateEmail: (email) => request('PUT', '/admin/users/profile/email', { email }, true),

  /** DELETE /admin/users/profile/email */
  deleteEmail: () => request('DELETE', '/admin/users/profile/email', null, true),

  /** PUT /admin/users/profile/password */
  updatePassword: (oldPassword, newPassword) =>
    request('PUT', '/admin/users/profile/password', { oldPassword, newPassword }, true),

  /** POST /admin/users/profile/avatar  (body: { dataUrl }) */
  addAvatar: (dataUrl) => request('POST', '/admin/users/profile/avatar', { dataUrl }, true),

  /** DELETE /admin/users/profile/avatar/:id */
  deleteAvatar: (avatarId) =>
    request('DELETE', `/admin/users/profile/avatar/${avatarId}`, null, true),

  /** PUT /admin/users/profile/avatar/active  (body: { avatarId }) */
  setActiveAvatar: (avatarId) =>
    request('PUT', '/admin/users/profile/avatar/active', { avatarId }, true),
};

// ── Avatar (публичный) ────────────────────────────────────────────────

export const avatarAPI = {
  /**
   * GET /admin/users/:userId/avatar
   * @returns {Promise<{avatarDataUrl: string|null, avatars: object[]}>}
   */
  get: (userId) => request('GET', `/admin/users/${userId}/avatar`),
};

// ── Meta ─────────────────────────────────────────────────────────────

export const metaAPI = {
  /**
   * GET /meta/filters
   * @returns {Promise<{tags: string[], authors: string[]}>}
   */
  getFilters: () => request('GET', '/meta/filters'),
};
