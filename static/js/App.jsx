const { useState, useEffect, useRef } = React;

/* ---------- helpers ---------- */
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const api = async (url, opt = {}) => {
  const r = await fetch(url, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const send = (method, body, pin) => ({
  method,
  headers: { 'Content-Type': 'application/json', ...(pin ? { 'X-Admin-Pin': pin } : {}) },
  body: JSON.stringify(body),
});
const card = (t, d, m, x = {}) => ({ t, d, m, ...x });

/* ---------- the PPT, as data ----------
   m = 'photo' | 'video' -> a media slot (counsellor uploads once, shown to every visitor)
   Slot key = `${slide.key}-${cardIndex}`  e.g. classrooms-1, jobs-0                       */
const PHASES = [
  { id: 'welcome', name: 'Welcome', icon: 'fa-hand' },
  { id: 'tour', name: 'Campus tour', icon: 'fa-building' },
  { id: 'course', name: 'Course', icon: 'fa-microchip' },
  { id: 'career', name: 'Career', icon: 'fa-briefcase' },
  { id: 'fees', name: 'Fees & terms', icon: 'fa-indian-rupee-sign' },
  { id: 'booking', name: 'Booking', icon: 'fa-calendar-check' },
];

const SLIDES = [
  { key: 'welcome', phase: 'welcome', type: 'register', title: 'Welcome' },

  { key: 'reception', phase: 'tour', title: 'Reception & Leadership', cols: 2,
    cards: [card('Reception', '', 'photo'), card('SCM / HOD', '', 'photo')] },
  { key: 'classrooms', phase: 'tour', title: 'Our Classrooms', cols: 4, single: true, cards: [
    card('Classroom 1', 'AC, projector, sound system and chairs', 'photo'),
    card('Classroom 2', 'Mobile phones, laptops, tools, machines, bag · spoken English & Hindi', 'photo'),
    card('Classroom 3', 'Uniform (shirt, pant, tag) · student photo', 'photo'),
    card('Classroom 4', 'Young faculties', 'photo')] },
  { key: 'lab', phase: 'tour', title: 'Lab & Practical Experience', cols: 2, cards: [
    card('Lab', 'Explain the latest machines', 'photo'), card('Practical Experience', '', 'video')] },
  { key: 'recognition', phase: 'tour', title: 'Counselling & Recognition', cols: 3, cards: [
    card('Cabin Orientation / Counselling', '', 'photo'),
    card('Central Gov & Magnus', 'TSSC / ESSI · Skill India', 'photo'),
    card('MLA', '', 'video')] },

  { key: 'courses', phase: 'course', type: 'courses', title: 'Our Courses' },
  { key: 'classes', phase: 'course', title: 'How Classes Work', cols: 3, cards: [
    card('Listening · Teaching', 'Time, haircut, uniform', 'photo'),
    card('Visualisation', 'Video class', 'video'),
    card('Practical', '', 'video'),
    card('QC', 'No exam', 'video'),
    card('Attendance', '90% required · late coming'),
    card('Grade', 'Progress card', 'photo')] },
  { key: 'learn', phase: 'course', title: 'What You Will Learn', cols: 2,
    banner: { t: 'With the latest equipment & machines', d: 'Manual & automatic', slot: 'learn-banner' },
    cards: [
      card('Mobile & laptop · A to Z', '', 'photo', { chips: ['Hardware', 'Software', 'Sales', 'Service', 'Chip level'] }),
      card('Basic electronics + brands', '', 'photo', { chips: ['Nokia', 'Redmi', 'Realme', 'Oppo', 'Vivo', 'Samsung', 'iPhone'] })] },
  { key: 'benefits1', phase: 'course', title: 'Additional Benefits (1–6)', cols: 2, rows: true, cards: [
    card('AI office automation', '', 'video', { n: 1 }), card('AI tech bot', '', 'video', { n: 2 }),
    card('Business class', '', 'video', { n: 3 }),
    card('Updation class (new mobiles, laptops, tools, machines, complaints) & lifelong support', '', 'video', { n: 4 }),
    card('Re-training', '', 'video', { n: 5 }), card('Spoken Hindi & English', '', 'video', { n: 6 })] },
  { key: 'benefits2', phase: 'course', title: 'Additional Benefits (7–12)', cols: 2, rows: true,
    banner: { t: '12 additional benefits included with the course' }, cards: [
      card('Distance degree', '', 'video', { n: 7 }), card('Motivation & life skill', '', 'photo', { n: 8 }),
      card('Hostel', '', 'video', { n: 9 }), card('Hope & care', '', 'video', { n: 10 }),
      card('Sports & arts', '', 'video', { n: 11 }), card('Abroad Placement', '', 'video', { n: 12 })] },

  { key: 'ojt', phase: 'career', title: 'On-the-Job Training', cols: 4, cards: [
    card('Location', 'Zoom in to explore service-centre counts by area', null, { n: 1, type: 'location' }),
    card('State / District', '', null, { n: 2 }),
    card('Stipend & Incentive', '', 'photo', { n: 3 }), card('Certificate', '', 'video', { n: 4 })] },
  { key: 'certs', phase: 'career', title: 'Certificates', cols: 3,
    banner: { t: 'Certificate distribution ceremony · once every month', d: 'Student branch with SCM, HOF, faculties & marketing staff' },
    cards: [card('NCVET', '', 'photo', { n: 1 }), card('1-year job experience certificate', '', 'photo', { n: 2 }),
            card('Magnus course completion certificate', '', 'photo', { n: 3 })] },
  { key: 'jobs', phase: 'career', title: 'Job Opportunities', cols: 2, rows: true, cards: [
    card('Expert service engineer', '', 'video', { n: 1, tag: 'Rashid' }), card('Service manager', '', 'video', { n: 2 }),
    card('Abroad expert service engineer / head / manager', '', 'video', { n: 3, tag: 'Amal' }),
    card('Faculty / HOF / HOD', '', 'video', { n: 4 }), card('R&D staff & HOD', '', 'video', { n: 5 }),
    card('Institute manager / regional manager / CEO', '', 'video', { n: 6 }),
    card('Owner: mobile service centre & sales', '', 'video', { n: 7 }), card('Tech vlogger', '', 'video', { n: 8 })] },
  { key: 'growth', phase: 'career', title: 'Career Growth', cols: 3, single: true,
    banner: { t: 'Age comparison', d: 'Mentally · Physically · Financially', slot: 'growth-banner' }, cards: [
      card('Age 18', 'Job', null), card('Age 20', '₹20,000 / ₹40,000 · Car', null), card('Age 23', 'Marriage', null)] },

  { key: 'compare', phase: 'fees', type: 'compare', title: 'Why Laptop?' },
  { key: 'fees', phase: 'fees', type: 'fees', title: 'Choose your course' },
  { key: 'payment', phase: 'fees', type: 'payment', title: 'Payment & Expenses' },
  { key: 'terms', phase: 'fees', type: 'terms', title: 'Other Terms' },
  { key: 'loan', phase: 'fees', type: 'loan', title: 'Skill Loan' },
  { key: 'docs', phase: 'fees', type: 'docs', title: 'Documents Required' },

  { key: 'booking', phase: 'booking', type: 'booking', title: 'Batch Assignment' },
  { key: 'summary', phase: 'booking', type: 'summary', title: 'Summary' },
];

/* Tour/course/career slides become one step per card (the sliding hero layout).
   Slides marked `rows` or `single` and all custom screens stay as a single step. Media slot keys are unchanged. */
const STEPS = SLIDES.flatMap((s) => {
  if (s.type || s.rows || s.single) return [s];
  const out = [];
  if (s.banner) out.push({ key: `${s.key}-banner`, phase: s.phase, type: 'hero', group: s.title,
    title: s.banner.t, desc: s.banner.d, kind: s.banner.slot ? 'photo' : null, slot: s.banner.slot });
  s.cards.forEach((k, i) => out.push({ key: `${s.key}-${i}`, phase: s.phase, type: k.type || 'hero', group: s.title,
    title: k.t, desc: k.d, kind: k.m, slot: `${s.key}-${i}`, chips: k.chips }));
  return out;
});

function HeroSlide({ s, mp, phase, n }) {
  return (
    <div className="hero">
      <div className="hero-copy">
        <span className="hero-eyebrow"><i className={`fa-solid ${phase.icon}`}></i>{phase.name} · {String(n).padStart(2, '0')}</span>
        <h2>{s.title}</h2>
        {s.desc && <p>{s.desc}</p>}
        {s.chips && <div className="chips">{s.chips.map((c) => <span className="chip" key={c}>{c}</span>)}</div>}
        <small className="hero-group">{s.group}</small>
      </div>
      <aside className="hero-panel">
        <span className="hero-panel-label">Get to know this space</span>
        {s.kind
          ? <MediaSlot {...mp} slot={s.slot} kind={s.kind} label={s.title} />
          : <div className="hero-icon" aria-hidden="true"><i className={`fa-solid ${phase.icon}`}></i></div>}
        <span className="hero-panel-foot">MAGNUS · ORIENTATION</span>
      </aside>
    </div>
  );
}

function LocationSlide({ cfg }) {
  const mapElement = useRef(null);
  const mapInstance = useRef(null);
  const [zoom, setZoom] = useState(4);
  const [mapError, setMapError] = useState('');
  const serviceCentres = cfg.service_centres;
  const areas = serviceCentres.areas;
  const districts = serviceCentres.kerala_districts;
  const outsideMajorCities = serviceCentres.outside_major_cities;
  const mapAreas = areas.filter((area) => Number.isFinite(area.latitude) && Number.isFinite(area.longitude));
  const focusArea = mapAreas[0];

  useEffect(() => {
    if (!window.L) {
      setMapError('The map could not be loaded. Check your internet connection and reload.');
      return undefined;
    }

    const leaflet = window.L;
    const map = leaflet.map(mapElement.current, { zoomControl: false, scrollWheelZoom: true })
      .setView([22.5, 79], 4);
    mapInstance.current = map;

    const tiles = leaflet.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Sources: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China (Hong Kong), Esri Korea, Esri (Thailand), NGCC, OpenStreetMap contributors, and the GIS User Community',
    }).addTo(map);
    tiles.on('tileerror', () => setMapError('Map tiles could not be loaded. Check your internet connection.'));

    const makeIcon = (count, label, total = false) => {
      const badge = document.createElement('span');
      badge.className = `service-map-badge${total ? ' total' : ''}`;
      badge.setAttribute('role', 'img');
      badge.setAttribute('aria-label', `${Number(count).toLocaleString('en-IN')} service centres, ${label}`);
      const value = document.createElement('strong');
      value.textContent = Number(count).toLocaleString('en-IN');
      badge.append(value);
      return leaflet.divIcon({ className: 'service-map-icon', html: badge, iconSize: null });
    };

    const totalMarker = leaflet.marker([22.5, 79], {
      icon: makeIcon(serviceCentres.total, 'Service centres · India', true),
      keyboard: false,
    }).addTo(map);
    const districtMarkers = districts.map((district) => leaflet.marker([district.latitude, district.longitude], {
      icon: makeIcon(district.count, district.name),
      keyboard: false,
    }));
    const areaMarkers = districts.flatMap((district) => district.areas.map((area) => leaflet.marker(
      [area.latitude, area.longitude],
      { icon: makeIcon(area.count, `${area.name} · ${district.name}`), keyboard: false },
    )));
    const outsideMarkers = outsideMajorCities.map((city) => leaflet.marker([city.latitude, city.longitude], {
      icon: makeIcon(city.count, city.name),
      keyboard: false,
    }));

    const syncZoom = () => {
      const currentZoom = map.getZoom();
      setZoom(currentZoom);
      if (currentZoom >= 10) {
        [totalMarker, ...districtMarkers].forEach((marker) => { if (map.hasLayer(marker)) map.removeLayer(marker); });
        [...areaMarkers, ...outsideMarkers].forEach((marker) => { if (!map.hasLayer(marker)) marker.addTo(map); });
      } else if (currentZoom >= 7) {
        [totalMarker, ...areaMarkers].forEach((marker) => { if (map.hasLayer(marker)) map.removeLayer(marker); });
        [...districtMarkers, ...outsideMarkers].forEach((marker) => { if (!map.hasLayer(marker)) marker.addTo(map); });
      } else if (currentZoom >= 5) {
        [...districtMarkers, ...areaMarkers, totalMarker].forEach((marker) => { if (map.hasLayer(marker)) map.removeLayer(marker); });
        outsideMarkers.forEach((marker) => { if (!map.hasLayer(marker)) marker.addTo(map); });
      } else {
        [...districtMarkers, ...areaMarkers, ...outsideMarkers].forEach((marker) => { if (map.hasLayer(marker)) map.removeLayer(marker); });
        if (!map.hasLayer(totalMarker)) totalMarker.addTo(map);
      }
    };
    map.on('zoomend', syncZoom);
    syncZoom();

    return () => {
      map.off('zoomend', syncZoom);
      map.remove();
      mapInstance.current = null;
    };
  }, [serviceCentres]);

  const zoomToArea = () => {
    if (mapInstance.current && focusArea) mapInstance.current.flyTo([focusArea.latitude, focusArea.longitude], 8);
  };
  const adjustZoom = (change) => {
    if (mapInstance.current) {
      mapInstance.current.setZoom(mapInstance.current.getZoom() + change, { animate: false });
    }
  };

  return (
    <div className="location-dashboard">
      <div className="location-summary">
        <div>
          <span className="location-summary-label">Number of service centres</span>
          <strong>{Number(serviceCentres.total).toLocaleString('en-IN')}</strong>
          <span className="location-summary-foot">Across India</span>
        </div>
        <div className="location-breakdown" aria-label="Service-centre split by area">
          {areas.map((area) => (
            <div key={area.name}>
              <strong>{Number(area.count).toLocaleString('en-IN')}</strong>
              <span>{area.name}</span>
            </div>
          ))}
        </div>
        <span className="location-zoom-level" aria-live="polite">
          {zoom >= 10 ? 'City & area view · counts only' : zoom >= 7 ? 'Kerala district view · counts only' : zoom >= 5 ? 'Outside Kerala major cities · counts only' : 'India view · zoom in for area counts'}
        </span>
      </div>
      <p className="location-estimate-note">{serviceCentres.estimate_basis}</p>
      <div className="service-map-wrap">
        <div ref={mapElement} className="service-map" role="application" aria-label="Interactive service-centre map of India" />
        <div className="service-map-controls" aria-label="Map controls">
          <button type="button" aria-label="Zoom in" onClick={() => adjustZoom(1)}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => adjustZoom(-1)}>−</button>
          {focusArea && <button type="button" className="service-map-focus" onClick={zoomToArea}>Zoom to {focusArea.name}</button>}
        </div>
        {mapError && <p className="service-map-error" role="alert">{mapError}</p>}
      </div>
      <p className="service-map-hint">Zoom to Kerala for district counts, then zoom in for six city counts and an other-areas count. Outside Kerala shows major-city counts.</p>
    </div>
  );
}

