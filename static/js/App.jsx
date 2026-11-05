const { useState, useEffect, useCallback } = React;

const PHOTO_ITEMS = [
  { title: 'Reception', description: 'Reception area', icon: 'fa-building' },
  { title: 'SCM / HOD', description: 'SCM and HOD', icon: 'fa-user-tie' },
  { title: 'Classroom 1', description: 'Air conditioning, projector, sound system, and chairs', icon: 'fa-chalkboard-user' },
  { title: 'Classroom 2', description: 'Mobile phones, laptops, tools, machines, bang, spoken English, and Hindi', icon: 'fa-laptop' },
  { title: 'Classroom 3', description: 'Students in uniform (shirt, pants, and tag)', icon: 'fa-user-graduate' },
  { title: 'Classroom 4', description: 'Young faculty members', icon: 'fa-person-chalkboard' },
  { title: 'Lab', description: 'Latest machines and equipment', icon: 'fa-flask' }
];

const SCHEDULE_STEP = PHOTO_ITEMS.length + 2;
const CHECKLIST_STEP = SCHEDULE_STEP + 1;
const READY_STEP = CHECKLIST_STEP + 1;

const STEPS = [
  { id: 1, name: 'Welcome', icon: 'fa-sparkles' },
  ...PHOTO_ITEMS.map((item, index) => ({
    id: index + 2,
    name: item.title,
    icon: item.icon
  })),
  { id: SCHEDULE_STEP, name: 'Schedule', icon: 'fa-calendar-days' },
  { id: CHECKLIST_STEP, name: 'Checklist', icon: 'fa-list-check' },
  { id: READY_STEP, name: 'Ready', icon: 'fa-award' }
];

const TOTAL_STEPS = STEPS.length;

