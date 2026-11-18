/* Reports tab for the management page. Fed by GET /api/admin/report (no phone numbers).
   Developer: data checks + all records. Admin: all branches. Branch-scoped users: their own branch. */
(function () {
  'use strict';
  const C = { coral: '#33261F', teal: '#2E8F7B', amber: '#A8947F', leather: '#6B5B52', sand: '#CDBFAE' };
  const VIEW_NAMES = { developer: 'Developer', admin: 'Admin', branch_manager: 'Branch Manager' };
  let esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let apiGet = null, onError = () => {};
  let root = null, filtersRoot = null, DATA = null, ALL = [], view = 'developer', views = [], status = 'all', section = 'overview';

  const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '0%');
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const fmtDay = (d) => new Date(d + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const fmtDT = (s) => fmtDay(s.slice(0, 10)) + ', ' + s.slice(11, 16);
  const count = (rows, f) => { const m = new Map(); rows.forEach((r) => { const k = f(r); m.set(k, (m.get(k) || 0) + 1); }); return m; };

  /* ---------- charts ---------- */
  function donut(data, colors, center, unit) {
    const tot = data.reduce((s, d) => s + d[1], 0);
    if (!tot) return '<div class="empty">No data in this view</div>';
    const R = 62, r = 40; let a = -Math.PI / 2, out = '';
    data.forEach((d, ci) => {
      if (!(d[1] > 0)) return;
      const f = d[1] / tot, b = a + Math.min(f, 0.9999) * 2 * Math.PI, l = f > 0.5 ? 1 : 0;
      const p = (ang, rad) => [80 + rad * Math.cos(ang), 80 + rad * Math.sin(ang)];
      const [x1, y1] = p(a, R), [x2, y2] = p(b, R), [x3, y3] = p(b, r), [x4, y4] = p(a, r);
      out += `<path class="seg" data-k="${ci}" data-t="${esc(d[0])}" data-v="<b>${d[1]}</b> (${(f * 100).toFixed(1)}%)" data-pc="${Math.round(f * 100)}%" d="M${x1} ${y1}A${R} ${R} 0 ${l} 1 ${x2} ${y2}L${x3} ${y3}A${r} ${r} 0 ${l} 0 ${x4} ${y4}Z" fill="${colors[ci]}" stroke="#F3EAE5" stroke-width="2"/>`;
      a = b;
    });
    return `<svg class="dn" viewBox="0 0 160 160" width="150" role="img" aria-label="Donut chart"><circle cx="80" cy="80" r="74" fill="none" stroke="#E4D9D2" stroke-width="5" opacity=".7"/><g>${out}</g><text class="cv" x="80" y="80" text-anchor="middle" style="font:700 24px Lora,Georgia,serif;fill:#2B1F1B">${center}</text><text class="cu" x="80" y="97" text-anchor="middle">${unit}</text></svg>`;
  }
  const legend = (data, colors) => `<div class="legend" style="flex-direction:column;gap:8px">${data.map((d, i) => `<span class="lg" data-k="${i}" data-t="${esc(d[0])}" data-v="<b>${d[1]}</b>"><i style="background:${colors[i]}"></i>${esc(d[0])} · <b style="color:var(--ink)">${d[1]}</b></span>`).join('')}</div>`;
  function hbars(data, color, max, fmt) {
    fmt = fmt || ((v) => v);
    if (!data.length) return '<div class="empty">No data in this view</div>';
    max = max || Math.max(...data.map((d) => d[1]), 1);
    const W = 420, rowH = 30, h = data.length * rowH + 4, lw = 112;
    return `<svg viewBox="0 0 ${W} ${h}" width="100%" role="img">${data.map((d, i) => {
      const y = i * rowH + 4, w = d[1] ? Math.max(6, (W - lw - 62) * d[1] / max) : 0;
      return `<g class="row" data-k="${i}" data-t="${esc(d[0])}" data-v="<b>${fmt(d[1])}</b>"><rect x="0" y="${y - 2}" width="${W}" height="${rowH - 2}" fill="transparent"/><text x="0" y="${y + 16}">${esc(d[0])}</text><rect x="${lw}" y="${y + 3}" width="${W - lw - 62}" height="16" rx="8" fill="#E4D9D2"/>${w ? `<rect class="hb" style="animation-delay:${0.35 + i * 0.05}s" x="${lw}" y="${y + 3}" width="${w}" height="16" rx="8" fill="${d[2] || color}"/>` : ''}<text x="${lw + w + 8}" y="${y + 16}" style="fill:#2B1F1B;font-weight:700">${fmt(d[1])}</text></g>`;
    }).join('')}</svg>`;
  }
  function vbars(data, color) {
    const W = 420, H = 190, base = 150, max = Math.max(...data.map((d) => d[1]), 1), n = data.length;
    const bw = Math.min(54, (W - 20) / n - 12), gap = (W - n * bw) / (n + 1);
    let g = '';
    (max < 2 ? [0, 1] : [0, 0.5, 1]).forEach((f) => { const y = base - f * 120; g += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="#D9CCC4" stroke-dasharray="3 4"/><text x="0" y="${y - 4}">${Math.round(max * f)}</text>`; });
    data.forEach((d, i) => {
      const x = gap + i * (bw + gap), h = d[1] / max * 120;
      g += `<g class="col" data-k="${i}" data-t="${esc(d[0])}" data-v="<b>${d[1]}</b> visitor${d[1] === 1 ? '' : 's'}"><rect x="${x - gap / 2}" y="20" width="${bw + gap}" height="${base - 20 + 24}" fill="transparent"/><rect class="vb" style="animation-delay:${0.4 + i * 0.1}s" x="${x}" y="${base - h}" width="${bw}" height="${h ? Math.max(h, 2) : 0}" rx="10" fill="${color}"/><text x="${x + bw / 2}" y="${base - h - 6}" text-anchor="middle" style="fill:#2B1F1B;font-weight:700">${d[1]}</text><text x="${x + bw / 2}" y="${base + 18}" text-anchor="middle" style="font-size:10px">${esc(d[0])}</text></g>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">${g}</svg>`;
  }
  function funnel(steps) {
    if (!steps[0][1]) return '<div class="empty">No visitors in this view</div>';
    const W = 420, max = steps[0][1], cols = [C.leather, C.amber, C.coral, C.teal];
    return `<svg viewBox="0 0 ${W} ${steps.length * 46}" width="100%" role="img">${steps.map((s, i) => {
      const w = Math.max(60, (W - 20) * s[1] / max), x = (W - w) / 2, y = i * 46;
      return `<g class="stp" data-k="${i}" data-t="${esc(s[0])}" data-v="<b>${s[1]}</b> (${Math.round(s[1] / max * 100)}% of registered)"><rect class="fb" style="animation-delay:${0.4 + i * 0.12}s" x="${x}" y="${y + 4}" width="${w}" height="36" rx="12" fill="${cols[i % 4]}"/><text x="${W / 2}" y="${y + 27}" text-anchor="middle" style="fill:#fff;font-weight:700;font-size:13px">${s[0]} · ${s[1]}</text></g>`;
    }).join('')}</svg>`;
  }
  const tile = (cls, l, v, n) => `<div class="tile raised ${cls}"><span class="label">${l}</span><span class="v">${v}</span><span class="n">${n}</span></div>`;
  const panel = (span, t, s, body) => `<section class="panel raised ${span}"><div><h3>${t}</h3>${s ? `<div class="sub">${s}</div>` : ''}</div>${body}</section>`;
  const well = (b) => `<div class="well chart">${b}</div>`;
  const flag = (h, t) => `<div class="flag well"><span class="screw"></span><div><b>${h}</b> ${t}</div></div>`;

  /* ---------- panels ---------- */
  const stage = (v) => (v.s === 'booked' ? ['Booked', 'ok'] : v.pa ? ['Payment chosen', 'warn'] : v.co ? ['Course chosen', 'warn'] : ['Registered', 'bad']);
  function kpis(rows) {
    const b = rows.filter((v) => v.s === 'booked'), open = rows.length - b.length, val = b.reduce((s, v) => s + (v.am || 0), 0);
    const bm = b.map((v) => v.mins), avg = bm.length ? Math.round(bm.reduce((a, c) => a + c, 0) / bm.length) : 0;
    return `<div class="tiles">
      ${tile('coral', 'Visitors', rows.length, 'Registered in this view')}
      ${tile('teal', 'Booked', b.length, pct(b.length, rows.length) + ' of visitors')}
      ${tile('', 'In progress', open, 'Can resume on the same device')}
      ${tile('', 'Booking value', inr(val), b.length ? 'Average ' + inr(Math.round(val / b.length)) + ' per booking' : 'No bookings')}
      ${tile('', 'Avg time to book', avg + ' min', 'Registration to last update, booked visitors')}
    </div>`;
  }
  function funnelPanel(rows, span) {
    const st = [['Registered', rows.length], ['Course chosen', rows.filter((v) => v.co).length], ['Payment chosen', rows.filter((v) => v.pa).length], ['Booked', rows.filter((v) => v.s === 'booked').length]];
    return panel(span || 'c5', 'Visitor funnel', 'How far visitors got in the counselling flow', well(funnel(st)));
  }
  function dayPanel(rows, span) {
    const MAX = 14, m = count(rows, (v) => v.day), end = new Date(DATA.today + 'T00:00');
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
    const m = count(rows.filter((v) => f(v)), f), data = order.map((k) => [cap(k), m.get(k) || 0]), tot = data.reduce((s, d) => s + d[1], 0);
    return panel(span || 'c4', t, sub, `<div class="well chart" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">${donut(data, cols, tot, 'chose')}${legend(data, cols)}</div>`);
  }
  function qualPanel(rows, span) {
    const order = ['10th / SSLC', '12th / Plus Two', 'Diploma', 'Degree'], m = count(rows, (v) => v.q || 'Not recorded');
    const known = new Set(order);
    const extra = [...m.keys()].filter((k) => k !== 'Not recorded' && !known.has(k));
    const data = [...order, ...extra, 'Not recorded'].map((k) => [k, m.get(k) || 0, k === 'Not recorded' ? C.sand : null]);
    return panel(span || 'c4', 'Qualification', 'Highest qualification entered at registration', well(hbars(data, C.leather)));
  }
  function amountPanel(rows, span) {
    const m = count(rows.filter((v) => v.am), (v) => v.am), data = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => [inr(k), n]);
    return panel(span || 'c4', 'Booking amounts', 'Bookings at each amount, batch ' + (rows.find((v) => v.ba)?.ba || 'not set'), well(hbars(data, C.teal)));
  }
  function timePanel(rows, span) {
    const LIMIT = 6, recent = [...rows].sort((a, b) => b.u.localeCompare(a.u)).slice(0, LIMIT);
    const data = recent.map((v) => [v.nm + ' · ' + v.n, v.mins, v.s === 'booked' ? C.teal : C.amber]);
    return panel(span || 'c8', 'Time spent per visitor', 'Minutes between registration and last update, latest ' + LIMIT + '. Teal is booked, sand is still open.', well(hbars(data, C.amber, null, (v) => v + ' min')));
  }
  function tablePanel(rows, title, sub, showStep) {
    const list = [...rows].sort((a, b) => b.c.localeCompare(a.c));
    const body = list.length ? `<div class="scroll"><table><thead><tr><th>Visitor</th><th>Registered</th><th class="num">Minutes</th><th>Qualification</th><th>Course</th><th>Payment</th><th class="num">Amount</th>${showStep ? '<th class="num">Saved step</th>' : ''}<th>Audio</th><th>Stage</th></tr></thead><tbody>${list.map((v) => {
      const [s, c] = stage(v);
      return `<tr><td><b>${esc(v.nm)}</b> <span style="color:var(--ink-3);font-size:11.5px">${v.n}</span></td><td>${fmtDT(v.c)}</td><td class="num">${v.mins}</td><td>${esc(v.q || '–')}</td><td>${v.co ? esc(cap(v.co)) : '–'}</td><td>${v.pa ? esc(cap(v.pa)) : '–'}</td><td class="num">${v.am ? inr(v.am) : '–'}</td>${showStep ? `<td class="num">${v.st}</td>` : ''}<td>${v.rec ? v.rec + ' rec.' : '–'}</td><td><span class="chip ${c}">${s}</span></td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="well empty">No visitors in this view</div>';
    return panel('c12', title, sub, body);
  }
  function followUp(rows, span) {
    const open = rows.filter((v) => v.s !== 'booked').sort((a, b) => (!!b.pa - !!a.pa) || (!!b.co - !!a.co) || b.u.localeCompare(a.u));
    const allHot = open.filter((v) => v.co || v.pa), hot = allHot.slice(0, 3), more = allHot.length - hot.length, cold = open.length - allHot.length;
    const body = hot.length ? `<div class="stack">${hot.map((v) => flag(esc(v.nm) + ' (' + v.n + ') chose ' + [v.co && cap(v.co), v.pa && cap(v.pa) + ' payment'].filter(Boolean).join(' with '), 'and stopped at step ' + v.st + '. Last active ' + fmtDT(v.u) + '.')).join('')}${more > 0 ? `<div class="sub">+${more} more open visitors</div>` : ''}</div>` : '<div class="well empty">No open visitors have chosen a course yet</div>';
    return panel(span || 'c12', 'Follow up first', 'Open visitors who already picked a course or payment route. ' + cold + ' more registered visitors have not picked either.', body);
  }
  function branchTable(rows) {
    const TODAY = DATA.today;
    const amt = (list, today) => list.filter((v) => v.s === 'booked' && (!today || v.u.slice(0, 10) === TODAY)).reduce((s, v) => s + (v.am || 0), 0);
    const line = (name, list) => { const t = list.filter((v) => v.day === TODAY).length; return `<tr><td><b>${esc(name)}</b></td><td class="num">${t ? `<span class="chip ok">${t}</span>` : '0'}</td><td class="num">${list.length}</td><td class="num">${inr(amt(list, true))}</td><td class="num">${inr(amt(list, false))}</td></tr>`; };
    const known = new Set(DATA.branches.map((b) => b.id));
    const body = DATA.branches.map((b) => line(b.name, rows.filter((v) => v.br === b.id))).join('') + line('No branch saved', rows.filter((v) => !v.br || !known.has(v.br)));
    const tt = rows.filter((v) => v.day === TODAY).length;
    return panel('c12', 'Visits by branch', 'Today is ' + fmtDay(TODAY) + ' ' + TODAY.slice(0, 4) + '. Visits are visitor sessions registered. Booking amount counts booked visitors, and today\'s amount uses the day of the last update.', `<div class="scroll"><table style="min-width:560px"><thead><tr><th>Branch name</th><th class="num">Today visit</th><th class="num">Total visit</th><th class="num">Today booking amount</th><th class="num">Total booking amount</th></tr></thead><tbody>${body}<tr><td><b>All branches</b></td><td class="num"><b>${tt}</b></td><td class="num"><b>${rows.length}</b></td><td class="num"><b>${inr(amt(rows, true))}</b></td><td class="num"><b>${inr(amt(rows, false))}</b></td></tr></tbody></table></div>`);
  }
  function branchPanel(rows) {
    const nb = rows.filter((v) => !v.br).length;
    const per = DATA.branches.map((b) => [b.name, rows.filter((v) => v.br === b.id).length]).filter((d) => d[1] > 0).sort((a, b) => b[1] - a[1]);
    const data = [['No branch', nb, C.coral], ...per.slice(0, 4)];
    const rest = per.slice(4).reduce((s, d) => s + d[1], 0);
    if (rest) data.push(['Other branches', rest]);
    return panel('c6', 'Visitors by branch', 'Branch saved on the visitor record',
      well(hbars(data, C.teal, rows.length || 1)) + (nb ? `<div class="sub">${nb} visitors cannot be reported by branch until a branch is saved with them.</div>` : ''));
  }

  /* ---------- role views ---------- */
  const COMPL = (rows) => { const n = rows.length, f = (label, k) => [label, rows.filter(k).length, n]; return [f('Qualification', (v) => v.q), f('Place', (v) => v.pl), f('Course', (v) => v.co), f('Payment', (v) => v.pa), f('Batch', (v) => v.ba), f('Branch', (v) => v.br)]; };
  const COURSE = [C.coral, C.teal], PAY = [C.amber, C.coral, C.teal];
  const V = {};
  V.developer = (rows) => {
    const comp = COMPL(rows), bookedLow = rows.filter((v) => v.s === 'booked' && v.st < 5), noBranch = rows.filter((v) => !v.br).length;
    const recs = rows.reduce((s, v) => s + v.rec, 0), withRec = rows.filter((v) => v.rec).length;
    const steps = rows.map((v) => v.st), lo = steps.length ? Math.min(...steps) : 0, hi = steps.length ? Math.max(...steps) : 0;
    return kpis(rows) + `<div class="grid fit">
      ${panel('c6', 'Field completeness', 'Visitors with each field filled in', well(hbars(comp.map((c) => [c[0], c[1], c[1] === 0 && c[2] ? C.coral : null]), C.teal, rows.length || 1, (v) => v + ' / ' + rows.length)))}
      ${panel('c6', 'Data checks', 'Things to confirm in the visitor records', `<div class="stack">
        ${flag(noBranch + ' of ' + rows.length + ' visitors have no branch.', 'Branch-scoped reports and visitor lists only include visitors saved with a branch.')}
        ${flag(bookedLow.length + ' booked visitors saved a step below 5.', 'Saved step ranges from ' + lo + ' to ' + hi + '. Confirm that booking resets the saved step, or the funnel cannot use it as a progress measure.')}
        ${flag(recs + ' recordings link to ' + withRec + ' visitor' + (withRec === 1 ? '' : 's') + '.', 'Visitors without a linked recording: ' + (rows.length - withRec) + '.')}
      </div>`)}
      ${funnelPanel(rows, 'c5')}${dayPanel(rows, 'c7')}
      ${timePanel(rows, 'c7')}
      ${mixPanel(rows, 'Course choice', 'Visitors who chose a course', (v) => v.co, COURSE, ['laptop', 'smartphone'], 'c5')}
    </div>`;
  };
  V.admin = (rows) => kpis(rows) + `<div class="grid fit g8">
      ${funnelPanel(rows, 'c5')}${dayPanel(rows, 'c7')}
      ${mixPanel(rows, 'Course choice', 'Visitors who chose a course', (v) => v.co, COURSE, ['laptop', 'smartphone'])}
      ${mixPanel(rows, 'Payment route', 'Visitors who chose a route', (v) => v.pa, PAY, ['mix', 'cash', 'loan'])}
      ${qualPanel(rows)}
      ${amountPanel(rows, 'c6')}
      ${branchPanel(rows)}
      ${followUp(rows)}
    </div>`;
  V.branch_manager = (rows) => kpis(rows) + `<div class="grid fit">
      ${followUp(rows)}
      ${funnelPanel(rows, 'c5')}${dayPanel(rows, 'c7')}
      ${mixPanel(rows, 'Course choice', 'Visitors who chose a course', (v) => v.co, COURSE, ['laptop', 'smartphone'])}
      ${mixPanel(rows, 'Payment route', 'Visitors who chose a route', (v) => v.pa, PAY, ['mix', 'cash', 'loan'])}
      ${amountPanel(rows)}
    </div>`;

  /* ---------- shell ---------- */
  const SUBS = {
    developer: 'Every visitor record plus data checks for the people who maintain the app.',
    admin: 'All visitors across all branches, with conversion, payment and branch coverage.',
    branch_manager: 'Visitors for your branch and who to call back first.',
  };
  function scoped() {
    return status === 'all' ? ALL : ALL.filter((v) => (status === 'booked' ? v.s === 'booked' : v.s !== 'booked'));
  }
  function shell() {
    const keys = views.length > 1 ? `<div class="keys" role="group" aria-label="Report view">${views.map((r) => `<button type="button" class="key" data-role="${r}" aria-pressed="${r === view}">${VIEW_NAMES[r]}</button>`).join('')}</div>` : '';
    const dial = views.length > 1 ? `<div class="dial-box"><button type="button" class="dial" id="rpt-dial" aria-label="Turn to switch report view"><span class="needle" style="transform:rotate(${(views.indexOf(view) - (views.length - 1) / 2) * 55}deg)"></span></button><small>${VIEW_NAMES[view]}</small></div>` : '<span></span>';
    const scope = `Scope: ${DATA.scope === 'all' ? 'All branches' : esc(DATA.branch_name || 'Your branch') + ' branch'}.`;
    if (section === 'branches') {
      return `<header class="slim"><h1><span class="brand-led"></span>Branches</h1><span class="meta">${scope} As of ${fmtDay(DATA.today)} ${DATA.today.slice(0, 4)}</span></header>
      <div id="rpt-view" class="rpt-view"></div>`;
    }
    return `<header class="slim"><h1><span class="brand-led"></span>Visitor Dashboard</h1><span class="meta">${scope} As of ${fmtDay(DATA.today)} ${DATA.today.slice(0, 4)}</span>${keys}</header>
      <div id="rpt-view" class="rpt-view"></div>`;
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
      if (filtersRoot) filtersRoot.innerHTML = [['all', 'All visitors'], ['booked', 'Booked'], ['open', 'In progress']].map(([k, l]) => `<button type="button" class="pill" data-status="${k}" aria-pressed="${status === k}">${l}</button>`).join('');
    } else if (filtersRoot) {
      filtersRoot.querySelectorAll('.pill').forEach((p) => p.setAttribute('aria-pressed', p.dataset.status === status));
    }
    const hint = DATA.scope === 'branch' && !ALL.length ? `<div class="raised panel">${flag('No visitors are saved to ' + esc(DATA.branch_name || 'this branch') + ' yet.', 'Visitors appear here once they are registered by a user assigned to this branch.')}</div>` : '';
    root.classList.toggle('one', section !== 'branches');
    root.querySelector('#rpt-view').innerHTML = section === 'branches' ? `<div class="grid">${branchTable(scoped())}</div>` : hint + V[view](scoped());
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
    if (!views.includes(view)) view = views[0];
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
      let x = e.clientX + 14, y = e.clientY - h - 12;
      if (x + w > innerWidth - 8) x = e.clientX - w - 14;
      if (y < 8) y = e.clientY + 18;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    });
    root.addEventListener('mouseleave', () => { if (current) { clear(current); current = null; } });
  }
  function bind() {
    root.addEventListener('click', (e) => {
      const key = e.target.closest('.key'), dial = e.target.closest('#rpt-dial');
      if (key) { view = key.dataset.role; draw(true); }
      else if (dial) { view = views[(views.indexOf(view) + 1) % views.length]; draw(true); }
    });
    if (filtersRoot) filtersRoot.addEventListener('click', (e) => {
      const pill = e.target.closest('.pill');
      if (pill) { status = pill.dataset.status; draw(false); }
    });
  }
  window.MagnusReports = {
    init(opts) { apiGet = opts.api; esc = opts.esc || esc; onError = opts.onError || onError; root = opts.root; filtersRoot = opts.filtersRoot || null; root.classList.add('rpt'); bind(); bindHover(); },
    async records(target) {
      try {
        prepare(await apiGet('/api/admin/report'));
        target.classList.add('rpt');
        target.innerHTML = tablePanel(ALL, 'Visitor records', 'Each visitor by name, with the last saved step', true);
        target.querySelectorAll('.panel,tbody tr').forEach((e) => { e.style.animation = 'none'; });
      } catch (error) { onError(error); }
    },
    async load(next) {
      if (next) section = next;
      try {
        prepare(await apiGet('/api/admin/report'));
        draw(true);
      } catch (error) { onError(error); }
    },
  };
})();