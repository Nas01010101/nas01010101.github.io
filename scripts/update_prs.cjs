#!/usr/bin/env node
// Rewrites the contributions table on index.html (merged PRs and bug reports) between <!-- prs:start --> and <!-- prs:end -->.
// Run daily by .github/workflows/update-prs.yml; GITHUB_TOKEN raises the search rate limit.
'use strict';
const fs = require('node:fs'), path = require('node:path');

const AUTHOR = 'Nas01010101';
// Own repositories and the robotics club's are not contributions. Compared case-insensitively, as GitHub does.
const SKIP_OWNERS = ['Nas01010101', 'EduTech-Interactive', 'dirobot', 'DIROBOTS'];
const skipped = owner => SKIP_OWNERS.some(o => o.toLowerCase() === owner.toLowerCase());
// Display names; an owner without an entry shows its login.
const LABELS = {
  'google-deepmind': 'Google DeepMind', QwenLM: 'Qwen Code', NVIDIA: 'NVIDIA', openclaw: 'OpenClaw', nasa: 'NASA', 'dora-rs': 'dora-rs',
  apache: 'Apache', fsspec: 'fsspec', 'Genesis-Embodied-AI': 'Genesis', modelscope: 'ModelScope', 'newton-physics': 'Newton',
  'huawei-noah': "Huawei Noah's Ark", tensorflow: 'TensorFlow', pytorch: 'PyTorch',
};
const label = owner => (Object.entries(LABELS).find(([k]) => k.toLowerCase() === owner.toLowerCase()) || [, owner])[1];
// Closed without a merge on GitHub because the maintainers copied the change in themselves
// (copybara commits 131ab9e and 75ada2f in alphafold3, 55c6332 in mujoco; 6888b0e in DALI). Search cannot see these.
const APPLIED = ['google-deepmind/alphafold3#765', 'google-deepmind/alphafold3#766', 'google-deepmind/mujoco#3301', 'NVIDIA/DALI#6604'];
// The organisations with a row of their own, in this order; every other one is counted in the last row.
const TOP = ['google-deepmind', 'NVIDIA', 'QwenLM'];
const OTHERS = 'TensorFlow, PyTorch, NASA, ModelScope, Newton Physics, Dora, Huawei, Apache and others';

const headers = token => ({ Accept: 'application/vnd.github+json', 'User-Agent': 'site-pr-count', ...(token && { Authorization: `Bearer ${token}` }) });

// Every page of a search query as { repo, title, url, item }; the caller keeps the items it wants.
async function search(query, token) {
  const q = encodeURIComponent(query), out = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`https://api.github.com/search/issues?q=${q}&per_page=100&page=${page}`, { headers: headers(token) });
    if (!res.ok) throw new Error(`search failed: ${res.status} ${await res.text()}`);
    const { items } = await res.json();
    for (const it of items) out.push({ repo: it.repository_url.split('/repos/')[1], title: it.title, url: it.html_url, item: it });
    if (items.length < 100) return out;
  }
}

// The author's merged PRs outside their own repositories, as { repo, title, url, mergedAt }, from the search API.
async function fetchMerged(token) {
  const found = await search(`author:${AUTHOR} is:pr is:closed ${SKIP_OWNERS.map(o => `-user:${o}`).join(' ')}`, token);
  return found.filter(({ item }) => item.pull_request && item.pull_request.merged_at)
    .map(({ repo, title, url, item }) => ({ repo, title, url, mergedAt: item.pull_request.merged_at.slice(0, 10) }));
}

// Issues in other people's repositories are bug reports, except where the owner or repository is excluded:
// formal-conjectures issues are problem statements and benhoangquan's are not defects.
const NOT_BUGS = ['user:benhoangquan', 'repo:google-deepmind/formal-conjectures'];
const isBug = repo => !skipped(repo.split('/')[0]) && repo.split('/')[0].toLowerCase() !== 'benhoangquan' && repo.toLowerCase() !== 'google-deepmind/formal-conjectures';

// The repository of each bug report the author opened, from the search API.
async function fetchBugs(token) {
  const found = await search(`author:${AUTHOR} is:issue ${[...SKIP_OWNERS.map(o => `user:${o}`), ...NOT_BUGS].map(q => `-${q}`).join(' ')}`, token);
  return found.filter(({ repo }) => isBug(repo)).map(({ repo }) => repo);
}

// APPLIED entries that search does not already return as merged; DALI#6604 later showed as merged and was counted twice.
const applied = prs => APPLIED.filter(a => !prs.some(p => p.url.endsWith(`/${a.replace('#', '/pull/')}`)));