const gate = (s, lead) => {
  if (s.type === 'register' && !lead.id) return 'Register the visitor to begin.';
  if (s.type === 'fees' && !lead.course) return 'Choose a course to continue.';
  if (s.type === 'payment' && !lead.payment) return 'Choose a payment option to continue.';
  if (s.type === 'terms' && !lead.terms) return 'Student and parent must accept the terms to continue.';
  if (s.type === 'booking' && !lead.booking_amount) return 'Choose a booking amount to continue.';
  return '';
};

/* ---------- media slot ---------- */
function MediaSlot({ slot, kind, media, admin, pin, reload, label }) {
  const input = useRef();
  const m = media[slot];
  const upload = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    try { await api(`/api/media/${slot}`, { method: 'POST', headers: { 'X-Admin-Pin': pin }, body: fd }); reload(); }
    catch (err) { alert(err.message); }
  };
  return (
    <div className={`media ${m ? 'filled' : ''}`}>
      {m ? (m.type === 'video'
        ? <video src={m.url} controls playsInline preload="metadata" />
        : <img src={m.url} alt={label || slot} />)
        : <div className="media-empty">
            <i className={`fa-solid ${kind === 'video' ? 'fa-circle-play' : 'fa-camera'}`}></i>
            <span>{kind === 'video' ? 'Video' : 'Photo'} coming soon</span>
          </div>}
      {admin && <>
        <button type="button" className="media-up" onClick={() => input.current.click()}>
          <i className="fa-solid fa-upload"></i> {m ? 'Replace' : 'Upload'} · {slot}
        </button>
        <input ref={input} type="file" hidden accept="image/*,video/*" onChange={upload} />
      </>}
    </div>
  );
}

