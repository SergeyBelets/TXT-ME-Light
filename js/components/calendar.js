console.log('[calendar.js] v: 2026-07-04-v1');
/**
 * components/calendar.js — календарь в сайдбаре (только vanilla-фронтенд).
 *
 * Два верхних ряда — выбор года и месяца (по умолчанию текущие).
 * Ниже — таблица дней месяца по неделям (Пн—Вс). Дни, в которые есть
 * записи, подсвечиваются точкой снизу. Клик по дню — фильтр ленты
 * по дате создания записи (показывает все записи этого дня без
 * ограничения обычным лимитом пагинации).
 *
 * createCalendar({ onSelectDay }) → Element
 */

import store from '../store.js';
import { postsAPI } from '../api.js';
import { clearElement } from '../utils/dom.js';
import { dayKey, parseDayKey } from '../utils/format.js';

const MONTHS_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
const WEEKDAYS     = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

/**
 * @param {{ onSelectDay: (dayKey: string) => void }} opts
 * @returns {HTMLElement}
 */
export function createCalendar({ onSelectDay }) {
  const now = new Date();
  let year  = now.getFullYear();
  let month = now.getMonth(); // 0-11

  const wrap = document.createElement('div');
  wrap.className = 'calendar-section';

  const title = document.createElement('span');
  title.className   = 'filter-title';
  title.textContent = 'Календарь';
  wrap.appendChild(title);

  // ── Ряд выбора года ──────────────────────────────────────────────
  const yearRow = document.createElement('div');
  yearRow.className = 'calendar-year-row';

  const yearPrev = document.createElement('button');
  yearPrev.type = 'button';
  yearPrev.className = 'calendar-nav-btn';
  yearPrev.textContent = '‹';
  yearPrev.setAttribute('aria-label', 'Предыдущий год');

  const yearLabel = document.createElement('span');
  yearLabel.className = 'calendar-year-label';

  const yearNext = document.createElement('button');
  yearNext.type = 'button';
  yearNext.className = 'calendar-nav-btn';
  yearNext.textContent = '›';
  yearNext.setAttribute('aria-label', 'Следующий год');

  yearRow.appendChild(yearPrev);
  yearRow.appendChild(yearLabel);
  yearRow.appendChild(yearNext);
  wrap.appendChild(yearRow);

  // ── Ряд выбора месяца ────────────────────────────────────────────
  const monthRow = document.createElement('div');
  monthRow.className = 'calendar-month-row';
  const monthBtns = MONTHS_SHORT.map((name, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'calendar-month-btn';
    btn.textContent = name;
    btn.addEventListener('click', () => { month = idx; _refresh(); });
    monthRow.appendChild(btn);
    return btn;
  });
  wrap.appendChild(monthRow);

  // ── Таблица дней ─────────────────────────────────────────────────
  const table = document.createElement('table');
  table.className = 'calendar-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const wd of WEEKDAYS) {
    const th = document.createElement('th');
    th.textContent = wd;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  const tbody = document.createElement('tbody');
  table.appendChild(thead);
  table.appendChild(tbody);
  wrap.appendChild(table);

  yearPrev.addEventListener('click', () => { year -= 1; _refresh(); });
  yearNext.addEventListener('click', () => { year += 1; _refresh(); });

  let _token = 0;

  function _currentSelectedKey() {
    return (store.get('activeFilters') ?? {}).day ?? null;
  }

  async function _refresh() {
    yearLabel.textContent = String(year);
    monthBtns.forEach((btn, idx) => btn.classList.toggle('active', idx === month));

    const selectedKey = _currentSelectedKey();
    // Сначала рисуем сетку без отметок «есть записи», чтобы UI не подвисал в ожидании сети
    _renderGrid(tbody, year, month, new Set(), selectedKey, onSelectDay);

    const token = ++_token;
    try {
      const marks = await _loadMonthMarks(year, month);
      if (token !== _token) return; // месяц/год сменили пока грузилось — отбрасываем устаревший ответ
      _renderGrid(tbody, year, month, marks, _currentSelectedKey(), onSelectDay);
    } catch {
      // Не удалось загрузить отметки — календарь остаётся рабочим, просто без подсветки дней с записями
    }
  }

  function _highlightSelected() {
    const selectedKey = _currentSelectedKey();
    tbody.querySelectorAll('.calendar-day.active').forEach(el => el.classList.remove('active'));
    if (!selectedKey) return;
    const { year: sy, month: sm, day: sd } = parseDayKey(selectedKey);
    if (sy !== year || sm !== month) return;
    tbody.querySelectorAll('.calendar-day').forEach(el => {
      if (Number(el.textContent) === sd) el.classList.add('active');
    });
  }

  // Держим подсветку в актуальном состоянии, если день сняли/поставили не через сам
  // календарь (например, крестиком на бейдже фильтра в пагинации). Если активный
  // день оказался в другом месяце/году — переключаем календарь на него.
  store.on('change:activeFilters', () => {
    const selectedKey = _currentSelectedKey();
    if (selectedKey) {
      const { year: sy, month: sm } = parseDayKey(selectedKey);
      if (sy !== year || sm !== month) {
        year = sy;
        month = sm;
        _refresh();
        return;
      }
    }
    _highlightSelected();
  });

  _refresh();

  return wrap;
}

