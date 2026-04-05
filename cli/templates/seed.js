function seedTemplate() {
  return [
    "INSERT INTO example (name) VALUES ('Sample 1');",
    "INSERT INTO example (name) VALUES ('Sample 2');",
    "",
  ].join("\n");
}

module.exports = { seedTemplate };
