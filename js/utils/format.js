console.log('[format.js] v: 2026-07-04-v10');
/**
 * format.js — утилиты форматирования дат, склонений, ролей, тегов.
 */

const MONTHS = [
  'января','февраля','марта','апреля','мая','июня',
  'июля','августа','сентября','октября','ноября','декабря',
];

function _pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Нормализует timestamp в миллисекунды.
 * DynamoDB хранит createdAt в миллисекундах, но некоторые посты — в секундах с большим значением.
 * Проверяем: если результат в мс даёт год > 2100 или < 2000 — пробуем как секунды.
 * @param {number} ts
 * @returns {number} миллисекунды
 */
function _toMs(ts) {
  if (!ts) return 0;
  // Пробуем как миллисекунды
  const asMs = ts;
  const year = new Date(asMs).getFullYear();
  if (year >= 2000 && year <= 2100) return asMs;
  // Иначе — секунды
  return ts * 1000;
}

/**
 * Публичная обёртка над _toMs — используется компонентами вне format.js
 * (например, календарём) для нормализации createdAt.
 * @param {number} ts
 * @returns {number} миллисекунды
 */
export function toMs(ts) {
  return _toMs(ts);
}

/** Unix timestamp (мс или с) → «12 января 2026» */
export function formatDate(ts) {
  const d = new Date(_toMs(ts));
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Unix timestamp (мс или с) → «12.01.2026» */
export function formatDateShort(ts) {
  const d = new Date(_toMs(ts));
  return `${_pad2(d.getDate())}.${_pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Unix timestamp (мс или с) → «2 часа назад» / «3 дня назад» / «12 января 2026» */
export function formatRelative(ts) {
  return formatDate(ts);
}

/** Русское склонение числительных. */
export function pluralize(n, forms) {
  const abs = Math.abs(n) % 100;
  const mod = abs % 10;
  if (abs > 10 && abs < 20) return `${n} ${forms[2]}`;
  if (mod === 1)             return `${n} ${forms[0]}`;
  if (mod >= 2 && mod <= 4) return `${n} ${forms[1]}`;
  return `${n} ${forms[2]}`;
}

/** Перевод роли на русский. */
export function getRoleDisplay(role) {
  const map = {
    NASTOIATEL:  'Настоятель',
    SMOTRITEL:   'Смотритель',
    AVTOR:       'Автор',
    KOMMENTATOR: 'Комментатор',
  };
  return map[role] ?? role;
}

/** Удаляет # из начала тега и приводит к нижнему регистру. */
export function cleanTag(tag) {
  if (!tag) return '';
  const t = tag.startsWith('#') ? tag.slice(1) : tag;
  return t.toLowerCase();
}

/** Роли, которым разрешено писать посты. */
export function canPost(role) {
  return ['NASTOIATEL', 'SMOTRITEL', 'AVTOR'].includes(role);
}

/** Роли с правом модерации (могут удалять чужие комментарии). */
export function isAdmin(role) {
  return ['NASTOIATEL', 'SMOTRITEL'].includes(role);
}

/* ════════════════════════════════════════
   КАЛЕНДАРЬ — работа с ключами дня 'YYYY-MM-DD'
   ════════════════════════════════════════ */

/**
 * Собрать ключ дня из года/месяца(0-11)/числа.
 * @param {number} year
 * @param {number} month 0-11
 * @param {number} day
 * @returns {string} 'YYYY-MM-DD'
 */
export function dayKey(year, month, day) {
  return `${year}-${_pad2(month + 1)}-${_pad2(day)}`;
}

/**
 * Разобрать ключ дня.
 * @param {string} key 'YYYY-MM-DD'
 * @returns {{year:number, month:number, day:number}} month 0-11
 */
export function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { year: y, month: m - 1, day: d };
}

/** 'YYYY-MM-DD' → «04.07.2026» */
export function formatDayKey(key) {
  const { year, month, day } = parseDayKey(key);
  return `${_pad2(day)}.${_pad2(month + 1)}.${year}`;
}

/**
 * Сдвинуть ключ дня на N дней (может быть отрицательным).
 * @param {string} key
 * @param {number} delta
 * @returns {string}
 */
export function shiftDayKey(key, delta) {
  const { year, month, day } = parseDayKey(key);
  const d = new Date(year, month, day + delta);
  return dayKey(d.getFullYear(), d.getMonth(), d.getDate());
}
