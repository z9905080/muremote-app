#!/usr/bin/env node
/**
 * 下載 Android platform-tools (adb) 並解壓到 resources/adb
 * 打包時會一併包含，確保應用在任何環境都能運作
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const PLATFORM_TOOLS_URL = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip';
const OUTPUT_DIR = path.join(__dirname, '..', 'resources', 'adb', 'windows');
const ADB_FILES = ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll'];

function download(url) {
  return new Promise((resolve, reject) => {
    const file = path.join(__dirname, '..', 'platform-tools-temp.zip');
    const stream = fs.createWriteStream(file);
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return download(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: ${res.statusCode}`));
        return;
      }
      res.pipe(stream);
      stream.on('finish', () => {
        stream.close();
        resolve(file);
      });
    }).on('error', reject);
  });
}

function extractZip(zipPath) {
  const extractZip = require('extract-zip');
  const extractDir = path.join(__dirname, '..', 'platform-tools-temp');
  return extractZip(zipPath, { dir: extractDir }).then(() => extractDir);
}

function copyAdbFiles(extractDir) {
  const platformToolsDir = path.join(extractDir, 'platform-tools');
  if (!fs.existsSync(platformToolsDir)) {
    throw new Error('platform-tools folder not found in archive');
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const file of ADB_FILES) {
    const src = path.join(platformToolsDir, file);
    const dest = path.join(OUTPUT_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log('  ✓', file);
    } else {
      console.warn('  ⚠', file, 'not found in archive');
    }
  }
}

function cleanup(tempFiles) {
  for (const f of tempFiles) {
    try {
      if (fs.existsSync(f)) {
        fs.statSync(f).isDirectory() ? fs.rmSync(f, { recursive: true }) : fs.unlinkSync(f);
      }
    } catch (e) {}
  }
}

async function main() {
  if (fs.existsSync(path.join(OUTPUT_DIR, 'adb.exe'))) {
    console.log('ADB already bundled, skipping download.');
    return;
  }
  console.log('Downloading Android platform-tools...');
  const zipPath = await download(PLATFORM_TOOLS_URL);
  console.log('Extracting...');
  const extractDir = await extractZip(zipPath);
  console.log('Copying ADB files to', OUTPUT_DIR);
  copyAdbFiles(extractDir);
  cleanup([zipPath, extractDir]);
  console.log('Done! ADB bundled at resources/adb/windows/');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