function OrientationApp() {
  const [currentStep, setCurrentStep] = useState(1);
  const [started, setStarted] = useState(false);
  const [checklist, setChecklist] = useState([
    {
      id: 1,
      title: 'Access Orientation Web Portal',
      desc: 'You are currently completing this orientation walkthrough!',
      checked: true
    },
    {
      id: 2,
      title: 'Submit Official Identification & Documents',
      desc: 'Upload emergency contact info and verify proof of enrollment / identification.',
      checked: false
    },
    {
      id: 3,
      title: 'Configure Campus Wi-Fi & Email Account',
      desc: 'Connect your laptop/phone to high-speed campus Wi-Fi using your institution credentials.',
      checked: false
    },
    {
      id: 4,
      title: 'Review Orientation Handbook & Safety Rules',
      desc: 'Read through student/employee codes, safety guidelines, and campus maps.',
      checked: false
    }
  ]);

  const playBeep = (freq = 520, duration = 0.08) => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
      // AudioContext might be muted or not allowed before interaction
    }
  };

  const launchCelebration = useCallback(() => {
    if (window.confetti) {
      window.confetti({
        particleCount: 110,
        spread: 75,
        origin: { y: 0.6 },
        colors: ['#26abe2', '#38bdf8', '#00d2ff', '#4ade80', '#fbbf24', '#ffffff']
      });
    }
  }, []);

  const goToStep = (step) => {
    playBeep(500, 0.06);
    setCurrentStep(step);
    document.getElementById(`orientation-step-${step}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  };

  const restartOrientation = () => {
    setStarted(false);
    setCurrentStep(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const startOrientation = () => {
    playBeep(500, 0.06);
    setStarted(true);
    setCurrentStep(2);
  };

  const toggleChecklist = (id) => {
    playBeep(640, 0.06);
    setChecklist(prev =>
      prev.map(item =>
        item.id === id ? { ...item, checked: !item.checked } : item
      )
    );
  };

  useEffect(() => {
    const sections = document.querySelectorAll('.orientation-section');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && entry.target.isConnected) {
          setCurrentStep(Number(entry.target.getAttribute('data-step')));
        }
      });
    }, { rootMargin: '-35% 0px -55% 0px' });

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (started) {
      document.getElementById('orientation-step-2')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  }, [started]);

  const progressPercent = (currentStep / TOTAL_STEPS) * 100;

  return (
    <div className="app-wrapper">
      {/* Ambient Dark Blue Background with layered glows */}
      <div className="ambient-background">
        <div className="subtle-grid"></div>
        <div className="ambient-glow-circle glow-1"></div>
        <div className="ambient-glow-circle glow-2"></div>
      </div>

      {/* Top Navigation Bar */}
      <header>
        <div className="brand-nav" onClick={() => goToStep(started ? 2 : 1)}>
          <img src="/static/images/loginpageimage.png" alt="Orientation Logo" className="brand-nav-logo" />
          <span className="brand-title">MAGNUS</span>
          <span className="brand-badge">2026</span>
        </div>

        <div className="nav-stats">
          <div className="progress-track-wrapper">
            <span className="progress-label">Step {currentStep} of {TOTAL_STEPS}</span>
            <div className="progress-bar-outer">
              <div
                className="progress-bar-inner"
                style={{ width: `${progressPercent}%` }}
              ></div>
            </div>
          </div>
        </div>
      </header>

      {/* Stepper Navigation Pills */}
      <nav className="step-pills" aria-label="Orientation Steps">
        {STEPS.filter((s) => started ? s.id !== 1 : s.id === 1).map((s) => {
          const isActive = s.id === currentStep;
          const isCompleted = s.id < currentStep;
          return (
            <div
              key={s.id}
              className={`step-pill ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
              onClick={() => goToStep(s.id)}
            >
              <span className="pill-num">
                {isCompleted ? <i className="fa-solid fa-check"></i> : s.id}
              </span>
              <span>{s.name}</span>
            </div>
          );
        })}
      </nav>

      {/* All orientation steps are available by scrolling */}
      <main>
        <div className="stage-container">

          {/* ==============================================
           STEP 1: Welcome
               ============================================== */}
          {!started && <section id="orientation-step-1" data-step="1" className="step-slide orientation-section">
              <div className="hero-welcome-card">
                {/* Logo with ambient glow on dark blue background */}
                <div className="logo-container">
                  <div className="logo-glow-halo"></div>
                  <img src="/static/images/loginpageimage.png" alt="Orientation Brand Logo" className="hero-logo-img" />
                </div>

                <div>
                  <h1 className="hero-title" style={{ fontSize: '3.2rem', fontWeight: 800, letterSpacing: '0.02em', marginBottom: '0px' }}>
                    WELCOME TO MAGNUS
                  </h1>
                </div>
                <button className="btn-next" onClick={startOrientation} style={{ marginTop: '28px' }}>
                  <span>Start</span>
                  <i className="fa-solid fa-arrow-down"></i>
                </button>
              </div>
          </section>}

          {/* One scrollable slide for each campus photo */}
          {started && PHOTO_ITEMS.map((item, index) => {
            const step = index + 2;
            return (
              <section
                id={`orientation-step-${step}`}
                data-step={step}
                className="step-slide orientation-section photo-step"
                key={item.title}
              >
                <div className="hero-welcome-card photo-slide-card">
                  <div className="photo-slide-heading">
                    <div className="hero-tag">
                      <i className={`fa-solid ${item.icon}`}></i> Orientation Stage {step}
                    </div>
                    <h2>{item.title}</h2>
                    <p>{item.description}</p>
                  </div>
                  <div className="photo-placeholder" role="img" aria-label={`${item.title} photo area`}>
                    <i className={`fa-solid ${item.icon}`} aria-hidden="true"></i>
                    <span>Photo area</span>
                  </div>
                </div>
              </section>
            );
          })}

          {/* ==============================================
               SCHEDULE: Timeline
               ============================================== */}
          {started && (
          <>
          <section id={`orientation-step-${SCHEDULE_STEP}`} data-step={SCHEDULE_STEP} className="step-slide orientation-section">
              <div className="hero-welcome-card" style={{ textAlign: 'left', padding: '40px 36px' }}>
                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                  <div className="hero-tag">
                    <i className="fa-solid fa-calendar-days"></i> Orientation Stage {SCHEDULE_STEP}
                  </div>
                  <h2 style={{ fontSize: '2.2rem', fontWeight: 800, color: '#fff' }}>Orientation Schedule</h2>
                  <p style={{ color: 'var(--text-secondary)', maxWidth: '580px', margin: '6px auto 0' }}>
                    Key milestones and sessions arranged to give you a seamless on-boarding experience.
                  </p>
                </div>

                <div className="timeline">
                  <div className="timeline-item">
                    <div className="timeline-bullet">
                      <i className="fa-solid fa-circle"></i>
                    </div>
                    <div className="timeline-content">
                      <div>
                        <h4 style={{ color: '#fff', fontSize: '1.05rem', fontWeight: 700 }}>Check-in & Welcome Kit</h4>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '2px' }}>Collect your official badge, ID card, lanyard, and welcome orientation packet.</p>
                      </div>
                      <span className="timeline-time">09:00 AM</span>
                    </div>
                  </div>

                  <div className="timeline-item">
                    <div className="timeline-bullet">
                      <i className="fa-solid fa-circle"></i>
                    </div>
                    <div className="timeline-content">
                      <div>
                        <h4 style={{ color: '#fff', fontSize: '1.05rem', fontWeight: 700 }}>Keynote & Leadership Address</h4>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '2px' }}>Main auditorium address, mission briefing, and introduction of departments.</p>
                      </div>
                      <span className="timeline-time">10:30 AM</span>
                    </div>
                  </div>

                  <div className="timeline-item">
                    <div className="timeline-bullet">
                      <i className="fa-solid fa-circle"></i>
                    </div>
                    <div className="timeline-content">
                      <div>
                        <h4 style={{ color: '#fff', fontSize: '1.05rem', fontWeight: 700 }}>Campus & Facility Tour</h4>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '2px' }}>Guided walk through labs, library, recreation center, and dining halls.</p>
                      </div>
                      <span className="timeline-time">01:30 PM</span>
                    </div>
                  </div>

                  <div className="timeline-item">
                    <div className="timeline-bullet">
                      <i className="fa-solid fa-circle"></i>
                    </div>
                    <div className="timeline-content">
                      <div>
                        <h4 style={{ color: '#fff', fontSize: '1.05rem', fontWeight: 700 }}>Peer Mixer & Networking</h4>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '2px' }}>Meet mentors, join student interest clubs, and enjoy refreshments.</p>
                      </div>
                      <span className="timeline-time">03:30 PM</span>
                    </div>
                  </div>
                </div>
              </div>
          </section>

          {/* ==============================================
               CHECKLIST: Interactive Essentials
               ============================================== */}
          <section id={`orientation-step-${CHECKLIST_STEP}`} data-step={CHECKLIST_STEP} className="step-slide orientation-section">
              <div className="hero-welcome-card" style={{ textAlign: 'left', padding: '40px 36px' }}>
                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                  <div className="hero-tag">
                    <i className="fa-solid fa-list-check"></i> Orientation Stage {CHECKLIST_STEP}
                  </div>
                  <h2 style={{ fontSize: '2.2rem', fontWeight: 800, color: '#fff' }}>Day 1 Readiness Checklist</h2>
                  <p style={{ color: 'var(--text-secondary)', maxWidth: '580px', margin: '6px auto 0' }}>
                    Click to tick off items as you complete them. All tasks are saved automatically.
                  </p>
                </div>

                <div className="checklist-container">
                  {checklist.map(item => (
                    <div
                      key={item.id}
                      className={`check-item ${item.checked ? 'checked' : ''}`}
                      onClick={() => toggleChecklist(item.id)}
                    >
                      <div className="check-box">
                        <i className="fa-solid fa-check"></i>
                      </div>
                      <div className="check-info">
                        <div className="check-title">{item.title}</div>
                        <div className="check-desc">{item.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
          </section>

          {/* ==============================================
               READY: Completion
               ============================================== */}
          <section id={`orientation-step-${READY_STEP}`} data-step={READY_STEP} className="step-slide orientation-section">
              <div className="hero-welcome-card success-celebration">
                <div className="badge-icon">
                  <i className="fa-solid fa-award"></i>
                </div>
                <div
                  className="hero-tag"
                  style={{
                    background: 'rgba(34, 197, 94, 0.15)',
                    borderColor: 'rgba(34, 197, 94, 0.3)',
                    color: '#4ade80'
                  }}
                >
                  <i className="fa-solid fa-circle-check"></i> Orientation Completed!
                </div>
                <h2 style={{ fontSize: '2.6rem', fontWeight: 800, color: '#fff', marginBottom: '12px' }}>
                  You're All Set!
                </h2>
                <p
                  style={{
                    color: 'var(--text-secondary)',
                    maxWidth: '600px',
                    margin: '0 auto 30px',
                    fontSize: '1.05rem',
                    lineHeight: 1.6
                  }}
                >
                  Congratulations on completing the orientation walkthrough. You have all the information and resources you need to embark on an incredible journey.
                </p>

                <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap' }}>
                  <button
                    className="btn-next"
                    onClick={restartOrientation}
                    style={{
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      boxShadow: 'none'
                    }}
                  >
                    <i className="fa-solid fa-rotate-left"></i>
                    <span>Review from Start</span>
                  </button>
                  <button className="btn-next" onClick={launchCelebration}>
                    <i className="fa-solid fa-champagne-glasses"></i>
                    <span>Celebrate & Finish</span>
                  </button>
                </div>
              </div>
          </section>
          </>
          )}

        </div>
      </main>

    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<OrientationApp />);

