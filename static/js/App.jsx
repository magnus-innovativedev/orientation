const { useState, useEffect, useRef } = React;

const PERMISSION = Object.freeze({
  visitorCreate: 'visitor.create',
  visitorResume: 'visitor.resume',
  userViewAll: 'user.view_all',
  userViewOwnBranch: 'user.view_own_branch',
  mediaUploadImage: 'media.upload_image',
  mediaUploadVideo: 'media.upload_video',
});

/* ---------- helpers ---------- */
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const api = async (url, opt = {}) => {
  const r = await fetch(url, { credentials: 'same-origin', ...opt });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const send = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const AUDIO_RECORDING_ID_KEY = 'audioRecordingId';
const AUDIO_RECORDING_TOKEN_KEY = 'audioRecordingToken';
const AUDIO_RECORDING_FINISH_KEY = 'audioRecordingFinishPending';
const AUDIO_RECORDING_NEXT_INDEX_KEY = 'audioRecordingNextIndex';
const AUDIO_SAMPLE_RATE = 16000;
const MICROPHONE_OFF_MESSAGE = 'Microphone is off. Turn it on to continue.';

function openAudioQueue() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('magnus-audio-queue', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('chunks', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open offline audio storage.'));
  });
}

async function queueAudioChunk(sessionId, index, audio, sampleRate) {
  const database = await openAudioQueue();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('chunks', 'readwrite');
      transaction.objectStore('chunks').put({
        key: `${sessionId}:${index}`, sessionId, index, audio, sampleRate,
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Could not save an audio chunk offline.'));
      transaction.onabort = () => reject(transaction.error || new Error('Could not save an audio chunk offline.'));
    });
  } finally { database.close(); }
}

async function queuedAudioChunks(sessionId) {
  const database = await openAudioQueue();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('chunks', 'readonly');
      const request = transaction.objectStore('chunks').getAll();
      request.onsuccess = () => resolve(request.result.filter((chunk) => chunk.sessionId === sessionId)
        .sort((a, b) => a.index - b.index));
      request.onerror = () => reject(request.error || new Error('Could not read queued audio chunks.'));
    });
  } finally { database.close(); }
}

async function removeQueuedAudioChunk(key) {
  const database = await openAudioQueue();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('chunks', 'readwrite');
      transaction.objectStore('chunks').delete(key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Could not clear an uploaded audio chunk.'));
      transaction.onabort = () => reject(transaction.error || new Error('Could not clear an uploaded audio chunk.'));
    });
  } finally { database.close(); }
}

const card = (t, d, m, x = {}) => ({ t, d, m, ...x });

let clickAudioContext;
function playClickSound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  if (!clickAudioContext) clickAudioContext = new AudioContextClass();
  const context = clickAudioContext;
  const play = () => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(900, now);
    oscillator.frequency.exponentialRampToValueAtTime(560, now + 0.05);
    gain.gain.setValueAtTime(0.018, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.05);
  };
  if (context.state === 'suspended') {
    context.resume().then(play).catch((error) => console.error('Could not play click sound.', error));
  } else play();
}

function playCompletionSound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  if (!clickAudioContext) clickAudioContext = new AudioContextClass();
  const context = clickAudioContext;
  const play = () => {
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      const start = context.currentTime + 0.08 + index * 0.12;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.02, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.24);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.24);
    });
  };
  if (context.state === 'suspended') {
    context.resume().then(play).catch((error) => console.error('Could not play completion sound.', error));
  } else play();
}

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
      card('Mobile & laptop · A to Z', '', 'photo', { chips: [
        { label: 'Hardware', icon: 'fa-desktop' },
        { label: 'Software', icon: 'fa-code' },
        { label: 'Sales', icon: 'fa-cart-shopping' },
        { label: 'Service', icon: 'fa-screwdriver-wrench' },
        { label: 'Chip level', icon: 'fa-microchip' },
      ] }),
      card('Basic electronics + brands', '', 'photo', { brands: [
        { name: 'Nokia', logo: 'https://cdn.simpleicons.org/nokia/FFFFFF' },
        { name: 'Redmi', logo: 'https://upload.wikimedia.org/wikipedia/commons/f/f9/REDMI_logo.svg' },
        { name: 'Realme', logo: 'https://upload.wikimedia.org/wikipedia/commons/f/f5/Realme-realme-_logo_box-RGB-01_with_out_back_ground.svg' },
        { name: 'Oppo', logo: 'https://cdn.simpleicons.org/oppo/FFFFFF' },
        { name: 'Vivo', logo: 'https://cdn.simpleicons.org/vivo/FFFFFF' },
        { name: 'Samsung', logo: 'https://cdn.simpleicons.org/samsung/FFFFFF' },
        { name: 'iPhone', logo: 'https://cdn.simpleicons.org/apple/FFFFFF' },
      ] })] },
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
      card('Age 18', 'Job', null, { icon: 'fa-briefcase' }),
      card('Age 20', '₹20,000 / ₹40,000 · Car', null, { icon: 'fa-car' }),
      card('Age 23', 'Marriage', null, { icon: 'fa-ring' })] },

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
    title: k.t, desc: k.d, kind: k.m, slot: `${s.key}-${i}`, chips: k.chips, brands: k.brands }));
  return out;
});

