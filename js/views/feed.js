console.log('[feed.js] v: 2026-07-04-v10');
/**
 * views/feed.js — лента постов V2.
 */

import store from '../store.js';
import postsModel from '../models/posts.js';
import metaModel from '../models/meta.js';
import router from '../router.js';
import { getSidebarEl } from './sidebar.js';
import { createAvatar } from '../components/avatar.js';
import { renderInto } from '../components/markdown.js';
import { createPagination, updatePagination } from '../components/pagination.js';
import { showToast } from '../components/toast.js';
import { postsAPI } from '../api.js';
import { formatRelative, cleanTag, getRoleDisplay, shiftDayKey } from '../utils/format.js';
import { clearElement } from '../utils/dom.js';

export function mount(container, params) {
  clearElement(container);

  // Клонируем layout из шаблона
  const tplLayout = document.getElementById('tpl-layout');
  if (!tplLayout) {
    container.innerHTML = '<div class="error">Ошибка: шаблон tpl-layout не найден</div>';
    return;
  }
  container.appendChild(tplLayout.content.cloneNode(true));

  // Заменяем placeholder на постоянный сайдбар
  const placeholder = document.getElementById('sidebar-placeholder');
  const sidebarEl   = getSidebarEl();
  if (placeholder && placeholder !== sidebarEl) {
    placeholder.parentNode.replaceChild(sidebarEl, placeholder);
  }

  const feedEl = document.getElementById('feed-root');
  if (!feedEl) return;

  // Фильтры из URL
  const stored = store.get('activeFilters') ?? {};
  const filters = {
    tag:    params.tag    ?? stored.tag    ?? null,
    author: params.author ?? stored.author ?? null,
    since:  params.since  ?? stored.since  ?? null,
    until:  params.until  ?? stored.until  ?? null,
    day:    params.day    ?? stored.day    ?? null,
    _tags:    stored._tags    ?? [],
    _authors: stored._authors ?? [],
  };
  store.set('activeFilters', filters);

  // Пагинация
  const paginationTop = createPagination({ onPrev, onNext, onRemoveFilter });
  const paginationBot = createPagination({ onPrev, onNext, onRemoveFilter });
  feedEl.appendChild(paginationTop);

  const listEl = document.createElement('div');
  listEl.className = 'feed-list';
  feedEl.appendChild(listEl);

  const noPostsEl = document.createElement('div');
  noPostsEl.className = 'no-posts hidden';
  noPostsEl.textContent = 'Записей не найдено';
  feedEl.appendChild(noPostsEl);

  const loadingEl = document.createElement('div');
  loadingEl.className = 'loading-state hidden';
  loadingEl.textContent = 'Загрузка…';
  feedEl.appendChild(loadingEl);

  feedEl.appendChild(paginationBot);

  const unsubs = [
    store.on('change:posts', () => _renderPosts(listEl, noPostsEl)),
    store.on('change:pageMeta', () => {
      const meta = store.get('pageMeta');
      const af   = store.get('activeFilters');
      updatePagination(paginationTop, { pageMeta: meta, activeFilters: af });
      updatePagination(paginationBot, { pageMeta: meta, activeFilters: af });
    }),
    store.on('change:activeFilters', () => {
      const meta = store.get('pageMeta');
      const af   = store.get('activeFilters');
      updatePagination(paginationTop, { pageMeta: meta, activeFilters: af });
      updatePagination(paginationBot, { pageMeta: meta, activeFilters: af });
    }),
    store.on('change:loading', (v) => {
      v ? loadingEl.classList.remove('hidden') : loadingEl.classList.add('hidden');
    }),
  ];

  metaModel.load();
  _load(filters);

  function onPrev() {
    const af = store.get('activeFilters');

    // Режим календарного дня: листаем на предыдущий день независимо от того,
    // есть там записи или нет.
    if (af?.day) {
      const newFilters = { ...af, day: shiftDayKey(af.day, -1) };
      store.set('activeFilters', newFilters);
      _load(newFilters);
      _syncDayUrl(newFilters);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const meta = store.get('pageMeta');
    if (!meta?.prevUntil) return;
    const newFilters = { ...af, until: meta.prevUntil, since: null };
    store.set('activeFilters', newFilters);
    _load(newFilters);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function onNext() {
    const af = store.get('activeFilters');

    if (af?.day) {
      const newFilters = { ...af, day: shiftDayKey(af.day, 1) };
      store.set('activeFilters', newFilters);
      _load(newFilters);
      _syncDayUrl(newFilters);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const meta = store.get('pageMeta');
    if (!meta?.nextSince) return;
    const newFilters = { ...af, since: meta.nextSince, until: null };
    store.set('activeFilters', newFilters);
    _load(newFilters);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function onRemoveFilter(key) {
    const af = { ...store.get('activeFilters'), [key]: null, since: null, until: null };
    if (key === 'tag')    af._tags    = [];
    if (key === 'author') af._authors = [];
    store.set('activeFilters', af);
    _load(af);
  }

  return () => unsubs.forEach(u => u());
}

// ── Загрузка ─────────────────────────────────────────────────────────

async function _load(filters) {
  // ── Режим календарного дня: выдаём ВСЕ записи этого дня, без лимита обычной пагинации ──
  // Бэкенд (CMS-Posts-ListV2) сам считает границы UTC-суток по параметру day —
  // since/until здесь не участвуют (более того, они взаимоисключающие).
  if (filters.day) {
    store.set('loading', true);
    store.set('error', null);
    try {
      const data = await _getDayWithRetry(filters.day);
      store.set('posts', data?.items ?? []);
      store.set('pageMeta', { prevUntil: null, nextSince: null });
    } catch (err) {
      store.set('error', err.message);
      store.set('posts', []);
    } finally {
      store.set('loading', false);
    }
    return;
  }

  const tags    = filters._tags    ?? (filters.tag    ? [filters.tag]    : []);
  const authors = filters._authors ?? (filters.author ? [filters.author] : []);
  const hasMultiple = tags.length > 1 || authors.length > 1;

  if (!hasMultiple) {
    const params = {};
    if (filters.tag)    params.tag    = filters.tag;
    if (filters.author) params.author = filters.author;
    if (filters.since)  params.since  = filters.since;
    if (filters.until)  params.until  = filters.until;
    await postsModel.loadFeed(params);
    _applyUrlRewrite();
    return;
  }

  store.set('loading', true);
  try {
    const effectiveTags    = tags.length    ? tags    : [null];
    const effectiveAuthors = authors.length ? authors : [null];
    const requests = [];
    for (const tag of effectiveTags) {
      for (const author of effectiveAuthors) {
        const p = {};
        if (tag)           p.tag    = tag;
        if (author)        p.author = author;
        if (filters.since) p.since  = filters.since;
        if (filters.until) p.until  = filters.until;
        requests.push(postsAPI.getV2(p));
      }
    }
    const results = await Promise.allSettled(requests);
    const seen = new Set();
    const merged = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const item of r.value?.items ?? []) {
        if (!seen.has(item.postId)) { seen.add(item.postId); merged.push(item); }
      }
    }
    merged.sort((a, b) => b.createdAt - a.createdAt);
    store.set('posts', merged);
    store.set('pageMeta', { prevUntil: null, nextSince: null });
  } catch (err) {
    store.set('error', err.message);
    store.set('posts', []);
  } finally {
    store.set('loading', false);
  }
}

function _applyUrlRewrite() {
  const posts = store.get('posts');
  if (!posts?.length) return;
  const af = store.get('activeFilters');
  if (af?.until && !af?.since) {
    const newFilters = { ...af, since: String(posts[0]?.createdAt), until: null };
    store.set('activeFilters', newFilters);
    const p = new URLSearchParams();
    if (newFilters.tag)    p.set('tag',    newFilters.tag);
    if (newFilters.author) p.set('author', newFilters.author);
    if (newFilters.since)  p.set('since',  newFilters.since);
    const qs = p.toString();
    history.replaceState(null, '', '#/' + (qs ? '?' + qs : ''));
  }
}

/** Синхронизирует URL при листании дней в режиме календаря. */
function _syncDayUrl(filters) {
  const p = new URLSearchParams();
  if (filters.day) p.set('day', filters.day);
  const qs = p.toString();
  history.replaceState(null, '', '#/' + (qs ? '?' + qs : ''));
}

/**
 * GET /v2/posts?day=... с ретраем на случай холодного старта Lambda/DynamoDB
 * (единичный транзиентный сбой не должен показывать пустую ленту на весь день).
 */
async function _getDayWithRetry(day, attempt = 0) {
  try {
    return await postsAPI.getV2({ day, limit: 300 });
  } catch (err) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 400 + attempt * 400));
      return _getDayWithRetry(day, attempt + 1);
    }
    throw err;
  }
}

