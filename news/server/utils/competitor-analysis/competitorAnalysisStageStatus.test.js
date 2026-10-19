const assert = require('assert');
const {
  formatStageDuration,
  buildStageTimeline,
  resolveListStatus,
  pickLatestMeaningfulRun,
} = require('./competitorAnalysisStageStatus');

assert.strictEqual(formatStageDuration(0), '0秒');
assert.strictEqual(formatStageDuration(30 * 1000), '30秒');
assert.strictEqual(formatStageDuration((25 * 60 + 30) * 1000), '25分30秒');
assert.strictEqual(formatStageDuration(25 * 60 * 1000), '25分');
assert.strictEqual(formatStageDuration((1 * 3600 + 20 * 60 + 10) * 1000), '1小时20分钟10秒');
assert.strictEqual(formatStageDuration(2 * 3600 * 1000), '2小时');
assert.strictEqual(formatStageDuration((1 * 3600 + 10) * 1000), '1小时10秒');

const t0 = Date.parse('2026-10-16T02:00:00Z');
const logs = [
  { step_code: 'S0_profile', status: 'ok', created_at: new Date(t0 + 90 * 1000) },
  { step_code: 'S1_recall', status: 'ok', created_at: new Date(t0 + (90 + 25 * 60 + 30) * 1000) },
];
const running = buildStageTimeline({
  status: 'running',
  startedAt: new Date(t0),
  logs,
  nowMs: t0 + (90 + 25 * 60 + 30 + 40) * 1000,
});
assert.strictEqual(running.stages[0].label, '准备画像');
assert.strictEqual(running.stages[0].state, 'done');
assert.strictEqual(running.stages[0].duration_text, '1分30秒');
assert.strictEqual(running.stages[1].duration_text, '25分30秒');
assert.strictEqual(running.stages[2].state, 'running');
assert.strictEqual(running.stages[2].label, '规则打分');
assert.strictEqual(running.stages[2].duration_text, '40秒');
assert.strictEqual(running.stages[3].state, 'pending');
assert.strictEqual(running.stages[3].duration_text, '');

const queued = resolveListStatus('ai_done', { id: 'r1', status: 'queued', started_at: new Date(t0) }, [], t0);
assert.strictEqual(queued.label, '准备画像');
assert.strictEqual(queued.clickable, true);

const mid = resolveListStatus('ai_done', { id: 'r1', status: 'running', started_at: new Date(t0) }, logs, t0);
assert.strictEqual(mid.label, '规则打分');

assert.deepStrictEqual(resolveListStatus('ai_done', { id: 'r2', status: 'success' }, [], t0), {
  label: '已完成分析',
  clickable: true,
  runId: 'r2',
});
assert.strictEqual(resolveListStatus('qcc_done', { id: 'r3', status: 'failed' }, [], t0).label, '分析失败');
assert.deepStrictEqual(resolveListStatus('draft', null, [], t0), {
  label: 'draft',
  clickable: false,
  runId: '',
});

const latest = pickLatestMeaningfulRun([
  { id: 'new', status: 'stub' },
  { id: 'run', status: 'success' },
]);
assert.strictEqual(latest.id, 'run');

const failedWrite = buildStageTimeline({
  status: 'failed',
  startedAt: new Date(t0),
  logs: [
    ...logs,
    { step_code: 'S6_done', status: 'failed', created_at: new Date(t0 + 999000) },
  ],
  nowMs: t0 + 999000,
});
assert.strictEqual(failedWrite.stages[5].state, 'pending');
assert.strictEqual(failedWrite.stages[1].state, 'done');

console.log('competitorAnalysisStageStatus.test.js ok');
