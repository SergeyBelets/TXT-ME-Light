console.log('[format.js] v: 2026-02-27-v9');
/**
 * format.js — утилиты форматирования дат, склонений, ролей, тегов.
 */

const MONTHS = [
  'января','февраля','марта','апреля','мая','июня',
  'июля','августа','сентября','октября','ноября','декабря',
];

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

/** Unix timestamp (мс или с) → «12 января 2026» */
export function formatDate(ts) {
  const d = new Date(_toMs(ts));
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Unix timestamp (мс или с) → «12.01.2026» */
export function formatDateShort(ts) {
  const d  = new Date(_toMs(ts));
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
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