// ── Рендеринг ────────────────────────────────────────────────────────

function _renderPosts(listEl, noPostsEl) {
  const posts = store.get('posts') ?? [];
  clearElement(listEl);
  if (!posts.length) { noPostsEl.classList.remove('hidden'); return; }
  noPostsEl.classList.add('hidden');
  const frag = document.createDocumentFragment();
  for (const post of posts) frag.appendChild(_makePostCard(post));
  listEl.appendChild(frag);
}

function _makePostCard(post) {
  const tpl = document.getElementById('tpl-post-card');
  if (!tpl) { console.error('MISSING: #tpl-post-card'); return document.createElement('div'); }
  const frag = tpl.content.cloneNode(true);
  const card = frag.querySelector('.post-fullwidth');

  card.querySelector('[data-slot="avatar"]').appendChild(
    createAvatar({ userId: post.userId, avatarId: post.postAvatarId, username: post.username, size: 50 })
  );

  const titleLink = card.querySelector('[data-slot="title-link"]');
  titleLink.textContent = post.title;
  titleLink.href = `#/posts/${post.postId}`;

  const authorEl = card.querySelector('[data-slot="author"]');
  authorEl.textContent = post.username;
  authorEl.addEventListener('click', () => {
    store.set('activeFilters', { ...store.get('activeFilters'), author: post.username, tag: null, day: null, since: null, until: null });
    _load({ author: post.username });
  });

  card.querySelector('[data-slot="role"]').textContent = getRoleDisplay(post.authorRole);
  card.querySelector('[data-slot="date"]').textContent = formatRelative(post.createdAt);

  renderInto(card.querySelector('[data-slot="content"]'), post.content, post.postId);

  if (post.media?.length) {
    const contentEl = card.querySelector('[data-slot="content"]');
    const mediaWrap = document.createElement('div');
    mediaWrap.style.marginTop = '1rem';
    for (const m of post.media) mediaWrap.appendChild(_renderMediaCard(m));
    contentEl.parentNode.appendChild(mediaWrap);
  }
  const tagsEl = card.querySelector('[data-slot="tags"]');
  for (const tag of post.tags ?? []) {
    const tplTag = document.getElementById('tpl-tag-btn');
    if (!tplTag) continue;
    const tagBtn = tplTag.content.cloneNode(true).querySelector('.post-tag');
    tagBtn.textContent = cleanTag(tag);
    tagBtn.addEventListener('click', () => {
      store.set('activeFilters', { ...store.get('activeFilters'), tag, author: null, day: null, since: null, until: null });
      _load({ tag });
    });
    tagsEl.appendChild(tagBtn);
  }

  const commentLink = card.querySelector('[data-slot="comment-link"]');
  if (commentLink) commentLink.href = `#/posts/${post.postId}#comment-form`;
  const countEl = card.querySelector('[data-slot="comment-count"]');
  if (countEl) countEl.textContent = `💬 ${post.commentCount ?? 0} ${_pluralComments(post.commentCount ?? 0)}`;

  const shareBtn = card.querySelector('[data-slot="share"]');
  if (shareBtn) shareBtn.addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#/posts/${post.postId}`;
    try { await navigator.clipboard.writeText(url); showToast('Ссылка скопирована', 'success'); }
    catch { showToast(url, 'info'); }
  });

  return card;
}