// One row per organisation as { org, label, repos: [[name, n]], merged }, most merged PRs first, ties by label.
function tally(repos, extra = APPLIED) {
  const rows = new Map();
  for (const full of [...repos, ...extra.map(s => s.split('#')[0])]) {
    const [owner, name] = full.split('/');
    if (skipped(owner)) continue;
    const row = rows.get(owner.toLowerCase()) || rows.set(owner.toLowerCase(), { org: owner, label: label(owner), repos: new Map() }).get(owner.toLowerCase());
    row.repos.set(name, (row.repos.get(name) || 0) + 1);
  }
  return [...rows.values()].map(r => ({ ...r, repos: [...r.repos].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), merged: [...r.repos.values()].reduce((a, n) => a + n, 0) }))
    .sort((a, b) => b.merged - a.merged || a.label.localeCompare(b.label));
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The headline <p> stays the first [data-prs] element because index.html reads the merged total from it.
// The update date render() wrote, read back so an unchanged day keeps it.
const lastDate = html => (html.match(/<p class="pr" data-prs="\d+">.*?<span class="t m">updated (\d{4}-\d\d-\d\d)<\/span><\/p>/) || [])[1];
// The contributions table: merged PRs, bug reports and their sum for each TOP organisation, one row for the rest, then the totals.
// rows comes from tally(), bugs is the repository of each bug report.
function render(rows, date, bugs) {
  const top = org => TOP.findIndex(t => t.toLowerCase() === org.toLowerCase());
  const counts = [...TOP.map(org => ({ label: label(org), url: `https://github.com/search?q=author%3A${AUTHOR}+org%3A${org}&type=pullrequests`, prs: 0, issues: 0 })), { label: OTHERS, prs: 0, issues: 0 }];
  const at = org => counts[top(org) < 0 ? TOP.length : top(org)];
  for (const r of rows) at(r.org).prs += r.merged;
  for (const repo of bugs) at(repo.split('/')[0]).issues++;
  const cell = n => `<td class="num"><span class="t">${n}</span></td>`;
  const name = c => c.url ? `<span class="t"><a href="${esc(c.url)}">${esc(c.label)}</a></span>` : `<span class="t m">${esc(c.label)}</span>`;
  const sum = k => counts.reduce((a, c) => a + c[k], 0), prs = sum('prs'), issues = sum('issues');
  return ['<!-- prs:start -->',
    `      <p class="pr" data-prs="${prs}"><span class="t m">open-source contributions</span><br><span class="t m">updated ${date}</span></p>`,
    '      <table class="gap">',
    `        <tr><td></td>${['merged<br>PRs', 'issues', 'total'].map(h => `<td class="num"><span class="t m">${h}</span></td>`).join('')}</tr>`,
    ...counts.map(c => `        <tr data-prs="${c.prs}"><td class="orgs">${name(c)}</td>${cell(c.prs)}${cell(c.issues)}${cell(c.prs + c.issues)}</tr>`),
    `        <tr><td><span class="t">total</span></td>${cell(prs)}${cell(issues)}${cell(prs + issues)}</tr>`,
    '      </table>',
    '      <!-- prs:end -->'].join('\n');
}

function rewrite(html, block, name = 'prs') {
  const re = new RegExp(`<!-- ${name}:start -->[\\s\\S]*?<!-- ${name}:end -->`);
  if (!re.test(html)) throw new Error(`${name} markers not found in index.html`);
  // A function replacement keeps "$" in PR titles literal.
  return html.replace(re, () => block);
}

async function main() {
  const file = path.join(__dirname, '..', 'index.html'), before = fs.readFileSync(file, 'utf8'), token = process.env.GITHUB_TOKEN;
  const [prs, bugs] = await Promise.all([fetchMerged(token), fetchBugs(token)]);
  const rows = tally(prs.map(p => p.repo), applied(prs));
  // Keep the old date when the counts did not change, so the page is only rewritten on a real change.
  const keep = lastDate(before);
  const stale = keep && rewrite(before, render(rows, keep, bugs));
  const out = stale === before ? before : rewrite(before, render(rows, new Date().toISOString().slice(0, 10), bugs));
  if (out !== before) fs.writeFileSync(file, out);
  console.log(out === before ? 'unchanged' : 'updated', rows.map(r => `${r.label} ${r.merged}`).join(', '));
}

if (require.main === module) main().catch(err => { console.error(err.message); process.exit(1); });
module.exports = { TOP, OTHERS, applied, lastDate, tally, render, rewrite, isBug, fetchMerged, fetchBugs, APPLIED };
