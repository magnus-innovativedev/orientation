const { useState, useEffect, useCallback } = React;

const PHOTO_ITEMS = [
  { title: 'Reception', description: 'Your first stop for a warm welcome and help finding your way around.', icon: 'fa-building', detail: 'Start here when you arrive on campus.' },
  { title: 'Meet the leadership team', description: 'Get to know your SCM and Heads of Department, and learn who to ask for support.', icon: 'fa-user-tie', detail: 'Student and department support' },
  { title: 'Classroom 1', description: 'A comfortable learning space with air conditioning, a projector, sound system, and seating.', icon: 'fa-chalkboard-user', detail: 'Teaching and presentation space' },
  { title: 'Classroom 2', description: 'Explore the laptops, tools, machines, and language-learning resources available to students.', icon: 'fa-laptop', detail: 'Technology and practical learning' },
  { title: 'Classroom 3', description: 'Review the student uniform expectations, including your shirt, trousers, and ID tag.', icon: 'fa-user-graduate', detail: 'Student essentials and expectations' },
  { title: 'Classroom 4', description: 'Meet the faculty who will guide you through your learning journey.', icon: 'fa-person-chalkboard', detail: 'Faculty and learning support' },
  { title: 'The Lab', description: 'Discover the machines and equipment used for hands-on learning.', icon: 'fa-flask', detail: 'Equipment and practical experience' }
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
    const updateCurrentStep = () => {
      const viewportCenter = window.innerHeight * 0.45;
      let closestSection = null;
      let closestDistance = Infinity;

      sections.forEach((section) => {
        const bounds = section.getBoundingClientRect();
        const distance = viewportCenter < bounds.top
          ? bounds.top - viewportCenter
          : viewportCenter > bounds.bottom
            ? viewportCenter - bounds.bottom
            : 0;

        if (distance < closestDistance) {
          closestSection = section;
          closestDistance = distance;
        }
      });

      if (closestSection) {
        const nextStep = Number(closestSection.getAttribute('data-step'));
        setCurrentStep((previousStep) => previousStep === nextStep ? previousStep : nextStep);
      }
    };

    updateCurrentStep();
    window.addEventListener('scroll', updateCurrentStep, { passive: true });
    window.addEventListener('resize', updateCurrentStep);
    return () => {
      window.removeEventListener('scroll', updateCurrentStep);
      window.removeEventListener('resize', updateCurrentStep);
    };
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
  const activeStep = STEPS[currentStep - 1];

  return (
    <div className="app-wrapper">
      {/* Ambient Dark Blue Background with layered glows */}
      <div className="ambient-background">
        <div className="subtle-grid"></div>
        <div className="ambient-glow-circle glow-1"></div>
        <div className="ambient-glow-circle glow-2"></div>
      </div>

      {/* Top Navigation Bar */}
      <header className="site-header">
        <button className="brand-nav" onClick={() => goToStep(started ? 2 : 1)} aria-label="Magnus home">
          <img src="/static/images/loginpageimage.png" alt="Orientation Logo" className="brand-nav-logo" />
          <span className="brand-title">MAGNUS</span>
          <span className="brand-badge">STUDENT ORIENTATION</span>
        </button>

        <div className="nav-stats">
          <div className="progress-track-wrapper">
            <span className="progress-label" aria-live="polite">Step {currentStep} of {TOTAL_STEPS}</span>
            <div
              className="progress-bar-outer"
              role="progressbar"
              aria-label="Orientation progress"
              aria-valuemin="1"
              aria-valuemax={TOTAL_STEPS}
              aria-valuenow={currentStep}
            >
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
            <button
              type="button"
              key={s.id}
              className={`step-pill ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
              onClick={() => goToStep(s.id)}
              aria-current={isActive ? 'step' : undefined}
            >
              <span className="pill-num">
                {isCompleted ? <i className="fa-solid fa-check"></i> : s.id}
              </span>
              <span>{s.name}</span>
            </button>
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
                <div className="hero-copy">
                  <div className="hero-tag">
                    <i className="fa-solid fa-sparkles"></i> YOUR MAGNUS JOURNEY STARTS HERE
                  </div>
                  <h1 className="hero-title">A great start begins with <span>feeling at home.</span></h1>
                  <p className="hero-description">
                    Get to know your campus, meet the people who will support you, and feel ready for your first day at Magnus.
                  </p>
                  <button className="btn-next" onClick={startOrientation}>
                    <span>Begin your orientation</span>
                    <i className="fa-solid fa-arrow-right"></i>
                  </button>
                  <div className="hero-notes">
                    <span><i className="fa-regular fa-clock"></i> A quick guided tour</span>
                    <span><i className="fa-solid fa-location-dot"></i> Explore your campus</span>
                  </div>
                </div>
                <div className="hero-art" aria-label="Magnus Institute of Technology">
                  <div className="hero-art-glow"></div>
                  <img src="/static/images/loginpageimage.png" alt="Magnus Institute of Technology logo" className="hero-logo-img" />
                  <div className="hero-art-caption">
                    <span>WELCOME TO MAGNUS</span>
                    <strong>Your next chapter starts here.</strong>
                  </div>
                  <div className="hero-art-mark" aria-hidden="true"><i className="fa-solid fa-arrow-down"></i></div>
                </div>
                <div className="hero-feature-strip">
                  <div className="hero-feature">
                    <span className="feature-icon"><i className="fa-solid fa-compass"></i></span>
                    <span><strong>Find your way</strong><small>Explore key campus spaces</small></span>
                  </div>
                  <div className="hero-feature">
                    <span className="feature-icon"><i className="fa-solid fa-people-group"></i></span>
                    <span><strong>Meet your people</strong><small>Learn where to find support</small></span>
                  </div>
                  <div className="hero-feature">
                    <span className="feature-icon"><i className="fa-solid fa-list-check"></i></span>
                    <span><strong>Feel prepared</strong><small>Keep track of day-one essentials</small></span>
                  </div>
                </div>
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
                <div className="hero-welcome-card photo-slide-card location-card">
                  <div className="location-copy">
                    <div className="hero-tag">
                      <i className={`fa-solid ${item.icon}`}></i> CAMPUS TOUR · {String(step - 1).padStart(2, '0')}
                    </div>
                    <h2>{item.title}</h2>
                    <p>{item.description}</p>
                  </div>
                  <div className="location-visual">
                    <span className="location-visual-label">GET TO KNOW THIS SPACE</span>
                    <div className="location-icon"><i className={`fa-solid ${item.icon}`} aria-hidden="true"></i></div>
                    <strong>{item.detail}</strong>
                    <span className="location-step">MAGNUS · ORIENTATION</span>
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
              <div className="hero-welcome-card content-card">
                <div className="section-heading">
                  <div className="hero-tag">
                    <i className="fa-solid fa-calendar-days"></i> YOUR DAY AT A GLANCE
                  </div>
                  <h2>Orientation Schedule</h2>
                  <p>
                    A sample guide to the day. Your team will share the confirmed timings and details.
                  </p>
                </div>

                <div className="timeline">
                  <div className="timeline-item">
                    <div className="timeline-bullet">
                      <i className="fa-solid fa-circle"></i>
                    </div>
                    <div className="timeline-content">
                      <div>
                        <h4>Check-in & Welcome Kit</h4>
                        <p>Get settled and collect the information you need to start the day.</p>
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
                        <h4>Welcome & introductions</h4>
                        <p>Hear from the team and get an introduction to the institute.</p>
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
                        <h4>Campus & facilities tour</h4>
                        <p>Visit key learning spaces and get familiar with the campus.</p>
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
                        <h4>Questions & next steps</h4>
                        <p>Connect with the people around you and find out what comes next.</p>
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
              <div className="hero-welcome-card content-card">
                <div className="section-heading">
                  <div className="hero-tag">
                    <i className="fa-solid fa-list-check"></i> YOUR FIRST-DAY CHECKLIST
                  </div>
                  <h2>Day 1 essentials</h2>
                  <p>
                    Tap an item to keep track of what you have taken care of.
                  </p>
                </div>

                <div className="checklist-container">
                  {checklist.map(item => (
                    <button
                      type="button"
                      key={item.id}
                      className={`check-item ${item.checked ? 'checked' : ''}`}
                      onClick={() => toggleChecklist(item.id)}
                      aria-pressed={item.checked}
                    >
                      <div className="check-box">
                        <i className="fa-solid fa-check"></i>
                      </div>
                      <div className="check-info">
                        <div className="check-title">{item.title}</div>
                        <div className="check-desc">{item.desc}</div>
                      </div>
                    </button>
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
                <h2 className="success-title">
                  You're All Set!
                </h2>
                <p className="success-description">
                  Congratulations on completing the orientation walkthrough. You have all the information and resources you need to embark on an incredible journey.
                </p>

                <div className="success-actions">
                  <button
                    className="btn-next"
                    onClick={restartOrientation}
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

      {started && (
        <footer className="action-footer">
          <div className="footer-step">
            <span className="footer-step-icon"><i className={`fa-solid ${activeStep.icon}`}></i></span>
            <span><small>YOUR PROGRESS</small><strong>{activeStep.name}</strong></span>
          </div>
          <div className="button-group">
            <button
              type="button"
              className="btn-prev"
              onClick={() => goToStep(currentStep - 1)}
              disabled={currentStep <= 2}
            >
              <i className="fa-solid fa-arrow-left"></i><span>Back</span>
            </button>
            <button
              type="button"
              className="btn-next"
              onClick={() => currentStep === READY_STEP ? launchCelebration() : goToStep(currentStep + 1)}
            >
              <span>{currentStep === READY_STEP ? 'Celebrate' : 'Continue'}</span>
              <i className={`fa-solid ${currentStep === READY_STEP ? 'fa-champagne-glasses' : 'fa-arrow-right'}`}></i>
            </button>
          </div>
        </footer>
      )}

    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<OrientationApp />);

