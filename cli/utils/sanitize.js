const CONTROL_CHARS_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

function stripControlChars(input) {
  if (typeof input !== "string") return "";
  return input.replace(CONTROL_CHARS_RE, "");
}

module.exports = { stripControlChars };