function _pluralComments(n) {
  const abs = Math.abs(n) % 100, mod = abs % 10;
  if (abs > 10 && abs < 20) return 'комментариев';
  if (mod === 1)             return 'комментарий';
  if (mod >= 2 && mod <= 4) return 'комментария';
  return 'комментариев';
}

// ── Медиа в карточке ленты ────────────────────────────────────────────

function _renderMediaCard(m) {
  const wrap = document.createElement('div');
  wrap.style.marginBottom = '0.75rem';

  if (m.type === 'video') {
    if (/youtube\.com|youtu\.be|vimeo\.com/.test(m.url)) {
      const iframe = document.createElement('iframe');
      iframe.src    = _embedUrlCard(m.url);
      iframe.width  = '100%';
      iframe.height = '360';
      iframe.style.border       = 'none';
      iframe.style.borderRadius = 'var(--radius)';
      iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
      iframe.setAttribute('allowfullscreen', '');
      wrap.appendChild(iframe);
    } else {
      const video = document.createElement('video');
      video.src      = m.url;
      video.controls = true;
      video.style.cssText = 'width:100%;border-radius:var(--radius)';
      wrap.appendChild(video);
    }
  } else if (m.type === 'audio') {
    const audio = document.createElement('audio');
    audio.src      = m.url;
    audio.controls = true;
    audio.style.width = '100%';
    wrap.appendChild(audio);
  }
  return wrap;
}

function _embedUrlCard(url) {
  if (/youtube\.com\/watch/.test(url)) {
    const id = new URL(url).searchParams.get('v');
    return `https://www.youtube.com/embed/${id}`;
  }
  if (/youtu\.be\//.test(url)) {
    const id = url.split('youtu.be/')[1]?.split('?')[0];
    return `https://www.youtube.com/embed/${id}`;
  }
  if (/vimeo\.com\/(\d+)/.test(url)) {
    const id = url.match(/vimeo\.com\/(\d+)/)?.[1];
    return `https://player.vimeo.com/video/${id}`;
  }
  return url;
}
