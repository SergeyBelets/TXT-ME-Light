console.log('[sidebar.js] v: 2026-07-04-v10');
/**
 * views/sidebar.js — сайдбар.
 * Постоянный DOM-элемент, создаётся один раз, переставляется в layout.
 * Обновляется при изменении авторизации и фильтров.
 * В самом низу — постоянный календарь (только vanilla-фронтенд).
 */

import auth from '../auth.js';
import store from '../store.js';
import metaModel from '../models/meta.js';
import router from '../router.js';
import { createAvatar } from '../components/avatar.js';
import { createCalendar } from '../components/calendar.js';
import { getRoleDisplay, canPost, cleanTag } from '../utils/format.js';
import { clearElement } from '../utils/dom.js';

// ── Постоянный элемент сайдбара ───────────────────────────────────────
// Создаётся один раз, переставляется в нужный slot при каждом рендере layout.

let _sidebarEl = null;
let _initialized = false;
let _calendarEl = null;

/**
 * Получить (или создать) постоянный DOM-элемент сайдбара.
 * @returns {HTMLElement}
 */
export function getSidebarEl() {
  if (!_sidebarEl) {
    _sidebarEl = document.createElement('aside');
    _sidebarEl.id        = 'sidebar-root';
    _sidebarEl.className = 'sidebar';
  }
  return _sidebarEl;
}

/**
 * Получить (или создать) постоянный элемент календаря.
 * Создаётся один раз, чтобы выбранные год/месяц не сбрасывались
 * при полном перерендере сайдбара (например, при auth:changed).
 * @returns {HTMLElement}
 */
function _getCalendarEl() {
  if (!_calendarEl) {
    _calendarEl = createCalendar({ onSelectDay: _handleDaySelect });
  }
  return _calendarEl;
}

/**
 * Клик по дню в календаре — фильтр ленты по дате создания записи.
 * Повторный клик по уже выбранному дню снимает фильтр (как и с тегами/авторами).
 * Выбор дня — самостоятельный фильтр: сбрасывает тег/автора, чтобы
 * пользователь всегда видел «всё за этот день», без неожиданных пустых лент.
 * @param {string} dayKeyStr 'YYYY-MM-DD'
 */
function _handleDaySelect(dayKeyStr) {
  const active = store.get('activeFilters') ?? {};
  const isSame = active.day === dayKeyStr;

  const newFilters = isSame
    ? { tag: null, author: null, day: null, since: null, until: null, _tags: [], _authors: [] }
    : { tag: null, author: null, day: dayKeyStr, since: null, until: null, _tags: [], _authors: [] };

  store.set('activeFilters', newFilters);
  router.replace(isSame ? '/' : '/?day=' + encodeURIComponent(dayKeyStr));
}

/**
 * Инициализировать сайдбар (вызывается один раз из app.js).
 */
export function mountSidebar() {
  if (_initialized) return;
  _initialized = true;

  const sidebar = getSidebarEl();
  _init(sidebar);
}

// ── Инициализация ─────────────────────────────────────────────────────

function _init(sidebar) {
  metaModel.load();

  store.on('change:allTags',       () => _renderFilters(sidebar));
  store.on('change:allAuthors',    () => _renderFilters(sidebar));
  store.on('change:activeFilters', () => _renderFilters(sidebar));

  document.addEventListener('auth:changed', () => _render(sidebar));

  _render(sidebar);
  _mountToggle(sidebar);
}

// ── Полный рендер ─────────────────────────────────────────────────────

function _render(sidebar) {
  clearElement(sidebar);

  const clubBlock = document.createElement('div');
  clubBlock.className = 'club-block';
  _renderUserSection(clubBlock);
  sidebar.appendChild(clubBlock);

  _renderFilters(sidebar);

  // Календарь — всегда в самом низу сайдбара
  sidebar.appendChild(_getCalendarEl());

  // Переставить кнопку тоггла (она снаружи sidebar)
  _remountToggle(sidebar);
}

// ── Секция пользователя ───────────────────────────────────────────────

function _renderUserSection(container) {
  if (auth.isLoggedIn()) {
    _renderLoggedIn(container);
  } else {
    _renderLoggedOut(container);
  }
}