/* ---------- slide renderers ---------- */
function GenericSlide({ s, mp }) {
  return (
    <>
      {s.banner && (
        <div className="fbanner">
          <div><strong>{s.banner.t}</strong>{s.banner.d && <span>{s.banner.d}</span>}</div>
          {s.banner.slot && <div className="banner-media"><MediaSlot {...mp} slot={s.banner.slot} kind="photo" /></div>}
        </div>
      )}
      <div className="fgrid" style={{ '--cols': s.cols }}>
        {s.cards.map((k, i) => (
          <article className={`fcard ${s.rows ? 'row' : ''}`} key={i}>
            {k.n && <span className="num">{k.n}</span>}
            {!s.rows && k.m && <MediaSlot {...mp} slot={`${s.key}-${i}`} kind={k.m} label={k.t} />}
            <div className="ftext">
              <h3>{k.t}{k.tag && <em className="chip tag">{k.tag}</em>}</h3>
              {k.d && <p>{k.d}</p>}
              {k.chips && <div className="chips">{k.chips.map((c) => <span className="chip" key={c}>{c}</span>)}</div>}
            </div>
            {s.rows && k.m && <MediaSlot {...mp} slot={`${s.key}-${i}`} kind={k.m} label={k.t} />}
          </article>
        ))}
      </div>
    </>
  );
}

