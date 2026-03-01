console.log('[post.js] v: 2026-02-27-v9');
/**
 * views/post.js — страница отдельного поста с комментариями.
 *
 * export function mount(container, { postId }) → unmount
 */

import store from '../store.js';
import postsModel from '../models/posts.js';
import commentsModel from '../models/comments.js';
import router from '../router.js';
import auth from '../auth.js';
import { createAvatar } from '../components/avatar.js';
import { createAvatarPicker } from '../components/avatar-picker.js';
import { renderInto } from '../components/markdown.js';
import { showToast } from '../components/toast.js';
import { showConfirm } from '../components/modal.js';
import { formatDate, formatRelative, getRoleDisplay, getVisibilityLabel, cleanTag, isAdmin } from '../utils/format.js';
import { clearElement } from '../utils/dom.js';
import { postsAPI } from '../api.js';

export function mount(container, { postId }) {
  _adjacentCache = null; // сброс кэша при переходе на новый пост
  clearElement(container);

  const wrapper = document.createElement('div');
  wrapper.className = 'post-view';
  container.appendChild(wrapper);

  // Индикатор загрузки — отдельный элемент, не затирает контент
  const loadingEl = document.createElement('div');
  loadingEl.className   = 'loading-state';
  loadingEl.textContent = 'Загрузка…';
  wrapper.appendChild(loadingEl);

  let postRendered = false;

  const unsubs = [
    store.on('change:currentPost', () => {
      if (postRendered) return; // пост рендерим только один раз
      postRendered = true;
      loadingEl.remove();
      _renderPost(wrapper, postId);
      // Если комментарии уже загрузились раньше поста — рендерим их сейчас
      if (store.get('comments') !== null) {
        _renderComments(wrapper, postId);
      }
    }),
    store.on('change:comments', () => _renderComments(wrapper, postId)),
  ];

  Promise.all([
    postsModel.loadPost(postId),
    commentsModel.loadForPost(postId),
  ]).catch(err => showToast(err.message, 'error'));

  if (location.hash.includes('comment-form')) {
    setTimeout(() => {
      document.getElementById('comment-form')?.scrollIntoView({ behavior: 'smooth' });
      document.getElementById('comment-form')?.querySelector('textarea')?.focus();
    }, 600);
  }

  return () => unsubs.forEach(u => u());
}

function _canUserComment(post) {
  if (!post) return false;
  const commentLevel = post.commentLevel || 0;
  if (commentLevel === 0) return true; // всем можно (если залогинены, но это проверяется в форме)

  if (!auth.isLoggedIn()) return false;

  const myUsername = auth.getUsername();
  const myUserId = auth.getUserId();
  const myRole = auth.getRole();

  // Автор поста может всегда
  if (post.username === myUsername || post.userId === myUserId) return true;

  const roleRank = {
    'ANONYM': 0,
    'KOMMENTATOR': 10,
    'AVTOR': 20,
    'SMOTRITEL': 30,
    'NASTOIATEL': 40
  };

  const userRank = roleRank[myRole] || 0;
  return userRank >= commentLevel;
}

// ── Рендеринг поста ───────────────────────────────────────────────────

