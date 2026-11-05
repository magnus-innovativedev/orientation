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

const READY_STEP = PHOTO_ITEMS.length + 2;

const STEPS = [
  { id: 1, name: 'Welcome', icon: 'fa-sparkles' },
  ...PHOTO_ITEMS.map((item, index) => ({
    id: index + 2,
    name: item.title,
    icon: item.icon
  })),
  { id: READY_STEP, name: 'Ready', icon: 'fa-award' }
];

const TOTAL_STEPS = STEPS.length;

function OrientationApp() {
  const [currentStep, setCurrentStep] = useState(1);
  const [started, setStarted] = useState(false);

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
      block: 'nearest',
      inline: 'start'
    });
  };

  const restartOrientation = () => {
    setStarted(false);
    setCurrentStep(1);
    document.querySelector('.stage-container')?.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const startOrientation = () => {
    playBeep(500, 0.06);
    setStarted(true);
    setCurrentStep(2);
  };

  useEffect(() => {
    const stage = document.querySelector('.stage-container');
    const sections = stage?.querySelectorAll('.orientation-section') || [];
    const updateCurrentStep = () => {
      const viewportCenter = window.innerWidth * 0.5;
      let closestSection = null;
      let closestDistance = Infinity;

      sections.forEach((section) => {
        const bounds = section.getBoundingClientRect();
        const distance = viewportCenter < bounds.left
          ? bounds.left - viewportCenter
          : viewportCenter > bounds.right
            ? viewportCenter - bounds.right
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
    stage?.addEventListener('scroll', updateCurrentStep, { passive: true });
    window.addEventListener('scroll', updateCurrentStep, { passive: true });
    window.addEventListener('resize', updateCurrentStep);
    return () => {
      stage?.removeEventListener('scroll', updateCurrentStep);
      window.removeEventListener('scroll', updateCurrentStep);
      window.removeEventListener('resize', updateCurrentStep);
    };
  }, [started]);

  useEffect(() => {
    if (started) {
      document.getElementById('orientation-step-2')?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'start'
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
                    <span className="feature-icon"><i className="fa-solid fa-book-open"></i></span>
                    <span><strong>Know what to expect</strong><small>Follow a simple campus walkthrough</small></span>
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

          {started && (
          <>
          {/* ==============================================
               READY: Completion
               ============================================== */}
          <section id={`orientation-step-${READY_STEP}`} data-step={READY_STEP} className="step-slide orientation-section completion-section">
              <div className="hero-welcome-card success-celebration">
                <div className="success-copy">
                  <div className="badge-icon" aria-hidden="true">
                    <i className="fa-solid fa-check"></i>
                  </div>
                  <div className="hero-tag completion-tag">
                    <i className="fa-solid fa-circle-check"></i> ORIENTATION COMPLETE
                  </div>
                  <h2 className="success-title">You're ready for what's next.</h2>
                  <p className="success-description">
                    You've completed your introduction to Magnus. Keep this guide nearby as you prepare for your first day.
                  </p>
                  <div className="success-actions">
                    <button className="btn-next" onClick={restartOrientation}>
                      <i className="fa-solid fa-rotate-left"></i>
                      <span>Review orientation</span>
                    </button>
                    <button className="btn-next" onClick={launchCelebration}>
                      <span>Finish orientation</span>
                      <i className="fa-solid fa-arrow-right"></i>
                    </button>
                  </div>
                  <p className="success-footnote">
                    <i className="fa-regular fa-bookmark" aria-hidden="true"></i>
                    You can return to this guide whenever you need a refresher.
                  </p>
                </div>

              </div>
          </section>
          </>
          )}

        </div>
      </main>

      {started && currentStep !== READY_STEP && (
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
              onClick={() => goToStep(currentStep + 1)}
            >
              <span>Continue</span>
              <i className="fa-solid fa-arrow-right"></i>
            </button>
          </div>
        </footer>
      )}

    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<OrientationApp />);

