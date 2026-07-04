/**
 * pagination.js — компонент пагинации (курсорная + режим календарного дня).
 * Рендерит кнопки «← Предыдущие» / «Следующие →» и активные фильтры.
 * Используется дважды: вверху и внизу ленты.
 *
 * В режиме календарного дня (activeFilters.day задан) кнопки перелистывания
 * всегда доступны и ведут на предыдущий/следующий календарный день —
 * независимо от того, есть там записи или нет.
 *
 * createPagination({ onPrev, onNext, onRemoveFilter }) → Element
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
 *   onRemoveFilter: (key: 'tag'|'author'|'since'|'until'|'day') => void,
 * }} opts
 * @returns {HTMLElement}
 */
export function createPagination({ onPrev, onNext, onRemoveFilter }) {
  const container = document.createElement('div');
  container.className = 'pagination-container';

  const controls = document.createElement('div');
  controls.className = 'pagination-controls';

  // Кнопка «Предыдущие» / «Предыдущий день»
  const btnPrev = document.createElement('button');
  btnPrev.className   = 'btn';
  btnPrev.textContent = '← Предыдущие';
  btnPrev.addEventListener('click', onPrev);

  // Центральная зона активных фильтров
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
  container._onRemoveFilter = onRemoveFilter;

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
  const onRemove       = el._onRemoveFilter;

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

  // Активные фильтры
  filtersDisplay.innerHTML = '';

  const labels = {
    day:    (v) => `День: ${formatDayKey(v)}`,
    tag:    (v) => `Тег: ${v.startsWith('#') ? v.slice(1) : v}`,
    author: (v) => `Автор: ${v}`,
    since:  (v) => `С: ${v}`,
    until:  (v) => `По: ${v}`,
  };

  for (const [key, label] of Object.entries(labels)) {
    const val = activeFilters?.[key];
    if (!val) continue;

    const frag   = cloneTemplate('tpl-active-filter');
    const badge  = frag.querySelector('.active-filter');
    badge.querySelector('[data-slot="label"]').textContent = label(val);
    badge.querySelector('[data-slot="remove"]').addEventListener('click', () => onRemove(key));
    filtersDisplay.appendChild(badge);
  }
}
