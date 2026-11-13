#!/usr/bin/env node
// Rewrites the merged pull request counts on index.html between <!-- prs:start --> and <!-- prs:end -->.
// Run daily by .github/workflows/update-prs.yml; GITHUB_TOKEN raises the search rate limit.
'use strict';
const fs = require('node:fs'), path = require('node:path');

const AUTHOR = 'Nas01010101';
// Own repositories are not contributions.
const SKIP_OWNERS = ['Nas01010101', 'EduTech-Interactive'];
// Organisations with their own row, in tie-break order; every other repository goes to "other repos".
const ORGS = [['google-deepmind', 'Google DeepMind'], ['QwenLM', 'QwenLM'], ['NVIDIA', 'NVIDIA'], ['openclaw', 'OpenClaw'], ['nasa', 'NASA']];
// Closed without a merge on GitHub because the maintainers copied the change in themselves
// (copybara commits 131ab9e and 75ada2f in alphafold3, 55c6332 in mujoco). Search cannot see these.
const APPLIED = ['google-deepmind/alphafold3#765', 'google-deepmind/alphafold3#766', 'google-deepmind/mujoco#3301'];

// Repository names of the author's merged PRs outside their own repositories, from the search API.
async function fetchMerged(token) {
  const q = encodeURIComponent(`author:${AUTHOR} is:pr is:closed ${SKIP_OWNERS.map(o => `-user:${o}`).join(' ')}`);
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'site-pr-count', ...(token && { Authorization: `Bearer ${token}` }) };
  const repos = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`https://api.github.com/search/issues?q=${q}&per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`search failed: ${res.status} ${await res.text()}`);
    const { items } = await res.json();
    for (const it of items) if (it.pull_request && it.pull_request.merged_at) repos.push(it.repository_url.split('/repos/')[1]);
    if (items.length < 100) return repos;
  }
}

// Rows of { org, label, repos: [[name, n]], merged }, largest first, "other repos" last.
function tally(repos) {
  const all = [...repos, ...APPLIED.map(s => s.split('#')[0])].filter(r => !SKIP_OWNERS.includes(r.split('/')[0]));
  const rows = [...ORGS.map(([org, label]) => ({ org, label, repos: new Map() })), { org: null, label: 'other repos', repos: new Map() }];
  for (const full of all) {
    const [owner, name] = full.split('/');
    const row = rows.find(r => r.org === owner) || rows[rows.length - 1];
    row.repos.set(name, (row.repos.get(name) || 0) + 1);
  }
  return rows.map(r => ({ ...r, repos: [...r.repos].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), merged: [...r.repos.values()].reduce((a, n) => a + n, 0) }))
    .filter(r => r.merged).sort((a, b) => !a.org - !b.org || b.merged - a.merged);
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function render(rows, date) {
  const total = rows.reduce((a, r) => a + r.merged, 0), nRepos = rows.reduce((a, r) => a + r.repos.length, 0);
  const line = r => {
    const name = r.org ? `<a href="https://github.com/search?q=author%3A${AUTHOR}+org%3A${r.org}+is%3Amerged&amp;type=pullrequests">${esc(r.label)}</a>` : esc(r.label);
    return `        <tr data-prs="${r.merged}"><td class="orgs"><span class="t">${name}</span> <span class="t m">${r.repos.map(([n]) => esc(n)).join(', ')}</span></td><td class="num"><span class="t">${r.merged}</span></td></tr>`;
  };
  return ['<!-- prs:start -->',
    `      <p class="split" data-prs="${total}"><span class="t">${total} merged PRs, ${nRepos} repos</span><span class="t m">${date}</span></p>`,
    '      <table class="gap">', ...rows.map(line), '      </table>',
    '      <!-- prs:end -->'].join('\n');
}

function rewrite(html, block) {
  const re = /<!-- prs:start -->[\s\S]*?<!-- prs:end -->/;
  if (!re.test(html)) throw new Error('prs markers not found in index.html');
  return html.replace(re, block);
}

async function main() {
  const file = path.join(__dirname, '..', 'index.html'), html = fs.readFileSync(file, 'utf8');
  const rows = tally(await fetchMerged(process.env.GITHUB_TOKEN));
  // Keep the old date when the counts did not change, so the page is only rewritten on a real change.
  const keep = html.match(/<span class="t m">(\d{4}-\d\d-\d\d)<\/span><\/p>\s*<table class="gap">/);
  const stale = keep && rewrite(html, render(rows, keep[1]));
  const out = stale === html ? html : rewrite(html, render(rows, new Date().toISOString().slice(0, 10)));
  if (out !== html) fs.writeFileSync(file, out);
  console.log(out === html ? 'unchanged' : 'updated', rows.map(r => `${r.label} ${r.merged}`).join(', '));
}

if (require.main === module) main().catch(err => { console.error(err.message); process.exit(1); });
module.exports = { tally, render, rewrite, APPLIED };
