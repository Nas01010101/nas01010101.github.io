const test = require('node:test'), assert = require('node:assert');
const { tally, render, rewrite, isBug, APPLIED } = require('../scripts/update_prs.cjs');

test('every organisation gets a row, sorted by merged PRs then name, with no catch-all and own or club repos dropped', () => {
  const applied = org => APPLIED.filter(s => s.startsWith(`${org}/`)).length;
  const rows = tally(['NVIDIA/warp', 'NVIDIA/warp', 'dora-rs/dora', 'apache/brpc', 'foo/bar', 'Nas01010101/compass', 'EduTech-Interactive/x', 'dirobot/site', 'DIROBOTS/site', 'DiRobots/x']);
  const merged = Object.fromEntries(rows.map(r => [r.label, r.merged]));
  assert.deepStrictEqual(merged, { 'Google DeepMind': applied('google-deepmind'), NVIDIA: 2 + applied('NVIDIA'), Apache: 1, 'dora-rs': 1, foo: 1 });
  assert(!rows.some(r => /other/.test(r.label)));
  const counts = rows.map(r => r.merged);
  assert.deepStrictEqual(counts, [...counts].sort((a, b) => b - a), 'most merged first');
  const ones = rows.filter(r => r.merged === 1).map(r => r.label);
  assert.deepStrictEqual(ones, [...ones].sort((a, b) => a.localeCompare(b)), 'ties by name');
  assert.deepStrictEqual(rows.find(r => r.label === 'NVIDIA').repos[0], ['warp', 2]);
  assert.strictEqual(tally(['QwenLM/qwen-code']).find(r => r.org === 'QwenLM').label, 'Qwen Code');
  assert.strictEqual(tally(['huawei-noah/trustworthyAI']).find(r => r.org === 'huawei-noah').label, "Huawei Noah's Ark");
});

test('the table has DeepMind, NVIDIA and Qwen Code rows in that order, one row for the rest, and totals that add up', () => {
  const { TOP, OTHERS } = require('../scripts/update_prs.cjs');
  const rows = tally(['QwenLM/qwen-code', 'nasa/fprime', '<o>/x']), bugs = ['NVIDIA/warp', 'tensorflow/tensorflow', 'pytorch/rl'];
  const block = render(rows, '2026-11-13', bugs);
  const got = [...block.matchAll(/<tr data-prs="\d+"><td class="orgs">(.*?)<\/td>(.*?)<\/tr>/g)].map(([, n, c]) => [n.replace(/<[^>]*>/g, ''), ...[...c.matchAll(/<span class="t">(\d+)</g)].map(m => +m[1])]);
  const dm = APPLIED.filter(s => s.startsWith('google-deepmind/')).length, nv = APPLIED.filter(s => s.startsWith('NVIDIA/')).length;
  assert.deepStrictEqual(got, [['Google DeepMind', dm, 0, dm], ['NVIDIA', nv, 1, nv + 1], ['Qwen Code', 1, 0, 1], [OTHERS, 2, 2, 4]]);
  assert.strictEqual(TOP.length + 1, got.length);
  const total = 3 + APPLIED.length;
  assert.match(block, new RegExp(`<span class="t">total</span></td><td class="num"><span class="t">${total}</span></td><td class="num"><span class="t">3</span></td><td class="num"><span class="t">${total + 3}</span>`));
  assert.match(block, new RegExp(`<p class="pr" data-prs="${total}"><span class="t m">open-source contributions</span><br><span class="t m">updated 2026-11-13</span></p>`));
  assert(block.indexOf('data-prs="' + total + '"') < block.indexOf('<tr data-prs'), 'the headline is the first data-prs element');
  assert(!block.includes('<o>') && !/class="t big"/.test(block), 'no raw names, no large numbers');
  const html = `x\n      <!-- prs:start -->old<!-- prs:end -->\ny`;
  assert.strictEqual(rewrite(html, block), `x\n      ${block}\ny`);
  assert.throws(() => rewrite('no markers', block));
  assert.strictEqual(require('../scripts/update_prs.cjs').lastDate(`x\n${block}`), '2026-11-13', 'the daily job reads the date back');
});

test('bug reports leave out own and club repos, benhoangquan and the formal-conjectures problem statements', () => {
  assert(isBug('tensorflow/tensorflow') && isBug('google-deepmind/mujoco') && isBug('NVIDIA/warp'));
  assert(!isBug('Nas01010101/compass') && !isBug('EduTech-Interactive/x') && !isBug('DIROBOTS/site') && !isBug('dirobot/x'));
  assert(!isBug('benhoangquan/thing') && !isBug('BenHoangQuan/thing'));
  assert(!isBug('google-deepmind/formal-conjectures') && !isBug('Google-DeepMind/Formal-Conjectures'));
});

test('an applied PR that search already returns as merged is not counted twice', () => {
  const { applied } = require('../scripts/update_prs.cjs');
  const left = applied([{ url: 'https://github.com/NVIDIA/DALI/pull/6604' }]);
  assert.ok(!left.includes('NVIDIA/DALI#6604'));
  assert.equal(left.length, APPLIED.length - 1);
});
