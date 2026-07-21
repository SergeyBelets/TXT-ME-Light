/**
 * pagination.js — компонент пагинации (курсорная + режим календарного дня).
 * Рендерит кнопки «← Предыдущие» / «Следующие →», чипы тег/автор и,
 * при необходимости, кнопку «На главную» (вместо «сырых» меток since/until
 * и как способ выйти из режима календарного дня).
 * Используется дважды: вверху и внизу ленты (position: 'top'|'bottom').
 * Метка календарного дня рендерится один раз — только у верхнего экземпляра.
 *
 * В режиме календарного дня (activeFilters.day задан) кнопки перелистывания
 * всегда доступны и ведут на предыдущий/следующий календарный день —
 * независимо от того, есть там записи или нет.
 *
 * createPagination({ onPrev, onNext, onHome, onRemoveFilter, position }) → Element
 * update(el, { pageMeta, activeFilters })
 */

import store from '../store.js';
import { cloneTemplate } from '../utils/dom.js';
import { formatDayKey } from '../utils/format.js';

/**
 * Создаёт DOM-элемент блока пагинации.
 * @param {{
 *   onPrev: () => void,
 *   onNext: () => void,
 *   onHome: () => void,
 *   onRemoveFilter: (key: 'tag'|'author') => void,
 *   position?: 'top'|'bottom',
 * }} opts
 * @returns {HTMLElement}
 */
export function createPagination({ onPrev, onNext, onHome, onRemoveFilter, position = 'top' }) {
  const container = document.createElement('div');
  container.className = 'pagination-container';

  // Метка календарного дня — центрирована, показывается только в верхнем
  // экземпляре пагинации (наверху страницы), чтобы не дублироваться внизу.
  let dayLabelEl = null;
  if (position === 'top') {
    dayLabelEl = document.createElement('div');
    dayLabelEl.className = 'pagination-day-label';
    dayLabelEl.hidden = true;
    container.appendChild(dayLabelEl);
  }

  const controls = document.createElement('div');
  controls.className = 'pagination-controls';

  // Кнопка «Предыдущие» / «Предыдущий день»
  const btnPrev = document.createElement('button');
  btnPrev.className   = 'btn';
  btnPrev.textContent = '← Предыдущие';
  btnPrev.addEventListener('click', onPrev);

  // Центральная зона: чипы тег/автор и, при необходимости, кнопка «На главную»
  const filtersDisplay = document.createElement('div');
  filtersDisplay.className = 'feed-filters-display';

  // Кнопка «Следующие» / «Следующий день»
  const btnNext = document.createElement('button');
  btnNext.className   = 'btn';
  btnNext.textContent = 'Следующие →';
  btnNext.addEventListener('click', onNext);

  controls.appendChild(btnPrev);
  controls.appendChild(filtersDisplay);
  controls.appendChild(btnNext);
  container.appendChild(controls);

  // Запоминаем ссылки для update()
  container._btnPrev        = btnPrev;
  container._btnNext        = btnNext;
  container._filtersDisplay = filtersDisplay;
  container._dayLabelEl     = dayLabelEl;
  container._onRemoveFilter = onRemoveFilter;
  container._onHome         = onHome;

  // Первичный рендер
  updatePagination(container, {
    pageMeta:      store.get('pageMeta'),
    activeFilters: store.get('activeFilters'),
  });

  return container;
}

/**
 * Обновляет состояние компонента пагинации.
 * @param {HTMLElement} el  — элемент, возвращённый createPagination
 * @param {{ pageMeta: object, activeFilters: object }} state
 */
export function updatePagination(el, { pageMeta, activeFilters }) {
  const btnPrev        = el._btnPrev;
  const btnNext        = el._btnNext;
  const filtersDisplay = el._filtersDisplay;
  const dayLabelEl     = el._dayLabelEl; // есть только у верхнего экземпляра
  const onRemove       = el._onRemoveFilter;
  const onHome         = el._onHome;

  if (!btnPrev || !btnNext) return;

  const dayMode = !!activeFilters?.day;

  if (dayMode) {
    // Режим календарного дня: перелистывание всегда доступно и ведёт
    // на соседний день независимо от наличия записей в этот день.
    btnPrev.textContent      = '← Предыдущий день';
    btnNext.textContent      = 'Следующий день →';
    btnPrev.style.visibility = 'visible';
    btnNext.style.visibility = 'visible';
  } else {
    btnPrev.textContent = '← Предыдущие';
    btnNext.textContent = 'Следующие →';

    if (pageMeta?.prevUntil) {
      btnPrev.style.visibility = 'visible';
    } else {
      btnPrev.style.visibility = 'hidden';
    }

    if (pageMeta?.nextSince) {
      btnNext.style.visibility = 'visible';
    } else {
      btnNext.style.visibility = 'hidden';
    }
  }

  // Метка дня — центрирована наверху страницы, только у верхнего экземпляра.
  if (dayLabelEl) {
    if (dayMode) {
      dayLabelEl.textContent = `День: ${formatDayKey(activeFilters.day)}`;
      dayLabelEl.hidden = false;
    } else {
      dayLabelEl.hidden = true;
      dayLabelEl.textContent = '';
    }
  }

  // Центральная зона: чипы тег/автор.
  // since/until — служебные курсоры пагинации, а не то, что стоит показывать
  // пользователю как «сырую» метку времени. Вместо них — кнопка «На главную».
  filtersDisplay.innerHTML = '';

  const chipLabels = {
    tag:    (v) => `Тег: ${v.startsWith('#') ? v.slice(1) : v}`,
    author: (v) => `Автор: ${v}`,
  };

  for (const [key, label] of Object.entries(chipLabels)) {
    const val = activeFilters?.[key];
    if (!val) continue;

    const frag   = cloneTemplate('tpl-active-filter');
    const badge  = frag.querySelector('.active-filter');
    badge.querySelector('[data-slot="label"]').textContent = label(val);
    badge.querySelector('[data-slot="remove"]').addEventListener('click', () => onRemove(key));
    filtersDisplay.appendChild(badge);
  }

  // «На главную» — показываем, когда мы либо в режиме календарного дня
  // (тогда она встаёт ровно между «Предыдущий день»/«Следующий день»,
  // образуя нужную строку), либо когда пагинация увела нас с первой
  // страницы (есть since/until).
  const showHome = onHome && (dayMode || !!activeFilters?.since || !!activeFilters?.until);
  if (showHome) {
    const homeBtn = document.createElement('button');
    homeBtn.type        = 'button';
    homeBtn.className   = 'btn btn-primary pagination-home-btn';
    homeBtn.textContent = '🏠 На главную';
    homeBtn.addEventListener('click', onHome);
    filtersDisplay.appendChild(homeBtn);
  }
}
