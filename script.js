(() => {
  const $ = (id) => document.getElementById(id);
  const els = {
    savedWorkouts: $("savedWorkouts"),
    modeLabel: $("modeLabel"),
    statusLabel: $("statusLabel"),
    primaryLabel: $("primaryLabel"),
    secondaryLabel: $("secondaryLabel"),
    noteLabel: $("noteLabel"),
    timeDisplay: $("timeDisplay"),
    progressBar: $("progressBar"),
    progressTrack: document.querySelector(".progress-track"),
    startBtn: $("startBtn"),
    pauseBtn: $("pauseBtn"),
    resetBtn: $("resetBtn"),
    tabs: [...document.querySelectorAll(".tab")],
    intervalPanel: $("intervalPanel"),
    capPanel: $("capPanel"),
    simulationPanel: $("simulationPanel"),
    workoutName: $("workoutName"),
    roundsInput: $("roundsInput"),
    setsInput: $("setsInput"),
    workInput: $("workInput"),
    setRestInput: $("setRestInput"),
    roundRestInput: $("roundRestInput"),
    buildIntervalsBtn: $("buildIntervalsBtn"),
    saveWorkoutBtn: $("saveWorkoutBtn"),
    deleteWorkoutBtn: $("deleteWorkoutBtn"),
    capMinutes: $("capMinutes"),
    capSeconds: $("capSeconds"),
    setCapBtn: $("setCapBtn"),
    waveName: $("waveName"),
    activeWave: $("activeWave"),
    addWaveBtn: $("addWaveBtn"),
    startWaveBtn: $("startWaveBtn"),
    deleteWaveBtn: $("deleteWaveBtn"),
    waveList: $("waveList"),
    personCount: $("personCount"),
    applyPeopleBtn: $("applyPeopleBtn"),
    clearLapsBtn: $("clearLapsBtn"),
    clearPeopleBtn: $("clearPeopleBtn"),
    exportSimulationBtn: $("exportSimulationBtn"),
    saveSimulationBtn: $("saveSimulationBtn"),
    peopleList: $("peopleList"),
    detailsTitle: $("detailsTitle"),
    detailsSummary: $("detailsSummary"),
    intervalList: $("intervalList"),
    savedSimulations: $("savedSimulations"),
    toast: $("toast"),
  };

  const WORKOUT_KEY = "coachTimer.workouts.v1";
  const SIM_KEY = "coachTimer.simulations.v1";
  const SETTINGS_KEY = "coachTimer.settings.v1";
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const readInt = (input, fallback, min, max) => clamp(Number.parseInt(input.value, 10) || fallback, min, max);
  const readAtLeast = (input, fallback, min) => Math.max(min, Number.parseInt(input.value, 10) || fallback);

  let mode = "interval";
  let status = "ready";
  let timerId = null;
  let endsAt = 0;
  let startedAt = 0;
  let pausedRemaining = 0;
  let elapsedBeforePause = 0;
  let currentIndex = 0;
  let intervals = [];
  let people = [];
  let waves = [];
  let toastId = null;
  let audioContext = null;
  let wakeLock = null;

  function loadJSON(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch (_) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function format(seconds, showTenths = false) {
    const safe = Math.max(0, seconds);
    const whole = Math.floor(safe);
    const minutes = Math.floor(whole / 60);
    const secs = whole % 60;
    const base = `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    return showTenths ? `${base}.${Math.floor((safe - whole) * 10)}` : base;
  }

  function totalIntervalSeconds() {
    return intervals.reduce((sum, item) => sum + item.seconds, 0);
  }

  function currentSimulationElapsed() {
    if (status === "running" && mode === "simulation") {
      return (performance.now() - startedAt) / 1000 + elapsedBeforePause;
    }
    return elapsedBeforePause;
  }

  function activeWave() {
    return waves.find((wave) => wave.id === els.activeWave.value) || waves[0];
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    clearTimeout(toastId);
    toastId = setTimeout(() => els.toast.classList.remove("is-visible"), 2200);
  }

  function beep(kind = "next") {
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === "suspended") audioContext.resume();
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.frequency.value = kind === "finish" ? 660 : kind === "lap" ? 990 : 820;
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, audioContext.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.28);
      osc.start();
      osc.stop(audioContext.currentTime + 0.3);
    } catch (_) {}
  }

  async function keepAwake() {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } catch (_) {
      wakeLock = null;
    }
  }

  function releaseWakeLock() {
    if (wakeLock) wakeLock.release();
    wakeLock = null;
  }

  function setStatus(next) {
    status = next;
    els.statusLabel.textContent = next.toUpperCase();
  }

  function setDisplay(seconds, progress, showTenths = false) {
    els.timeDisplay.textContent = format(seconds, showTenths);
    const percent = clamp(progress * 100, 0, 100);
    els.progressBar.style.width = `${percent}%`;
    els.progressTrack.setAttribute("aria-valuenow", String(Math.round(percent)));
  }

  function buildIntervals() {
    const rounds = readInt(els.roundsInput, 1, 1, 99);
    const sets = readInt(els.setsInput, 1, 1, 99);
    const work = readInt(els.workInput, 40, 1, 5999);
    const setRest = readInt(els.setRestInput, 0, 0, 5999);
    const roundRest = readInt(els.roundRestInput, 0, 0, 5999);
    const built = [];

    for (let round = 1; round <= rounds; round += 1) {
      for (let set = 1; set <= sets; set += 1) {
        built.push({ type: "Work", round, set, seconds: work, note: `Set ${set} of ${sets}` });
        if (set < sets && setRest > 0) built.push({ type: "Rest", round, set, seconds: setRest, note: "Rest between sets" });
      }
      if (round < rounds && roundRest > 0) built.push({ type: "Round Rest", round, set: sets, seconds: roundRest, note: "Rest between rounds" });
    }

    intervals = built;
    currentIndex = 0;
    pausedRemaining = intervals[0]?.seconds || 0;
    saveSettings();
    renderIntervals();
    resetTimer(false);
    toast("Intervals built");
  }

  function renderIntervals() {
    els.detailsTitle.textContent = mode === "simulation" ? "Saved simulations" : "Session plan";
    els.detailsSummary.textContent = intervals.length ? `${intervals.length} blocks, ${format(totalIntervalSeconds())}` : "";
    els.intervalList.classList.toggle("is-hidden", mode === "simulation");
    els.savedSimulations.classList.toggle("is-hidden", mode !== "simulation");

    if (!intervals.length) {
      els.intervalList.innerHTML = `<li class="empty">Build a workout to see every work and rest block.</li>`;
      return;
    }

    els.intervalList.innerHTML = intervals.map((item, index) => `
      <li class="${index === currentIndex && mode === "interval" ? "is-active" : ""}" data-index="${index}">
        <span>${item.type}</span>
        <span>Round ${item.round}${item.type === "Round Rest" ? "" : `, set ${item.set}`}</span>
        <span>${format(item.seconds)}</span>
      </li>
    `).join("");

    els.intervalList.querySelectorAll("li[data-index]").forEach((row) => {
      row.addEventListener("click", () => {
        if (mode !== "interval") return;
        pauseTimer();
        currentIndex = Number(row.dataset.index);
        pausedRemaining = intervals[currentIndex].seconds;
        updateIntervalLabels(pausedRemaining);
      });
    });
  }

  function updateIntervalLabels(remaining) {
    const item = intervals[currentIndex];
    if (!item) {
      els.primaryLabel.textContent = "Build a session";
      els.secondaryLabel.textContent = "-";
      els.noteLabel.textContent = "Add rounds, sets, work, and rest.";
      setDisplay(0, 0);
      return;
    }
    const elapsedBefore = intervals.slice(0, currentIndex).reduce((sum, block) => sum + block.seconds, 0);
    const progress = (elapsedBefore + (item.seconds - remaining)) / totalIntervalSeconds();
    els.primaryLabel.textContent = `Round ${item.round}`;
    els.secondaryLabel.textContent = item.type === "Round Rest" ? "Between rounds" : `Set ${item.set}`;
    els.noteLabel.textContent = item.note;
    setDisplay(remaining, progress);
    renderIntervals();
  }

  function setCap() {
    const total = readInt(els.capMinutes, 12, 0, 599) * 60 + readInt(els.capSeconds, 0, 0, 59);
    pausedRemaining = Math.max(1, total);
    els.primaryLabel.textContent = "Time cap";
    els.secondaryLabel.textContent = "Countdown";
    els.noteLabel.textContent = "Run until the cap expires.";
    setDisplay(pausedRemaining, 0);
    saveSettings();
    toast("Time cap set");
  }

  function setupPeople() {
    const count = readAtLeast(els.personCount, 4, 1);
    ensureWaves();
    people = Array.from({ length: count }, (_, index) => {
      const existing = people[index] || {};
      return {
        name: existing.name || `Person ${index + 1}`,
        waveId: existing.waveId || waves[0].id,
        laps: normalizeLaps(existing.laps || [], existing.waveId || waves[0].id),
      };
    });
    renderPeople();
    saveSettings();
  }

  function ensureWaves() {
    if (waves.length) return;
    waves = [{ id: "wave-1", name: "Wave 1", startElapsed: null }];
  }

  function addWave() {
    ensureWaves();
    const name = els.waveName.value.trim() || `Wave ${waves.length + 1}`;
    const id = crypto.randomUUID ? crypto.randomUUID() : `wave-${Date.now()}`;
    waves.push({ id, name, startElapsed: null });
    els.waveName.value = `Wave ${waves.length + 1}`;
    renderWaves();
    saveSettings();
    toast(`${name} added`);
  }

  function startWave() {
    ensureWaves();
    if (mode !== "simulation") switchMode("simulation");
    if (status !== "running") startTimer();
    const wave = activeWave();
    if (!wave) return;
    wave.startElapsed = currentSimulationElapsed();
    renderWaves();
    renderPeople();
    saveSettings();
    beep("lap");
    toast(`${wave.name} started`);
  }

  function deleteWave() {
    ensureWaves();
    const wave = activeWave();
    if (!wave) return;
    if (waves.length === 1) {
      waves = [{ id: "wave-1", name: "Wave 1", startElapsed: null }];
      people.forEach((person) => {
        person.waveId = waves[0].id;
        person.laps = [];
      });
      renderPeople();
      saveSettings();
      toast("Wave reset");
      return;
    }
    const fallback = waves.find((item) => item.id !== wave.id);
    waves = waves.filter((item) => item.id !== wave.id);
    people.forEach((person) => {
      if (person.waveId === wave.id) {
        person.waveId = fallback.id;
        person.laps = [];
      } else {
        person.laps = person.laps.filter((lap) => lap.waveId !== wave.id);
      }
    });
    els.activeWave.value = fallback.id;
    renderPeople();
    saveSettings();
    toast(`${wave.name} deleted`);
  }

  function renderWaves() {
    ensureWaves();
    const current = els.activeWave.value || waves[0].id;
    els.activeWave.innerHTML = waves.map((wave) => `<option value="${wave.id}">${escapeHTML(wave.name)}</option>`).join("");
    els.activeWave.value = waves.some((wave) => wave.id === current) ? current : waves[0].id;
    els.waveList.innerHTML = waves.map((wave) => `
      <span class="wave-chip ${wave.startElapsed === null ? "" : "is-started"}">
        ${escapeHTML(wave.name)} · ${wave.startElapsed === null ? "not started" : `started ${format(wave.startElapsed, true)}`}
      </span>
    `).join("");
  }

  function renderPeople() {
    renderWaves();
    els.peopleList.innerHTML = people.map((person, index) => `
      <div class="person-card">
        <label class="field">
          <span>Name</span>
          <input class="person-name" data-index="${index}" value="${escapeHTML(person.name)}" maxlength="28" />
        </label>
        <label class="field">
          <span>Wave</span>
          <select class="person-wave" data-index="${index}">
            ${waves.map((wave) => `<option value="${wave.id}" ${wave.id === person.waveId ? "selected" : ""}>${escapeHTML(wave.name)}</option>`).join("")}
          </select>
        </label>
        <button class="button button-primary lap-btn" type="button" data-index="${index}">Lap</button>
        <div class="person-laps">
          ${person.laps.length ? person.laps.map((lap, lapIndex) => `<span class="lap-chip">${lapIndex + 1}: ${format(lap.elapsed, true)} (${format(lap.split, true)})</span>`).join("") : `<span class="lap-chip">No laps</span>`}
        </div>
      </div>
    `).join("");

    els.peopleList.querySelectorAll(".person-name").forEach((input) => {
      input.addEventListener("input", () => {
        people[Number(input.dataset.index)].name = input.value.trim() || `Person ${Number(input.dataset.index) + 1}`;
        saveSettings();
      });
    });

    els.peopleList.querySelectorAll(".person-wave").forEach((select) => {
      select.addEventListener("change", () => {
        people[Number(select.dataset.index)].waveId = select.value;
        saveSettings();
      });
    });

    els.peopleList.querySelectorAll(".lap-btn").forEach((button) => {
      button.addEventListener("click", () => recordLap(Number(button.dataset.index)));
    });
  }

  function recordLap(index) {
    if (mode !== "simulation") switchMode("simulation");
    const person = people[index];
    const wave = waves.find((item) => item.id === person.waveId);
    if (!wave || wave.startElapsed === null) {
      toast("Start this athlete's wave first");
      return;
    }
    const elapsed = Math.max(0, currentSimulationElapsed() - wave.startElapsed);
    const lastLap = person.laps[person.laps.length - 1];
    person.laps.push({
      waveId: wave.id,
      elapsed,
      split: lastLap ? elapsed - lastLap.elapsed : elapsed,
      recordedAt: currentSimulationElapsed(),
    });
    beep("lap");
    renderPeople();
    saveSettings();
  }

  function normalizeLaps(laps, waveId) {
    return laps.map((lap, index, all) => {
      if (typeof lap === "number") {
        const previous = typeof all[index - 1] === "number" ? all[index - 1] : 0;
        return { waveId, elapsed: lap, split: lap - previous, recordedAt: lap };
      }
      return {
        waveId: lap.waveId || waveId,
        elapsed: Number(lap.elapsed) || 0,
        split: Number(lap.split) || Number(lap.elapsed) || 0,
        recordedAt: Number(lap.recordedAt ?? lap.elapsed) || 0,
      };
    });
  }

  function renderSavedSimulations() {
    const saved = loadJSON(SIM_KEY, []);
    if (!saved.length) {
      els.savedSimulations.innerHTML = `<div class="empty">Saved lap sessions will appear here.</div>`;
      return;
    }
    els.savedSimulations.innerHTML = saved.slice(0, 8).map((session) => `
      <div class="sim-record">
        <span>${session.date}</span>
        <span>${session.people.length} people</span>
        <span>${session.people.reduce((sum, person) => sum + person.laps.length, 0)} laps</span>
      </div>
    `).join("");
  }

  function saveSimulation() {
    const hasLaps = people.some((person) => person.laps.length);
    if (!hasLaps) {
      toast("No laps to save yet");
      return;
    }
    const saved = loadJSON(SIM_KEY, []);
    saved.unshift({
      date: new Date().toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
      waves: waves.map((wave) => ({ ...wave })),
      people: people.map((person) => ({ name: person.name, waveId: person.waveId, laps: person.laps })),
    });
    saveJSON(SIM_KEY, saved.slice(0, 30));
    renderSavedSimulations();
    toast("Lap session saved");
  }

  function exportSimulationCSV() {
    const hasLaps = people.some((person) => person.laps.length);
    if (!hasLaps) {
      toast("No laps to export yet");
      return;
    }
    const sessionDate = new Date().toISOString();
    const rows = [["session_date", "wave", "athlete", "lap_number", "lap_time", "lap_seconds", "split_time", "split_seconds", "race_clock"]];
    people.forEach((person) => {
      person.laps.forEach((lap, index) => {
        const wave = waves.find((item) => item.id === (lap.waveId || person.waveId));
        rows.push([
          sessionDate,
          wave?.name || "Wave",
          person.name,
          String(index + 1),
          format(lap.elapsed, true),
          lap.elapsed.toFixed(1),
          format(lap.split, true),
          lap.split.toFixed(1),
          format(lap.recordedAt ?? lap.elapsed, true),
        ]);
      });
    });
    downloadCSV(`simulation-laps-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast("CSV exported");
  }

  function downloadCSV(filename, rows) {
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function saveWorkout() {
    if (!intervals.length) buildIntervals();
    const saved = loadJSON(WORKOUT_KEY, []);
    const workout = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      name: els.workoutName.value.trim() || "Coaching intervals",
      settings: getIntervalSettings(),
      intervals,
    };
    const next = [workout, ...saved.filter((item) => item.name !== workout.name)].slice(0, 40);
    saveJSON(WORKOUT_KEY, next);
    populateSavedWorkouts();
    els.savedWorkouts.value = workout.id;
    toast("Workout saved");
  }

  function deleteSavedWorkout() {
    const id = els.savedWorkouts.value;
    if (!id) {
      toast("Pick a saved workout first");
      return;
    }
    const next = loadJSON(WORKOUT_KEY, []).filter((item) => item.id !== id);
    saveJSON(WORKOUT_KEY, next);
    populateSavedWorkouts();
    toast("Saved workout deleted");
  }

  function populateSavedWorkouts() {
    const saved = loadJSON(WORKOUT_KEY, []);
    els.savedWorkouts.innerHTML = `<option value="">Saved workouts</option>${saved.map((item) => `<option value="${item.id}">${escapeHTML(item.name)}</option>`).join("")}`;
  }

  function loadWorkout(id) {
    const workout = loadJSON(WORKOUT_KEY, []).find((item) => item.id === id);
    if (!workout) return;
    Object.entries(workout.settings).forEach(([key, value]) => {
      if (els[key]) els[key].value = value;
    });
    els.workoutName.value = workout.name;
    intervals = workout.intervals;
    currentIndex = 0;
    pausedRemaining = intervals[0]?.seconds || 0;
    switchMode("interval");
    updateIntervalLabels(pausedRemaining);
    toast("Workout loaded");
  }

  function getIntervalSettings() {
    return {
      roundsInput: els.roundsInput.value,
      setsInput: els.setsInput.value,
      workInput: els.workInput.value,
      setRestInput: els.setRestInput.value,
      roundRestInput: els.roundRestInput.value,
    };
  }

  function saveSettings() {
    saveJSON(SETTINGS_KEY, {
      mode,
      interval: getIntervalSettings(),
      cap: { minutes: els.capMinutes.value, seconds: els.capSeconds.value },
      waves,
      people,
      personCount: els.personCount.value,
    });
  }

  function loadSettings() {
    const saved = loadJSON(SETTINGS_KEY, null);
    if (!saved) {
      setupPeople();
      buildIntervals();
      return;
    }
    Object.entries(saved.interval || {}).forEach(([key, value]) => {
      if (els[key]) els[key].value = value;
    });
    els.capMinutes.value = saved.cap?.minutes ?? els.capMinutes.value;
    els.capSeconds.value = saved.cap?.seconds ?? els.capSeconds.value;
    els.personCount.value = saved.personCount || els.personCount.value;
    waves = saved.waves?.length ? saved.waves : [];
    people = saved.people?.length ? saved.people : [];
    setupPeople();
    buildIntervals();
    switchMode(saved.mode || "interval");
  }

  function startTimer() {
    if (status === "running") return;
    if (mode === "interval" && !intervals.length) buildIntervals();
    if (mode === "cap" && pausedRemaining <= 0) setCap();

    setStatus("running");
    keepAwake();
    if (mode === "simulation") {
      startedAt = performance.now();
      runSimulationTick();
      timerId = setInterval(runSimulationTick, 100);
      return;
    }

    endsAt = performance.now() + pausedRemaining * 1000;
    runCountdownTick();
    timerId = setInterval(runCountdownTick, 200);
  }

  function pauseTimer() {
    if (status !== "running") return;
    clearInterval(timerId);
    timerId = null;
    if (mode === "simulation") {
      elapsedBeforePause += (performance.now() - startedAt) / 1000;
    } else {
      pausedRemaining = Math.max(0, (endsAt - performance.now()) / 1000);
    }
    releaseWakeLock();
    setStatus("paused");
  }

  function resetTimer(showMessage = true) {
    clearInterval(timerId);
    timerId = null;
    releaseWakeLock();
    setStatus("ready");
    currentIndex = 0;
    elapsedBeforePause = 0;
    startedAt = performance.now();

    if (mode === "interval") {
      pausedRemaining = intervals[0]?.seconds || 0;
      updateIntervalLabels(pausedRemaining);
    } else if (mode === "cap") {
      setCap();
    } else {
      waves.forEach((wave) => { wave.startElapsed = null; });
      setDisplay(0, 0, true);
      els.primaryLabel.textContent = "Simulation";
      els.secondaryLabel.textContent = "Lap recorder";
      els.noteLabel.textContent = "Start a wave, then tap Lap for each athlete.";
      renderWaves();
    }
    if (showMessage) toast("Reset");
  }

  function runCountdownTick() {
    const remaining = Math.max(0, (endsAt - performance.now()) / 1000);
    pausedRemaining = remaining;

    if (mode === "interval") {
      updateIntervalLabels(remaining);
      if (remaining <= 0) nextInterval();
      return;
    }

    setDisplay(remaining, 1 - remaining / Math.max(1, readInt(els.capMinutes, 0, 0, 599) * 60 + readInt(els.capSeconds, 0, 0, 59)));
    if (remaining <= 0) finishTimer();
  }

  function nextInterval() {
    currentIndex += 1;
    if (currentIndex >= intervals.length) {
      finishTimer();
      return;
    }
    pausedRemaining = intervals[currentIndex].seconds;
    endsAt = performance.now() + pausedRemaining * 1000;
    beep();
    updateIntervalLabels(pausedRemaining);
  }

  function runSimulationTick() {
    const elapsed = currentSimulationElapsed();
    const activeWaves = waves.filter((wave) => wave.startElapsed !== null).length;
    els.primaryLabel.textContent = "Simulation";
    els.secondaryLabel.textContent = `${people.reduce((sum, person) => sum + person.laps.length, 0)} laps`;
    els.noteLabel.textContent = activeWaves ? `${activeWaves} wave${activeWaves === 1 ? "" : "s"} running.` : "Start a wave before recording laps.";
    setDisplay(elapsed, 0, true);
  }

  function finishTimer() {
    clearInterval(timerId);
    timerId = null;
    releaseWakeLock();
    setStatus("done");
    pausedRemaining = 0;
    setDisplay(0, 1);
    els.primaryLabel.textContent = mode === "cap" ? "Time cap complete" : "Workout complete";
    els.secondaryLabel.textContent = "Done";
    els.noteLabel.textContent = "Nice work.";
    beep("finish");
  }

  function switchMode(nextMode) {
    if (mode !== nextMode) pauseTimer();
    mode = nextMode;
    els.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.mode === mode));
    els.intervalPanel.classList.toggle("is-hidden", mode !== "interval");
    els.capPanel.classList.toggle("is-hidden", mode !== "cap");
    els.simulationPanel.classList.toggle("is-hidden", mode !== "simulation");
    els.modeLabel.textContent = mode === "interval" ? "INTERVAL SESSION" : mode === "cap" ? "TIME CAP" : "SIMULATION LAPS";
    renderIntervals();
    renderSavedSimulations();
    resetTimer(false);
    saveSettings();
  }

  function clearLaps() {
    people.forEach((person) => { person.laps = []; });
    waves.forEach((wave) => { wave.startElapsed = null; });
    elapsedBeforePause = 0;
    renderPeople();
    resetTimer(false);
    toast("Laps cleared");
  }

  function clearPeople() {
    ensureWaves();
    people = [];
    els.personCount.value = 1;
    els.peopleList.innerHTML = `<div class="empty">Participants cleared. Set a number and tap Apply.</div>`;
    saveSettings();
    toast("Participants cleared");
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;",
    }[char]));
  }

  els.buildIntervalsBtn.addEventListener("click", buildIntervals);
  els.saveWorkoutBtn.addEventListener("click", saveWorkout);
  els.deleteWorkoutBtn.addEventListener("click", deleteSavedWorkout);
  els.setCapBtn.addEventListener("click", setCap);
  els.addWaveBtn.addEventListener("click", addWave);
  els.startWaveBtn.addEventListener("click", startWave);
  els.deleteWaveBtn.addEventListener("click", deleteWave);
  els.applyPeopleBtn.addEventListener("click", setupPeople);
  els.clearLapsBtn.addEventListener("click", clearLaps);
  els.clearPeopleBtn.addEventListener("click", clearPeople);
  els.exportSimulationBtn.addEventListener("click", exportSimulationCSV);
  els.saveSimulationBtn.addEventListener("click", saveSimulation);
  els.startBtn.addEventListener("click", startTimer);
  els.pauseBtn.addEventListener("click", pauseTimer);
  els.resetBtn.addEventListener("click", resetTimer);
  els.savedWorkouts.addEventListener("change", () => loadWorkout(els.savedWorkouts.value));
  els.tabs.forEach((tab) => tab.addEventListener("click", () => switchMode(tab.dataset.mode)));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && status === "running") keepAwake();
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
  }

  populateSavedWorkouts();
  loadSettings();
})();