function _renderLoggedIn(container) {
  const username = auth.getUsername() ?? '';
  const role     = auth.getRole()     ?? '';
  const userId   = auth.getUserId()   ?? '';

  console.log('[sidebar] logged in:', { username, role, userId });

  // Логотип клуба
  const logoRow = document.createElement('div');
  logoRow.style.cssText = 'display:flex;align-items:center;gap:0.75rem;margin-bottom:1.25rem';
  const logoImg = document.createElement('img');
  logoImg.src   = '/favicon.jpg';
  logoImg.alt   = 'Текст-Мине-Клуб';
  logoImg.style.cssText = 'width:40px;height:40px;border-radius:var(--radius);object-fit:cover;flex-shrink:0';
  const logoName = document.createElement('div');
  logoName.style.cssText = 'font-weight:600;font-size:0.95rem;line-height:1.2';
  logoName.textContent   = 'Текст-Мине-Клуб';
  logoRow.appendChild(logoImg);
  logoRow.appendChild(logoName);
  container.appendChild(logoRow);

  const userRow = document.createElement('div');
  userRow.style.cssText = 'display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem';

  const avatarEl = createAvatar({ userId, username, size: 48 });

  const info = document.createElement('div');

  const nameEl = document.createElement('div');
  nameEl.style.fontWeight = '500';
  nameEl.textContent = username;

  const roleEl = document.createElement('div');
  roleEl.style.cssText = 'font-size:0.8rem;color:var(--muted-foreground)';
  roleEl.textContent = getRoleDisplay(role);

  info.appendChild(nameEl);
  info.appendChild(roleEl);
  userRow.appendChild(avatarEl);
  userRow.appendChild(info);
  container.appendChild(userRow);

  if (canPost(role)) {
    const newPostBtn = document.createElement('a');
    newPostBtn.className   = 'new-post-btn';
    newPostBtn.href        = '#/posts/new';
    newPostBtn.textContent = '+ Новая запись';
    container.appendChild(newPostBtn);
  }

  const profileLink = document.createElement('a');
  profileLink.className   = 'sidebar-nav-link';
  profileLink.href        = '#/profile/edit';
  profileLink.textContent = 'Редактировать профиль';
  container.appendChild(profileLink);

  const logoutBtn = document.createElement('button');
  logoutBtn.className   = 'btn logout-btn';
  logoutBtn.style.width = '100%';
  logoutBtn.textContent = 'Выйти';
  logoutBtn.addEventListener('click', () => {
    auth.clear();
    document.dispatchEvent(new CustomEvent('auth:changed'));
    router.push('/');
  });
  container.appendChild(logoutBtn);
}

function _renderLoggedOut(container) {
  // Логотип — favicon.jpg + название
  const logoRow = document.createElement('div');
  logoRow.style.cssText = 'display:flex;align-items:center;gap:0.75rem;margin-bottom:1.25rem';

  const logoImg = document.createElement('img');
  logoImg.src    = '/favicon.jpg';
  logoImg.alt    = 'Текст-Мине-Клуб';
  logoImg.style.cssText = 'width:48px;height:48px;border-radius:var(--radius);object-fit:cover;flex-shrink:0';

  const logoName = document.createElement('div');
  logoName.style.cssText = 'font-weight:600;font-size:1rem;line-height:1.2';
  logoName.textContent   = 'Текст-Мине-Клуб';

  logoRow.appendChild(logoImg);
  logoRow.appendChild(logoName);
  container.appendChild(logoRow);

  const authBtns = document.createElement('div');
  authBtns.className = 'auth-buttons';

  const loginLink = document.createElement('a');
  loginLink.className   = 'btn btn-primary';
  loginLink.href        = '#/login';
  loginLink.textContent = 'Войти';

  const regLink = document.createElement('a');
  regLink.className   = 'btn';
  regLink.href        = '#/register';
  regLink.textContent = 'Регистрация';

  authBtns.appendChild(loginLink);
  authBtns.appendChild(regLink);
  container.appendChild(authBtns);
}

// ── Секция фильтров ───────────────────────────────────────────────────

