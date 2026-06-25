(() => {
  'use strict';

  /* ============================================
     STATE
     ============================================ */
  let running = false;
  let startTimestamp = 0;   // performance.now() when the current run began
  let elapsedBeforeStart = 0; // accumulated ms from previous runs (pause/resume)
  let rafId = null;

  let laps = []; // { totalMs, splitMs }

  const CIRCUMFERENCE = 2 * Math.PI * 142; // matches bezel__progress r=142

  /* ============================================
     DOM REFS
     ============================================ */
  const minutesEl = document.getElementById('minutes');
  const secondsEl = document.getElementById('seconds');
  const centisEl = document.getElementById('centis');
  const hoursEl = document.getElementById('hours');
  const timeDisplay = document.getElementById('timeDisplay');
  const bezelProgress = document.getElementById('bezelProgress');
  const statusLabel = document.getElementById('statusLabel');
  const statusText = statusLabel.querySelector('.instrument__status-text');
  const panelGlow = document.querySelector('.panel-glow');
  const instrumentPanel = document.querySelector('.instrument');

  const startBtn = document.getElementById('startBtn');
  const startBtnLabel = document.getElementById('startBtnLabel');
  const lapBtn = document.getElementById('lapBtn');
  const resetBtn = document.getElementById('resetBtn');

  const lapList = document.getElementById('lapList');
  const lapEmpty = document.getElementById('lapEmpty');
  const lapDelta = document.getElementById('lapDelta');
  const bestLapEl = document.getElementById('bestLap');
  const worstLapEl = document.getElementById('worstLap');

  const tickMarksGroup = document.getElementById('tickMarks');

  /* ============================================
     BUILD TICK MARKS (60 around the bezel, 12 major)
     ============================================ */
  function buildTicks() {
    const cx = 160, cy = 160;
    const outerR = 142;
    for (let i = 0; i < 60; i++) {
      const isMajor = i % 5 === 0;
      const angle = (i / 60) * 2 * Math.PI;
      const len = isMajor ? 10 : 5;
      const r1 = outerR + 8;
      const r2 = r1 + len;
      const x1 = cx + r1 * Math.cos(angle);
      const y1 = cy + r1 * Math.sin(angle);
      const x2 = cx + r2 * Math.cos(angle);
      const y2 = cy + r2 * Math.sin(angle);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1.toFixed(2));
      line.setAttribute('y1', y1.toFixed(2));
      line.setAttribute('x2', x2.toFixed(2));
      line.setAttribute('y2', y2.toFixed(2));
      line.setAttribute('class', isMajor ? 'tick tick--major' : 'tick');
      tickMarksGroup.appendChild(line);
    }
  }
  buildTicks();

  /* ============================================
     TIME FORMATTING
     ============================================ */
  function pad(n, width = 2) {
    return String(Math.floor(n)).padStart(width, '0');
  }

  function getElapsedMs() {
    if (running) {
      return elapsedBeforeStart + (performance.now() - startTimestamp);
    }
    return elapsedBeforeStart;
  }

  function formatParts(ms) {
    const totalCentis = Math.floor(ms / 10);
    const centis = totalCentis % 100;
    const totalSeconds = Math.floor(ms / 1000);
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);
    return { hours, minutes, seconds, centis };
  }

  function formatClock(ms) {
    const { hours, minutes, seconds, centis } = formatParts(ms);
    const base = `${pad(minutes)}:${pad(seconds)}.${pad(centis)}`;
    return hours > 0 ? `${pad(hours)}:${base}` : base;
  }

  /* ============================================
     RENDER LOOP
     ============================================ */
  function render() {
    const ms = getElapsedMs();
    const { hours, minutes, seconds, centis } = formatParts(ms);

    hoursEl.textContent = pad(hours);
    minutesEl.textContent = pad(minutes);
    secondsEl.textContent = pad(seconds);
    centisEl.textContent = pad(centis);
    timeDisplay.dataset.hasHours = hours > 0 ? 'true' : 'false';

    // bezel sweeps once per second (0 -> 1000ms maps to full circle)
    const fraction = (ms % 1000) / 1000;
    const offset = CIRCUMFERENCE * (1 - fraction);
    bezelProgress.style.strokeDashoffset = offset.toFixed(2);

    document.title = running
      ? `${formatClock(ms)} — Stopwatch`
      : 'Stopwatch';

    if (running) {
      rafId = requestAnimationFrame(render);
    }
  }

  /* ============================================
     STATE TRANSITIONS
     ============================================ */
  function setStatus(state, label) {
    statusLabel.dataset.state = state;
    statusText.textContent = label;
  }

  function start() {
    if (running) return;
    running = true;
    startTimestamp = performance.now();
    panelGlow.dataset.running = 'true';
    instrumentPanel.dataset.running = 'true';

    startBtnLabel.textContent = 'PAUSE';
    startBtn.dataset.running = 'true';
    lapBtn.disabled = false;
    resetBtn.disabled = false;

    setStatus('running', laps.length ? 'RUNNING' : 'TIMING');
    rafId = requestAnimationFrame(render);
  }

  function pause() {
    if (!running) return;
    running = false;
    elapsedBeforeStart += performance.now() - startTimestamp;
    if (rafId) cancelAnimationFrame(rafId);

    panelGlow.dataset.running = 'false';
    instrumentPanel.dataset.running = 'false';
    startBtnLabel.textContent = 'RESUME';
    startBtn.dataset.running = 'false';
    lapBtn.disabled = true;

    setStatus('paused', 'PAUSED');
    render(); // final paint at the paused value
  }

  function reset() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    elapsedBeforeStart = 0;
    laps = [];

    panelGlow.dataset.running = 'false';
    instrumentPanel.dataset.running = 'false';
    startBtnLabel.textContent = 'START';
    startBtn.dataset.running = 'false';
    lapBtn.disabled = true;
    resetBtn.disabled = true;

    bezelProgress.style.strokeDashoffset = CIRCUMFERENCE.toFixed(2);
    setStatus('idle', 'STANDING BY');

    lapDelta.textContent = '— : —';
    lapDelta.removeAttribute('data-trend');
    bestLapEl.textContent = 'Best lap: —';
    worstLapEl.textContent = 'Slowest lap: —';

    renderLaps();
    render();
  }

  function recordLap() {
    if (!running) return;
    const total = getElapsedMs();
    const previousTotal = laps.length ? laps[laps.length - 1].totalMs : 0;
    const split = total - previousTotal;

    laps.push({ totalMs: total, splitMs: split });
    renderLaps();
    setStatus('running', 'RUNNING');
  }

  /* ============================================
     LAP LIST RENDERING
     ============================================ */
  function renderLaps() {
    lapList.innerHTML = '';

    if (laps.length === 0) {
      lapList.appendChild(lapEmpty);
      return;
    }

    const splitValues = laps.map(l => l.splitMs);
    const bestSplit = Math.min(...splitValues);
    const worstSplit = Math.max(...splitValues);
    const hasVariance = bestSplit !== worstSplit;

    // newest lap first
    for (let i = laps.length - 1; i >= 0; i--) {
      const lap = laps[i];
      const lapNumber = i + 1;
      const li = document.createElement('li');
      li.className = 'lap-row';

      if (hasVariance && lap.splitMs === bestSplit) li.classList.add('lap-row--best');
      if (hasVariance && lap.splitMs === worstSplit) li.classList.add('lap-row--worst');

      let deltaHtml = '<span class="lap-row__delta">—</span>';
      if (i > 0) {
        const diff = lap.splitMs - laps[i - 1].splitMs;
        const sign = diff <= 0 ? '−' : '+';
        const trendClass = diff < 0 ? 'lap-row__delta--faster' : (diff > 0 ? 'lap-row__delta--slower' : '');
        const diffAbs = Math.abs(diff);
        deltaHtml = `<span class="lap-row__delta ${trendClass}">${sign}${formatClock(diffAbs)}</span>`;
      }

      li.innerHTML = `
        <span class="lap-row__num">#${pad(lapNumber)}</span>
        <span>${formatClock(lap.splitMs)}</span>
        <span>${formatClock(lap.totalMs)}</span>
        ${deltaHtml}
      `;
      lapList.appendChild(li);
    }

    // header delta readout: compare latest lap to previous
    const latest = laps[laps.length - 1];
    if (laps.length === 1) {
      lapDelta.textContent = `Lap 1 · ${formatClock(latest.splitMs)}`;
      lapDelta.removeAttribute('data-trend');
    } else {
      const prev = laps[laps.length - 2];
      const diff = latest.splitMs - prev.splitMs;
      const trend = diff < 0 ? 'faster' : (diff > 0 ? 'slower' : 'even');
      const arrow = diff < 0 ? '▼' : (diff > 0 ? '▲' : '·');
      lapDelta.textContent = `${arrow} ${formatClock(Math.abs(diff))} vs last lap`;
      lapDelta.dataset.trend = trend;
    }

    bestLapEl.textContent = hasVariance || laps.length === 1
      ? `Best lap: ${formatClock(bestSplit)}`
      : `Best lap: ${formatClock(bestSplit)} (all even)`;
    worstLapEl.textContent = `Slowest lap: ${formatClock(worstSplit)}`;
  }

  /* ============================================
     EVENT WIRING
     ============================================ */
  startBtn.addEventListener('click', () => {
    running ? pause() : start();
  });
  lapBtn.addEventListener('click', recordLap);
  resetBtn.addEventListener('click', reset);

  window.addEventListener('keydown', (e) => {
    // ignore if user is focused on a button via tab and hits space to "click" it twice
    if (e.code === 'Space') {
      e.preventDefault();
      running ? pause() : start();
    } else if (e.key.toLowerCase() === 'l') {
      e.preventDefault();
      if (!lapBtn.disabled) recordLap();
    } else if (e.key.toLowerCase() === 'r') {
      e.preventDefault();
      if (!resetBtn.disabled) reset();
    }
  });

  // initial paint
  render();
})();