function RegisterSlide({ lead, setLead, onNew, onStart }) {
  const [f, setF] = useState({ name: '', phone: '', parent_name: '', place: '', qualification: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { const l = await api('/api/leads', send('POST', f)); localStorage.setItem('leadId', l.id); setLead(l); onStart(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  if (lead.id) return (
    <div className="fcard welcome">
      <h2>Welcome back, {lead.name}</h2>
      <p>Your counselling is saved. Continue where you stopped, or start a new visitor.</p>
      <div className="actions">
        <button className="btn-next" onClick={onStart}><span>Continue</span><i className="fa-solid fa-arrow-right"></i></button>
        <button className="btn-prev" onClick={onNew}>New visitor</button>
      </div>
    </div>
  );
  return (
    <div className="fcard welcome">
      <h2>Let's get to know you</h2>
      <p>We save your answers as you go, so you can pick up later.</p>
      <form className="form" onSubmit={submit}>
        <label>Student name<input value={f.name} onChange={set('name')} autoComplete="name" required /></label>
        <label>Mobile number<input value={f.phone} onChange={set('phone')} inputMode="numeric" maxLength={14} placeholder="10 digits" required /></label>
        <label>Parent / guardian name<input value={f.parent_name} onChange={set('parent_name')} /></label>
        <label>Place<input value={f.place} onChange={set('place')} /></label>
        <label>Qualification
          <select value={f.qualification} onChange={set('qualification')}>
            <option value="">Select</option>
            {['10th / SSLC', '12th / Plus Two', 'ITI', 'Diploma', 'Degree', 'Other'].map((q) => <option key={q}>{q}</option>)}
          </select>
        </label>
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn-next" disabled={busy}><span>{busy ? 'Saving…' : 'Start the tour'}</span><i className="fa-solid fa-arrow-right"></i></button>
      </form>
    </div>
  );
}

const total = (c) => c.student_fee + c.franchise_fee + c.stipend;

function CoursesSlide({ cfg, mp }) {
  const cs = Object.values(cfg.courses);
  return (
    <>
      <div className="fgrid" style={{ '--cols': 2 }}>
        {cs.map((c) => (
          <article className="fcard" key={c.name}>
            <p className="muted">Electronics and Communication in</p>
            <h3>{c.name}</h3>
            <div className="big">{c.months} months</div>
            <p className="muted">{c.training} + {c.ojt} months · training + OJT</p>
          </article>
        ))}
      </div>
      <div className="fgrid" style={{ '--cols': 3, marginTop: 16 }}>
        <article className="fcard dark"><p className="muted">Stipend (minimum)</p><div className="mid">{inr(cfg.stipend_range[0])} to {inr(cfg.stipend_range[1])}</div></article>
        <article className="fcard dark"><p className="muted">Salary</p><div className="mid">{inr(cfg.salary_range[0])} to {inr(cfg.salary_range[1])}</div></article>
        <article className="fcard"><h3>Agreement</h3><MediaSlot {...mp} slot="courses-agreement" kind="video" label="Agreement" /></article>
      </div>
    </>
  );
}

function CompareSlide({ cfg }) {
  const a = cfg.courses.smartphone, b = cfg.courses.laptop;
  const emi = (c) => `${inr(c.emi_first)} first, then ${inr(c.emi_each)} × ${c.emi_count}`;
  const rows = [
    ['Duration', `${a.months} months (${a.training} + ${a.ojt})`, `${b.months} months (${b.training} + ${b.ojt})`],
    ['Fees', inr(a.student_fee), inr(b.student_fee)],
    ['EMI', emi(a), emi(b)],
    ['Technology', 'One technology', 'Two technologies'],
    ['OJT will get', 'Only mobile service / sales centre', 'Only mobile service / sales centre'],
    ['If going to an interview', 'Low possibility', 'High possibility – knows mobile and laptop service'],
    ['Abroad recruitment', 'Low possibility', 'High possibility – knows mobile and laptop service'],
    ['Laptop study again', 'Minimum fee ₹80K and 4 months', 'He already knows'],
  ];
  const diff = b.student_fee - a.student_fee, months = b.months - a.months;
  return (
    <>
      <div className="fcard scroll">
        <table className="ftable">
          <thead><tr><th>Course</th><th>Mobile</th><th>Mobile + Laptop</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r[0]}><th scope="row">{r[0]}</th><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="fbanner" style={{ marginTop: 16 }}>
        <div><strong>Only {inr(diff)} and {months} months more</strong>
          <span>That is the whole difference between the two courses ({inr(b.student_fee)} vs {inr(a.student_fee)}; {b.months} vs {a.months} months).</span></div>
      </div>
    </>
  );
}

function FeesSlide({ cfg, lead, patch }) {
  return (
    <div className="fgrid" style={{ '--cols': 2 }}>
      {Object.entries(cfg.courses).map(([id, c]) => (
        <button type="button" key={id} className={`fcard pick ${lead.course === id ? 'sel' : ''}`}
          onClick={() => patch({ course: id, payment: lead.course === id ? lead.payment : '' })} aria-pressed={lead.course === id}>
          <h3>{c.name}</h3>
          <p className="muted">Duration: {c.months} months ({c.training} + {c.ojt})</p>
          <div className="eq">
            <div><small>Student payable fees</small><b>{inr(c.student_fee)}</b></div><span>+</span>
            <div><small>Franchise payable fees</small><b>{inr(c.franchise_fee)}</b></div><span>+</span>
            <div><small>Stipend</small><b>{inr(c.stipend)}</b></div><span>=</span>
            <div className="sum"><small>Total course value</small><b>{inr(total(c))}</b></div>
          </div>
          <p className="muted">The student pays {inr(c.student_fee)}.</p>
        </button>
      ))}
    </div>
  );
}

function PaymentSlide({ cfg, lead, patch }) {
  const c = cfg.courses[lead.course];
  if (!c) return <div className="fcard"><p>Choose a course first.</p></div>;
  const fee = c.student_fee;
  const cash = lead.payment === 'cash' ? fee : lead.payment === 'loan' ? 0
    : Math.min(Math.max(Number(lead.cash_amount ?? c.emi_first) || 0, 0), fee);
  const loan = fee - cash;
  const known = cfg.expenses.reduce((a, e) => a + (e.amount || 0), 0);
  const opts = [['cash', 'Cash'], ['loan', 'Pure loan'], ['mix', 'Loan + cash']];
  return (
    <div className="fgrid" style={{ '--cols': 2 }}>
      <article className="fcard">
        <h3>Payment options</h3>
        <div className="opts" role="radiogroup" aria-label="Payment option">
          {opts.map(([id, label], i) => (
            <button type="button" key={id} role="radio" aria-checked={lead.payment === id}
              className={`opt ${lead.payment === id ? 'sel' : ''}`} onClick={() => patch({ payment: id })}>
              <span className="num">{i + 1}</span>{label}
            </button>
          ))}
        </div>
        {lead.payment === 'mix' && (
          <label className="inline">Cash part
            <input type="number" min="0" max={fee} step="1000" value={lead.cash_amount ?? c.emi_first}
              onChange={(e) => patch({ cash_amount: Number(e.target.value) })} />
          </label>
        )}
        {lead.payment && (
          <div className="plan">
            <div><small>Course fee</small><b>{inr(fee)}</b></div>
            <div><small>Paid in cash</small><b>{inr(cash)}</b></div>
            <div><small>Paid by skill loan</small><b>{inr(loan)}</b></div>
          </div>
        )}
        {lead.payment === 'cash' && (
          <p className="muted">Instalments: {inr(c.emi_first)} first, then {inr(c.emi_each)} × {c.emi_count} (total {inr(c.emi_first + c.emi_each * c.emi_count)}).</p>
        )}
        {loan > 0 && <p className="muted">Loan EMI starts from month {cfg.loan.emi_from_month}. Loan period: {cfg.loan.years} years.</p>}
      </article>
      <article className="fcard">
        <h3>Additional expenses</h3>
        <ul className="list">
          {cfg.expenses.map((e, i) => (
            <li key={e.label}><span className="num amber">{i + 1}</span>
              <span>{e.label}{e.note && <small> · {e.note}</small>}</span>
              <b>{e.amount ? inr(e.amount) : 'Varies'}</b></li>
          ))}
        </ul>
        <p className="muted">Known extras at joining: {inr(known)} (food cost not included).</p>
      </article>
    </div>
  );
}

function TermsSlide({ cfg, lead, patch, mp }) {
  const ch = cfg.cheque;
  return (
    <>
      <div className="fgrid" style={{ '--cols': 3 }}>
        <article className="fcard"><MediaSlot {...mp} slot="terms-cooking" kind="photo" /><h3>Self cooking</h3></article>
        <article className="fcard"><MediaSlot {...mp} slot="terms-washing" kind="photo" /><h3>Self washing</h3></article>
        <article className="fcard">
          <h3>Leave & late coming</h3>
          <div className="note"><b>Every second Saturday, all Sundays</b><small>Basic training period (8/10 months)</small></div>
          <div className="note"><b>Weekly once</b><small>OJT time (12 months)</small></div>
        </article>
      </div>
      <div className="fgrid" style={{ '--cols': 2, marginTop: 16 }}>
        <article className="fcard dark">
          <p className="muted">Cheque</p><div className="big">{inr(ch.amount)}</div>
          <div className="chips"><span className="chip">Student: {ch.student}</span><span className="chip">Parent: {ch.parent}</span></div>
        </article>
        <article className="fcard">
          <h3>Reasons for 2 cheques</h3>
          <ul className="list">
            <li><span className="num red">1</span><span>Incomplete OJT</span></li>
            <li><span className="num red">2</span><span>Money / mobile theft or blackmail</span></li>
          </ul>
        </article>
      </div>
      <label className="accept">
        <input type="checkbox" checked={!!lead.terms} onChange={(e) => patch({ terms: e.target.checked })} />
        <span>I have understood: leave, attendance (90%), cheque and agreement terms.</span>
      </label>
    </>
  );
}

function LoanSlide({ cfg, mp }) {
  const L = cfg.loan;
  const pts = ['Full loan amount is received', `EMI starts from the ${L.emi_from_month}th month onwards`,
    'No Aadharam (property deed) / gold needed', `Loan period: ${L.years} years`, 'Full documents provided from our side'];
  return (
    <div className="fgrid" style={{ '--cols': 2 }}>
      <article className="fcard"><MediaSlot {...mp} slot="loan-0" kind="photo" /><h3>Skill loan</h3></article>
      <article className="fcard">
        <ul className="list">{pts.map((p) => <li key={p}><span className="num"><i className="fa-solid fa-check"></i></span><b>{p}</b></li>)}</ul>
      </article>
    </div>
  );
}

function DocsSlide({ cfg, lead, patch }) {
  const docs = lead.docs || {};
  return (
    <>
      <p className="muted lead-in">Base documents only needed for getting the loan. Tick each one the family has brought.</p>
      <div className="fgrid" style={{ '--cols': 3 }}>
        {cfg.documents.map((d) => (
          <button type="button" key={d.key} className={`fcard pick ${docs[d.key] ? 'sel' : ''}`} aria-pressed={!!docs[d.key]}
            onClick={() => patch({ docs: { ...docs, [d.key]: !docs[d.key] } })}>
            <span className="num"><i className={`fa-solid ${docs[d.key] ? 'fa-check' : 'fa-minus'}`}></i></span>
            <h3>{d.label}</h3>{d.note && <p className="muted">{d.note}</p>}
          </button>
        ))}
      </div>
    </>
  );
}

function BookingSlide({ cfg, lead, patch }) {
  const b = cfg.booking, nb = cfg.next_batch, fileRef = useRef();
  const [msg, setMsg] = useState('');
  const upload = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    try { await api(`/api/leads/${lead.id}/photo`, { method: 'POST', body: fd }); setMsg('Photo saved.'); patch({ photo: true }); }
    catch (x) { setMsg(x.message); }
  };
  const left = lead.booking_amount ? Math.max(b.first_payment_total - lead.booking_amount, 0) : null;
  const when = `${new Date(nb.date + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}, ${nb.time}`;
  return (
    <div className="fgrid" style={{ '--cols': 2 }}>
      <article className="fcard">
        <h3>Student photo</h3>
        <button type="button" className="media drop" onClick={() => fileRef.current.click()}>
          <div className="media-empty"><i className="fa-solid fa-camera"></i><span>{lead.photo ? 'Photo uploaded · tap to replace' : 'Tap to take or upload a photo'}</span></div>
        </button>
        <input ref={fileRef} type="file" hidden accept="image/*" capture="user" onChange={upload} />
        {msg && <p className="muted" role="status">{msg}</p>}
        <div className="note"><small>Next batch</small><b>{when}</b></div>
      </article>
      <article className="fcard">
        <h3>Booking amount</h3>
        <div className="amounts" role="radiogroup" aria-label="Booking amount">
          {b.options.map((a, i) => (
            <button type="button" key={a} role="radio" aria-checked={lead.booking_amount === a}
              className={`amt ${i === 0 ? 'top' : ''} ${lead.booking_amount === a ? 'sel' : ''}`}
              onClick={() => patch({ booking_amount: a, batch: when })}>{inr(a)}</button>
          ))}
        </div>
        {left !== null && (
          <>
            <div className="amounts balance" aria-live="polite">
              <div className="amt-card"><small>Paying now</small><b>{inr(lead.booking_amount)}</b></div>
              <div className={`amt-card ${left === 0 ? 'done' : 'due'}`}><small>{left === 0 ? 'Remaining' : 'Remaining to pay'}</small><b>{inr(left)}</b></div>
            </div>
            <p className="muted">{left === 0 ? 'First payment complete.' : `Complete the remaining ${inr(left)} of the ${inr(b.first_payment_total)} first payment before the batch starts.`}</p>
          </>
        )}
      </article>
    </div>
  );
}

function SummarySlide({ cfg, lead, onNew }) {
  const c = cfg.courses[lead.course] || {};
  const missing = cfg.documents.filter((d) => !(lead.docs || {})[d.key]).map((d) => d.label);
  const payLabel = { cash: 'Cash', loan: 'Pure loan', mix: 'Loan + cash' }[lead.payment];
  const rows = [['Student', lead.name], ['Mobile', lead.phone], ['Parent', lead.parent_name], ['Place', lead.place],
    ['Course', c.name], ['Duration', c.months && `${c.months} months (${c.training} + ${c.ojt})`], ['Course fee', c.student_fee && inr(c.student_fee)],
    ['Payment', payLabel], ['Booking amount', lead.booking_amount && inr(lead.booking_amount)], ['Batch', lead.batch],
    ['Documents pending', missing.length ? missing.join(', ') : 'None']];
  return (
    <div className="fcard summary">
      <div className="badge-icon" aria-hidden="true"><i className="fa-solid fa-check"></i></div>
      <h2>Booking recorded</h2>
      <dl>{rows.filter((r) => r[1]).map((r) => <div key={r[0]}><dt>{r[0]}</dt><dd>{r[1]}</dd></div>)}</dl>
      <div className="actions no-print">
        <button className="btn-next" onClick={() => window.print()}><i className="fa-solid fa-print"></i><span>Print summary</span></button>
        <button className="btn-prev" onClick={onNew}>New visitor</button>
      </div>
    </div>
  );
}

/* ---------- app shell ---------- */
function App() {
  const [cfg, setCfg] = useState(null);
  const [media, setMedia] = useState({});
  const [lead, setLead] = useState({});
  const [i, setI] = useState(0);
  const [dir, setDir] = useState('fwd');
  const [toast, setToast] = useState('');
  const [pin, setPin] = useState(sessionStorage.getItem('pin') || '');
  const ref = useRef(lead); ref.current = lead;
  const s = STEPS[i];
  const admin = !!pin;

  const reload = () => api('/api/media').then(setMedia).catch(() => {});
  useEffect(() => {
    api('/api/config').then(setCfg).catch((e) => setToast(e.message));
    reload();
    const id = localStorage.getItem('leadId');
    if (id) api(`/api/leads/${id}`).then((l) => { setLead(l); setI(Math.min(l.progress || 0, STEPS.length - 1)); })
      .catch(() => localStorage.removeItem('leadId'));
  }, []);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); } }, [toast]);

  const patch = (p) => setLead((l) => ({ ...l, ...p }));
  const save = (progress, extra = {}) => {
    const l = ref.current;
    if (!l.id) return;
    const body = { course: l.course, payment: l.payment, cash_amount: l.cash_amount, docs: l.docs, terms: l.terms,
      booking_amount: l.booking_amount, batch: l.batch, progress, acknowledgments: l.acknowledgments, ...extra };
    api(`/api/leads/${l.id}`, send('PATCH', body)).catch(() => setToast('Could not save. Check the connection.'));
  };
  const acknowledge = (checked) => {
    const nextLead = {
      ...ref.current,
      acknowledgments: { ...(ref.current.acknowledgments || {}), [s.key]: checked },
    };
    ref.current = nextLead;
    setLead(nextLead);
    save(i, { acknowledgments: nextLead.acknowledgments });
  };
  const go = (n) => {
    n = Math.max(0, Math.min(n, STEPS.length - 1));
    if (n > i) {
      const acknowledgments = ref.current.acknowledgments || {};
      for (let step = i; step < n; step += 1) {
        const current = STEPS[step];
        if (current.type !== 'register' && current.type !== 'summary' && !acknowledgments[current.key]) {
          setToast(`Please acknowledge "${current.title}" before continuing.`);
          return;
        }
      }
      const g = gate(s, ref.current);
      if (g) { setToast(g); return; }
    }
    const done = STEPS[n].type === 'summary';
    setDir(n >= i ? 'fwd' : 'back'); setI(n); window.scrollTo({ top: 0, behavior: 'smooth' });
    save(n, done ? { status: 'booked' } : {});
    if (done && window.confetti) window.confetti({ particleCount: 110, spread: 75, origin: { y: 0.6 } });
  };
  const newVisitor = () => { localStorage.removeItem('leadId'); setLead({}); setI(0); };
  const unlock = async () => {
    if (admin) { sessionStorage.removeItem('pin'); setPin(''); return; }
    const p = prompt('Counsellor PIN'); if (!p) return;
    try { await api('/api/admin/login', send('POST', {}, p)); sessionStorage.setItem('pin', p); setPin(p); }
    catch (e) { setToast('Wrong PIN'); }
  };

  useEffect(() => {
    const k = (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'ArrowRight') go(i + 1); if (e.key === 'ArrowLeft') go(i - 1);
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  if (!cfg) return <div className="boot" role="status">{toast || 'Loading…'}</div>;
  const mp = { media, admin, pin, reload };
  const phase = PHASES.find((p) => p.id === s.phase);
  const acknowledged = !!(lead.acknowledgments || {})[s.key];
  const body = {
    register: <RegisterSlide lead={lead} setLead={setLead} onNew={newVisitor} onStart={() => go(1)} />,
    location: <LocationSlide cfg={cfg} />,
    courses: <CoursesSlide cfg={cfg} mp={mp} />, compare: <CompareSlide cfg={cfg} />,
    fees: <FeesSlide cfg={cfg} lead={lead} patch={patch} />, payment: <PaymentSlide cfg={cfg} lead={lead} patch={patch} />,
    terms: <TermsSlide cfg={cfg} lead={lead} patch={patch} mp={mp} />, loan: <LoanSlide cfg={cfg} mp={mp} />,
    docs: <DocsSlide cfg={cfg} lead={lead} patch={patch} />, booking: <BookingSlide cfg={cfg} lead={lead} patch={patch} />,
    summary: <SummarySlide cfg={cfg} lead={lead} onNew={newVisitor} />,
    hero: <HeroSlide s={s} mp={mp} phase={phase} n={stepNo} />,
  }[s.type] || <GenericSlide s={s} mp={mp} />;
  const stepNo = STEPS.filter((x) => x.phase === s.phase).indexOf(s) + 1;
  const first = (id) => STEPS.findIndex((x) => x.phase === id);

  return (
    <div className="app-wrapper">
      <div className="ambient-background"><div className="subtle-grid"></div><div className="ambient-glow-circle glow-1"></div><div className="ambient-glow-circle glow-2"></div></div>

      <header className="site-header no-print">
        <button className="brand-nav" onClick={() => go(0)} aria-label="Magnus home">
          <img src="/static/images/loginpageimage.png" alt="" className="brand-nav-logo" />
          <span className="brand-title">MAGNUS</span><span className="brand-badge">ADMISSION COUNSELLING</span>
        </button>
        <div className="nav-stats">
          <div className="progress-track-wrapper">
            <span className="progress-label" aria-live="polite">{i + 1} of {STEPS.length}</span>
            <div className="progress-bar-outer" role="progressbar" aria-valuemin="1" aria-valuemax={STEPS.length} aria-valuenow={i + 1}>
              <div className="progress-bar-inner" style={{ width: `${((i + 1) / STEPS.length) * 100}%` }}></div>
            </div>
          </div>
          <button className={`lock ${admin ? 'on' : ''}`} onClick={unlock} title={admin ? 'Counsellor mode on · tap to lock' : 'Counsellor sign-in'}
            aria-label={admin ? 'Lock counsellor mode' : 'Counsellor sign-in'}><i className={`fa-solid ${admin ? 'fa-lock-open' : 'fa-lock'}`}></i></button>
        </div>
      </header>

      <nav className="step-pills no-print" aria-label="Counselling stages">
        {PHASES.map((p, n) => {
          const active = p.id === s.phase, done = first(p.id) < first(s.phase);
          return (
            <button type="button" key={p.id} className={`step-pill ${active ? 'active' : ''} ${done ? 'completed' : ''}`}
              onClick={() => (lead.id || n === 0) && go(first(p.id))} aria-current={active ? 'step' : undefined}>
              <span className="pill-num">{done ? <i className="fa-solid fa-check"></i> : n + 1}</span><span>{p.name}</span>
            </button>
          );
        })}
      </nav>

      <main>
        <div className="stage-container">
          <section className={`orientation-section anim-${dir} ${s.type === 'hero' ? 'is-hero' : ''}`} key={s.key} data-step={i}>
            {s.type !== 'hero' && <div className="slide-head"><h1>{s.title}</h1>{lead.name && s.type !== 'register' && <span className="who">{lead.name}</span>}</div>}
            {body}
            {s.type !== 'register' && s.type !== 'summary' && (
              <label className="accept slide-acknowledgment">
                <input type="checkbox" checked={acknowledged} onChange={(e) => acknowledge(e.target.checked)} />
                <span>I have understood: {s.title}.</span>
              </label>
            )}
          </section>
        </div>
      </main>

      {toast && <div className="toast" role="alert">{toast}</div>}

      {s.type !== 'register' && s.type !== 'summary' && (
        <footer className="action-footer no-print">
          <div className="footer-step"><span className="footer-step-icon"><i className={`fa-solid ${phase.icon}`}></i></span>
            <span><small>{phase.name}</small><strong>{s.title}</strong></span></div>
          <div className="button-group">
            <button type="button" className="btn-prev" onClick={() => go(i - 1)}><i className="fa-solid fa-arrow-left"></i><span>Back</span></button>
            <button type="button" className="btn-next" disabled={!acknowledged} onClick={() => go(i + 1)}>
              <span>{STEPS[i + 1].type === 'summary' ? 'Confirm booking' : 'Continue'}</span><i className="fa-solid fa-arrow-right"></i></button>
          </div>
        </footer>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);