#!/usr/bin/env node
// E-184 install entry — CRX capability verification (handoff step 2).
//
// Downloads the OFFICIAL signed CRX from Google's update service for the
// existing store entry and verifies the Schedule capabilities the share
// page's install flow depends on:
//   1. version >= EXPECT_MIN (first compatible candidate: 12.2.0)
//   2. manifest content_scripts contain a Schedule entry whose matches cover
//      the deployment origins (host matches, not just any script)
//   3. background bundle contains the PERSONAL_SCHEDULE_BRIDGE handler
//
// Exit 0 only when every capability check passes — an HTTP 200 from the
// store page alone proves nothing (the 11.1.0 package also returns 200).
// Until this script passes, SCHEDULE_EXT_INSTALL_URL must stay unset.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXT_ID = process.env.EXT_ID || 'kefnadjndpllbibeklhajjddgmlbafel';
const EXPECT_MIN = process.env.EXPECT_MIN || '12.2.0';
const REQUIRED_MATCH_HOSTS = (process.env.REQUIRED_HOSTS || 'schedule.xmnup.com,localhost,127.0.0.1').split(',').map((h) => h.trim()).filter(Boolean);
const BRIDGE_MARKER = 'PERSONAL_SCHEDULE_BRIDGE';
const SCHEDULE_SCRIPT = 'contentScriptSchedule';

const ver = (v) => String(v || '0').split('.').map((p) => parseInt(p, 10) || 0);
const older = (a, b) => {
  const x = ver(a), y = ver(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d < 0;
  }
  return false;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crx-verify-'));
const crxPath = path.join(tmp, 'ext.crx');
const url = `https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3&prodversion=120.0.0.0&x=id%3D${EXT_ID}%26uc`;

console.log('downloading official CRX:', url);
execFileSync('curl', ['-sL', '-o', crxPath, '-w', '%{http_code} %{size_download}', url], { stdio: ['ignore', 'inherit', 'inherit'] });

// strip the CRX3 header: 'Cr24' + version + headerLen + protobuf
const buf = fs.readFileSync(crxPath);
if (buf.slice(0, 4).toString() !== 'Cr24') { console.error('FAIL: not a CRX file'); process.exit(1); }
const headerLen = buf.readUInt32LE(8);
const zipPath = path.join(tmp, 'ext.zip');
fs.writeFileSync(zipPath, buf.subarray(12 + headerLen));
execFileSync('unzip', ['-oq', zipPath, '-d', path.join(tmp, 'pkg')], { stdio: 'ignore' });
const pkg = path.join(tmp, 'pkg');

const results = [];
const check = (id, ok, note) => { results.push([id, ok]); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + (note ? '  — ' + note : '')); };

// 1. version
const manifest = JSON.parse(fs.readFileSync(path.join(pkg, 'manifest.json'), 'utf8'));
const v = manifest.version;
check('version', !older(v, EXPECT_MIN), `official package version ${v} (need >= ${EXPECT_MIN})`);

// 2. schedule content script with real host matches
const cs = manifest.content_scripts || [];
const scheduleCs = cs.filter((e) => (e.js || []).some((j) => j.includes(SCHEDULE_SCRIPT)));
const matchedHosts = REQUIRED_MATCH_HOSTS.filter((h) => scheduleCs.some((e) => (e.matches || []).some((m) => m.includes(h))));
check('schedule-content-script', scheduleCs.length > 0 && matchedHosts.length === REQUIRED_MATCH_HOSTS.length,
  `${SCHEDULE_SCRIPT} present=${scheduleCs.length > 0}; host matches ${matchedHosts.join(',') || 'NONE'} (need ${REQUIRED_MATCH_HOSTS.join(',')})`);

// 3. background bridge handler
let bgHasBridge = false;
for (const cand of ['background.js']) {
  const p2 = path.join(pkg, cand);
  if (fs.existsSync(p2) && fs.readFileSync(p2, 'utf8').includes(BRIDGE_MARKER)) bgHasBridge = true;
}
check('background-bridge', bgHasBridge, `${BRIDGE_MARKER} handler in background.js`);

fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter(([, ok]) => !ok);
console.log('---');
console.log(`checks: ${results.length}, pass: ${results.length - failed.length}, fail: ${failed.length}`);
if (failed.length) {
  console.log('NOT COMPATIBLE — SCHEDULE_EXT_INSTALL_URL must stay unset until every check passes.');
  process.exit(1);
}
console.log('COMPATIBLE — safe to configure SCHEDULE_EXT_INSTALL_URL to the store entry and SCHEDULE_EXT_MIN_VERSION=' + v);
