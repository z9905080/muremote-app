/**
 * H.264 SPS/PPS NAL unit 偵測與緩存邏輯測試
 *
 * 用法：node test/nal_cache_test.js
 *
 * 驗證 streamer.js 中 _cacheNalUnits / _findNextStartCode 的核心邏輯，
 * 確保 ffmpeg 啟動前能正確取得 SPS+PPS，避免 "non-existing PPS 0 referenced" 錯誤。
 */

// ─── 複製自 streamer.js 的純邏輯（獨立測試，不引入 Electron 依賴）───────────

function findNextStartCode(buf, from) {
  for (let i = from; i <= buf.length - 4; i++) {
    if (buf[i] === 0x00 && buf[i+1] === 0x00 &&
        buf[i+2] === 0x00 && buf[i+3] === 0x01) {
      return i;
    }
  }
  return buf.length;
}

function cacheNalUnits(state, chunk) {
  let i = 0;
  while (i <= chunk.length - 5) {
    if (chunk[i] === 0x00 && chunk[i+1] === 0x00 &&
        chunk[i+2] === 0x00 && chunk[i+3] === 0x01) {
      const nalType = chunk[i+4] & 0x1F;
      const nextStart = findNextStartCode(chunk, i + 4);
      if (nalType === 7) {        // SPS
        state.spsNal = chunk.slice(i, nextStart);
        state.ppsNal = null;
        state.idrNal = null;
      } else if (nalType === 8) { // PPS
        state.ppsNal = chunk.slice(i, nextStart);
        state.idrNal = null;
      } else if (nalType === 5 && state.spsNal && state.ppsNal) { // IDR
        state.idrNal = chunk.slice(i, nextStart);
      }
      i = nextStart;
    } else {
      i++;
    }
  }
}

// ─── 測試資料 ────────────────────────────────────────────────────────────────

const SC = Buffer.from([0x00, 0x00, 0x00, 0x01]);   // Annex B 起始碼

// 假的 NAL payloads（含 NAL header byte 作為第一個 byte）
const SPS_V1 = Buffer.from([0x67, 0x42, 0x00, 0x1E, 0xAB, 0xCD]);  // NAL type 7
const SPS_V2 = Buffer.from([0x67, 0x64, 0x00, 0x28, 0x12]);         // 更新的 SPS
const PPS_V1 = Buffer.from([0x68, 0xCE, 0x38, 0x80]);               // NAL type 8
const IDR    = Buffer.from([0x65, 0x88, 0x84, 0x00]);               // NAL type 5 (IDR)
const PFRAME = Buffer.from([0x41, 0x9A, 0x00]);                      // NAL type 1 (P-frame)

// ─── 測試工具 ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

function test(name, fn) {
  console.log(`\n[${name}]`);
  fn();
}

// ─── 測試案例 ────────────────────────────────────────────────────────────────

test('基本偵測：SPS + PPS + IDR 在同一個 chunk', () => {
  const chunk = Buffer.concat([SC, SPS_V1, SC, PPS_V1, SC, IDR]);
  const state = { spsNal: null, ppsNal: null, idrNal: null };
  cacheNalUnits(state, chunk);

  assert(state.spsNal !== null, 'SPS NAL 被偵測到');
  assert(state.ppsNal !== null, 'PPS NAL 被偵測到');
  assert(state.idrNal !== null, 'IDR NAL 被偵測到');
  assert(state.spsNal[4] === 0x67, 'SPS NAL header byte = 0x67');
  assert(state.ppsNal[4] === 0x68, 'PPS NAL header byte = 0x68');
  assert(state.idrNal[4] === 0x65, 'IDR NAL header byte = 0x65');
  assert(state.spsNal.length === 4 + SPS_V1.length,
    `SPS 長度正確：${state.spsNal.length} = 4(起始碼) + ${SPS_V1.length}(payload)`);
  assert(state.ppsNal.length === 4 + PPS_V1.length,
    `PPS 長度正確：${state.ppsNal.length} = 4(起始碼) + ${PPS_V1.length}(payload)`);
});

test('僅有 P-frame 的 chunk 不影響已緩存的 SPS/PPS/IDR', () => {
  const state = { spsNal: null, ppsNal: null, idrNal: null };
  cacheNalUnits(state, Buffer.concat([SC, SPS_V1, SC, PPS_V1, SC, IDR]));
  const savedSps = state.spsNal;
  const savedPps = state.ppsNal;
  const savedIdr = state.idrNal;

  // 第二個 chunk：只有 P-frame
  cacheNalUnits(state, Buffer.concat([SC, PFRAME]));

  assert(state.spsNal === savedSps, 'P-frame chunk 不覆蓋已緩存的 SPS');
  assert(state.ppsNal === savedPps, 'P-frame chunk 不覆蓋已緩存的 PPS');
  assert(state.idrNal === savedIdr, 'P-frame chunk 不覆蓋已緩存的 IDR');
});

