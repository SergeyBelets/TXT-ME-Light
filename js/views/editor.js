/**
 * views/editor.js — форма создания и редактирования поста.
 * Два режима: mode='create' и mode='edit' (с postId).
 *
 * export function mount(container, { mode, postId? }) → unmount
 */

import auth from '../auth.js';
import postsModel from '../models/posts.js';
import router from '../router.js';
import { postsAPI } from '../api.js';
import { createAvatarPicker } from '../components/avatar-picker.js';
import { renderInto } from '../components/markdown.js';
import { showToast } from '../components/toast.js';
import { clearElement } from '../utils/dom.js';
import { cleanTag } from '../utils/format.js';

export function mount(container, { mode = 'create', postId = null }) {
  clearElement(container);

  const page = document.createElement('div');
  page.className = 'editor-page';

  const card = document.createElement('div');
  card.className = 'form-card';

  const h1 = document.createElement('h1');
  h1.style.cssText      = 'font-size:1.5rem;margin-bottom:1.5rem';
  h1.textContent = mode === 'create' ? 'Новая запись' : 'Редактировать запись';
  card.appendChild(h1);

  // Форма
  const { form, getValues, setValues } = _buildForm(card);

  page.appendChild(card);
  container.appendChild(page);

  // При редактировании — загрузить данные
  if (mode === 'edit' && postId) {
    _loadPost(postId, setValues, card);
  }

  // Сабмит
  const submitBtn = card.querySelector('[data-action="submit"]');
  submitBtn?.addEventListener('click', async () => {
    const values = getValues();
    if (!_validate(values, card)) return;

    submitBtn.disabled    = true;
    submitBtn.textContent = 'Сохранение…';

    try {
      if (mode === 'create') {
        const post = await postsModel.create(values);
        showToast('Запись опубликована', 'success');
        router.push(`/posts/${post.postId}`);
      } else {
        await postsModel.update(postId, values);
        showToast('Запись обновлена', 'success');
        router.push(`/posts/${postId}`);
      }
    } catch (err) {
      _showError(card, err.message);
      submitBtn.disabled    = false;
      submitBtn.textContent = mode === 'create' ? 'Опубликовать' : 'Сохранить';
    }
  });

  // Кнопка отмены
  const cancelBtn = card.querySelector('[data-action="cancel"]');
  cancelBtn?.addEventListener('click', () => {
    if (mode === 'edit' && postId) router.push(`/posts/${postId}`);
    else router.push('/');
  });
}

// ── Построение формы ──────────────────────────────────────────────────