function HeroSlide({ s, mp, phase, n }) {
  return (
    <div className="hero">
      <div className="hero-copy">
        <span className="hero-eyebrow"><i className={`fa-solid ${phase.icon}`}></i>{phase.name} · {String(n).padStart(2, '0')}</span>
        <h2>{s.title}</h2>
        {s.desc && <p>{s.desc}</p>}
        {s.brands && <div className="chips hero-brand-logos" aria-label="Brands">
          {s.brands.map((brand) => (
            <span className="chip hero-brand-logo" key={brand.name}>
              <img src={brand.logo} alt={brand.name} loading="lazy" onError={(event) => {
                console.error(`Brand logo failed to load for ${brand.name}.`);
                event.currentTarget.hidden = true;
              }} />
            </span>
          ))}
        </div>}
        {s.chips && !s.brands && <div className="chips">{s.chips.map((c) => (
          <span className="chip hero-topic-chip" key={c.label}>
            <i className={`fa-solid ${c.icon}`} aria-hidden="true"></i>{c.label}
          </span>
        ))}</div>}
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
function MediaSlot({ slot, kind, media, authUser, reload, label, unlock, viewMedia }) {
  const input = useRef();
  const m = media[slot];
  const uploadPermission = kind === 'video' ? PERMISSION.mediaUploadVideo : PERMISSION.mediaUploadImage;
  const canUpload = !!authUser?.permissions?.includes(uploadPermission);
  const upload = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    fd.append('kind', kind);
    try { await api(`/api/media/${slot}`, { method: 'POST', body: fd }); reload(); }
    catch (err) { alert(err.message); }
  };
  const remove = async () => {
    try { await api(`/api/media/${slot}`, { method: 'DELETE' }); reload(); }
    catch (err) { alert(err.message); }
  };
  const openViewer = () => viewMedia({ ...m, label: label || slot });
  return (
    <div className={`media ${m ? 'filled' : ''}`}>
      {m ? <button type="button" className="media-open-trigger" onClick={openViewer}
          aria-label={`Open ${label || slot} ${m.type === 'video' ? 'video' : 'photo'}`}>
          {m.type === 'video'
            ? <video src={m.url} playsInline preload="metadata" aria-hidden="true" tabIndex="-1" />
            : <img src={m.url} alt="" />}
        </button>
        : <div className="media-empty">
            <i className={`fa-solid ${kind === 'video' ? 'fa-circle-play' : 'fa-camera'}`}></i>
            <span>{kind === 'video' ? 'Video' : 'Photo'} coming soon</span>
          </div>}
      {canUpload && <>
        <button type="button" className="media-up" onClick={() => input.current.click()}>
          <i className="fa-solid fa-upload"></i> {m ? 'Replace' : 'Upload'} {kind} · {slot}
        </button>
        {m && <button type="button" className="media-remove" onClick={remove} title="Remove uploaded media"
          aria-label={`Remove media from ${slot}`}><i className="fa-solid fa-xmark" aria-hidden="true"></i></button>}
        <input ref={input} type="file" hidden accept={kind === 'video' ? 'video/mp4,video/webm,video/quicktime' : 'image/jpeg,image/png,image/webp,image/gif'} onChange={upload} />
      </>}
      {!authUser && <button type="button" className="media-up" onClick={unlock}>
        <i className="fa-solid fa-lock"></i> Sign in to upload {kind}
      </button>}
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
          <article className={`fcard ${s.rows ? 'row' : ''} ${k.icon ? 'career-growth-card' : ''}`} key={i}>
            {k.n && <span className="num">{k.n}</span>}
            {k.icon && <span className="career-growth-icon" aria-hidden="true"><i className={`fa-solid ${k.icon}`}></i></span>}
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

function RegisterSlide({
  lead, setLead, onNew, onStart, recording, retentionDays, onStartSession, onResumeSession, onContinueSession,
}) {
  const [f, setF] = useState({ name: '', phone: '', parent_name: '', place: '', qualification: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    if (recording.status !== 'recording') { setErr('Microphone is off. Turn it on to continue.'); setBusy(false); return; }
    try {
      const body = { ...f, recording_id: recording.id, recording_token: recording.token };
      const l = await api('/api/leads', send('POST', body));
      localStorage.setItem('leadId', l.id);
      setLead(l);
      onStart();
    }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  if (lead.id) return (
    <div className="fcard welcome">
      <h2>Welcome back, {lead.name}</h2>
      <p>Your counselling is saved. Resume the recording to continue where you stopped.</p>
      {!recording.id && recording.status !== 'recording' && <>
        <p>Your session will be audio-recorded and stored securely for up to {retentionDays} days. Only authorized counsellors can access it.</p>
        <label className="accept recording-consent">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          <span>I consent to audio recording and storage of this counselling session.</span>
        </label>
      </>}
      {recording.status === 'error' && <p className="error" role="alert">{recording.error}</p>}
      <div className="actions">
        <button className="btn-next" disabled={recording.status === 'starting' || (!recording.id && recording.status !== 'recording' && !consent)}
          onClick={recording.id ? onContinueSession : () => onStartSession(lead.id, consent)}>
          <span>{recording.status === 'recording' ? 'Continue' : recording.status === 'starting' ? 'Starting…' : recording.id ? 'Resume session' : 'Start session'}</span>
          <i className="fa-solid fa-arrow-right"></i>
        </button>
        {!recording.id && recording.status !== 'recording' && <button className="btn-prev" onClick={onNew}>New visitor</button>}
      </div>
    </div>
  );
  if (recording.status !== 'recording') return (
    <div className="fcard welcome">
      <h2>{recording.id ? 'Resume your session' : 'Start a session'}</h2>
      <p>Your counselling session will be audio-recorded and stored securely for up to {retentionDays} days. Only authorized counsellors can access it.</p>
      {recording.id
        ? <p className="muted">Your consent was saved. Resume recording to continue.</p>
        : <label className="accept recording-consent">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          <span>I consent to audio recording and storage of this counselling session.</span>
        </label>}
      {recording.error && <p className="error" role="alert">{recording.error}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      <button type="button" className="btn-next" disabled={recording.status === 'starting' || (!recording.id && !consent)}
        onClick={recording.id ? onResumeSession : () => onStartSession(null, consent)}>
        <span>{recording.status === 'starting' ? 'Starting…' : recording.id ? 'Resume session' : 'Start session'}</span>
        <i className="fa-solid fa-arrow-right"></i>
      </button>
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
        <button className="btn-next" disabled={busy || recording.status !== 'recording'}>
          <span>{busy ? 'Saving…' : 'Start the tour'}</span><i className="fa-solid fa-arrow-right"></i>
        </button>
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
  const rows = [
    { icon: 'fa-calendar-clock', label: 'Duration',
      mobile: <><strong>{a.months} months</strong><small>{a.training} + {a.ojt}</small></>,
      laptop: <><strong>{b.months} months</strong><small>{b.training} + {b.ojt}</small></> },
    { icon: 'fa-indian-rupee-sign', label: 'Fees',
      mobile: <strong>{inr(a.student_fee)}</strong>, laptop: <strong>{inr(b.student_fee)}</strong> },
    { icon: 'fa-credit-card', label: 'EMI',
      mobile: <><strong>{inr(a.emi_first)} first</strong><small>then {inr(a.emi_each)} × {a.emi_count}</small></>,
      laptop: <><strong>{inr(b.emi_first)} first</strong><small>then {inr(b.emi_each)} × {b.emi_count}</small></> },
    { icon: 'fa-microchip', label: 'Technology',
      mobile: <><strong>One technology</strong></>,
      laptop: <><strong>Two technologies</strong><small>Mobile + Laptop</small></> },
    { icon: 'fa-briefcase', label: 'OJT will get',
      mobile: <span>Only mobile service / sales centre</span>,
      laptop: <span>Only mobile service / sales centre</span> },
    { icon: 'fa-user-check', label: 'If going to an interview',
      mobile: <span className="compare-badge low"><i className="fa-solid fa-arrow-down" aria-hidden="true"></i>Low possibility</span>,
      laptop: <><span className="compare-badge high"><i className="fa-solid fa-arrow-up" aria-hidden="true"></i>High possibility</span><small>Knows mobile and laptop service</small></> },
    { icon: 'fa-plane', label: 'Abroad recruitment',
      mobile: <span className="compare-badge low"><i className="fa-solid fa-arrow-down" aria-hidden="true"></i>Low possibility</span>,
      laptop: <><span className="compare-badge high"><i className="fa-solid fa-arrow-up" aria-hidden="true"></i>High possibility</span><small>Knows mobile and laptop service</small></> },
    { icon: 'fa-laptop', label: 'Laptop study again',
      mobile: <span className="compare-badge low"><i className="fa-solid fa-indian-rupee-sign" aria-hidden="true"></i>Min. fee ₹80K + 4 months</span>,
      laptop: <span className="compare-badge high"><i className="fa-solid fa-check" aria-hidden="true"></i>Already knows</span> },
  ];
  const diff = b.student_fee - a.student_fee, months = b.months - a.months;
  return (
    <>
      <div className="compare-table" role="table" aria-label="Mobile and Mobile plus Laptop course comparison">
        <div className="compare-row compare-header" role="row">
          <div className="compare-feature" role="columnheader"><span className="compare-title">Feature</span></div>
          <div role="columnheader">
            <span className="compare-title"><span className="compare-course-icon"><i className="fa-solid fa-mobile-screen-button" aria-hidden="true"></i></span>Mobile</span>
          </div>
          <div className="compare-laptop-column" role="columnheader">
            <span className="compare-title">
              <span className="compare-course-icon"><i className="fa-solid fa-mobile-screen-button" aria-hidden="true"></i><i className="fa-solid fa-laptop" aria-hidden="true"></i></span>
              <span>Mobile + Laptop</span>
            </span>
            <span className="compare-recommended">Recommended</span>
          </div>
        </div>
        {rows.map((row) => (
          <div className="compare-row" role="row" key={row.label}>
            <div className="compare-feature" role="rowheader">
              <i className={`fa-solid ${row.icon}`} aria-hidden="true"></i><strong>{row.label}</strong>
            </div>
            <div role="cell">{row.mobile}</div>
            <div className="compare-laptop-column" role="cell">{row.laptop}</div>
          </div>
        ))}
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

function StudentPhotoSlide({ lead, patch }) {
  const fileRef = useRef(), cameraVideoRef = useRef();
  const [msg, setMsg] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [cameraError, setCameraError] = useState('');
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  useEffect(() => {
    if (!cameraOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setCameraOpen(false);
        setCameraStream(null);
        setCameraError('');
        setCameraReady(false);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [cameraOpen]);
  useEffect(() => {
    if (!cameraOpen || !cameraStream || !cameraVideoRef.current) return undefined;
    const video = cameraVideoRef.current;
    video.srcObject = cameraStream;
    video.play().catch((error) => {
      console.error('Could not start the student camera preview.', error);
      setCameraError('Camera preview could not start. Close the camera and use Upload photo.');
    });
    return () => {
      cameraStream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, [cameraOpen, cameraStream]);
  const closeCamera = () => {
    setCameraOpen(false);
    setCameraStream(null);
    setCameraError('');
    setCameraReady(false);
  };
  const openCamera = async () => {
    setMsg('');
    setCameraError('');
    setCameraReady(false);
    setCameraOpen(true);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Camera access is unavailable in this browser. Close the camera and use Upload photo.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'user' },
          aspectRatio: { ideal: 4 / 3 },
          width: { ideal: 4000 },
          height: { ideal: 3000 },
        },
      });
      setCameraStream(stream);
    } catch (error) {
      console.error('Could not open the student camera.', error);
      setCameraError(error.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow access or close the camera and use Upload photo.'
        : `Could not open the camera: ${error.message || 'Camera access failed.'} Close it and use Upload photo.`);
    }
  };
  const capturePhoto = async () => {
    const video = cameraVideoRef.current;
    if (!cameraStream || !video) return;
    setCameraBusy(true);
    setCameraError('');
    let bitmap;
    try {
      let nativePhoto;
      const track = cameraStream.getVideoTracks()[0];
      if (window.ImageCapture && track) {
        try {
          const capture = new window.ImageCapture(track);
          const capabilities = await capture.getPhotoCapabilities();
          const settings = {};
          if (capabilities.imageWidth && capabilities.imageHeight
            && capabilities.imageWidth.max >= 4000 && capabilities.imageHeight.max >= 3000) {
            settings.imageWidth = 4000;
            settings.imageHeight = 3000;
          }
          if (Array.isArray(capabilities.fillLightMode) && capabilities.fillLightMode.includes('auto')) {
            settings.fillLightMode = 'auto';
          }
          nativePhoto = await capture.takePhoto(settings);
          if (typeof createImageBitmap === 'function') bitmap = await createImageBitmap(nativePhoto);
        } catch (error) {
          console.warn('Using the camera preview because high-resolution photo capture is unavailable.', error);
        }
      }

      const source = bitmap || video;
      const sourceWidth = bitmap ? bitmap.width : video.videoWidth;
      const sourceHeight = bitmap ? bitmap.height : video.videoHeight;
      if (!sourceWidth || !sourceHeight) throw new Error('The camera is not ready. Please try again.');
      const targetAspect = 4 / 3;
      let cropWidth = sourceWidth;
      let cropHeight = sourceHeight;
      let cropX = 0;
      let cropY = 0;
      if (sourceWidth / sourceHeight > targetAspect) {
        cropWidth = Math.round(sourceHeight * targetAspect);
        cropX = Math.round((sourceWidth - cropWidth) / 2);
      } else {
        cropHeight = Math.round(sourceWidth / targetAspect);
        cropY = Math.round((sourceHeight - cropHeight) / 2);
      }
      const canvas = document.createElement('canvas');
      canvas.width = cropWidth;
      canvas.height = cropHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not prepare the photo. Please try again.');
      context.drawImage(source, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      const jpeg = await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not create the JPEG photo.')),
          'image/jpeg', 0.95);
      });
      if (bitmap) bitmap.close();
      const photo = new File([jpeg], `student-photo-${Date.now()}.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now(),
      });
      const fd = new FormData();
      fd.append('file', photo);
      await api(`/api/leads/${lead.id}/photo`, { method: 'POST', body: fd });
      setMsg(`Photo saved (${canvas.width} x ${canvas.height} px, JPEG).`);
      patch({ photo: true });
      closeCamera();
    } catch (error) {
      if (bitmap) bitmap.close();
      console.error('Could not capture or save the student photo.', error);
      setCameraError(error.message || 'Could not capture the photo. Try again or close the camera and use Upload photo.');
    } finally {
      setCameraBusy(false);
    }
  };
  const upload = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    try {
      await api(`/api/leads/${lead.id}/photo`, { method: 'POST', body: fd });
      setMsg('Photo saved.');
      patch({ photo: true });
      closeCamera();
    } catch (x) {
      setMsg(x.message);
      if (cameraOpen) setCameraError(x.message);
    }
    e.target.value = '';
  };
  return (
    <>
      <article className="fcard">
        <h3>Student photo</h3>
        <button type="button" className="media drop" onClick={openCamera}>
          <div className="media-empty"><i className="fa-solid fa-camera"></i><span>{lead.photo ? 'Photo uploaded · tap to take or replace' : 'Tap to open camera or upload a photo'}</span></div>
        </button>
        <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp,image/gif" capture="user" onChange={upload} />
        {msg && <p className="muted" role="status">{msg}</p>}
      </article>
      {cameraOpen && (
        <div className="camera-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeCamera();
        }}>
          <section className="camera-dialog" role="dialog" aria-modal="true" aria-labelledby="camera-dialog-title">
            <header className="camera-dialog-header">
              <h2 id="camera-dialog-title">Student photo</h2>
              <button type="button" className="camera-dialog-close" onClick={closeCamera} autoFocus
                aria-label="Close camera"><i className="fa-solid fa-xmark" aria-hidden="true"></i></button>
            </header>
            <div className="camera-preview">
              {cameraStream
                ? <video ref={cameraVideoRef} autoPlay playsInline muted aria-label="Camera preview"
                    onLoadedMetadata={() => setCameraReady(true)} />
                : <p role={cameraError ? 'alert' : 'status'}>{cameraError || 'Waiting for camera permission…'}</p>}
              {cameraStream && (
                <button type="button" className="camera-capture-button" onClick={capturePhoto}
                  aria-label={cameraBusy ? 'Saving photo' : 'Capture photo'} title="Capture photo"
                  disabled={!cameraReady || cameraBusy}>
                  <i className={`fa-solid ${cameraBusy ? 'fa-spinner fa-spin' : 'fa-camera'}`} aria-hidden="true"></i>
                </button>
              )}
            </div>
            <p className="camera-settings">4:3 · 12 MP target (4000 x 3000) · JPEG 95% · auto orientation · auto flash when supported</p>
            {cameraError && cameraStream && <p className="camera-error" role="alert">{cameraError}</p>}
          </section>
        </div>
      )}
    </>
  );
}

function BookingSlide({ cfg, lead, patch }) {
  const b = cfg.booking, nb = cfg.next_batch;
  const left = lead.booking_amount ? Math.max(b.first_payment_total - lead.booking_amount, 0) : null;
  const when = `${new Date(nb.date + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}, ${nb.time}`;
  return (
    <div className="fgrid" style={{ '--cols': 2 }}>
      <article className="fcard">
        <h3>Next batch</h3>
        <div className="note"><b>{when}</b></div>
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

function SummarySlide({ cfg, lead, patch, onNew, recording }) {
  const c = cfg.courses[lead.course] || {};
  const missing = cfg.documents.filter((d) => !(lead.docs || {})[d.key]).map((d) => d.label);
  const payLabel = { cash: 'Cash', loan: 'Pure loan', mix: 'Loan + cash' }[lead.payment];
  const rows = [['Student', lead.name], ['Mobile', lead.phone], ['Parent', lead.parent_name], ['Place', lead.place],
    ['Course', c.name], ['Duration', c.months && `${c.months} months (${c.training} + ${c.ojt})`], ['Course fee', c.student_fee && inr(c.student_fee)],
    ['Payment', payLabel], ['Booking amount', lead.booking_amount && inr(lead.booking_amount)], ['Batch', lead.batch],
    ['Documents pending', missing.length ? missing.join(', ') : 'None']];
  return (
    <div className="fgrid summary-layout" style={{ '--cols': 2 }}>
      <StudentPhotoSlide lead={lead} patch={patch} />
      <div className="fcard summary">
        <div className="badge-icon" aria-hidden="true"><i className="fa-solid fa-check"></i></div>
        <h2>Booking recorded</h2>
        {recording.status === 'complete' && <p role="status">Audio recording saved securely.</p>}
        {recording.status === 'stopped_pending' && <p role="status">The audio recording is queued and will be saved when the connection returns.</p>}
        <dl>{rows.filter((r) => r[1]).map((r) => <div key={r[0]}><dt>{r[0]}</dt><dd>{r[1]}</dd></div>)}</dl>
        <div className="actions no-print">
          <button className="btn-next" onClick={() => window.print()}><i className="fa-solid fa-print"></i><span>Print summary</span></button>
          <button className="btn-prev" disabled={recording.status === 'stopped_pending'} onClick={onNew}>New visitor</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- app shell ---------- */
function App() {
  const [cfg, setCfg] = useState(null);
  const [theme, setTheme] = useState('light');
  const [media, setMedia] = useState({});
  const [lead, setLead] = useState({});
  const [i, setI] = useState(0);
  const [dir, setDir] = useState('fwd');
  const [toast, setToast] = useState('');
  const [authUser, setAuthUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginPasswordVisible, setLoginPasswordVisible] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [viewingMedia, setViewingMedia] = useState(null);
  const [recording, setRecording] = useState(() => {
    const id = localStorage.getItem(AUDIO_RECORDING_ID_KEY);
    const token = localStorage.getItem(AUDIO_RECORDING_TOKEN_KEY);
    if (!id || !token) return { id: '', token: '', status: 'idle', error: '', uploadWarning: '' };
    return {
      id, token, status: localStorage.getItem(AUDIO_RECORDING_FINISH_KEY) === id ? 'stopped_pending' : 'needs_resume',
      error: '', uploadWarning: '',
    };
  });
  const recordingRef = useRef(recording);
  const audioCaptureRef = useRef(null);
  const chunkIndexRef = useRef(0);
  const chunkChainRef = useRef(Promise.resolve());
  const uploadBusyRef = useRef(false);
  const finishBusyRef = useRef(false);
  const ref = useRef(lead); ref.current = lead;
  const s = STEPS[i];
  const signedIn = !!authUser;
  const hasPermission = (key) => !!authUser?.permissions?.includes(key);
  const isExplicitCounsellingFlow = new URLSearchParams(window.location.search).get('flow') === '1';

  const updateRecording = (update) => {
    const next = typeof update === 'function' ? update(recordingRef.current) : update;
    recordingRef.current = next;
    setRecording(next);
  };
  const recordingHeaders = (session) => ({ 'X-Recording-Token': session.token });
  const clearRecordingStorage = () => {
    localStorage.removeItem(AUDIO_RECORDING_ID_KEY);
    localStorage.removeItem(AUDIO_RECORDING_TOKEN_KEY);
    localStorage.removeItem(AUDIO_RECORDING_FINISH_KEY);
    localStorage.removeItem(AUDIO_RECORDING_NEXT_INDEX_KEY);
  };
  const uploadQueuedAudio = async (session) => {
    if (!navigator.onLine) {
      updateRecording((current) => ({
        ...current, uploadWarning: 'Recording is safely queued and will upload when the connection returns.',
      }));
      return false;
    }
    if (uploadBusyRef.current) return false;
    uploadBusyRef.current = true;
    try {
      const chunks = await queuedAudioChunks(session.id);
      for (const chunk of chunks) {
        const response = await fetch(`/api/recordings/${session.id}/chunks/${chunk.index}`, {
          method: 'PUT',
          headers: { ...recordingHeaders(session), 'X-Audio-Sample-Rate': String(chunk.sampleRate) },
          body: chunk.audio,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || response.statusText);
        await removeQueuedAudioChunk(chunk.key);
      }
      updateRecording((current) => ({ ...current, uploadWarning: '' }));
      return true;
    } catch (error) {
      updateRecording((current) => ({
        ...current,
        uploadWarning: navigator.onLine
          ? `Recording upload is delayed: ${error.message}`
          : 'Recording is safely queued and will upload when the connection returns.',
      }));
      return false;
    } finally {
      uploadBusyRef.current = false;
    }
  };
  const stopAudioCapture = async (flush = true) => {
    const capture = audioCaptureRef.current;
    if (!capture || capture.stopping) return;
    capture.stopping = true;
    if (flush && capture.context.state === 'suspended') {
      await capture.context.resume().catch((error) => console.error('Could not resume audio to flush the final chunk.', error));
    }
    if (flush && capture.context.state === 'running') {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 2000);
        capture.flushResolve = () => { clearTimeout(timeout); resolve(); };
        capture.processor.port.postMessage('flush');
      });
    }
    await chunkChainRef.current;
    capture.stream.getTracks().forEach((track) => {
      track.removeEventListener('ended', capture.trackEnded);
      track.stop();
    });
    capture.source.disconnect();
    capture.processor.disconnect();
    capture.mute.disconnect();
    if (capture.context.state !== 'closed') await capture.context.close();
    audioCaptureRef.current = null;
  };
  const saveAudioChunk = (audio, session) => {
    const index = chunkIndexRef.current;
    chunkIndexRef.current += 1;
    localStorage.setItem(AUDIO_RECORDING_NEXT_INDEX_KEY, String(chunkIndexRef.current));
    chunkChainRef.current = chunkChainRef.current.then(async () => {
      await queueAudioChunk(session.id, index, audio, session.sampleRate);
      await uploadQueuedAudio(session);
    }).catch((error) => {
      updateRecording((current) => ({
        ...current, status: 'error', error: `Recording could not be saved: ${error.message}`,
      }));
      stopAudioCapture(false).catch((stopError) => console.error('Could not stop the audio capture.', stopError));
    });
  };
  const startAudioCapture = async (stream, session) => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !window.AudioWorkletNode) throw new Error('Audio recording is unavailable in this browser.');
    const context = new AudioContextClass({ sampleRate: session.sampleRate });
    try {
      if (context.sampleRate !== session.sampleRate) throw new Error('This device cannot start a supported audio recording.');
      await context.audioWorklet.addModule('/static/js/pcm-recorder-worklet.js');
      const source = context.createMediaStreamSource(stream);
      const processor = new AudioWorkletNode(context, 'magnus-pcm-recorder', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      });
      const mute = context.createGain();
      mute.gain.value = 0;
      const capture = { stream, context, source, processor, mute, stopping: false, flushResolve: null };
      capture.trackEnded = () => {
        if (capture.stopping) return;
        updateRecording((current) => ({ ...current, status: 'error', error: MICROPHONE_OFF_MESSAGE }));
        stopAudioCapture(false).catch((error) => console.error('Could not stop the disconnected microphone.', error));
      };
      processor.port.onmessage = (event) => {
        if (event.data.type === 'chunk') saveAudioChunk(event.data.audio, session);
        if (event.data.type === 'flushed' && capture.flushResolve) {
          const resolve = capture.flushResolve;
          capture.flushResolve = null;
          resolve();
        }
      };
      source.connect(processor);
      processor.connect(mute);
      mute.connect(context.destination);
      stream.getAudioTracks().forEach((track) => track.addEventListener('ended', capture.trackEnded));
      audioCaptureRef.current = capture;
      context.onstatechange = () => {
        if (context.state === 'suspended' && document.visibilityState === 'visible' && !capture.stopping) {
          context.resume().catch(() => capture.trackEnded());
        }
      };
      await context.resume();
      if (context.state !== 'running') throw new Error(MICROPHONE_OFF_MESSAGE);
    } catch (error) {
      if (context.state !== 'closed') await context.close();
      if (audioCaptureRef.current && audioCaptureRef.current.context === context) audioCaptureRef.current = null;
      throw error;
    }
  };
  const startRecordingSession = async (leadId, consented) => {
    if (!consented) {
      updateRecording((current) => ({ ...current, error: 'Consent is required before recording.' }));
      return false;
    }
    if (!authUser) {
      setLoginDialogOpen(true);
      setToast('Sign in before starting a visitor session.');
      return false;
    }
    if (!hasPermission(PERMISSION.visitorCreate)) {
      setToast('Your account cannot start visitor sessions.');
      return false;
    }
    updateRecording((current) => ({ ...current, status: 'starting', error: '', uploadWarning: '' }));
    let stream;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(MICROPHONE_OFF_MESSAGE);
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const created = await api('/api/recordings', send('POST', { consent: true }));
      const session = { id: created.id, token: created.token, sampleRate: created.sample_rate, status: 'starting', error: '', uploadWarning: '' };
      localStorage.setItem(AUDIO_RECORDING_ID_KEY, session.id);
      localStorage.setItem(AUDIO_RECORDING_TOKEN_KEY, session.token);
      chunkIndexRef.current = created.next_index;
      localStorage.setItem(AUDIO_RECORDING_NEXT_INDEX_KEY, String(created.next_index));
      updateRecording(session);
      if (leadId) {
        const options = send('POST', { lead_id: leadId });
        options.headers = { ...options.headers, ...recordingHeaders(session) };
        await api(`/api/recordings/${session.id}/link`, options);
      }
      await startAudioCapture(stream, session);
      updateRecording({ ...session, status: 'recording' });
      return true;
    } catch (error) {
      if (stream) stream.getTracks().forEach((track) => track.stop());
      const microphoneError = ['AbortError', 'NotAllowedError', 'NotFoundError', 'NotReadableError', 'SecurityError'].includes(error.name)
        || error.message === MICROPHONE_OFF_MESSAGE;
      updateRecording((current) => ({
        ...current, status: 'error', error: microphoneError ? MICROPHONE_OFF_MESSAGE : error.message,
      }));
      return false;
    }
  };
  const resumeRecordingSession = async (leadId) => {
    const current = recordingRef.current;
    if (!authUser) {
      setLoginDialogOpen(true);
      setToast('Sign in to resume this visitor session.');
      return false;
    }
    if (!hasPermission(PERMISSION.visitorResume)) {
      setToast('Your account cannot resume visitor sessions.');
      return false;
    }
    if (!current.id || !current.token) return startRecordingSession(leadId, true);
    updateRecording((session) => ({ ...session, status: 'starting', error: '', uploadWarning: '' }));
    let stream;
    try {
      const status = await api(`/api/recordings/${current.id}/status`, { headers: recordingHeaders(current) });
      if (status.status === 'complete') {
        clearRecordingStorage();
        updateRecording({ id: '', token: '', status: 'complete', error: '', uploadWarning: '' });
        return false;
      }
      if (leadId && !status.lead_linked) {
        const options = send('POST', { lead_id: leadId });
        options.headers = { ...options.headers, ...recordingHeaders(current) };
        await api(`/api/recordings/${current.id}/link`, options);
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(MICROPHONE_OFF_MESSAGE);
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const queued = await queuedAudioChunks(current.id);
      chunkIndexRef.current = Math.max(
        status.next_index,
        Number(localStorage.getItem(AUDIO_RECORDING_NEXT_INDEX_KEY)) || 0,
        ...queued.map((chunk) => chunk.index + 1),
      );
      localStorage.setItem(AUDIO_RECORDING_NEXT_INDEX_KEY, String(chunkIndexRef.current));
      const session = { ...current, sampleRate: status.sample_rate };
      await startAudioCapture(stream, session);
      updateRecording({ ...session, status: 'recording', error: '', uploadWarning: '' });
      await uploadQueuedAudio(session);
      return true;
    } catch (error) {
      if (stream) stream.getTracks().forEach((track) => track.stop());
      const microphoneError = ['AbortError', 'NotAllowedError', 'NotFoundError', 'NotReadableError', 'SecurityError'].includes(error.name)
        || error.message === MICROPHONE_OFF_MESSAGE;
      updateRecording((session) => ({
        ...session, status: 'error',
        error: microphoneError ? MICROPHONE_OFF_MESSAGE : `Could not resume recording: ${error.message}`,
      }));
      return false;
    }
  };
  const finishPendingRecording = async (session) => {
    if (!navigator.onLine || finishBusyRef.current) return false;
    finishBusyRef.current = true;
    try {
      if (!await uploadQueuedAudio(session)) return false;
      if ((await queuedAudioChunks(session.id)).length) return false;
      const options = send('POST', {
        expected_chunks: Math.max(chunkIndexRef.current, Number(localStorage.getItem(AUDIO_RECORDING_NEXT_INDEX_KEY)) || 0),
      });
      options.headers = { ...options.headers, ...recordingHeaders(session) };
      const response = await fetch(`/api/recordings/${session.id}/complete`, options);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || response.statusText);
      clearRecordingStorage();
      updateRecording({ id: '', token: '', status: 'complete', error: '', uploadWarning: '' });
      return true;
    } catch (error) {
      updateRecording((current) => ({ ...current, status: 'stopped_pending', uploadWarning: error.message }));
      return false;
    } finally {
      finishBusyRef.current = false;
    }
  };
  const finishRecording = async () => {
    const session = recordingRef.current;
    if (!session.id || !session.token || session.status !== 'recording') return;
    localStorage.setItem(AUDIO_RECORDING_FINISH_KEY, session.id);
    updateRecording((current) => ({ ...current, status: 'stopped_pending', uploadWarning: '' }));
    await stopAudioCapture(true);
    await chunkChainRef.current;
    await finishPendingRecording(session);
  };
  const continueSession = async () => {
    if (recordingRef.current.status !== 'recording') {
      const resumed = await resumeRecordingSession(lead.id);
      if (!resumed) return;
    }
    go(Math.max(1, i));
  };

  const toggleTheme = (event) => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    const bounds = event.currentTarget.getBoundingClientRect();
    const root = document.documentElement;
    root.style.setProperty('--theme-origin-x', `${bounds.left + bounds.width / 2}px`);
    root.style.setProperty('--theme-origin-y', `${bounds.top + bounds.height / 2}px`);
    if (document.startViewTransition) {
      document.startViewTransition(() => ReactDOM.flushSync(() => setTheme(nextTheme)));
    } else {
      setTheme(nextTheme);
    }
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#EEE4DF' : '#EEE4DF');
  }, [theme]);

  const reload = () => api('/api/media').then(setMedia).catch(() => {});
  useEffect(() => {
    api('/api/config').then(setCfg).catch((e) => setToast(e.message));
    let redirectingToDashboard = false;
    api('/api/auth/me').then((result) => {
      if (result.user.role === 'developer' && !isExplicitCounsellingFlow) {
        redirectingToDashboard = true;
        window.location.replace('/admin');
        return;
      }
      setAuthUser(result.user);
    }).catch((error) => {
      setLoginDialogOpen(true);
      if (error.message !== 'Sign in required' && error.message !== 'Account is inactive') {
        setToast(`Could not check your sign-in: ${error.message}`);
      }
    }).finally(() => {
      if (!redirectingToDashboard) setAuthReady(true);
    });
    reload();
  }, [isExplicitCounsellingFlow]);
  useEffect(() => {
    const id = localStorage.getItem('leadId');
    if (!authUser || !id) return undefined;
    let cancelled = false;
    api(`/api/leads/${id}`).then((visitor) => {
      if (cancelled) return;
      setLead(visitor);
      setI(Math.min(visitor.progress || 0, STEPS.length - 1));
    }).catch((error) => {
      if (cancelled) return;
      if (error.message === 'Visitor not found') localStorage.removeItem('leadId');
      else setToast(`Could not resume visitor: ${error.message}`);
    });
    return () => { cancelled = true; };
  }, [authUser]);
  useEffect(() => {
    const id = localStorage.getItem(AUDIO_RECORDING_ID_KEY);
    const token = localStorage.getItem(AUDIO_RECORDING_TOKEN_KEY);
    if (!id || !token) return undefined;
    let cancelled = false;
    const session = { id, token, sampleRate: AUDIO_SAMPLE_RATE };
    api(`/api/recordings/${id}/status`, { headers: recordingHeaders(session) }).then(async (status) => {
      if (cancelled) return;
      if (status.status === 'complete') {
        clearRecordingStorage();
        updateRecording({ id: '', token: '', status: 'complete', error: '', uploadWarning: '' });
        return;
      }
      session.sampleRate = status.sample_rate;
      chunkIndexRef.current = status.next_index;
      const finishPending = localStorage.getItem(AUDIO_RECORDING_FINISH_KEY) === id;
      updateRecording({
        ...session, status: finishPending ? 'stopped_pending' : 'needs_resume',
        error: '', uploadWarning: '',
      });
      if (finishPending) await finishPendingRecording(session);
    }).catch((error) => {
      if (cancelled) return;
      updateRecording((current) => ({
        ...current, status: 'error', error: `Could not resume recording: ${error.message}`,
      }));
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const retryUploads = () => {
      const session = recordingRef.current;
      if (!session.id || !session.token) return;
      if (localStorage.getItem(AUDIO_RECORDING_FINISH_KEY) === session.id) finishPendingRecording(session);
      else uploadQueuedAudio(session);
    };
    const resumeAfterVisibility = () => {
      const capture = audioCaptureRef.current;
      if (document.visibilityState === 'visible' && capture && capture.context.state === 'suspended') {
        capture.context.resume().catch(() => capture.trackEnded());
      }
    };
    window.addEventListener('online', retryUploads);
    document.addEventListener('visibilitychange', resumeAfterVisibility);
    return () => {
      window.removeEventListener('online', retryUploads);
      document.removeEventListener('visibilitychange', resumeAfterVisibility);
    };
  }, []);
  useEffect(() => {
    if (recording.status !== 'stopped_pending') return undefined;
    const retry = setInterval(() => {
      const session = recordingRef.current;
      if (session.id && session.token) finishPendingRecording(session);
    }, 5000);
    return () => clearInterval(retry);
  }, [recording.status]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => {
    const handleClick = (event) => {
      if (event.isTrusted && event.target instanceof Element
        && event.target.closest('button:not(:disabled), a[href], input[type="checkbox"]:not(:disabled), input[type="radio"]:not(:disabled), select:not(:disabled)')) {
        playClickSound();
      }
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

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
      if (lead.id && recordingRef.current.status !== 'recording') {
        setToast(MICROPHONE_OFF_MESSAGE);
        return;
      }
      const acknowledgments = ref.current.acknowledgments || {};
      for (let step = i; step < n; step += 1) {
        const current = STEPS[step];
        if (current.type !== 'register' && current.type !== 'summary' && current.key !== 'terms'
          && !acknowledgments[current.key]) {
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
    if (done) {
      playCompletionSound();
      finishRecording().catch((error) => {
        updateRecording((current) => ({
          ...current, status: 'stopped_pending', uploadWarning: `Recording finalization failed: ${error.message}`,
        }));
      });
    }
    if (done && window.confetti) window.confetti({ particleCount: 110, spread: 75, origin: { y: 0.6 } });
  };
  const newVisitor = () => {
    if (recordingRef.current.status === 'stopped_pending') {
      setToast('The recording is still being saved. Please wait before starting another visitor.');
      return;
    }
    if (recordingRef.current.status === 'recording' || recordingRef.current.status === 'starting') {
      setToast('Complete the current visitor session before starting another.');
      return;
    }
    localStorage.removeItem('leadId');
    clearRecordingStorage();
    updateRecording({ id: '', token: '', status: 'idle', error: '', uploadWarning: '' });
    setLead({});
    setI(0);
  };
  const openLoginDialog = () => {
    setLoginPassword('');
    setLoginError('');
    setLoginDialogOpen(true);
  };
  const closeLoginDialog = () => {
    setLoginDialogOpen(false);
    setLoginPassword('');
    setLoginPasswordVisible(false);
    setLoginError('');
  };
  const unlock = async () => {
    if (signedIn) {
      if (recordingRef.current.status === 'recording' || recordingRef.current.status === 'starting') {
        setToast('Complete the current visitor session before signing out.');
        return;
      }
      try {
        await api('/api/auth/logout', send('POST', {}));
        setAuthUser(null);
        setLoginDialogOpen(true);
      } catch (error) {
        setToast(`Could not sign out: ${error.message}`);
      }
      return;
    }
    openLoginDialog();
  };
  const submitLogin = async (event) => {
    event.preventDefault();
    if (!loginEmail.trim() || !loginPassword) { setLoginError('Enter your email and password.'); return; }
    setLoginBusy(true);
    try {
      const result = await api('/api/auth/login', send('POST', {
        email: loginEmail.trim(), password: loginPassword,
      }));
      if (result.user.role === 'developer' && !isExplicitCounsellingFlow) {
        window.location.replace('/admin');
        return;
      }
      setAuthUser(result.user);
      closeLoginDialog();
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoginBusy(false);
    }
  };
  useEffect(() => {
    const k = (e) => {
      if (viewingMedia) {
        if (e.key === 'Escape') setViewingMedia(null);
        return;
      }
      if (loginDialogOpen) {
        if (e.key === 'Escape') closeLoginDialog();
        return;
      }
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'ArrowRight') go(i + 1); if (e.key === 'ArrowLeft') go(i - 1);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  if (!authReady) return <div className="boot" role="status">Checking your sign-in…</div>;
  if (!authUser) {
    return (
      <div className="pin-dialog-backdrop">
        <section className="pin-dialog" role="main" aria-labelledby="pin-dialog-title">
          <h1 id="pin-dialog-title">Sign in to Magnus</h1>
          <p>Use your assigned username (email) and password to enter the portal.</p>
          <form className="pin-form" onSubmit={submitLogin}>
            <label htmlFor="counsellor-email">Username (email)</label>
            <input id="counsellor-email" type="email" autoComplete="username" autoFocus
              value={loginEmail} onChange={(event) => { setLoginEmail(event.target.value); setLoginError(''); }}
              aria-invalid={!!loginError} aria-describedby={loginError ? 'pin-dialog-error' : undefined} required />
            <label htmlFor="counsellor-password">Password</label>
            <div className="password-field">
              <input id="counsellor-password" type={loginPasswordVisible ? 'text' : 'password'} autoComplete="current-password"
                value={loginPassword} onChange={(event) => { setLoginPassword(event.target.value); setLoginError(''); }}
                aria-invalid={!!loginError} aria-describedby={loginError ? 'pin-dialog-error' : undefined} required />
              <button type="button" className="password-eye" onClick={() => setLoginPasswordVisible((visible) => !visible)}
                aria-label={loginPasswordVisible ? 'Hide password' : 'Show password'}
                title={loginPasswordVisible ? 'Hide password' : 'Show password'} aria-pressed={loginPasswordVisible}>
                <i className={`fa-solid ${loginPasswordVisible ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden="true"></i>
              </button>
            </div>
            {loginError && <p className="pin-dialog-error" id="pin-dialog-error" role="alert">{loginError}</p>}
            <div className="pin-dialog-actions">
              <button type="submit" className="btn-next" disabled={loginBusy || !loginEmail.trim() || !loginPassword}>
                {loginBusy ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>
        </section>
      </div>
    );
  }
  if (!cfg) return <div className="boot" role="status">{toast || 'Loading…'}</div>;
  const mp = { media, authUser, reload, unlock, viewMedia: setViewingMedia };
  const phase = PHASES.find((p) => p.id === s.phase);
  const acknowledged = s.key === 'terms' || !!(lead.acknowledgments || {})[s.key];
  const body = {
    register: <RegisterSlide lead={lead} setLead={setLead} onNew={newVisitor} onStart={() => go(1)}
      recording={recording} retentionDays={cfg.audio_retention_days}
      onStartSession={startRecordingSession} onResumeSession={() => resumeRecordingSession()}
      onContinueSession={continueSession} />,
    location: <LocationSlide cfg={cfg} />,
    courses: <CoursesSlide cfg={cfg} mp={mp} />, compare: <CompareSlide cfg={cfg} />,
    fees: <FeesSlide cfg={cfg} lead={lead} patch={patch} />, payment: <PaymentSlide cfg={cfg} lead={lead} patch={patch} />,
    terms: <TermsSlide cfg={cfg} lead={lead} patch={patch} mp={mp} />, loan: <LoanSlide cfg={cfg} mp={mp} />,
    docs: <DocsSlide cfg={cfg} lead={lead} patch={patch} />, booking: <BookingSlide cfg={cfg} lead={lead} patch={patch} />,
    summary: <SummarySlide cfg={cfg} lead={lead} patch={patch} onNew={newVisitor} recording={recording} />,
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
          <span className="brand-badge">ADMISSION COUNSELLING</span>
        </button>
        <div className="nav-stats">
          <div className="progress-track-wrapper">
            <span className="progress-label" aria-live="polite">{i + 1} of {STEPS.length}</span>
            <div className="progress-bar-outer" role="progressbar" aria-valuemin="1" aria-valuemax={STEPS.length} aria-valuenow={i + 1}>
              <div className="progress-bar-inner" style={{ width: `${((i + 1) / STEPS.length) * 100}%` }}></div>
            </div>
          </div>
          {recording.status === 'recording' && (
            <span className="recording-indicator" role="status"><span className="recording-dot"></span>Recording</span>
          )}
          {(hasPermission(PERMISSION.userViewAll) || hasPermission(PERMISSION.userViewOwnBranch)) && (
            <a className="header-management-link" href="/admin">Manage</a>
          )}
          <button className={`header-login ${signedIn ? 'on' : ''}`} onClick={unlock}
            title={signedIn ? `Signed in as ${authUser.name} · sign out` : 'Sign in with your user account'}
            aria-label={signedIn ? 'Sign out' : 'User sign-in'}>
            <i className={`fa-solid ${signedIn ? 'fa-right-from-bracket' : 'fa-user'}`} aria-hidden="true"></i>
            <span>{signedIn ? 'Sign out' : 'Sign in'}</span>
          </button>
          <button type="button" className="theme-toggle" onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            <i className={`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`} aria-hidden="true"></i>
          </button>
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

      {recording.status === 'error' && s.type !== 'register' && (
        <div className="recording-error" role="alert">
          <span>{recording.error || MICROPHONE_OFF_MESSAGE}</span>
          {recording.id && <button type="button" className="btn-prev" onClick={() => resumeRecordingSession()}>
            Turn microphone on
          </button>}
        </div>
      )}
      {recording.uploadWarning && <p className="recording-upload-warning" role="status">{recording.uploadWarning}</p>}

      <main>
        <div className="stage-container">
          <section className={`orientation-section anim-${dir} ${s.type === 'hero' ? 'is-hero' : ''}`} key={s.key} data-step={i}>
            {s.type !== 'hero' && <div className="slide-head"><h1>{s.title}</h1>{lead.name && s.type !== 'register' && <span className="who">{lead.name}</span>}</div>}
            {body}
            {s.type !== 'register' && s.type !== 'summary' && s.key !== 'terms' && (
              <label className="accept slide-acknowledgment">
                <input type="checkbox" checked={acknowledged} onChange={(e) => acknowledge(e.target.checked)} />
                <span>I have understood: {s.title}.</span>
              </label>
            )}
          </section>
        </div>
      </main>

      {viewingMedia && (
        <div className="media-viewer-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setViewingMedia(null);
        }} onKeyDown={(event) => {
          if (event.key === 'Escape') setViewingMedia(null);
        }}>
          <section className="media-viewer" role="dialog" aria-modal="true" aria-label={`Viewing ${viewingMedia.label}`}>
            <button type="button" className="media-viewer-close" onClick={() => setViewingMedia(null)} autoFocus
              aria-label="Close media viewer"><i className="fa-solid fa-xmark" aria-hidden="true"></i></button>
            {viewingMedia.type === 'video'
              ? <video src={viewingMedia.url} controls playsInline autoPlay />
              : <img src={viewingMedia.url} alt={viewingMedia.label} />}
          </section>
        </div>
      )}

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

      {loginDialogOpen && (
        <div className="pin-dialog-backdrop" onMouseDown={(event) => {
          if (authUser && event.target === event.currentTarget) closeLoginDialog();
        }} onKeyDown={(event) => {
          if (authUser && event.key === 'Escape') closeLoginDialog();
        }}>
          <section className="pin-dialog" role="dialog" aria-modal="true" aria-labelledby="pin-dialog-title">
            <h2 id="pin-dialog-title">User sign-in</h2>
            <p>Sign in with your assigned username (email) and password to continue.</p>
            <form className="pin-form" onSubmit={submitLogin}>
              <label htmlFor="counsellor-email">Username (email)</label>
              <input id="counsellor-email" type="email" autoComplete="username" autoFocus
                value={loginEmail} onChange={(event) => { setLoginEmail(event.target.value); setLoginError(''); }}
                aria-invalid={!!loginError} aria-describedby={loginError ? 'pin-dialog-error' : undefined} required />
              <label htmlFor="counsellor-password">Password</label>
              <div className="password-field">
                <input id="counsellor-password" type={loginPasswordVisible ? 'text' : 'password'} autoComplete="current-password"
                  value={loginPassword} onChange={(event) => { setLoginPassword(event.target.value); setLoginError(''); }}
                  aria-invalid={!!loginError} aria-describedby={loginError ? 'pin-dialog-error' : undefined} required />
                <button type="button" className="password-eye" onClick={() => setLoginPasswordVisible((visible) => !visible)}
                  aria-label={loginPasswordVisible ? 'Hide password' : 'Show password'}
                  title={loginPasswordVisible ? 'Hide password' : 'Show password'} aria-pressed={loginPasswordVisible}>
                  <i className={`fa-solid ${loginPasswordVisible ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden="true"></i>
                </button>
              </div>
              {loginError && <p className="pin-dialog-error" id="pin-dialog-error" role="alert">{loginError}</p>}
              <div className="pin-dialog-actions">
                {authUser && <button type="button" className="btn-prev" onClick={closeLoginDialog}>Cancel</button>}
                <button type="submit" className="btn-next" disabled={loginBusy || !loginEmail.trim() || !loginPassword}>
                  {loginBusy ? 'Signing in…' : 'Sign in'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);