test('SPS 更新：後來的 SPS 覆蓋先前緩存，並重置 PPS/IDR', () => {
  const state = { spsNal: null, ppsNal: null, idrNal: null };
  cacheNalUnits(state, Buffer.concat([SC, SPS_V1, SC, PPS_V1, SC, IDR]));
  assert(state.idrNal !== null, '第一個 GOP 後 IDR 已緩存');

  // 新的 SPS 到來（解析度變更），應重置 PPS/IDR
  cacheNalUnits(state, Buffer.concat([SC, SPS_V2]));

  assert(state.spsNal.length === 4 + SPS_V2.length,
    `SPS 已更新為新版本（${state.spsNal.length} bytes）`);
  assert(state.ppsNal === null, '新 SPS 到來後 PPS 被重置（等待新 PPS）');
  assert(state.idrNal === null, '新 SPS 到來後 IDR 被重置（等待新 IDR）');
});

test('ffmpeg 啟動前應能組出 SPS+PPS+IDR buffer', () => {
  const state = { spsNal: null, ppsNal: null, idrNal: null };
  cacheNalUnits(state, Buffer.concat([SC, SPS_V1, SC, PPS_V1, SC, IDR]));

  const canStart = state.spsNal !== null && state.ppsNal !== null && state.idrNal !== null;
  assert(canStart, '有緩存的 SPS+PPS+IDR，ffmpeg 可以立即解碼');

  if (canStart) {
    const gop = Buffer.concat([state.spsNal, state.ppsNal, state.idrNal]);
    const expected = state.spsNal.length + state.ppsNal.length + state.idrNal.length;
    assert(gop.length === expected,
      `SPS+PPS+IDR 組合正確，總長度：${gop.length} bytes`);
    assert(gop[0] === 0x00 && gop[1] === 0x00 &&
           gop[2] === 0x00 && gop[3] === 0x01 && gop[4] === 0x67,
      'GOP buffer 以 SPS 起始碼（00 00 00 01 67）開頭');
  }
});

test('邊界情況：NAL unit 在 chunk 結尾（無後續起始碼）', () => {
  // 只有一個 SPS，後面沒有其他 NAL
  const chunk = Buffer.concat([SC, SPS_V1]);
  const state = { spsNal: null, ppsNal: null };
  cacheNalUnits(state, chunk);

  assert(state.spsNal !== null, '末尾的 SPS 也能被偵測到');
  assert(state.spsNal.length === 4 + SPS_V1.length,
    `末尾 SPS 長度正確：${state.spsNal?.length} bytes`);
});

test('邊界情況：chunk 不包含起始碼（純 P-frame 資料）', () => {
  const chunk = Buffer.from([0x41, 0x9A, 0xBC, 0xDE, 0xFF]);
  const state = { spsNal: null, ppsNal: null, idrNal: null };
  cacheNalUnits(state, chunk);  // 不應 crash

  assert(state.spsNal === null, '無起始碼的 chunk 不產生 SPS');
  assert(state.ppsNal === null, '無起始碼的 chunk 不產生 PPS');
  assert(state.idrNal === null, '無起始碼的 chunk 不產生 IDR');
});

test('多個 chunk 依序到達（模擬真實 scrcpy 串流）', () => {
  const state = { spsNal: null, ppsNal: null, idrNal: null };

  // chunk 1: SPS + PPS（IDR 尚未到）
  cacheNalUnits(state, Buffer.concat([SC, SPS_V1, SC, PPS_V1]));
  assert(state.spsNal !== null && state.ppsNal !== null, 'chunk 1 後 SPS+PPS 已緩存');
  assert(state.idrNal === null, 'chunk 1 後 IDR 尚未緩存（正確）');

  // chunk 2: IDR
  cacheNalUnits(state, Buffer.concat([SC, IDR]));
  assert(state.idrNal !== null, 'chunk 2 後 IDR 已緩存');

  // chunk 3–N: P-frames（不包含 SPS/PPS/IDR）
  for (let i = 0; i < 5; i++) {
    cacheNalUnits(state, Buffer.concat([SC, PFRAME]));
  }

  assert(state.spsNal !== null, 'P-frame 串流後 SPS 仍在緩存中');
  assert(state.ppsNal !== null, 'P-frame 串流後 PPS 仍在緩存中');
  assert(state.idrNal !== null, 'P-frame 串流後 IDR 仍在緩存中');

  // IDR 只有在 SPS 之後才會被接受（沒有先看到 SPS 的 IDR 不快取）
  const state2 = { spsNal: null, ppsNal: null, idrNal: null };
  cacheNalUnits(state2, Buffer.concat([SC, IDR]));  // 沒有前置 SPS+PPS
  assert(state2.idrNal === null, 'SPS+PPS 前的 IDR 不被快取');
});

// ─── 結果 ────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`結果：${passed} 通過，${failed} 失敗`);
console.log('─'.repeat(50));

if (failed > 0) {
  console.error('\n有測試失敗！請檢查 streamer.js 的 _cacheNalUnits 邏輯。');
  process.exit(1);
} else {
  console.log('\n所有測試通過。SPS/PPS 緩存邏輯正確，ffmpeg 應能正常解碼。');
  process.exit(0);
}
