// Newest first. Every Tuesday: add a line at the top. The home page shows the first; reading.html lists them all.
const READING = [
  { title: 'WeatherNext 3: Increasing resolution and performance of global weather models with raw observations', author: 'Stephan Rasp et al., with Peter Battaglia', url: 'https://arxiv.org/abs/2609.03582' },
  { title: 'Understanding Adam Requires Better Rotation Dependent Assumptions', author: 'Tianyue H. Zhang et al., with Ioannis Mitliagkas', url: 'https://arxiv.org/abs/2410.19964' },
];
function renderPaper(parent, { title, author, url }) {
  const line = (cls, child) => {
    const p = document.createElement('p'), t = document.createElement('span');
    t.className = cls; t.append(child); p.append(t); parent.append(p);
  };
  const link = document.createElement('a');
  link.className = 'title'; link.href = url; link.textContent = title;
  line('t', link);
  line('t m', author);
}
