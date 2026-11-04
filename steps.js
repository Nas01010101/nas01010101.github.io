'use strict';
// The equations each pipeline step runs, typeset in text so they share the page's font.
// `say` is the same equation on one line, for screen readers.
const art = String.raw;
const eq = (say, text = say) => ({ say, rows: text.split('\n').filter(row => row.trim()) });

function flows(r) {
  const w = r && r.weather, o = r && r.satellites, m = w && w.model, days = w ? Number(w.train_days) : 45;
  // The satellite pipeline has fewer lines, so on two columns its streams run longer to end level with the weather one.
  const rows = 4, longer = matchMedia('(min-width:760px)').matches ? 19 : rows;
  const part = (list, shape) => ({ rows: list.slice(8, 11), caption: shape });
  const place = c => c.place.replace('near ', '').padEnd(10);
  const worked = ({ cell: c }) => {
    const raw = c.mean + c.change, sum = `${c.mean} ${c.change < 0 ? '-' : '+'} ${Math.abs(c.change)}`;
    if (raw < 0 || raw > 100) return `${place(c)} clip(${sum}) = ${c.predicted}`;
    return `${place(c)} ${sum} ${Math.abs(raw - c.predicted) > .05 ? '~' : '='} ${c.predicted}`;
  };
  const week = w && w.week.cloud, newest = o && o.horizons[0], count = o ? o.count : 'N';
  const lanes = m && {
    rows: 8, width: 8, label: '1 value per cell', names: ['yest', '2d', '3d', 'N', 'S', 'E', 'W'], bands: m.bands,
  };
  $('weather-flow').replaceChildren(); $('sat-flow').replaceChildren();
  drawPipeline($('weather-flow'), [
    {
      title: 'Open-Meteo forecast API',
      eq: [eq('c for day d, hour h, cell i is between 0 and 100', art`
c       in [0, 100]
 d,h,i`)],
      detail: ['c: cloud cover in percent, on day d, hour h, cell i', '1,152 cells, hourly, once a day. Temperature runs the same way.'],
      strip: w && part(w.last_scored.actual, 'actual cloud cover, 3 latitude rows'),
      stream: { rows, width: 30, label: '[hours,24,48]' },
    },
    {
      title: 'validate',
      eq: [eq('c is between 0 and 100', art`
0 <= c      <= 100
      d,h,i`), eq('n i is at least 18', art`
n  >= 18
 i`), eq('missing cells over 1152 is at most 1 percent', art`
missing cells
-------------  <= 1%
    1152`)],
      detail: ['n: hours a cell has in one day. Temperature and rain have their own ranges.'],
      stream: { rows, width: 30, label: '[hours,24,48]' },
    },
    {
      title: 'preprocess',
      eq: [eq('C d i is the mean of c over the hours of day d', art`
         1   __
C    =  ---  \    c
 d,i     n   /_    d,h,i
          i   h`), eq('C bar i is the mean of C over the days before t', art`
_        1   __
C    =  ---  \    C
 i       t   /_    d,i
             d<t`), eq('delta d i is C d i minus C bar i', art`
                _
δ    =  C    -  C
 d,i     d,i     i`)],
      detail: [`${days} complete days, up to 60. t: the day being forecast. δ: departure from the cell's mean.`],
      stream: { rows, width: 22, label: `[${days},24,48]` },
    },
    {
      title: 'train',
      eq: [eq('x d i is delta for the last three days and the four neighbours yesterday', art`
                                 N,S,E,W
x    = [δ     , δ     , δ     , δ       ]
 d,i     d-1,i   d-2,i   d-3,i   d-1`), eq('main loss: L of w is the sum of a i times delta minus x transpose w, squared, plus lambda times the squared norm of w', art`
main loss function
        __              T     2          2
L(w) =  \   a  (δ    - x    w)  + λ ||w||
        /_   i   d,i    d,i
        d,i`), eq('w is the inverse of X transpose A X plus lambda I, times X transpose A delta', art`
      T          -1 T
w = (X A X + λ I)  X  A δ`), eq(`a i is the cosine of latitude, lambda is ${m ? m.ridge : 1}`, art`
a  = cos(lat ),   λ = ${m ? m.ridge : 1}
 i          i`)],
      detail: ['x: the last 3 days of a cell and its 4 neighbours yesterday.', 'One linear layer, solved in one step with no gradient descent. Each latitude band fits its own 7 weights, drawn below as lanes. Training minimises squared error; the scores use absolute error.'],
      stream: lanes || { rows, width: 8, label: '[3,7]' },
    },
    {
      title: 'predict',
      eq: [eq('C hat t i is C bar i plus x transpose w for the band', art`
^       _      T
C    =  C  +  x     w
 t,i     i     t,i   b`), eq('C hat t i is limited to between 0 and 100', art`
^                        ^
C    <- min(100, max(0,  C   ))
 t,i                      t,i`), ...(m ? m.bands.map(b => eq(worked(b))) : [])],
      detail: [`b: the cell's latitude band. The min and max apply to cloud cover only.${m ? ` Named cells are for ${m.date}.` : ''}`],
      strip: w && part(w.today.map, `predicted cloud cover for ${w.today.date}`),
      stream: { rows, width: 16, label: '[24,48]' },
    },
    {
      title: 'score',
      eq: [eq('MAE is the sum of a i times the absolute error, over the sum of a i', art`
        __      ^
        \   a  |C    - C   |
        /_   i   t,i    t,i
         i
MAE  =  --------------------
             __
             \   a
             /_   i
              i`), ...(m ? m.bands.map(({ cell: c }) => eq(`${place(c)} |${c.predicted} - ${c.actual}| = ${c.error}`)) : []),
      ...(week ? [eq(`model ${week.model}  persist ${week.persistence}  mean ${week.trailing_mean}`)] : [])],
      detail: [`Cloud points. ${m ? `Named cells are predicted against the actual for ${m.date}; the last row is this week. ` : ''}Persistence repeats yesterday; mean is the cell mean above.`],
      strip: w && part(w.last_scored.error, `|predicted - actual| for ${w.last_scored.date}`),
    },
  ], still);
  drawPipeline($('sat-flow'), [
    {
      title: 'CelesTrak active elements',
      eq: [eq("e is mean motion, eccentricity, inclination, node, perigee, anomaly, decay and drag", "e = (n, e, i, Ω, ω, M, n', B*)")],
      detail: ['mean motion, eccentricity, inclination, node, perigee, anomaly, decay, drag', `${o ? fmt(o.count) + ' satellites' : 'All active satellites'}, one snapshot a day.`],
      stream: { rows: longer, width: 26, label: `[${count},8]` },
    },
    {
      title: 'validate',
      eq: [eq('N is at least 5000', 'N >= 5000'), eq('dropped rows over N is at most 5 percent', art`
dropped rows
------------  <= 5%
     N`)],
      detail: ['Keeps 9 days of snapshots.'],
      stream: { rows: longer, width: 26, label: `[${count},8]` },
    },
    {
      title: 'preprocess',
      eq: [eq('id is in both the old and new snapshot', art`
id in I    and I
       old      new`), eq('t old is before t new', art`
t    <  t
 old     new`)],
      detail: ['I: the NORAD ids in a snapshot. t: the epoch of its elements.'],
      stream: { rows: longer, width: 20, label: '[n,8]' },
    },
    {
      title: 'predict',
      eq: [eq('r old is SGP4 of the old elements at t new', art`
r    = SGP4(e   , t   )
 old         old   new`), eq('s is about z transpose w', art`
     T
s ~ z  w`), eq('z is tau, tau squared, decay times tau squared, drag times tau squared, and 1', art`
         2      2      2
z = [τ, τ , n' τ , B* τ , 1]`)],
      detail: ['Elements 1 to 7 days old. s: along-track error. τ: element age. The drift fit covers low orbits only.'],
      stream: { rows: longer, width: 14, label: '[n,3]' },
    },
    {
      title: 'actual',
      eq: [eq('r new is SGP4 of the new elements at t new', art`
r    = SGP4(e   , t   )
 new         new   new`)],
      detail: ['The newest elements stand in for the true position.'],
      stream: { rows: longer, width: 14, label: '[n,3]' },
    },
    {
      title: 'score',
      eq: [eq('d is the norm of r old minus r new', art`
d = || r    - r    ||
        old    new`), eq('d drift is the root of rho squared plus chi squared plus s minus z transpose w squared', art`
           _______________________
          /  2    2         T   2
d      = /  ρ  + χ  + (s - z  w)
 drift \/`), eq(newest && newest.low ? `median(d) = ${newest.low.median_km} km` : 'median(d) by orbit and age')],
      detail: [`ρ, χ: radial and cross-track error, in km.${newest && newest.low ? ` Median for low orbits, ${newest.days} day old elements.` : ''}`],
    },
  ], still);
}
