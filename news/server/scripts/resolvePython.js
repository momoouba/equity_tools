const { spawnSync } = require('child_process');

function resolvePythonBin() {
  if (process.env.PYTHON) return process.env.PYTHON;
  if (process.platform === 'win32') {
    const probe = spawnSync('py', ['-3', '-c', 'import sys'], { encoding: 'utf8', windowsHide: true });
    if (probe.status === 0) return 'py';
  }
  return 'python';
}

/** @returns {string[]} */
function pythonArgs(scriptPath, args = []) {
  const bin = resolvePythonBin();
  if (bin === 'py') return ['-3', scriptPath, ...args];
  return [scriptPath, ...args];
}

module.exports = { resolvePythonBin, pythonArgs };
