// Small shared helpers used across datasources and the bot.

// Reduce a phone to comparable digits. Handles +380..., 00380..., spaces, dashes, etc.
function normalizePhone(v) {
  return String(v == null ? "" : v).replace(/\D/g, "");
}

// Tolerant match: exact digits, or one is the other's last-9 suffix (national vs +country).
function phonesMatch(a, b) {
  a = normalizePhone(a);
  b = normalizePhone(b);
  if (!a || !b) return false;
  if (a === b) return true;
  const tail = s => s.slice(-9);
  return tail(a) === tail(b) && tail(a).length === 9;
}

module.exports = { normalizePhone, phonesMatch };