function _buildForm(card) {
  // Заголовок
  const titleGroup = document.createElement('div');
  titleGroup.className = 'form-group';
  const titleLabel = document.createElement('label');
  titleLabel.textContent = 'Заголовок';
  const titleInput = document.createElement('input');
  titleInput.type        = 'text';
  titleInput.placeholder = 'Заголовок записи…';
  titleInput.maxLength   = 300;
  titleGroup.appendChild(titleLabel);
  titleGroup.appendChild(titleInput);
  card.appendChild(titleGroup);

  // Markdown-редактор
  const editorEl = _buildMarkdownEditor();
  card.appendChild(editorEl.container);

  // Теги
  const tagsGroup = document.createElement('div');
  tagsGroup.className = 'form-group';
  const tagsLabel = document.createElement('label');
  tagsLabel.textContent = 'Теги (через пробел или запятую, максимум 10)';
  const tagsInput = document.createElement('input');
  tagsInput.type        = 'text';
  tagsInput.placeholder = 'программирование проза стихи';
  tagsGroup.appendChild(tagsLabel);
  tagsGroup.appendChild(tagsInput);
  card.appendChild(tagsGroup);

  // Уровень видимости
  const visibilityGroup = document.createElement('div');
  visibilityGroup.className = 'form-group';
  const visibilityLabel = document.createElement('label');
  visibilityLabel.textContent = 'Уровень видимости';
  const visibilitySelect = document.createElement('select');
  visibilitySelect.className = 'form-control';
  visibilitySelect.style.cssText = 'width:100%;padding:0.75rem;border-radius:var(--radius);border:1px solid var(--border);background:var(--input-background);color:var(--foreground)';
  
  const role = auth.getRole();
  const options = [
    { value: 0, label: 'Всем' },
    { value: 10, label: 'Комментаторам', minRole: 'KOMMENTATOR' },
    { value: 20, label: 'Авторам', minRole: 'AVTOR' },
    { value: 30, label: 'Смотрителям', minRole: 'SMOTRITEL' },
    { value: 40, label: 'Настоятелям', minRole: 'NASTOIATEL' }
  ];

  const roleRank = {
    'ANONYM': 0,
    'KOMMENTATOR': 10,
    'AVTOR': 20,
    'SMOTRITEL': 30,
    'NASTOIATEL': 40
  };

  const currentRank = roleRank[role] || 0;

  options.forEach(opt => {
    const requiredRank = roleRank[opt.minRole] || 0;
    if (currentRank >= requiredRank) {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      visibilitySelect.appendChild(el);
    }
  });

  const visibilityHelp = document.createElement('p');
  visibilityHelp.style.cssText = 'font-size:0.75rem;color:var(--muted-foreground);margin-top:0.25rem';
  visibilityHelp.textContent = 'Кто сможет увидеть этот пост.';

  visibilityGroup.appendChild(visibilityLabel);
  visibilityGroup.appendChild(visibilitySelect);
  visibilityGroup.appendChild(visibilityHelp);
  card.appendChild(visibilityGroup);

  // Аватар поста
  let postAvatarId = null;
  const avatarGroup = document.createElement('div');
  avatarGroup.className = 'form-group';
  const avatarLabel = document.createElement('label');
  avatarLabel.textContent = 'Аватар записи (необязательно)';
  const picker = createAvatarPicker({
    onSelect: (id) => { postAvatarId = id; },
  });
  avatarGroup.appendChild(avatarLabel);
  avatarGroup.appendChild(picker.trigger);
  card.appendChild(avatarGroup);

  // Медиа
  const mediaSection = _buildMediaSection();
  card.appendChild(mediaSection.container);

  // Ошибка
  const errEl = document.createElement('div');
  errEl.className = 'error hidden';
  card.appendChild(errEl);

  // Кнопки
  const actions = document.createElement('div');
  actions.className = 'form-actions';

  const submitBtn = document.createElement('button');
  submitBtn.className = 'btn btn-primary';
  submitBtn.dataset.action = 'submit';
  submitBtn.textContent    = 'Опубликовать';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.dataset.action = 'cancel';
  cancelBtn.textContent    = 'Отмена';

  actions.appendChild(submitBtn);
  actions.appendChild(cancelBtn);
  card.appendChild(actions);

  // ── getValues ──
  function getValues() {
    const rawTags = tagsInput.value
      .split(/[\s,]+/)
      .map(t => t.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map(t => t.startsWith('#') ? t : '#' + t);

    return {
      title:       titleInput.value.trim(),
      content:     editorEl.getContent(),
      tags:        rawTags,
      media:       mediaSection.getMedia(),
      postAvatarId: postAvatarId || null,
      visibilityLevel: Number(visibilitySelect.value),
    };
  }

  // ── setValues (режим редактирования) ──
  function setValues(post) {
    titleInput.value = post.title ?? '';
    editorEl.setContent(post.content ?? '');

    const tagStr = (post.tags ?? []).map(cleanTag).join(' ');
    tagsInput.value = tagStr;

    if (post.postAvatarId) {
      postAvatarId = post.postAvatarId;
      picker.setAvatarId(post.postAvatarId);
    }

    if (post.visibilityLevel !== undefined) {
      visibilitySelect.value = post.visibilityLevel;
    }

    mediaSection.setMedia(post.media ?? []);

    // Меняем текст кнопки
    submitBtn.textContent = 'Сохранить';
  }

  return { form: card, getValues, setValues };
}

// ── Markdown-редактор ─────────────────────────────────────────────────

function _buildMarkdownEditor() {
  const container = document.createElement('div');
  container.className = 'form-group markdown-editor';

  const label = document.createElement('label');
  label.textContent = 'Текст';
  container.appendChild(label);

  // Табы
  const tabs = document.createElement('div');
  tabs.className = 'editor-tabs';
  const tabEdit    = document.createElement('button');
  tabEdit.type     = 'button';
  tabEdit.textContent = 'Редактор';
  tabEdit.className   = 'active';
  const tabPreview = document.createElement('button');
  tabPreview.type    = 'button';
  tabPreview.textContent = 'Предпросмотр';
  tabs.appendChild(tabEdit);
  tabs.appendChild(tabPreview);
  container.appendChild(tabs);

  // Тулбар
  const toolbar = document.createElement('div');
  toolbar.className = 'markdown-toolbar';
  const toolbarBtns = [
    { label: 'B',   title: 'Bold',          wrap: ['**', '**'] },
    { label: 'I',   title: 'Italic',         wrap: ['*', '*'] },
    { label: 'S',   title: 'Strikethrough',  wrap: ['~~', '~~'] },
    { label: 'U',   title: 'Underline',      wrap: ['<u>', '</u>'] },
    { label: '🔗',  title: 'Link',           fn: insertLink },
  ];

  const textarea = document.createElement('textarea');
  textarea.className   = 'markdown-textarea';
  textarea.placeholder = 'Текст в формате Markdown…';

  for (const def of toolbarBtns) {
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'toolbar-btn';
    btn.textContent = def.label;
    btn.title       = def.title;
    btn.addEventListener('click', () => {
      if (def.fn) { def.fn(textarea); return; }
      _wrapSelection(textarea, def.wrap[0], def.wrap[1]);
    });
    toolbar.appendChild(btn);
  }
  container.appendChild(toolbar);

  // Textarea / preview
  const preview = document.createElement('div');
  preview.className = 'markdown-preview hidden';

  container.appendChild(textarea);
  container.appendChild(preview);

  // Переключение табов
  tabEdit.addEventListener('click', () => {
    tabEdit.classList.add('active');
    tabPreview.classList.remove('active');
    textarea.classList.remove('hidden');
    preview.classList.add('hidden');
  });

  tabPreview.addEventListener('click', () => {
    tabPreview.classList.add('active');
    tabEdit.classList.remove('active');
    textarea.classList.add('hidden');
    preview.classList.remove('hidden');
    renderInto(preview, textarea.value);
  });

  function insertLink(ta) {
    const url  = prompt('URL ссылки:', 'https://');
    if (!url) return;
    const sel  = ta.value.slice(ta.selectionStart, ta.selectionEnd) || 'текст ссылки';
    const link = `[${sel}](${url})`;
    _insertAt(ta, ta.selectionStart, ta.selectionEnd, link);
  }

  return {
    container,
    getContent: () => textarea.value,
    setContent: (v) => { textarea.value = v; },
  };
}

// ── Медиа-секция ──────────────────────────────────────────────────────

function _buildMediaSection() {
  const container = document.createElement('div');
  container.className = 'form-group';

  const label = document.createElement('label');
  label.textContent = 'Медиа (необязательно)';
  container.appendChild(label);

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:0.5rem;margin-bottom:0.5rem';
  container.appendChild(list);

  const addBtn = document.createElement('button');
  addBtn.type      = 'button';
  addBtn.className = 'btn btn-small';
  addBtn.textContent = '+ Добавить медиа';
  addBtn.addEventListener('click', () => _addMediaRow(list));
  container.appendChild(addBtn);

  function _addMediaRow(list, item = null) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:0.5rem;align-items:center';

    const typeSelect = document.createElement('select');
    typeSelect.style.cssText = 'padding:0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--input-background);min-height:44px';
    ['video', 'audio'].forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t === 'video' ? '🎬 Видео' : '🎵 Аудио';
      typeSelect.appendChild(opt);
    });
    if (item?.type) typeSelect.value = item.type;

    const urlInput = document.createElement('input');
    urlInput.type        = 'text';
    urlInput.placeholder = 'URL…';
    urlInput.style.flex  = '1';
    urlInput.style.minHeight = '44px';
    if (item?.url) urlInput.value = item.url;

    const removeBtn = document.createElement('button');
    removeBtn.type      = 'button';
    removeBtn.className = 'btn-small btn-danger';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => row.remove());

    row.appendChild(typeSelect);
    row.appendChild(urlInput);
    row.appendChild(removeBtn);
    list.appendChild(row);
  }

  function getMedia() {
    return Array.from(list.querySelectorAll('div')).map(row => {
      const sel = row.querySelector('select');
      const inp = row.querySelector('input');
      return { type: sel?.value, url: inp?.value.trim(), addedAt: Date.now() };
    }).filter(m => m.url);
  }

  function setMedia(media) {
    clearElement(list);
    for (const m of media) _addMediaRow(list, m);
  }

  return { container, getMedia, setMedia };
}