// ── Загрузка отметок «есть записи» за месяц ─────────────────────────
//
// У бэкенда (CMS-Posts-ListV2) since и until взаимоисключающие — диапазонный
// запрос "весь месяц одним вызовом" через них невозможен. Отдельного
// агрегирующего эндпоинта по месяцу тоже нет. Поэтому проверяем каждый день
// месяца отдельно через официальный режим day (GET /v2/posts?day=YYYY-MM-DD),
// с limit:1 — нужен только факт «есть хотя бы одна запись», не сами данные.
//
// Важно: НЕ шлём все ~31 запрос одним залпом. На холодной Lambda/DynamoDB
// (например, самый первый запрос после простоя) резкий всплеск параллельных
// Query по одному и тому же GSI иногда упирается в burst-capacity и часть
// запросов падает с 500. Поэтому идём небольшими партиями и с ретраем на
// случай единичного транзиентного сбоя.

const MARKS_BATCH_SIZE   = 6;
const MARKS_MAX_ATTEMPTS = 3;

async function _loadMonthMarks(year, month) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const marks = new Set();

  for (let i = 0; i < days.length; i += MARKS_BATCH_SIZE) {
    const chunk = days.slice(i, i + MARKS_BATCH_SIZE);
    const results = await Promise.all(chunk.map((d) => _checkDayHasPosts(year, month, d)));
    for (const { d, has } of results) {
      if (has) marks.add(d);
    }
  }

  return marks;
}

async function _checkDayHasPosts(year, month, d, attempt = 0) {
  const key = dayKey(year, month, d);
  try {
    const data = await postsAPI.getV2({ day: key, limit: 1 });
    return { d, has: (data?.items?.length ?? 0) > 0 };
  } catch (err) {
    if (attempt < MARKS_MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, 300 + attempt * 400));
      return _checkDayHasPosts(year, month, d, attempt + 1);
    }
    // Отметка за этот день не критична — лучше без неё, чем ронять весь календарь
    console.warn(`[calendar] не удалось проверить день ${key}:`, err.message);
    return { d, has: false };
  }
}

// ── Рендер сетки месяца ──────────────────────────────────────────────

function _renderGrid(tbody, year, month, marks, selectedKey, onSelectDay) {
  clearElement(tbody);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const jsFirstDay  = new Date(year, month, 1).getDay(); // 0=Вс..6=Сб
  const leading     = (jsFirstDay + 6) % 7;              // 0=Пн..6=Вс

  const now      = new Date();
  const todayKey = dayKey(now.getFullYear(), now.getMonth(), now.getDate());

  const cells = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  for (let row = 0; row < cells.length / 7; row++) {
    const tr = document.createElement('tr');
    for (let col = 0; col < 7; col++) {
      const day = cells[row * 7 + col];
      const td  = document.createElement('td');

      if (day == null) {
        td.className = 'calendar-empty';
      } else {
        const key = dayKey(year, month, day);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'calendar-day';
        btn.textContent = String(day);
        if (marks.has(day))      btn.classList.add('has-posts');
        if (key === todayKey)    btn.classList.add('today');
        if (key === selectedKey) btn.classList.add('active');
        btn.addEventListener('click', () => onSelectDay(key));
        td.appendChild(btn);
      }

      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}
