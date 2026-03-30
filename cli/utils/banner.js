const path = require("node:path");

const BRAND_COLOR = "\x1b[38;2;101;187;233m";
const RESET = "\x1b[0m";
const version = require(path.join(__dirname, "..", "..", "package.json")).version;

function printBanner() {
  console.log(
    `\n ${BRAND_COLOR}\u{1F327}\uFE0F  rain.js ${version}${RESET}`,
  );
  console.log(`${BRAND_COLOR}${"─".repeat(20)}${RESET}\n`);
}

module.exports = { printBanner, version, BRAND_COLOR, RESET };
