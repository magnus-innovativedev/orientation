let currentStep = 1;
const totalSteps = 5;

// Pleasant audio feedback using Web Audio API
function playBeep(freq = 480, duration = 0.08) {
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
    // AudioContext might be muted or not allowed before user interaction
  }
}

function updateView() {
  // Update slide display
  for (let i = 1; i <= totalSteps; i++) {
    const slide = document.getElementById(`slide-${i}`);
    if (slide) {
      slide.classList.toggle('active', i === currentStep);
    }
  }

  // Update pills
  document.querySelectorAll('.step-pill').forEach(pill => {
    const step = parseInt(pill.getAttribute('data-step'));
    pill.classList.remove('active', 'completed');
    if (step === currentStep) {
      pill.classList.add('active');
    } else if (step < currentStep) {
      pill.classList.add('completed');
    }
  });

  // Update progress bar
  const progressPercent = (currentStep / totalSteps) * 100;
  const progressIndicator = document.getElementById('progress-indicator');
  const stepCounterText = document.getElementById('step-counter-text');
  
  if (progressIndicator) {
    progressIndicator.style.width = `${progressPercent}%`;
  }
  if (stepCounterText) {
    stepCounterText.textContent = `Step ${currentStep} of ${totalSteps}`;
  }

  // Update Previous button state
  const btnPrev = document.getElementById('btn-prev');
  if (btnPrev) {
    btnPrev.disabled = (currentStep === 1);
  }

  // Update Next button label & styling
  const nextLabel = document.getElementById('next-label');
  const nextIcon = document.getElementById('next-icon');
  const btnNext = document.getElementById('btn-next');

  if (btnNext && nextLabel && nextIcon) {
    if (currentStep === totalSteps) {
      nextLabel.textContent = 'Finish';
      nextIcon.className = 'fa-solid fa-check';
      btnNext.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
      btnNext.style.boxShadow = '0 8px 25px rgba(16, 185, 129, 0.4)';
      launchCelebration();
    } else {
      nextLabel.textContent = 'NEXT';
      nextIcon.className = 'fa-solid fa-arrow-right';
      btnNext.style.background = 'var(--btn-gradient)';
      btnNext.style.boxShadow = '0 8px 24px rgba(0, 210, 255, 0.35), 0 0 15px rgba(58, 134, 255, 0.4)';
    }
  }
}

function nextStep() {
  playBeep(560, 0.08);
  if (currentStep < totalSteps) {
    currentStep++;
    updateView();
  } else {
    launchCelebration();
  }
}

function prevStep() {
  playBeep(420, 0.08);
  if (currentStep > 1) {
    currentStep--;
    updateView();
  }
}

function goToStep(step) {
  if (step >= 1 && step <= totalSteps) {
    playBeep(500, 0.06);
    currentStep = step;
    updateView();
  }
}

function restartOrientation() {
  playBeep(600, 0.1);
  currentStep = 1;
  updateView();
}

function toggleCheck(element) {
  playBeep(640, 0.06);
  element.classList.toggle('checked');
}

// Keyboard navigation
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'Enter') {
    nextStep();
  } else if (e.key === 'ArrowLeft') {
    prevStep();
  }
});

// Lightweight Confetti Particle Canvas
const canvas = document.getElementById('confetti-canvas');
let ctx = null;
let particles = [];
let animationId = null;

if (canvas) {
  ctx = canvas.getContext('2d');
  
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
}

function createConfetti() {
  if (!canvas) return;
  particles = [];
  const colors = ['#00d2ff', '#3a86ff', '#38bdf8', '#4ade80', '#fbbf24', '#f43f5e'];
  for (let i = 0; i < 110; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * -canvas.height * 0.5,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      speedX: (Math.random() - 0.5) * 4,
      speedY: Math.random() * 4 + 2,
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 8
    });
  }
}

function renderConfetti() {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  let activeCount = 0;

  particles.forEach(p => {
    p.x += p.speedX;
    p.y += p.speedY;
    p.rotation += p.rotSpeed;

    if (p.y < canvas.height + 20) {
      activeCount++;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
  });

  if (activeCount > 0) {
    animationId = requestAnimationFrame(renderConfetti);
  } else {
    cancelAnimationFrame(animationId);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function launchCelebration() {
  createConfetti();
  if (animationId) cancelAnimationFrame(animationId);
  renderConfetti();
}

// Initial view update when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  updateView();
});

