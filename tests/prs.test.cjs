const test = require('node:test'), assert = require('node:assert');
const { tally, render, rewrite, APPLIED } = require('../scripts/update_prs.cjs');

test('merged PRs group by organisation, own repos drop out, maintainer-applied fixes count', () => {
  const rows = tally(['NVIDIA/warp', 'NVIDIA/DALI', 'NVIDIA/warp', 'dora-rs/dora', 'Nas01010101/compass', 'EduTech-Interactive/x']);
  assert.deepStrictEqual(rows.map(r => [r.label, r.merged]), [['Google DeepMind', APPLIED.length], ['NVIDIA', 3], ['other repos', 1]]);
  assert.deepStrictEqual(rows[1].repos, [['warp', 2], ['DALI', 1]]);
});

test('the block lists repos after the organisation and the rows add up to the headline', () => {
  const block = render(tally(['QwenLM/qwen-code', 'a/<b>']), '2026-11-13');
  assert.match(block, /data-prs="5"><span class="t">5 merged PRs, 4 repos<\/span><span class="t m">2026-11-13/);
  assert.match(block, /Google DeepMind<\/a><\/span> <span class="t m">alphafold3, mujoco<\/span>/);
  assert(block.includes('&lt;b&gt;') && !block.includes('<b>'), 'repo names are escaped');
  const html = `x\n      <!-- prs:start -->old<!-- prs:end -->\ny`;
  assert.strictEqual(rewrite(html, block), `x\n      ${block}\ny`);
  assert.throws(() => rewrite('no markers', block));
});
