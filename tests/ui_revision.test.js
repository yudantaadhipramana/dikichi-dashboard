const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

for (const id of ['dashboardTabsMount', 'dashboardLayoutContent', 'visualAuditTrend', 'visualProductTrend', 'monthlyItemSection', 'monthlyOutletSection', 'itemRankingSection', 'outletRankingSection', 'followUpSection', 'recentAuditsSection', 'followUpToolbar', 'followUpSummary']) {
  assert.ok(html.includes(`id="${id}"`), `HTML has ${id}`);
}
assert.ok(app.includes('function installDashboardLayout()'));
assert.ok(app.includes('function renderFollowUpControls(audits)'));
assert.ok(app.includes('function renderFollowUps(audits)'));
assert.ok(app.includes('function simulateParameterScenario(audits, parameter, targetScore)'));
assert.ok(app.includes('function renderItemAttention(item)'));
assert.ok(app.includes('function selectView(view)'));
assert.ok(app.includes('bindFollowUpControls();'));
assert.ok(app.includes('FOLLOW_UP_PAGE_SIZE = 8'));
assert.ok(app.includes('if (quality) quality.remove();'));
assert.ok(app.includes('itemSection.after(disclosure)'));
assert.ok(app.includes('Simulasi, bukan prediksi.'));
assert.ok(app.includes('renderCharts(DashboardState.data)'));
assert.ok(app.includes('return Number(a.score || 0) - Number(b.score || 0);'));
assert.ok(css.includes('.dashboard-view-tabs'));
assert.ok(css.includes('.fu-pagination'));
assert.ok(css.includes('.what-if-panel'));
assert.ok(css.includes(':focus-visible'));
assert.ok(css.includes('@media (max-width: 640px)'));

const scenarioMatch = app.match(/function simulateParameterScenario\(audits, parameter, targetScore\) \{[\s\S]*?\n\}/);
assert.ok(scenarioMatch, 'scenario calculator present');
const scenario = vm.runInNewContext(`(${scenarioMatch[0].replace('function simulateParameterScenario', 'function')})`);
const audits = [
  { auditId: 'a1', attributes: [
    { product: 'P', item: 'I1', attribute: 'Taste', score: 1 },
    { product: 'P', item: 'I1', attribute: 'Texture', score: 5 },
    { product: 'P', item: 'I2', attribute: 'Taste', score: 3 }
  ] },
  { auditId: 'a2', attributes: [
    { product: 'P', item: 'I1', attribute: 'Taste', score: 5 }
  ] }
];
assert.equal(scenario(audits, '', 0), 11 / 3, 'baseline averages per audit-item then observations');
assert.equal(scenario(audits, 'Taste', 5), 5, 'scenario changes selected parameter before aggregation');
assert.equal(scenario([], 'Taste', 5), null, 'empty scenario returns null');

console.log('UI revision source contract and what-if aggregation tests passed');
