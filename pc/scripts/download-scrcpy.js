/**
 * download-scrcpy.js
 *
 * 下載 scrcpy-server JAR 到 resources/scrcpy/ 目錄。
 * 在 npm postinstall / prebuild 時自動執行。
 *
 * 下載來源：
 *   https://github.com/Genymobile/scrcpy/releases/download/v2.4/scrcpy-server-v2.4
 *
 * 若已存在且大小正確則跳過下載。
 */

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');

const SCRCPY_VERSION = '2.4';
const SCRCPY_URL     = `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/scrcpy-server-v${SCRCPY_VERSION}`;
const OUT_DIR        = path.join(__dirname, '..', 'resources', 'scrcpy');
const OUT_FILE       = path.join(OUT_DIR, 'scrcpy-server.jar');

// 已知 v2.4 server JAR 的大小（bytes），用於快速校驗
// 若官方更新導致大小不同，可以調低 minSize 進行容錯判斷
const MIN_EXPECTED_SIZE = 50_000;  // 正常應有 ~100-400KB

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[download-scrcpy] 建立目錄：${dir}`);
  }
}

function download(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      return reject(new Error('重定向次數過多'));
    }

    const proto = url.startsWith('https') ? https : http;
    const file  = fs.createWriteStream(dest);

    const req = proto.get(url, (res) => {
      // 處理重定向（GitHub releases 會 302 到 CDN）
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(dest, () => {});
        console.log(`[download-scrcpy] 重定向至：${res.headers.location}`);
        return download(res.headers.location, dest, redirectCount + 1)
          .then(resolve)
          .catch(reject);
      }

      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;

      res.on('data', (chunk) => {
        received += chunk.length;
        if (total > 0) {
          const pct = Math.round((received / total) * 100);
          process.stdout.write(`\r[download-scrcpy] 下載中... ${pct}%`);
        }
      });

      res.pipe(file);

      file.on('finish', () => {
        file.close(() => {
          process.stdout.write('\n');
          resolve();
        });
      });
    });

    req.on('error', (err) => {
      file.close();
      fs.unlink(dest, () => {});
      reject(err);
    });

    req.setTimeout(30_000, () => {
      req.destroy(new Error('下載逾時'));
    });
  });
}

async function main() {
  ensureDir(OUT_DIR);

  // 已存在且大小合理 → 跳過
  if (fs.existsSync(OUT_FILE)) {
    const size = fs.statSync(OUT_FILE).size;
    if (size >= MIN_EXPECTED_SIZE) {
      console.log(`[download-scrcpy] scrcpy-server.jar 已存在 (${size} bytes)，跳過下載`);
      return;
    }
    console.log(`[download-scrcpy] 檔案大小異常 (${size} bytes)，重新下載...`);
    fs.unlinkSync(OUT_FILE);
  }

  console.log(`[download-scrcpy] 下載 scrcpy-server v${SCRCPY_VERSION}...`);
  console.log(`[download-scrcpy] 來源：${SCRCPY_URL}`);

  try {
    await download(SCRCPY_URL, OUT_FILE);
    const size = fs.statSync(OUT_FILE).size;
    if (size < MIN_EXPECTED_SIZE) {
      fs.unlinkSync(OUT_FILE);
      throw new Error(`下載的檔案大小不足（${size} bytes），可能下載失敗`);
    }
    console.log(`[download-scrcpy] 下載完成：${OUT_FILE} (${size} bytes)`);
  } catch (err) {
    console.error(`[download-scrcpy] 下載失敗：${err.message}`);
    console.warn('[download-scrcpy] 警告：scrcpy-server.jar 不存在，將回退到 screencap 模式（~2 FPS）');
    console.warn('[download-scrcpy] 可以手動下載並放置到 resources/scrcpy/scrcpy-server.jar');
    // 不拋出錯誤，讓 npm install 仍可完成（screencap 仍可作為 fallback）
    process.exit(0);
  }
}

main();
