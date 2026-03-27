const { spawnSync } = require("node:child_process");

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: true,
    cwd: process.cwd(),
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  return result.status;
}

function npmInstall(packages, isDev = false) {
  const args = ["install", ...(isDev ? ["-D"] : []), ...packages];
  return runCommand("npm", args);
}

module.exports = { runCommand, npmInstall };
