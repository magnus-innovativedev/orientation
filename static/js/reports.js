/* Reports tab for the management page. Fed by GET /api/admin/report (no phone numbers).
   Developer: data checks + all records. Admin: all branches. Branch-scoped users: their own branch. */
(function () {
  'use strict';
  const C = { coral: 'var(--mocha-brown)', teal: 'var(--mocha-teal)', amber: 'var(--mocha-tan)', leather: 'var(--mocha-muted-brown)', sand: 'var(--mocha-tan)', rust: 'var(--mocha-rust)', ink: 'var(--mocha-ink)', booked: 'var(--mocha-booked)' };
  const VIEW_NAMES = { developer: 'Developer', admin: 'Admin', branch_manager: 'Branch Manager' };
  const SOUND_PREFERENCE_KEY = 'dashboard-sound-enabled';
  const SOUND_ON_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"></path></svg>';
  const SOUND_OFF_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"></path><path d="m16 9 5 6m0-6-5 6"></path></svg>';
  const FILTERS = [
    ['all', 'All visitors', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="4"></circle><path d="M2 21v-2a7 7 0 0 1 14 0v2M19 8v6M22 11h-6"></path></svg>'],
    ['booked', 'Booked', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18M8 15l2.5 2.5L16 12"></path></svg>'],
    ['open', 'In progress', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>'],
  ];
  let esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let apiGet = null, onError = () => {}, onDashboard = () => {}, onStatus = () => {};
  let root = null, headerRoot = null, viewsRoot = null, filtersRoot = null, DATA = null, ALL = [], view = 'developer', views = [], status = 'all', section = 'overview', recordsView = false;
  let branchFilter = '', branchOptions = [], branchDropdownOpen = false, branchActiveIndex = 0, branchTypeahead = '', branchTypeaheadTimer = null;
  let dateStart = '', dateEnd = '', datePreset = 'all', dateDraftStart = '', dateDraftEnd = '', datePickerOpen = false, datePickerMonth = null;
  let soundEnabled = true;
  try { soundEnabled = localStorage.getItem(SOUND_PREFERENCE_KEY) !== 'false'; }
  catch (error) { console.error('Could not read the sound preference.', error); }
  window.magnusSoundEnabled = soundEnabled;

  const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '0%');
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const PAYMENT_LABELS = Object.freeze({ cash: 'Cash', loan: 'Pure loan', mix: 'Loan + Cash' });
  const fmtDay = (d) => new Date(d + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const fmtDT = (s) => fmtDay(s.slice(0, 10)) + ', ' + s.slice(11, 16);
  const count = (rows, f) => { const m = new Map(); rows.forEach((r) => { const k = f(r); m.set(k, (m.get(k) || 0) + 1); }); return m; };

  /* ---------- charts ---------- */
  /* 3D tube donut: metallic silver + navy slices, thin separators, soft shadow (matches the reference). */
  const DONUT_FILL = [['#ffffff', '#8a909b'], ['#3a70b4', '#0f2c58'], ['#7fa3d8', '#2f5c9e']];
  const DONUT_DOT = ['#b4b9c3', '#1b447f', '#4f7cc0'];
  let donutN = 0;
  function donut(data, colors, center, unit) {
    const tot = data.reduce((s, d) => s + d[1], 0);
    if (!tot) return '<div class="empty">No data in this view</div>';
    const uid = 'dn' + (++donutN), R = 62, r = 36; let a = -Math.PI / 2, out = '', defs = '';
    data.forEach((d, ci) => {
      const c = DONUT_FILL[ci % DONUT_FILL.length];
      defs += `<linearGradient id="${uid}g${ci}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset="1" stop-color="${c[1]}"/></linearGradient>`;
    });
    const p = (ang, rad) => [80 + rad * Math.cos(ang), 80 + rad * Math.sin(ang)];
    const arc = (a0, a1) => {
      const l = (a1 - a0) > Math.PI ? 1 : 0, [x1, y1] = p(a0, R), [x2, y2] = p(a1, R), [x3, y3] = p(a1, r), [x4, y4] = p(a0, r);
      return `M${x1} ${y1}A${R} ${R} 0 ${l} 1 ${x2} ${y2}L${x3} ${y3}A${r} ${r} 0 ${l} 0 ${x4} ${y4}Z`;
    };
    data.forEach((d, ci) => {
      if (!(d[1] > 0)) return;
      const f = d[1] / tot, b = a + Math.min(f, 0.9999) * 2 * Math.PI;
      out += `<path class="seg" data-k="${ci}" data-t="${esc(d[0])}" data-v="<b>${d[1]}</b> (${(f * 100).toFixed(1)}%)" data-pc="${Math.round(f * 100)}%" d="${arc(a, b)}" fill="url(#${uid}g${ci})"/>`;
      a = b;
    });
    /* tube shading over every slice: dark inner edge, bright crest, dark outer edge */
    const m0 = r / R, mid = (r + (R - r) * 0.38) / R;
    defs += `<radialGradient id="${uid}t" gradientUnits="userSpaceOnUse" cx="80" cy="80" r="${R}"><stop offset="${m0}" stop-color="#000" stop-opacity=".30"/><stop offset="${mid}" stop-color="#fff" stop-opacity=".16"/><stop offset="${(mid + 1) / 2 + .04}" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".30"/></radialGradient>`;
    defs += `<filter id="${uid}s" x="-25%" y="-20%" width="150%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="4.5" flood-color="#0b2147" flood-opacity=".38"/></filter>`;
    const tube = `<path class="gloss" fill-rule="evenodd" d="M80 ${80 - R}A${R} ${R} 0 1 1 79.99 ${80 - R}ZM80 ${80 - r}A${r} ${r} 0 1 0 80.01 ${80 - r}Z" fill="url(#${uid}t)"/>`;
    /* thin separator lines between slices */
    let sep = '', ang = -Math.PI / 2;
    if (data.filter((d) => d[1] > 0).length > 1) data.forEach((d) => { if (!(d[1] > 0)) return; const [x1, y1] = p(ang, r), [x2, y2] = p(ang, R); sep += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#10264a" stroke-opacity=".55" stroke-width="1.4"/>`; ang += d[1] / tot * 2 * Math.PI; });
    return `<svg class="dn" viewBox="0 0 160 160" width="140" role="img" aria-label="Donut chart"><defs>${defs}</defs><g filter="url(#${uid}s)">${out}${tube}${sep}</g><circle cx="80" cy="80" r="${r}" fill="none" stroke="rgba(16,38,74,.45)" stroke-width="1.2"/><circle cx="80" cy="80" r="${R}" fill="none" stroke="rgba(16,38,74,.45)" stroke-width="1.2"/><text class="cv" x="80" y="80" text-anchor="middle" style="font:700 24px Outfit,Arial,sans-serif;fill:var(--mocha-ink)">${center}</text><text class="cu" x="80" y="97" text-anchor="middle" style="fill:var(--mocha-muted)">${unit}</text></svg>`;
  }
  const legend = (data, colors) => `<div class="legend" style="flex-direction:column;gap:8px">${data.map((d, i) => `<span class="lg" data-k="${i}" data-t="${esc(d[0])}" data-v="<b>${d[1]}</b>"><i style="background:${colors[i]}"></i>${esc(d[0])} · <b style="color:var(--ink)">${d[1]}</b></span>`).join('')}</div>`;
  function hbars(data, color, max, fmt) {
    fmt = fmt || ((v) => v);
    if (!data.length) return '<div class="empty">No data in this view</div>';
    max = max || Math.max(...data.map((d) => d[1]), 1);
    const W = 420, rowH = 30, h = data.length * rowH + 4, lw = 112, trackW = W - lw - 78;
    return `<svg viewBox="0 0 ${W} ${h}" width="100%" role="img">${data.map((d, i) => {
      const y = i * rowH + 4, w = d[1] ? Math.max(4, trackW * d[1] / max) : 0;
      const outlier = d[1] > max ? ' *' : '';
      return `<g class="row" data-k="${i}" data-t="${esc(d[0])}" data-v="<b>${fmt(d[1])}</b>"><rect x="0" y="${y - 2}" width="${W}" height="${rowH - 2}" fill="transparent"/><text x="0" y="${y + 16}">${esc(d[0])}</text><rect x="${lw}" y="${y + 6}" width="${trackW}" height="15" rx="7.5" fill="var(--mocha-track)"/><rect class="hb" style="animation-delay:${0.35 + i * 0.05}s" x="${lw}" y="${y + 6}" width="${w ? Math.min(w, trackW) : 0}" height="15" rx="7.5" fill="${d[2] || color}"/><rect class="hb gloss" style="animation-delay:${0.35 + i * 0.05}s" x="${lw}" y="${y + 6}" width="${w ? Math.min(w, trackW) : 0}" height="15" rx="7.5" fill="url(#nvGloss)"/><text x="${W - 16}" y="${y + 16}" text-anchor="end" style="fill:var(--mocha-ink);font-weight:700">${fmt(d[1])}${outlier}</text></g>`;
    }).join('')}</svg>`;
  }
  function vbars(data, color) {
    const W = 420, H = 190, base = 150, max = Math.max(...data.map((d) => d[1]), 1), n = data.length;
    const bw = Math.min(54, (W - 20) / n - 12), gap = (W - n * bw) / (n + 1);
    let g = '';
    data.forEach((d, i) => {
      const x = gap + i * (bw + gap), h = d[1] / max * 120;
      const barColor = d[1] === 0 ? C.sand : d[1] === max ? C.coral : C.amber;
      g += `<g class="col" data-k="${i}" data-t="${esc(d[0])}" data-v="<b>${d[1]}</b> visitor${d[1] === 1 ? '' : 's'}"><rect x="${x - gap / 2}" y="20" width="${bw + gap}" height="${base - 20 + 24}" fill="transparent"/><rect class="vb" style="animation-delay:${0.4 + i * 0.1}s" x="${x}" y="${d[1] === 0 ? base : base - h}" width="${bw}" height="${d[1] === 0 ? 3 : h ? Math.max(h, 2) : 0}" rx="${d[1] === 0 ? 1.5 : 10}" fill="${barColor}"/><rect class="vb gloss" style="animation-delay:${0.4 + i * 0.1}s" x="${x}" y="${d[1] === 0 ? base : base - h}" width="${bw}" height="${d[1] === 0 ? 3 : h ? Math.max(h, 2) : 0}" rx="${d[1] === 0 ? 1.5 : 10}" fill="url(#nvGlossV)"/><text x="${x + bw / 2}" y="${base - h - 7}" text-anchor="middle" style="fill:var(--mocha-ink);font-weight:700">${d[1]}</text><text x="${x + bw / 2}" y="${base + 18}" text-anchor="middle" style="font-size:12px;fill:var(--mocha-muted)">${esc(d[0])}</text></g>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">${g}</svg>`;
  }
  function funnel(steps) {
    if (!steps[0][1]) return '<div class="empty">No visitors in this view</div>';
    const W = 420, max = steps[0][1], cols = [C.coral, C.coral, C.coral, C.coral];
    return `<svg viewBox="0 0 ${W} ${steps.length * 46}" width="100%" role="img">${steps.map((s, i) => {
      const w = Math.max(60, (W - 20) * s[1] / max), x = (W - w) / 2, y = i * 46;
      return `<g class="stp" data-k="${i}" data-t="${esc(s[0])}" data-v="<b>${s[1]}</b> (${Math.round(s[1] / max * 100)}% of registered)"><rect class="fb" style="animation-delay:${0.4 + i * 0.12}s" x="${x}" y="${y + 4}" width="${w}" height="36" rx="12" fill="${cols[i % 4]}"/><rect class="fb gloss" style="animation-delay:${0.4 + i * 0.12}s" x="${x}" y="${y + 4}" width="${w}" height="36" rx="12" fill="url(#nvGloss)"/><text x="${W / 2}" y="${y + 27}" text-anchor="middle" style="fill:#fff;font-weight:700;font-size:13px">${s[0]} · ${s[1]}</text></g>`;
    }).join('')}</svg>`;
  }
  const tile = (cls, l, v, n, reportStatus) => reportStatus
    ? `<button type="button" class="tile raised ${cls}" data-report-status="${reportStatus}" aria-label="View ${l.toLowerCase()} visitor report"><span class="label">${l}</span><span class="v">${v}</span><span class="n">${n}</span></button>`
    : `<div class="tile raised ${cls}"><span class="label">${l}</span><span class="v">${v}</span><span class="n">${n}</span></div>`;
  const panel = (span, t, s, body) => `<section class="panel raised ${span}"><div><h3>${t}</h3>${s ? `<div class="sub">${s}</div>` : ''}</div>${body}</section>`;
  const well = (b) => `<div class="well chart">${b}</div>`;
  const flag = (h, t) => `<div class="flag well"><span class="screw"></span><div><b>${h}</b> ${t}</div></div>`;

  /* ---------- panels ---------- */
  const stage = (v) => (v.s === 'booked' ? ['Booked', 'ok'] : v.pa ? ['Payment chosen', 'warn'] : v.co ? ['Course chosen', 'warn'] : ['Registered', 'bad']);
  function kpis(rows) {
    const b = rows.filter((v) => v.s === 'booked'), open = rows.length - b.length, val = b.reduce((s, v) => s + (v.am || 0), 0);
    const bm = b.map((v) => v.mins), avg = bm.length ? Math.round(bm.reduce((a, c) => a + c, 0) / bm.length) : 0;
    return `<div class="tiles">
      ${tile('', 'Visitors', rows.length, 'Registered in this view', 'all')}
      ${tile('', 'Booked', b.length, pct(b.length, rows.length) + ' of visitors', 'booked')}
      ${tile('', 'In progress', open, 'Can resume on the same device', 'open')}
      ${tile('booking-value', 'Booking value', inr(val), b.length ? 'Average ' + inr(Math.round(val / b.length)) + ' per booking' : 'No bookings')}
      ${tile('', 'Avg time to book', avg + ' min', 'Registration to last update, booked visitors')}
    </div>`;
  }
  function funnelPanel(rows, span) {
    const st = [['Registered', rows.length], ['Course chosen', rows.filter((v) => v.co).length], ['Payment chosen', rows.filter((v) => v.pa).length], ['Booked', rows.filter((v) => v.s === 'booked').length]];
    return panel(span || 'c5', 'Visitor funnel', 'How far visitors got in the counselling flow', well(funnel(st)));
  }
  function dayPanel(rows, span) {
    const MAX = 14, m = count(rows, (v) => v.day), end = new Date((document.querySelector('#report-date-filter')?.value || DATA.today) + 'T00:00');
    const firstDay = ALL.length ? ALL.reduce((a, v) => (v.day < a ? v.day : a), ALL[0].day) : DATA.today;
    const span_ = Math.min(MAX, Math.max(1, Math.round((end - new Date(firstDay + 'T00:00')) / 864e5) + 1)), data = [];
    for (let i = span_ - 1; i >= 0; i--) {
      const d = new Date(end); d.setDate(d.getDate() - i);
      const k = d.toLocaleDateString('en-CA');
      data.push([fmtDay(k), m.get(k) || 0]);
    }
    return panel(span || 'c7', 'Visitors by day', 'New visitor sessions registered each day' + (span_ === MAX ? ', last ' + MAX + ' days' : ''), well(vbars(data, C.coral)));
  }
  function mixPanel(rows, t, sub, f, cols, order, span) {
    const m = count(rows.filter((v) => f(v)), f), data = order.map((k) => [t === 'Payment route' ? (PAYMENT_LABELS[k] || cap(k)) : cap(k), m.get(k) || 0]), tot = data.reduce((s, d) => s + d[1], 0);
    return panel(span || 'c4', t, sub, `<div class="well chart" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">${donut(data, cols, tot, 'chose')}${legend(data, DONUT_DOT)}</div>`);
  }
  function qualPanel(rows, span) {
    const order = ['10th / SSLC', '12th / Plus Two', 'Diploma', 'Degree'], m = count(rows, (v) => v.q || 'Not recorded');
    const known = new Set(order);
    const extra = [...m.keys()].filter((k) => k !== 'Not recorded' && !known.has(k));
    const qualificationColors = [C.leather, C.rust, C.ink, C.sand];
    const data = [...order, ...extra, 'Not recorded'].map((k, i) => [k, m.get(k) || 0, k === 'Not recorded' ? C.sand : qualificationColors[i] || C.leather]);
    return panel(span || 'c4', 'Qualification', 'Highest qualification entered at registration', well(hbars(data, C.leather)));
  }
  function amountPanel(rows, span) {
    const m = count(rows.filter((v) => v.am), (v) => v.am), amountColors = [C.teal, C.rust, C.ink];
    const data = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, n], i) => [inr(k), n, amountColors[i % amountColors.length]]);
    return panel(span || 'c4', 'Booking amounts', 'Bookings at each amount, batch ' + (rows.find((v) => v.ba)?.ba || 'not set'), well(hbars(data, C.teal)));
  }
  function timePanel(rows, span) {
    const LIMIT = 6, recent = [...rows].sort((a, b) => b.u.localeCompare(a.u)).slice(0, LIMIT);
    const data = recent.map((v) => [v.nm + ' · ' + v.n, v.mins, v.s === 'booked' ? C.teal : C.amber]);
    const values = data.map((d) => d[1]).sort((a, b) => a - b);
    const percentileIndex = Math.max(0, Math.ceil(values.length * 0.9) - 1);
    const axisMax = Math.max(1, values[percentileIndex] || 1);
    return panel(span || 'c8', 'Time spent per visitor', 'Minutes between registration and last update, latest ' + LIMIT + '. Teal is booked, sand is still open.', well(hbars(data, C.amber, axisMax, (v) => v + ' min')));
  }
  function tablePanel(rows, title, sub, showStep) {
    const list = [...rows].sort((a, b) => b.c.localeCompare(a.c));
    const body = list.length ? `<div class="scroll"><table><thead><tr><th>Visitor</th><th>Registered</th><th class="num">Minutes</th><th>Qualification</th><th>Course</th><th>Payment</th><th class="num">Amount</th>${showStep ? '<th class="num">Saved step</th>' : ''}<th>Audio</th><th>Stage</th></tr></thead><tbody>${list.map((v) => {
      const [s, c] = stage(v);
      return `<tr><td><b>${esc(v.nm)}</b> <span style="color:var(--ink-3);font-size:11.5px">${v.n}</span></td><td>${fmtDT(v.c)}</td><td class="num">${v.mins}</td><td>${esc(v.q || '–')}</td><td>${v.co ? esc(cap(v.co)) : '–'}</td><td>${v.pa ? esc(PAYMENT_LABELS[v.pa] || cap(v.pa)) : '–'}</td><td class="num">${v.am ? inr(v.am) : '–'}</td>${showStep ? `<td class="num">${v.st}</td>` : ''}<td>${v.rec ? v.rec + ' rec.' : '–'}</td><td><span class="chip ${c}">${s}</span></td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="well empty">No visitors in this view</div>';
    return panel('c12', title, sub, tableScroll(body));
  }
  function tableScroll(body) {
    return `<div class="report-table-shell">
      <div class="report-table-scroll"><div class="report-table-area">${body}</div></div>
    </div>`;
  }
  function branchTable(rows) {
    const TODAY = document.querySelector('#report-date-filter')?.value || DATA.today;
    const amt = (list, today) => list.filter((v) => v.s === 'booked' && (!today || v.u.slice(0, 10) === TODAY)).reduce((s, v) => s + (v.am || 0), 0);
    const line = (name, list) => { const t = list.filter((v) => v.day === TODAY).length; return `<tr><td><b>${esc(name)}</b></td><td class="num">${t ? `<span class="chip ok">${t}</span>` : '0'}</td><td class="num">${list.length}</td><td class="num">${inr(amt(list, true))}</td><td class="num">${inr(amt(list, false))}</td></tr>`; };
    const known = new Set(DATA.branches.map((b) => b.id));
    const body = DATA.branches.map((b) => line(b.name, rows.filter((v) => v.br === b.id))).join('') + line('No branch saved', rows.filter((v) => !v.br || !known.has(v.br)));
    const tt = rows.filter((v) => v.day === TODAY).length;
    const table = `<div class="scroll"><table style="min-width:560px"><thead><tr><th>Branch name</th><th class="num">Visits on selected date</th><th class="num">Total visits</th><th class="num">Booking amount on selected date</th><th class="num">Total booking amount</th></tr></thead><tbody>${body}<tr><td><b>All branches</b></td><td class="num"><b>${tt}</b></td><td class="num"><b>${rows.length}</b></td><td class="num"><b>${inr(amt(rows, true))}</b></td><td class="num"><b>${inr(amt(rows, false))}</b></td></tr></tbody></table></div>`;
    return panel('c12', 'Visits by branch', 'Selected report date: ' + fmtDay(TODAY) + ' ' + TODAY.slice(0, 4) + '. Totals include visitors registered on or before that date.', tableScroll(table));
  }
  function branchPanel(rows, span) {
    const nb = rows.filter((v) => !v.br).length;
    const per = DATA.branches.map((b) => [b.name, rows.filter((v) => v.br === b.id).length]).filter((d) => d[1] > 0).sort((a, b) => b[1] - a[1]);
    const data = [['No branch', nb, C.coral], ...per.slice(0, 4)];
    const rest = per.slice(4).reduce((s, d) => s + d[1], 0);
    if (rest) data.push(['Other branches', rest]);
    return panel(span || 'c6', 'Visitors by branch', 'Branch saved on the visitor record',
      well(hbars(data, C.teal, rows.length || 1)) + (nb ? `<div class="sub">${nb} visitors cannot be reported by branch until a branch is saved with them.</div>` : ''));
  }

  /* ---------- role views ---------- */
  const COMPL = (rows) => { const n = rows.length, f = (label, k) => [label, rows.filter(k).length, n]; return [f('Qualification', (v) => v.q), f('Place', (v) => v.pl), f('Course', (v) => v.co), f('Payment', (v) => v.pa), f('Batch', (v) => v.ba), f('Branch', (v) => v.br)]; };
  const VIEW_CARD_CONFIG = {
    admin: {
      row2: ['visitor-funnel', 'visitors-by-day', 'visitors-by-branch'],
      row3: ['course-choice', 'payment-route', 'booking-amounts', 'qualification'],
    },
    developer: {
      row2: ['field-completeness', 'data-checks', 'visitor-funnel'],
      row3: ['visitors-by-day', 'time-spent', 'course-choice'],
    },
  };
  const V = {};
  function cardById(id, rows) {
    const comp = COMPL(rows), bookedLow = rows.filter((v) => v.s === 'booked' && v.st < 5), noBranch = rows.filter((v) => !v.br).length;
    const recs = rows.reduce((s, v) => s + v.rec, 0), withRec = rows.filter((v) => v.rec).length;
    const steps = rows.map((v) => v.st), lo = steps.length ? Math.min(...steps) : 0, hi = steps.length ? Math.max(...steps) : 0;
    switch (id) {
      case 'field-completeness':
        return panel('c12', 'Field completeness', 'Visitors with each field filled in', well(hbars(comp.map((c) => [c[0], c[1], c[1] === 0 ? C.rust : c[1] === c[2] ? C.teal : c[1] / c[2] >= .5 ? C.coral : C.rust]), C.teal, rows.length || 1, (v) => v + ' / ' + rows.length)));
      case 'data-checks':
        return panel('c12', 'Data checks', 'Things to confirm in the visitor records', `<div class="stack">
        ${flag(noBranch + ' of ' + rows.length + ' visitors have no branch.', 'Branch-scoped reports and visitor lists only include visitors saved with a branch.')}
        ${flag(bookedLow.length + ' booked visitors saved a step below 5.', 'Saved step ranges from ' + lo + ' to ' + hi + '. Confirm that booking resets the saved step, or the funnel cannot use it as a progress measure.')}
        ${flag(recs + ' recordings link to ' + withRec + ' visitor' + (withRec === 1 ? '' : 's') + '.', 'Visitors without a linked recording: ' + (rows.length - withRec) + '.')}
      </div>`);
      case 'visitor-funnel': return funnelPanel(rows, 'c12');
      case 'visitors-by-day': return dayPanel(rows, 'c12');
      case 'visitors-by-branch': return branchPanel(rows, 'c12');
      case 'course-choice': return mixPanel(rows, 'Course choice', 'Visitors who chose a course', (v) => v.co, [C.ink, C.teal], ['laptop', 'smartphone'], 'c12');
      case 'payment-route': return mixPanel(rows, 'Payment route', 'Visitors who chose a route', (v) => v.pa, [C.coral, C.amber, C.teal], ['mix', 'cash', 'loan'], 'c12');
      case 'booking-amounts': return amountPanel(rows, 'c12');
      case 'qualification': return qualPanel(rows, 'c12');
      case 'time-spent': return timePanel(rows, 'c12');
      default: return '';
    }
  }
  V.admin = (rows) => kpis(rows) + viewGrid(VIEW_CARD_CONFIG.admin, rows);
  V.developer = (rows) => kpis(rows) + viewGrid(VIEW_CARD_CONFIG.developer, rows);
  V.branch_manager = (rows) => kpis(rows) + `<div class="grid fit">
      ${funnelPanel(rows, 'c5')}${dayPanel(rows, 'c7')}
      ${mixPanel(rows, 'Course choice', 'Visitors who chose a course', (v) => v.co, [C.ink, C.teal], ['laptop', 'smartphone'])}
      ${mixPanel(rows, 'Payment route', 'Visitors who chose a route', (v) => v.pa, [C.coral, C.amber, C.teal], ['mix', 'cash', 'loan'])}
      ${amountPanel(rows)}
    </div>`;
  function viewGrid(config, rows) {
    const row = (ids) => `<div class="dashboard-row row-${ids.length}">${ids.map((id) => cardById(id, rows)).join('')}</div>`;
    return `<div class="dashboard-grid">${row(config.row2)}${row(config.row3)}</div>`;
  }

  /* ---------- shell ---------- */
  const SUBS = {
    developer: 'Every visitor record plus data checks for the people who maintain the app.',
    admin: 'All visitors across all branches, with conversion, payment and branch coverage.',
    branch_manager: 'Visitors for your branch and who to call back first.',
  };
  function scoped() {
    const reportDate = document.querySelector('#report-date-filter')?.value || DATA.today;
    return ALL.filter((v) => (status === 'all' || (status === 'booked' ? v.s === 'booked' : v.s !== 'booked'))
      && (!branchFilter || v.br === branchFilter)
      && (!dateStart || v.day >= dateStart)
      && (!dateEnd || v.day <= dateEnd));
  }
  function setupSoundToggle() {
    window.magnusSoundEnabled = soundEnabled;
    let toggle = document.querySelector('#sound-toggle');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.id = 'sound-toggle';
      toggle.type = 'button';
      toggle.className = 'rail-btn';
      const rail = document.querySelector('#rail');
      const logout = document.querySelector('#logout');
      if (logout) logout.before(toggle);
      else rail?.append(toggle);
    }
    const sync = () => {
      const label = soundEnabled ? 'Sound on' : 'Sound off';
      const action = soundEnabled ? 'Disable sound' : 'Enable sound';
      toggle.setAttribute('aria-label', action);
      toggle.setAttribute('aria-pressed', String(soundEnabled));
      toggle.title = action;
      toggle.innerHTML = `<span class="rail-pill">${soundEnabled ? SOUND_ON_ICON : SOUND_OFF_ICON}<span class="rail-label">${label}</span></span>`;
    };
    if (toggle.dataset.soundToggleBound !== 'true') {
      toggle.addEventListener('click', () => {
        soundEnabled = !soundEnabled;
        window.magnusSoundEnabled = soundEnabled;
        sync();
        try { localStorage.setItem(SOUND_PREFERENCE_KEY, String(soundEnabled)); }
        catch (error) { onError(new Error(`Could not save the sound preference: ${error.message}`)); }
      });
      toggle.dataset.soundToggleBound = 'true';
    }
    sync();
    const playSound = window.playDockDroplet;
    if (typeof playSound === 'function' && !playSound.soundPreferenceWrapped) {
      const soundAwarePlay = function () {
        if (window.magnusSoundEnabled !== false) playSound();
      };
      soundAwarePlay.soundPreferenceWrapped = true;
      window.playDockDroplet = soundAwarePlay;
    }
  }
  function branchDropdownParts() {
    return {
      root: document.querySelector('#report-branch-dropdown'),
      trigger: document.querySelector('#report-branch-filter'),
      label: document.querySelector('#report-branch-label'),
      listbox: document.querySelector('#report-branch-options'),
    };
  }
  function renderBranchOptions(options) {
    const { label, listbox } = branchDropdownParts();
    branchOptions = options;
    if (!listbox) return;
    const selectedIndex = options.findIndex(([value]) => String(value) === branchFilter);
    branchActiveIndex = selectedIndex < 0 ? 0 : selectedIndex;
    listbox.replaceChildren(...options.map(([value, name]) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'branch-filter-option';
      option.dataset.value = String(value);
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(String(value) === branchFilter));
      option.tabIndex = String(value) === branchFilter ? 0 : -1;
      const text = document.createElement('span');
      text.textContent = name;
      const check = document.createElement('span');
      check.className = 'branch-filter-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = '✓';
      option.append(text, check);
      return option;
    }));
    if (label) label.textContent = options[selectedIndex < 0 ? 0 : selectedIndex]?.[1] || '';
  }
  function focusBranchOption(index) {
    const { listbox } = branchDropdownParts();
    const options = listbox ? [...listbox.querySelectorAll('[role="option"]')] : [];
    if (!options.length) return;
    branchActiveIndex = (index + options.length) % options.length;
    options.forEach((option, i) => { option.tabIndex = i === branchActiveIndex ? 0 : -1; });
    options[branchActiveIndex].focus();
    options[branchActiveIndex].scrollIntoView({ block: 'nearest' });
  }
  function openBranchDropdown() {
    const { trigger, listbox } = branchDropdownParts();
    if (!trigger || !listbox || trigger.disabled) return;
    const selectedIndex = branchOptions.findIndex(([value]) => String(value) === branchFilter);
    branchActiveIndex = selectedIndex < 0 ? 0 : selectedIndex;
    listbox.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    focusBranchOption(branchActiveIndex);
    branchDropdownOpen = true;
  }
  function closeBranchDropdown(returnFocus) {
    const { trigger, listbox } = branchDropdownParts();
    branchDropdownOpen = false;
    branchTypeahead = '';
    clearTimeout(branchTypeaheadTimer);
    if (listbox) listbox.hidden = true;
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
      if (returnFocus) trigger.focus();
    }
  }
  function selectBranch(value) {
    if (!branchOptions.some(([optionValue]) => String(optionValue) === value)) return;
    branchFilter = value;
    renderBranchOptions(branchOptions);
    closeBranchDropdown(true);
    window.MagnusReports.load(section);
  }
  function jumpToBranchOption(character) {
    const letter = character.toLocaleLowerCase();
    branchTypeahead = branchTypeahead === letter ? letter : branchTypeahead + letter;
    clearTimeout(branchTypeaheadTimer);
    branchTypeaheadTimer = setTimeout(() => { branchTypeahead = ''; }, 700);
    const currentLabel = String(branchOptions[branchActiveIndex]?.[1] || '').toLocaleLowerCase();
    if (branchTypeahead.length > 1 && currentLabel.startsWith(branchTypeahead)) return;
    for (let offset = 1; offset <= branchOptions.length; offset++) {
      const index = (branchActiveIndex + offset) % branchOptions.length;
      if (String(branchOptions[index][1]).toLocaleLowerCase().startsWith(branchTypeahead)) {
        focusBranchOption(index);
        return;
      }
    }
  }
  function upgradeNativeBranchFilter() {
    const select = document.querySelector('select#report-branch-filter');
    const oldField = select?.closest('.topbar-field');
    if (!select || !oldField) return;
    const field = document.createElement('div');
    field.className = 'topbar-field';
    const caption = document.createElement('span');
    caption.textContent = 'Branch';
    const dropdown = document.createElement('div');
    dropdown.id = 'report-branch-dropdown';
    dropdown.className = 'branch-filter';
    const trigger = document.createElement('button');
    trigger.id = 'report-branch-filter';
    trigger.className = 'branch-filter-trigger';
    trigger.type = 'button';
    trigger.setAttribute('aria-label', 'Branch');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'report-branch-options');
    const label = document.createElement('span');
    label.id = 'report-branch-label';
    label.textContent = select.selectedOptions[0]?.textContent || 'All Branches';
    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm6 9 6 6 6-6');
    chevron.append(path);
    trigger.append(label, chevron);
    const listbox = document.createElement('div');
    listbox.id = 'report-branch-options';
    listbox.className = 'branch-filter-list';
    listbox.setAttribute('role', 'listbox');
    listbox.setAttribute('aria-label', 'Branches');
    listbox.hidden = true;
    dropdown.append(trigger, listbox);
    field.append(caption, dropdown);
    oldField.replaceWith(field);
  }
  function handleBranchDropdownKeydown(event) {
    const trigger = event.target.closest('#report-branch-filter');
    const option = event.target.closest('#report-branch-options [role="option"]');
    if (!trigger && !option) return;
    if (event.key === 'Escape' && branchDropdownOpen) {
      event.preventDefault();
      closeBranchDropdown(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      if (!branchDropdownOpen) {
        openBranchDropdown();
        if (event.key === 'ArrowUp') focusBranchOption(branchActiveIndex - 1);
      } else {
        focusBranchOption(branchActiveIndex + delta);
      }
      return;
    }
    if (option && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      selectBranch(option.dataset.value);
      return;
    }
    if (event.key.length === 1 && event.key !== ' ' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      if (!branchDropdownOpen) openBranchDropdown();
      jumpToBranchOption(event.key);
    }
  }
  const dateLocal = (date) => {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  function addDays(value, days) {
    const d = new Date(value + 'T00:00');
    d.setDate(d.getDate() + days);
    return dateLocal(d);
  }
  function monthStart(value) { return value.slice(0, 7) + '-01'; }
  function monthEnd(value) {
    const d = new Date(value.slice(0, 7) + '-01T00:00');
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    return dateLocal(d);
  }
  function setDatePreset(preset) {
    const today = DATA?.today || dateLocal(new Date());
    const earliest = ALL.length ? ALL.reduce((min, v) => v.day < min ? v.day : min, ALL[0].day) : today;
    datePreset = preset;
    if (preset === 'all') { dateStart = ''; dateEnd = today; }
    if (preset === 'today') { dateStart = today; dateEnd = today; }
    if (preset === 'yesterday') { dateStart = addDays(today, -1); dateEnd = dateStart; }
    if (preset === '7') { dateStart = addDays(today, -6); dateEnd = today; }
    if (preset === '30') { dateStart = addDays(today, -29); dateEnd = today; }
    if (preset === 'month') { dateStart = monthStart(today); dateEnd = today; }
    if (preset === 'last-month') {
      const first = new Date(monthStart(today) + 'T00:00');
      first.setMonth(first.getMonth() - 1);
      dateStart = dateLocal(first);
      dateEnd = monthEnd(dateStart);
    }
    if (preset === 'custom') { dateStart = dateDraftStart || earliest; dateEnd = dateDraftEnd || today; }
  }
  function renderDateCalendar(parent, month) {
    parent.replaceChildren();
    const head = document.createElement('div');
    head.className = 'date-calendar-header';
    head.textContent = new Date(month + '-01T00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const grid = document.createElement('div');
    grid.className = 'date-calendar-grid';
    ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach((day) => {
      const label = document.createElement('div');
      label.className = 'date-weekday';
      label.textContent = day;
      grid.append(label);
    });
    const first = new Date(month + '-01T00:00');
    const offset = first.getDay();
    const last = new Date(first);
    last.setMonth(last.getMonth() + 1);
    last.setDate(0);
    for (let i = 0; i < offset; i++) {
      const blank = document.createElement('button');
      blank.type = 'button'; blank.className = 'date-day outside'; blank.tabIndex = -1;
      grid.append(blank);
    }
    for (let day = 1; day <= last.getDate(); day++) {
      const value = month + '-' + String(day).padStart(2, '0');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'date-day';
      button.dataset.date = value;
      button.textContent = day;
      if (value === dateDraftStart || value === dateDraftEnd) button.classList.add(value === dateDraftStart ? 'range-start' : 'range-end');
      if (dateDraftStart && dateDraftEnd && value > dateDraftStart && value < dateDraftEnd) button.classList.add('in-range');
      if (value > (DATA?.today || dateLocal(new Date()))) button.disabled = true;
      grid.append(button);
    }
    parent.append(head, grid);
  }
  function syncDatePicker() {
    const popover = document.querySelector('#date-range-popover');
    if (!popover) return;
    popover.querySelectorAll('.date-preset').forEach((button) => button.classList.toggle('active', button.dataset.preset === datePreset));
    const today = DATA?.today || dateLocal(new Date());
    const base = datePickerMonth || (today.slice(0, 7));
    const first = new Date(base + '-01T00:00');
    const second = new Date(first); second.setMonth(second.getMonth() + 1);
    renderDateCalendar(popover.querySelector('.date-calendar.first'), dateLocal(first).slice(0, 7));
    renderDateCalendar(popover.querySelector('.date-calendar.second'), dateLocal(second).slice(0, 7));
    const summary = popover.querySelector('.date-range-summary');
    if (summary) summary.textContent = dateDraftStart && dateDraftEnd
      ? new Date(dateDraftStart + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) +
        ' - ' + new Date(dateDraftEnd + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'Pick a start and an end date';
    const apply = popover.querySelector('.date-range-apply');
    if (apply) apply.disabled = !(dateDraftStart && dateDraftEnd);
  }
  function openDatePicker() {
    const popover = document.querySelector('#date-range-popover');
    const trigger = document.querySelector('#date-range-trigger');
    if (!popover || !trigger) return;
    dateDraftStart = dateStart || '';
    dateDraftEnd = dateEnd || DATA?.today || '';
    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    datePickerOpen = true;
    syncDatePicker();
  }
  function closeDatePicker(returnFocus) {
    const popover = document.querySelector('#date-range-popover');
    const trigger = document.querySelector('#date-range-trigger');
    if (popover) popover.hidden = true;
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
      if (returnFocus) trigger.focus();
    }
    datePickerOpen = false;
  }
  function upgradeNativeDateFilter() {
    const input = document.querySelector('#report-date-filter');
    const oldField = input?.closest('.topbar-field');
    if (!input || !oldField || oldField.querySelector('#date-range-picker')) return;
    input.hidden = true;
    oldField.classList.add('date-topbar-field');
    const picker = document.createElement('div');
    picker.id = 'date-range-picker';
    picker.className = 'date-range-picker';
    picker.innerHTML = `<button type="button" id="date-range-trigger" class="date-range-trigger" aria-haspopup="dialog" aria-expanded="false" aria-controls="date-range-popover"><span id="date-range-trigger-label">All Time</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"></path></svg></button>
      <div id="date-range-popover" class="date-range-popover" role="dialog" aria-label="Select date range" hidden>
        <div class="date-preset-list">
          <button type="button" class="date-preset" data-preset="all">All Time</button>
          <button type="button" class="date-preset" data-preset="today">Today</button>
          <button type="button" class="date-preset" data-preset="yesterday">Yesterday</button>
          <button type="button" class="date-preset" data-preset="7">Last 7 days</button>
          <button type="button" class="date-preset" data-preset="30">Last 30 days</button>
          <button type="button" class="date-preset" data-preset="month">This month</button>
          <button type="button" class="date-preset" data-preset="last-month">Last month</button>
          <button type="button" class="date-preset" data-preset="custom">Custom range</button>
        </div>
        <div class="date-range-main">
          <div class="date-calendars">
            <button type="button" class="date-nav prev" aria-label="Previous month">&#8249;</button>
            <div class="date-calendar first"></div>
            <div class="date-calendar second"></div>
            <button type="button" class="date-nav next" aria-label="Next month">&#8250;</button>
          </div>
          <div class="date-range-footer"><span class="date-range-summary">Pick a start and an end date</span><button type="button" class="date-range-cancel">Cancel</button><button type="button" class="date-range-apply" disabled>Apply</button></div>
        </div>
      </div>`;
    input.replaceWith(picker);
  }
  function syncTopbar() {
    if (!DATA) return;
    if (!dateEnd) dateEnd = DATA.today;
    document.querySelectorAll('#dashboard-view-toggle, #report-refresh').forEach((control) => control.remove());
    upgradeNativeBranchFilter();
    upgradeNativeDateFilter();
    const branchTrigger = document.querySelector('#report-branch-filter');
    const branchListbox = document.querySelector('#report-branch-options');
    const dateInput = document.querySelector('#report-date-filter');
    if (branchTrigger) {
      const allBranches = DATA.scope === 'all';
      const options = allBranches ? [['', 'All Branches'], ...DATA.branches.map((b) => [b.id, b.name])] : DATA.branches.map((b) => [b.id, b.name]);
      if (!allBranches && !DATA.branches.some((b) => b.id === branchFilter)) branchFilter = DATA.branches[0]?.id || '';
      if (branchFilter && !DATA.branches.some((b) => b.id === branchFilter)) branchFilter = '';
      renderBranchOptions(options);
      branchTrigger.disabled = !allBranches;
      branchListbox?.setAttribute('aria-disabled', String(!allBranches));
      if (!allBranches) closeBranchDropdown(false);
    }
    if (dateInput) dateInput.max = DATA.today;
    const activeBranch = DATA.branches.find((b) => b.id === branchFilter);
    const scope = document.querySelector('#topbar-scope');
    if (scope) scope.textContent = activeBranch ? activeBranch.name : DATA.scope === 'all' ? 'All Branches' : DATA.branch_name || 'Your Branch';
    const dateLabel = document.querySelector('#topbar-date-label');
    if (dateLabel) {
      const label = datePreset === 'all' ? 'All Time' : dateStart === dateEnd
        ? new Date((dateEnd || DATA.today) + 'T00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : `${new Date((dateStart || DATA.today) + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} - ${new Date((dateEnd || DATA.today) + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
      dateLabel.textContent = label.toUpperCase();
    }
    const dateTriggerLabel = document.querySelector('#date-range-trigger-label');
    if (dateTriggerLabel) {
      const names = { all: 'All Time', today: 'Today', yesterday: 'Yesterday', '7': 'Last 7 days', '30': 'Last 30 days', month: 'This month', 'last-month': 'Last month', custom: 'Custom range' };
      dateTriggerLabel.textContent = names[datePreset] || 'Custom range';
    }
    const viewLabel = document.querySelector('#dashboard-view-label');
    if (viewLabel) viewLabel.textContent = view.toUpperCase() + ' VIEW';
  }
  function shell() {
    const keys = section !== 'branches' && views.length > 1 ? views.map((r) => `<button type="button" class="rail-btn rail-view-key" data-role="${r}" aria-label="${VIEW_NAMES[r]} report view" aria-pressed="${r === view}"><span class="rail-pill"><span class="rail-view-short">${r === 'developer' ? '&lt;/&gt;' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3Z"></path><path d="m9 12 2 2 4-4"></path></svg>'}</span></span><span class="rail-label">${r === 'developer' ? 'Dev' : VIEW_NAMES[r]}</span></button>`).join('') : '';
    const title = section === 'branches' ? 'Branches' : 'Visitor Dashboard';
    if (headerRoot) {
      headerRoot.innerHTML = `<h2>${title}</h2>`;
      headerRoot.hidden = false;
      headerRoot.closest('.topbar')?.classList.add('has-context');
    }
    if (viewsRoot) {
      viewsRoot.innerHTML = keys;
      viewsRoot.hidden = !keys;
    }
    return '<div id="rpt-view" class="rpt-view"></div>';
  }
  function animateIn() {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.querySelectorAll('.tile').forEach((e, i) => { e.style.animationDelay = i * 70 + 'ms'; });
    root.querySelectorAll('.panel').forEach((e, i) => { e.style.animationDelay = 250 + i * 80 + 'ms'; });
    root.querySelectorAll('tbody tr').forEach((e, i) => { e.style.animationDelay = 500 + Math.min(i, 24) * 30 + 'ms'; });
    if (reduce) return;
    root.querySelectorAll('.tile .v').forEach((el, i) => {
      const t = el.textContent, m = t.match(/^(\D*?)([\d,]+)(.*)$/); if (!m) return;
      const to = +m[2].replace(/,/g, ''), comma = m[2].includes(',') || m[1].includes('₹'), t0 = performance.now() + i * 70, dur = 1000;
      el.textContent = m[1] + 0 + m[3];
      const step = (now) => { const k = Math.min(1, Math.max(0, (now - t0) / dur)), e = 1 - Math.pow(1 - k, 3), val = Math.round(to * e); el.textContent = k >= 1 ? t : m[1] + (comma ? val.toLocaleString('en-IN') : val) + m[3]; if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  function draw(full) {
    if (full) {
      root.innerHTML = shell();
      if (filtersRoot) filtersRoot.innerHTML = FILTERS.map(([k, l, icon]) => `<button type="button" class="pill" data-status="${k}" aria-pressed="${recordsView && status === k}"><span class="dock-icon">${icon}</span><span class="dock-label">${l}</span></button>`).join('');
    } else if (filtersRoot) {
      filtersRoot.querySelectorAll('.pill').forEach((p) => p.setAttribute('aria-pressed', recordsView && p.dataset.status === status));
    }
    syncTopbar();
    const hint = DATA.scope === 'branch' && !ALL.length ? `<div class="raised panel">${flag('No visitors are saved to ' + esc(DATA.branch_name || 'this branch') + ' yet.', 'Visitors appear here once they are registered by a user assigned to this branch.')}</div>` : '';
    const rows = scoped();
    const compact = section !== 'branches' && status === 'all' && !recordsView;
    const records = recordsView || status !== 'all' ? tablePanel(rows, 'Visitor records',
      status === 'booked' ? 'Booked visitors' : status === 'open' ? 'Visitors who have not booked yet' : 'All registered visitors', true) : '';
    document.body.classList.toggle('fit', compact);
    root.classList.toggle('one', compact);
    root.querySelector('#rpt-view').innerHTML = section === 'branches'
      ? `<div class="grid">${branchTable(rows)}</div>`
      : hint + V[view](rows) + records;
    animateIn();
  }
  function prepare(d) {
    DATA = d;
    ALL = d.visitors.map((v, i) => {
      const o = { nm: v.name, n: 'V-' + String(i + 1).padStart(2, '0'), c: v.created, u: v.updated || v.created, q: v.qualification, pl: v.has_place,
        s: v.status, st: v.step, co: v.course, pa: v.payment, am: v.amount, ba: v.batch, br: v.branch_id, rec: v.recordings };
      o.mins = Math.max(0, Math.round((new Date(o.u) - new Date(o.c)) / 60000)) || 0;
      o.day = o.c.slice(0, 10);
      return o;
    });
    views = d.role === 'developer' ? ['developer', 'admin'] : d.scope === 'all' ? ['admin'] : ['branch_manager'];
    let savedView = '';
    try { savedView = localStorage.getItem('dashboardView') || ''; } catch (_) {}
    if (d.role === 'developer' && (savedView === 'admin' || savedView === 'developer')) view = savedView;
    else if (d.role === 'developer') view = 'developer';
    else view = 'admin';
  }

  /* ---------- hover interaction: highlight the item under the cursor, fade the rest, show a tooltip ---------- */
  let tip = null;
  function bindHover() {
    tip = document.createElement('div'); tip.className = 'rpt-tip'; tip.hidden = true; document.body.appendChild(tip);
    const clear = (chart) => {
      if (!chart) return;
      chart.classList.remove('hl');
      chart.querySelectorAll('.on').forEach((e) => e.classList.remove('on'));
      const cv = chart.querySelector('.cv'), cu = chart.querySelector('.cu');
      if (cv && cv.dataset.o !== undefined) { cv.textContent = cv.dataset.o; cu.textContent = cu.dataset.o2; delete cv.dataset.o; }
      tip.hidden = true;
    };
    let current = null;
    root.addEventListener('mousemove', (e) => {
      const el = e.target.closest ? e.target.closest('[data-k]') : null, chart = el && el.closest('.chart');
      if (!el || !chart) { if (current) { clear(current); current = null; } return; }
      if (current && current !== chart) clear(current);
      current = chart;
      const k = el.dataset.k;
      chart.classList.add('hl');
      chart.querySelectorAll('[data-k]').forEach((n) => n.classList.toggle('on', n.dataset.k === k));
      const cv = chart.querySelector('.cv'), cu = chart.querySelector('.cu'), seg = chart.querySelector('.seg.on');
      if (cv && seg) { if (cv.dataset.o === undefined) { cv.dataset.o = cv.textContent; cu.dataset.o2 = cu.textContent; } cv.textContent = seg.dataset.pc; cu.textContent = seg.dataset.t; }
      tip.innerHTML = '<span>' + el.dataset.t + '</span>' + el.dataset.v;
      tip.hidden = false;
      const w = tip.offsetWidth, h = tip.offsetHeight;
      const chartRect = chart.getBoundingClientRect();
      const hoverRect = el.getBoundingClientRect();
      let x = e.clientX + 14;
      let y = hoverRect.top - h - 8;
      if (y < chartRect.top) y = chartRect.top;
      if (x + w > innerWidth - 8) x = e.clientX - w - 14;
      if (y < 8) y = e.clientY + 18;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    });
    root.addEventListener('mouseleave', () => { if (current) { clear(current); current = null; } });
  }
  function bind() {
    root.addEventListener('click', (e) => {
      const report = e.target.closest('[data-report-status]');
      if (report) { status = report.dataset.reportStatus; recordsView = true; draw(false); onStatus(); }
    });
    if (viewsRoot) viewsRoot.addEventListener('click', (e) => {
      const key = e.target.closest('[data-role]');
      if (key) { view = key.dataset.role; draw(true); }
    });
    if (headerRoot) headerRoot.addEventListener('click', (e) => {
      const key = e.target.closest('.key');
      if (key) { view = key.dataset.role; draw(true); }
    });
    const topbar = headerRoot?.closest('.topbar');
    if (topbar) {
      topbar.addEventListener('click', (e) => {
        const trigger = e.target.closest('#report-branch-filter');
        if (trigger) {
          e.preventDefault();
          if (branchDropdownOpen) closeBranchDropdown(true);
          else openBranchDropdown();
          return;
        }
        const option = e.target.closest('#report-branch-options [role="option"]');
        if (option) {
          e.preventDefault();
          selectBranch(option.dataset.value);
        }
        const dateTrigger = e.target.closest('#date-range-trigger');
        if (dateTrigger) {
          e.preventDefault();
          if (datePickerOpen) closeDatePicker(true);
          else openDatePicker();
          return;
        }
        const preset = e.target.closest('.date-preset');
        if (preset) {
          e.preventDefault();
          datePreset = preset.dataset.preset;
          if (datePreset === 'custom') {
            dateDraftStart = '';
            dateDraftEnd = '';
            syncDatePicker();
          } else {
            setDatePreset(datePreset);
            dateDraftStart = dateStart;
            dateDraftEnd = dateEnd;
            syncDatePicker();
          }
          return;
        }
        const day = e.target.closest('.date-day[data-date]');
        if (day && !day.disabled) {
          e.preventDefault();
          datePreset = 'custom';
          const value = day.dataset.date;
          if (!dateDraftStart || dateDraftEnd) {
            dateDraftStart = value;
            dateDraftEnd = '';
          } else if (value < dateDraftStart) {
            dateDraftEnd = dateDraftStart;
            dateDraftStart = value;
          } else {
            dateDraftEnd = value;
          }
          syncDatePicker();
          return;
        }
        if (e.target.closest('.date-nav.prev')) {
          datePickerMonth = dateLocal(new Date((datePickerMonth || DATA.today.slice(0, 7) + '-01') + 'T00:00'));
          const d = new Date(datePickerMonth); d.setMonth(d.getMonth() - 1);
          datePickerMonth = dateLocal(d).slice(0, 7);
          syncDatePicker();
          return;
        }
        if (e.target.closest('.date-nav.next')) {
          datePickerMonth = dateLocal(new Date((datePickerMonth || DATA.today.slice(0, 7) + '-01') + 'T00:00'));
          const d = new Date(datePickerMonth); d.setMonth(d.getMonth() + 1);
          datePickerMonth = dateLocal(d).slice(0, 7);
          syncDatePicker();
          return;
        }
        if (e.target.closest('.date-range-cancel')) {
          closeDatePicker(true);
          return;
        }
        if (e.target.closest('.date-range-apply')) {
          if (!dateDraftStart || !dateDraftEnd) return;
          dateStart = dateDraftStart;
          dateEnd = dateDraftEnd;
          datePreset = 'custom';
          closeDatePicker(false);
          syncTopbar();
          draw(false);
        }
      });
      topbar.addEventListener('keydown', handleBranchDropdownKeydown);
      topbar.addEventListener('focusout', (e) => {
        const { root: branchRoot } = branchDropdownParts();
        if (branchDropdownOpen && branchRoot && !branchRoot.contains(e.relatedTarget)) closeBranchDropdown(false);
      });
      topbar.addEventListener('change', (e) => {
        if (e.target.matches('#report-date-filter')) window.MagnusReports.load(section);
      });
      document.addEventListener('click', (e) => {
        const { root: branchRoot } = branchDropdownParts();
        if (branchDropdownOpen && branchRoot && !branchRoot.contains(e.target)) closeBranchDropdown(false);
        if (datePickerOpen && !e.target.closest('#date-range-picker')) closeDatePicker(false);
      });
    }
    if (filtersRoot) filtersRoot.addEventListener('click', (e) => {
      const pill = e.target.closest('.pill');
      if (pill) {
        onDashboard();
        section = 'overview';
        status = pill.dataset.status;
        recordsView = true;
        draw(false);
        onStatus();
      }
    });
  }
  window.MagnusReports = {
    init(opts) {
      apiGet = opts.api; esc = opts.esc || esc; onError = opts.onError || onError; onDashboard = opts.onDashboard || onDashboard; onStatus = opts.onStatus || onStatus;
      root = opts.root; headerRoot = opts.headerRoot || null; viewsRoot = opts.viewsRoot || null; filtersRoot = opts.filtersRoot || null;
      /* Chart colours stay as CSS variables so dark and white cards each resolve them in their own context (see navy.css). */
      if (!document.getElementById('nvGloss')) {
        const defs = document.createElement('div');
        defs.innerHTML = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs><linearGradient id="nvGloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".48" stop-color="#fff" stop-opacity=".08"/><stop offset=".52" stop-color="#000" stop-opacity=".02"/><stop offset="1" stop-color="#000" stop-opacity=".32"/></linearGradient><linearGradient id="nvGlossV" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset=".35" stop-color="#fff" stop-opacity=".42"/><stop offset=".6" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#000" stop-opacity=".4"/></linearGradient></defs></svg>';
        document.body.appendChild(defs.firstChild);
      }
      root.classList.add('rpt'); bind(); bindHover(); setupSoundToggle();
    },
    async load(next) {
      if (next) section = next;
      try {
        prepare(await apiGet('/api/admin/report'));
        draw(true);
      } catch (error) { onError(error); }
    },
    async dashboard() {
      status = 'all';
      recordsView = false;
      await this.load('overview');
    },
    clearStatusSelection() {
      status = 'all';
      recordsView = false;
      if (filtersRoot) filtersRoot.querySelectorAll('.pill').forEach((p) => p.setAttribute('aria-pressed', 'false'));
    },
  };
})();