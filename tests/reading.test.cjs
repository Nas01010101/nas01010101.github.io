const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

test('every paper in reading.js has a title, an author line and an arXiv link, newest first', () => {
  const ctx = {};
  vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'reading.js'), 'utf8')}; this.READING = READING;`, ctx);
  for (const { title, author, url } of ctx.READING) assert(title && author && /^https:\/\/arxiv\.org\/abs\/\d{4}\.\d{4,5}$/.test(url), title);
  assert.strictEqual(new Set(ctx.READING.map(p => p.url)).size, ctx.READING.length, 'no paper listed twice');
});
