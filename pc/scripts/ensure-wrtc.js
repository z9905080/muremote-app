const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function info(msg) {
  console.log(`[ensure-wrtc] ${msg}`);
}

function warn(msg) {
  console.warn(`[ensure-wrtc] ${msg}`);
}

function run(cmd, args, cwd, extraEnv = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      ...extraEnv,
      PATH: extraEnv.PATH || process.env.PATH,
    },
  });
  return result.status === 0;
}

function getPathEntriesForBins(wrtcDir) {
  const entries = [];
  const projectBin = path.join(process.cwd(), 'node_modules', '.bin');
  const wrtcBin = path.join(wrtcDir, 'node_modules', '.bin');
  if (fs.existsSync(projectBin)) entries.push(projectBin);
  if (fs.existsSync(wrtcBin)) entries.push(wrtcBin);
  if (process.env.PATH) entries.push(process.env.PATH);
  return entries.join(path.delimiter);
}

function tryRunOriginalDownloader(wrtcDir) {
  const downloader = path.join(wrtcDir, 'scripts', 'download-prebuilt.js');
  if (!fs.existsSync(downloader)) {
    warn('download script not found; skipping');
    return false;
  }

  return run(process.execPath, [downloader], wrtcDir, {
    PATH: getPathEntriesForBins(wrtcDir),
  });
}

function tryRunNodePreGypLocalJs(wrtcDir) {
  let nodePreGypBin;
  try {
    nodePreGypBin = require.resolve('node-pre-gyp/bin/node-pre-gyp', {
      paths: [wrtcDir, process.cwd()],
    });
  } catch (_) {
    return false;
  }

  info('trying fallback: local node-pre-gyp JS entry');
  return run(process.execPath, [nodePreGypBin, 'install'], wrtcDir, {
    PATH: getPathEntriesForBins(wrtcDir),
  });
}

function tryRunNodePreGypViaNpmExec(wrtcDir) {
  info('trying fallback: npm exec node-pre-gyp install');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return run(npmCmd, ['exec', '--yes', 'node-pre-gyp@0.13.0', '--', 'install'], wrtcDir, {
    PATH: getPathEntriesForBins(wrtcDir),
  });
}

function tryRunNodePreGypViaNpx(wrtcDir) {
  info('trying fallback: npx -p node-pre-gyp node-pre-gyp install');
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return run(npxCmd, ['-p', 'node-pre-gyp@0.13.0', 'node-pre-gyp', 'install'], wrtcDir, {
    PATH: getPathEntriesForBins(wrtcDir),
    npm_config_yes: 'true',
  });
}

function main() {
  let wrtcPackageJson;
  try {
    wrtcPackageJson = require.resolve('wrtc/package.json', { paths: [process.cwd()] });
  } catch (_) {
    info('wrtc not installed; skipping');
    return;
  }

  const wrtcDir = path.dirname(wrtcPackageJson);
  const binaryPath = path.join(wrtcDir, 'build', 'Release', 'wrtc.node');
  if (fs.existsSync(binaryPath)) {
    info('native binary already present');
    return;
  }

  info('native binary missing, downloading prebuilt artifact');
  let ok = tryRunOriginalDownloader(wrtcDir);
  if (!ok) {
    ok = tryRunNodePreGypLocalJs(wrtcDir);
  }
  if (!ok) {
    ok = tryRunNodePreGypViaNpmExec(wrtcDir);
  }
  if (!ok) {
    ok = tryRunNodePreGypViaNpx(wrtcDir);
  }

  if (!ok) {
    warn('failed to download prebuilt artifact');
  }

  if (fs.existsSync(binaryPath)) {
    info('native binary downloaded successfully');
    return;
  }

  warn('download completed but wrtc.node is still missing');
}

main();