// ── Валидация ─────────────────────────────────────────────────────────

function _validate(values, card) {
  _clearError(card);
  if (!values.title) {
    _showError(card, 'Заголовок обязателен (максимум 300 символов)');
    return false;
  }
  if (values.title.length > 300) {
    _showError(card, 'Заголовок не может быть длиннее 300 символов');
    return false;
  }
  if (!values.content) {
    _showError(card, 'Текст поста обязателен');
    return false;
  }
  return true;
}

function _showError(card, msg) {
  const el = card.querySelector('.error');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function _clearError(card) {
  const el = card.querySelector('.error');
  if (el) { el.textContent = ''; el.classList.add('hidden'); }
}

// ── Загрузка поста для редактирования ────────────────────────────────

async function _loadPost(postId, setValues, card) {
  try {
    const post = await postsAPI.getById(postId);
    // Проверить права
    if (post.username !== auth.getUsername() && !['NASTOIATEL', 'SMOTRITEL'].includes(auth.getRole())) {
      showToast('Нет прав на редактирование', 'error');
      router.push(`/posts/${postId}`);
      return;
    }
    setValues(post);
  } catch (err) {
    _showError(card, err.message);
  }
}

// ── DOM-утилиты для редактора ─────────────────────────────────────────

function _wrapSelection(ta, before, after) {
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  const sel   = ta.value.slice(start, end) || 'текст';
  _insertAt(ta, start, end, before + sel + after);
  ta.selectionStart = start + before.length;
  ta.selectionEnd   = start + before.length + sel.length;
}

function _insertAt(ta, start, end, text) {
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + text.length;
  ta.focus();
}