function _renderPost(wrapper, postId) {
  const post = store.get('currentPost');
  if (!post) return;
  console.log('[post] currentPost keys:', Object.keys(post), 'sample:', {
    title: post.title,
    username: post.username,
    createdAt: post.createdAt,
    authorRole: post.authorRole,
    contentLen: post.content?.length,
  });

  // Очищаем только секцию поста, не трогаем комментарии
  let postSection = wrapper.querySelector('.post-section');
  if (postSection) postSection.remove();

  postSection = document.createElement('div');
  postSection.className = 'post-section';

  // ── Навигация СВЕРХУ (placeholder, заполнится асинхронно) ──
  const navTop = document.createElement('div');
  navTop.className = 'post-navigation';
  const backTop = document.createElement('a');
  backTop.className   = 'nav-link center';
  backTop.href        = '#/';
  backTop.textContent = 'Назад к ленте';
  navTop.appendChild(backTop);
  postSection.appendChild(navTop);

  // ── Шапка поста ──
  const card = document.createElement('article');
  card.className = 'post-fullwidth';

  const header = document.createElement('div');
  header.className = 'post-header-full';

  const avatarEl = createAvatar({
    userId:   post.userId,
    avatarId: post.postAvatarId,
    username: post.username,
    size: 50,
  });
  avatarEl.className = 'post-avatar-small';

  const headerRight = document.createElement('div');
  headerRight.className = 'post-header-right';

  const titleEl = document.createElement('h1');
  titleEl.className   = 'post-title';
  titleEl.textContent = post.title;

  const meta = document.createElement('div');
  meta.className = 'post-meta';

  const authorSpan = document.createElement('span');
  authorSpan.textContent = post.username;
  authorSpan.style.cursor = 'pointer';
  authorSpan.style.fontWeight = '500';
  authorSpan.addEventListener('click', () => router.push(`/?author=${post.username}`));

  const roleSpan = document.createElement('span');
  roleSpan.style.cssText  = 'font-size:0.8rem;color:var(--muted-foreground)';
  roleSpan.textContent    = getRoleDisplay(post.authorRole);

  const dateSpan = document.createElement('span');
  dateSpan.textContent = formatDate(post.createdAt);

  meta.appendChild(authorSpan);
  meta.appendChild(roleSpan);
  meta.appendChild(dateSpan);

  if (post.visibilityLevel && post.visibilityLevel > 0) {
    const badge = document.createElement('span');
    badge.className = 'visibility-badge';
    badge.textContent = getVisibilityLabel(post.visibilityLevel);
    meta.appendChild(badge);
  }

  headerRight.appendChild(titleEl);
  headerRight.appendChild(meta);
  header.appendChild(avatarEl);
  header.appendChild(headerRight);

  // ── Контент ──
  const contentWrap = document.createElement('div');
  contentWrap.className = 'post-content-full';
  const contentEl = document.createElement('div');
  contentEl.className = 'markdown-content';
  renderInto(contentEl, post.content);
  contentWrap.appendChild(contentEl);

  // Медиа
  if (post.media?.length) {
    const mediaWrap = document.createElement('div');
    mediaWrap.style.marginTop = '1rem';
    for (const m of post.media) {
      mediaWrap.appendChild(_renderMedia(m));
    }
    contentWrap.appendChild(mediaWrap);
  }

  // ── Футер (теги + кнопки) ──
  const footer = document.createElement('div');
  footer.className = 'post-footer-full';

  const tagsEl = document.createElement('div');
  tagsEl.style.cssText = 'display:flex;gap:0.5rem;flex-wrap:wrap;flex:1';
  if (post.tags?.length) {
    for (const tag of post.tags) {
      const btn = document.createElement('button');
      btn.className   = 'post-tag';
      btn.textContent = cleanTag(tag);
      btn.addEventListener('click', () => router.push(`/?tag=${encodeURIComponent(tag)}`));
      tagsEl.appendChild(btn);
    }
  }

  const actions = document.createElement('div');
  actions.className = 'post-actions-full';

  // Кнопка «Написать комментарий»
  const commentBtn = document.createElement('a');
  commentBtn.className   = 'post-comment-link';
  commentBtn.href        = '#comment-form';
  commentBtn.textContent = '💬 Комментарии';

  // Поделиться
  const shareBtn = document.createElement('button');
  shareBtn.className   = 'post-share-btn';
  shareBtn.textContent = '📋 Поделиться';
  shareBtn.addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#/posts/${post.postId}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Ссылка скопирована', 'success');
    } catch {
      showToast(url, 'info');
    }
  });

  actions.appendChild(commentBtn);
  actions.appendChild(shareBtn);

  // Кнопки редактирования/удаления (только автор)
  const myUsername = auth.getUsername();
  if (auth.isLoggedIn() && post.username === myUsername) {
    const editBtn = document.createElement('a');
    editBtn.className   = 'btn btn-small';
    editBtn.href        = `#/posts/${post.postId}/edit`;
    editBtn.textContent = 'Редактировать';
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className   = 'btn-small btn-danger';
    delBtn.textContent = 'Удалить';
    delBtn.addEventListener('click', async () => {
      const ok = await showConfirm('Удалить этот пост и все его комментарии?');
      if (!ok) return;
      try {
        await postsModel.delete(post.postId);
        showToast('Пост удалён', 'success');
        router.push('/');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
    actions.appendChild(delBtn);
  }

  footer.appendChild(tagsEl);
  footer.appendChild(actions);

  card.appendChild(header);
  card.appendChild(contentWrap);
  card.appendChild(footer);
  postSection.appendChild(card);

  // ── Только верхняя навигация (нижняя — под комментариями, в _renderComments) ──
  _loadAdjacentPosts(post.createdAt, navTop, null);

  // Вставляем postSection ПЕРВЫМ в wrapper — комментарии всегда идут после
  wrapper.insertBefore(postSection, wrapper.firstChild);

  // После рендера поста — рендерим форму комментария
  _renderCommentForm(wrapper, postId);
}

// ── Медиа ─────────────────────────────────────────────────────────────

function _renderMedia(m) {
  const wrap = document.createElement('div');
  wrap.style.marginBottom = '0.75rem';

  if (m.type === 'video') {
    if (/youtube\.com|youtu\.be|vimeo\.com/.test(m.url)) {
      const iframe = document.createElement('iframe');
      iframe.src             = _embedUrl(m.url);
      iframe.width           = '100%';
      iframe.height          = '360';
      iframe.style.border    = 'none';
      iframe.style.borderRadius = 'var(--radius)';
      iframe.allowFullscreen = true;
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

function _embedUrl(url) {
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

// ── Форма комментария ─────────────────────────────────────────────────

function _renderCommentForm(wrapper, postId) {
  let formSection = wrapper.querySelector('#comment-form');
  if (formSection) return; // уже есть

  const post = store.get('currentPost');
  const canComment = _canUserComment(post);

  formSection = document.createElement('div');
  formSection.id        = 'comment-form';
  formSection.className = 'comment-form';

  const h3 = document.createElement('h3');
  h3.textContent = 'Написать комментарий';
  formSection.appendChild(h3);

  if (!auth.isLoggedIn()) {
    const msg = document.createElement('p');
    msg.innerHTML = '<a href="#/login">Войдите</a>, чтобы оставить комментарий.';
    formSection.appendChild(msg);
    wrapper.appendChild(formSection);
    return;
  }

  if (!canComment) {
    const msg = document.createElement('p');
    msg.style.color = 'var(--muted-foreground)';
    msg.textContent = 'Комментирование этой записи ограничено автором.';
    formSection.appendChild(msg);
    wrapper.appendChild(formSection);
    return;
  }

  // AvatarPicker
  let commentAvatarId = null;
  const picker = createAvatarPicker({
    onSelect: (id) => { commentAvatarId = id; },
  });
  formSection.appendChild(picker.trigger);

  const textarea = document.createElement('textarea');
  textarea.className   = 'comment-textarea';
  textarea.placeholder = 'Ваш комментарий… Поддерживается Markdown. @username для упоминания.';
  formSection.appendChild(textarea);

  // @mention дропдаун
  _attachMentionDropdown(textarea, formSection);

  const errEl = document.createElement('div');
  errEl.className = 'form-error hidden';
  formSection.appendChild(errEl);

  const submitBtn = document.createElement('button');
  submitBtn.className   = 'btn btn-primary';
  submitBtn.textContent = 'Отправить';
  submitBtn.addEventListener('click', async () => {
    const content = textarea.value.trim();
    if (!content) { errEl.textContent = 'Комментарий не может быть пустым'; errEl.classList.remove('hidden'); return; }
    errEl.classList.add('hidden');
    submitBtn.disabled = true;
    try {
      await commentsModel.create(postId, { content, commentAvatarId });
      textarea.value   = '';
      commentAvatarId  = null;
      picker.setAvatarId(null);
      showToast('Комментарий добавлен', 'success');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
    }
  });
  formSection.appendChild(submitBtn);

  wrapper.appendChild(formSection);
}

// ── Список комментариев ───────────────────────────────────────────────

function _renderComments(wrapper, postId) {
  if (!wrapper.querySelector('.post-section')) return;

  let section = wrapper.querySelector('#comments-section');
  if (section) section.remove();

  section = document.createElement('div');
  section.id        = 'comments-section';
  section.className = 'comments-section';

  const comments          = store.get('comments') ?? [];
  const postAuthorUsername = store.get('currentPost')?.username ?? '';

  // Дедупликация по commentId
  const seen = new Set();
  const uniqueComments = comments.filter(c => {
    if (seen.has(c.commentId)) return false;
    seen.add(c.commentId);
    return true;
  });

  const h3 = document.createElement('h3');
  h3.textContent = `Комментарии (${uniqueComments.length})`;
  section.appendChild(h3);

  if (!uniqueComments.length) {
    const empty = document.createElement('div');
    empty.className   = 'no-comments';
    empty.textContent = 'Комментариев пока нет. Будьте первым!';
    section.appendChild(empty);
  } else {
    const roots = uniqueComments.filter(c => !c.parentCommentId);
    const frag  = document.createDocumentFragment();
    for (const c of roots) {
      frag.appendChild(_makeComment(c, uniqueComments, postId, 0, postAuthorUsername));
    }
    section.appendChild(frag);
  }

  const commentForm = wrapper.querySelector('#comment-form');
  if (commentForm) {
    commentForm.after(section);
  } else {
    wrapper.appendChild(section);
  }

  // ── Нижняя навигация — самый низ страницы, после всех комментариев ──
  let navBot = wrapper.querySelector('.post-navigation-bottom');
  if (navBot) navBot.remove();

  navBot = document.createElement('div');
  navBot.className = 'post-navigation post-navigation-bottom';
  const backBot = document.createElement('a');
  backBot.className   = 'nav-link center';
  backBot.href        = '#/';
  backBot.textContent = 'Назад к ленте';
  navBot.appendChild(backBot);
  wrapper.appendChild(navBot);

  // Заполняем пред/след ссылки из уже загруженных данных поста
  const currentPost = store.get('currentPost');
  if (currentPost) {
    _loadAdjacentPosts(currentPost.createdAt, null, navBot);
  }
}

function _makeComment(comment, allComments, postId, depth, postAuthorUsername = '', _visited = new Set()) {
  // Защита от циклических ссылок в данных
  if (_visited.has(comment.commentId)) {
    console.warn('[post] цикл в комментариях:', comment.commentId);
    const stub = document.createElement('div');
    return stub;
  }
  _visited = new Set(_visited);
  _visited.add(comment.commentId);
  const tpl  = document.getElementById('tpl-comment');
  const frag = tpl.content.cloneNode(true);
  const el   = frag.querySelector('.comment-block');

  el.dataset.commentId = comment.commentId;
  if (depth > 0) el.classList.add('reply');

  // Аватар
  el.querySelector('[data-slot="avatar"]').appendChild(
    createAvatar({ userId: comment.userId, avatarId: comment.commentAvatarId, username: comment.username, size: 36 })
  );

  // Мета
  el.querySelector('[data-slot="author"]').textContent = comment.username;
  el.querySelector('[data-slot="role"]').textContent   = getRoleDisplay(comment.authorRole);
  el.querySelector('[data-slot="date"]').textContent   = formatRelative(comment.createdAt);

  const editedEl = el.querySelector('[data-slot="edited"]');
  if (comment.updatedAt > comment.createdAt + 5000) {
    editedEl.classList.remove('hidden');
  }

  // Контент
  const contentEl = el.querySelector('[data-slot="content"]');
  renderInto(contentEl, comment.content);

  const myUsername      = auth.getUsername();
  const myRole          = auth.getRole();
  const isCommentAuthor = auth.isLoggedIn() && comment.username === myUsername;
  const isPostAuthor    = auth.isLoggedIn() && postAuthorUsername && postAuthorUsername === myUsername;
  const isModerator     = auth.isLoggedIn() && isAdmin(myRole);

  const canEdit   = isCommentAuthor;                              // только автор комментария
  const canDelete = isCommentAuthor || isPostAuthor || isModerator; // + автор поста + модераторы

  if (!canEdit)   el.querySelector('[data-slot="edit-btn"]')?.remove();
  if (!canDelete) el.querySelector('[data-action="delete"]')?.remove();

  if (!auth.isLoggedIn() || !_canUserComment(store.get('currentPost'))) {
    el.querySelector('[data-action="reply"]')?.remove();
  }

  // Кнопка «Ответить»
  const replyBtn  = el.querySelector('[data-action="reply"]');
  const replyForm = el.querySelector('[data-slot="reply-form"]');
  replyBtn?.addEventListener('click', () => {
    if (!replyForm.classList.contains('hidden')) {
      replyForm.classList.add('hidden');
      return;
    }
    replyForm.classList.remove('hidden');
    clearElement(replyForm);
    replyForm.appendChild(_makeReplyForm(comment, postId, () => {
      replyForm.classList.add('hidden');
    }));
    replyForm.querySelector('textarea')?.focus();
  });

  // Кнопка «Редактировать» (инлайн)
  const editBtn  = el.querySelector('[data-action="edit"]');
  const editForm = el.querySelector('[data-slot="edit-form"]');
  editBtn?.addEventListener('click', () => {
    if (!editForm.classList.contains('hidden')) {
      editForm.classList.add('hidden');
      contentEl.style.display = '';
      return;
    }
    editForm.classList.remove('hidden');
    contentEl.style.display = 'none';
    clearElement(editForm);
    editForm.appendChild(_makeEditForm(comment, postId, () => {
      editForm.classList.add('hidden');
      contentEl.style.display = '';
    }));
    editForm.querySelector('textarea')?.focus();
  });

  // Кнопка «Удалить»
  const delBtn = el.querySelector('[data-action="delete"]');
  delBtn?.addEventListener('click', async () => {
    const ok = await showConfirm('Удалить этот комментарий и все ответы на него?');
    if (!ok) return;
    try {
      await commentsModel.delete(postId, comment.commentId);
      showToast('Комментарий удалён', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  const repliesEl = el.querySelector('[data-slot="replies"]');
  const children = depth < 50
    ? allComments.filter(c => c.parentCommentId === comment.commentId)
    : [];
  if (children.length && repliesEl) {
    for (const child of children) {
      repliesEl.appendChild(_makeComment(child, allComments, postId, depth + 1, postAuthorUsername, _visited));
    }
  }

  return el;
}

// ── Форма ответа ──────────────────────────────────────────────────────

function _makeReplyForm(parentComment, postId, onClose) {
  const wrap = document.createElement('div');
  wrap.style.marginTop = '0.75rem';

  let replyAvatarId = null;
  const picker = createAvatarPicker({ onSelect: (id) => { replyAvatarId = id; } });
  wrap.appendChild(picker.trigger);

  const ta = document.createElement('textarea');
  ta.className   = 'comment-textarea';
  ta.placeholder = `Ответ для @${parentComment.username}…`;
  ta.value       = `@${parentComment.username} `;
  wrap.appendChild(ta);

  const errEl = document.createElement('div');
  errEl.className = 'form-error hidden';
  wrap.appendChild(errEl);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:0.5rem;margin-top:0.5rem';

  const sendBtn = document.createElement('button');
  sendBtn.className   = 'btn btn-primary';
  sendBtn.textContent = 'Ответить';
  sendBtn.addEventListener('click', async () => {
    const content = ta.value.trim();
    if (!content) return;
    sendBtn.disabled = true;
    try {
      await commentsModel.create(postId, {
        content,
        parentCommentId: parentComment.commentId,
        commentAvatarId: replyAvatarId,
      });
      showToast('Ответ добавлен', 'success');
      onClose();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      sendBtn.disabled = false;
    }
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.className   = 'btn';
  cancelBtn.textContent = 'Отмена';
  cancelBtn.addEventListener('click', onClose);

  btnRow.appendChild(sendBtn);
  btnRow.appendChild(cancelBtn);
  wrap.appendChild(btnRow);

  return wrap;
}

// ── Форма редактирования ──────────────────────────────────────────────

function _makeEditForm(comment, postId, onClose) {
  const wrap = document.createElement('div');

  const ta = document.createElement('textarea');
  ta.className = 'comment-textarea';
  ta.value     = comment.content;
  wrap.appendChild(ta);

  const errEl = document.createElement('div');
  errEl.className = 'form-error hidden';
  wrap.appendChild(errEl);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:0.5rem;margin-top:0.5rem';

  const saveBtn = document.createElement('button');
  saveBtn.className   = 'btn btn-primary';
  saveBtn.textContent = 'Сохранить';
  saveBtn.addEventListener('click', async () => {
    const content = ta.value.trim();
    if (!content) return;
    saveBtn.disabled = true;
    try {
      await commentsModel.update(postId, comment.commentId, { content });
      showToast('Комментарий обновлён', 'success');
      onClose();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      saveBtn.disabled = false;
    }
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.className   = 'btn';
  cancelBtn.textContent = 'Отмена';
  cancelBtn.addEventListener('click', onClose);

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);
  wrap.appendChild(btnRow);

  return wrap;
}

// ── @mention дропдаун ─────────────────────────────────────────────────

function _attachMentionDropdown(textarea, container) {
  const dropdown = document.createElement('div');
  dropdown.className = 'hidden';
  dropdown.style.cssText = `
    position:absolute;background:var(--card);border:1px solid var(--border);
    border-radius:var(--radius);box-shadow:0 4px 12px rgba(0,0,0,0.1);
    z-index:100;max-height:200px;overflow-y:auto;min-width:160px
  `;
  container.style.position = 'relative';
  container.appendChild(dropdown);

  textarea.addEventListener('input', () => {
    const val    = textarea.value;
    const cursor = textarea.selectionStart;
    const before = val.slice(0, cursor);
    const match  = before.match(/@([a-zA-Z0-9_-]*)$/);

    if (!match) { dropdown.classList.add('hidden'); return; }

    const query   = match[1].toLowerCase();
    const authors = store.get('allAuthors') ?? [];
    const matches = authors.filter(a => a.toLowerCase().includes(query)).slice(0, 8);

    if (!matches.length) { dropdown.classList.add('hidden'); return; }

    clearElement(dropdown);
    for (const author of matches) {
      const item = document.createElement('div');
      item.textContent  = '@' + author;
      item.style.cssText = 'padding:0.4rem 0.75rem;cursor:pointer;font-size:0.875rem';
      item.addEventListener('mouseover', () => item.style.background = 'var(--accent)');
      item.addEventListener('mouseout',  () => item.style.background = '');
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const start = cursor - match[0].length;
        textarea.value =
          val.slice(0, start) + '@' + author + ' ' + val.slice(cursor);
        textarea.selectionStart = textarea.selectionEnd = start + author.length + 2;
        dropdown.classList.add('hidden');
      });
      dropdown.appendChild(item);
    }
    dropdown.classList.remove('hidden');
  });

  textarea.addEventListener('blur', () => {
    setTimeout(() => dropdown.classList.add('hidden'), 200);
  });
}

// ── Соседние посты (пред/след) ────────────────────────────────────────

let _adjacentCache = null; // { newer, older } — кэш на время жизни страницы

async function _loadAdjacentPosts(createdAt, navTop, navBot) {
  try {
    if (!_adjacentCache) {
      const [newerRes, olderRes] = await Promise.allSettled([
        postsAPI.getV2({ until: createdAt, limit: 1 }),
        postsAPI.getV2({ since: createdAt, limit: 1 }),
      ]);
      _adjacentCache = {
        newer: newerRes.status === 'fulfilled' ? newerRes.value?.items?.[0] : null,
        older: olderRes.status === 'fulfilled'  ? olderRes.value?.items?.[0]  : null,
      };
    }

    const { newer, older } = _adjacentCache;
    for (const navEl of [navTop, navBot].filter(Boolean)) {
      if (newer) {
        const link = document.createElement('a');
        link.className   = 'nav-link';
        link.href        = `#/posts/${newer.postId}`;
        link.textContent = '← Следующая запись';
        navEl.insertBefore(link, navEl.firstChild);
      }
      if (older) {
        const link = document.createElement('a');
        link.className   = 'nav-link';
        link.href        = `#/posts/${older.postId}`;
        link.textContent = 'Предыдущая запись →';
        navEl.appendChild(link);
      }
    }
  } catch (err) {
    console.warn('[post] adjacent posts load failed:', err.message);
  }
}