function _renderFilters(sidebar) {
  const old = sidebar.querySelector('.filters-section');
  if (old) old.remove();

  const tags    = store.get('allTags')    ?? [];
  const authors = store.get('allAuthors') ?? [];
  if (!tags.length && !authors.length) return;

  const active = store.get('activeFilters') ?? {};

  const section = document.createElement('div');
  section.className = 'filters-section';

  // ── Теги ──
  if (tags.length) {
    const group = document.createElement('div');
    group.className = 'filter-group';

    const label = document.createElement('span');
    label.className   = 'filter-title';
    label.textContent = 'Теги';
    group.appendChild(label);

    for (const tag of tags) {
      const btn = document.createElement('button');
      btn.className   = 'filter-btn';
      btn.textContent = cleanTag(tag);
      if (active.tag === tag) btn.classList.add('active');

      btn.addEventListener('click', () => {
        const isActive = active.tag === tag;
        // Выбор тега — выход из режима календарного дня.
        const newFilters = { ...active, tag: isActive ? null : tag, day: null, since: null, until: null };
        store.set('activeFilters', newFilters);
        const params = new URLSearchParams();
        if (newFilters.tag)    params.set('tag',    newFilters.tag);
        if (newFilters.author) params.set('author', newFilters.author);
        const qs = params.toString();
        router.replace('/' + (qs ? '?' + qs : ''));
      });

      group.appendChild(btn);
    }
    section.appendChild(group);
  }

  // ── Авторы ──
  if (authors.length) {
    const group = document.createElement('div');
    group.className = 'filter-group';

    const label = document.createElement('span');
    label.className   = 'filter-title';
    label.textContent = 'Авторы';
    group.appendChild(label);

    for (const author of authors) {
      const btn = document.createElement('button');
      btn.className   = 'filter-btn';
      btn.textContent = author;
      if (active.author === author) btn.classList.add('active');

      btn.addEventListener('click', () => {
        const isActive = active.author === author;
        // Выбор автора — выход из режима календарного дня.
        const newFilters = { ...active, author: isActive ? null : author, day: null, since: null, until: null };
        store.set('activeFilters', newFilters);
        const params = new URLSearchParams();
        if (newFilters.tag)    params.set('tag',    newFilters.tag);
        if (newFilters.author) params.set('author', newFilters.author);
        const qs = params.toString();
        router.replace('/' + (qs ? '?' + qs : ''));
      });

      group.appendChild(btn);
    }
    section.appendChild(group);
  }

  // ── Сброс (только если что-то активно) ──
  if (active.tag || active.author) {
    const resetBtn = document.createElement('button');
    resetBtn.className   = 'btn filter-reset';
    resetBtn.textContent = '× Сбросить фильтр';
    resetBtn.addEventListener('click', () => {
      store.set('activeFilters', { tag: null, author: null, since: null, until: null });
      router.replace('/');
    });
    section.appendChild(resetBtn);
  }

  // Вставляем секцию фильтров НАД календарём, а не в конец сайдбара —
  // календарь должен всегда оставаться самым нижним блоком.
  const calEl = sidebar.querySelector('.calendar-section');
  if (calEl) {
    sidebar.insertBefore(section, calEl);
  } else {
    sidebar.appendChild(section);
  }
}

// ── Мобильный тоггл ───────────────────────────────────────────────────

let _expandBtn = null;

function _mountToggle(sidebar) {
  _expandBtn = document.createElement('button');
  _expandBtn.className   = 'expand-toggle';
  _expandBtn.textContent = '☰ Фильтры и навигация';

  if (sidebar.parentNode) {
    sidebar.parentNode.insertBefore(_expandBtn, sidebar);
  }

  _expandBtn.addEventListener('click', () => {
    sidebar.classList.add('expanded');
    _expandBtn.style.display = 'none';

    let collapseBtn = sidebar.querySelector('.collapse-toggle');
    if (!collapseBtn) {
      collapseBtn = document.createElement('button');
      collapseBtn.className   = 'collapse-toggle';
      collapseBtn.textContent = '✕ Свернуть';
      sidebar.insertBefore(collapseBtn, sidebar.firstChild);
      collapseBtn.addEventListener('click', () => {
        sidebar.classList.remove('expanded');
        _expandBtn.style.display = '';
      });
    }
  });
}

/**
 * После полного ре-рендера sidebar (при auth:changed) — переставить expand-кнопку.
 */
function _remountToggle(sidebar) {
  if (!_expandBtn) return;
  if (sidebar.parentNode && _expandBtn.parentNode !== sidebar.parentNode) {
    sidebar.parentNode.insertBefore(_expandBtn, sidebar);
  }
}
