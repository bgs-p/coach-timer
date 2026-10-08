(() => {
  const $ = (id) => document.getElementById(id);
  const els = {
    capPanel: $("capPanel"),
    capMinutes: $("capMinutes"),
    capSeconds: $("capSeconds"),
    setCapBtn: $("setCapBtn"),
    startBtn: $("startBtn"),
    pauseBtn: $("pauseBtn"),
    resetBtn: $("resetBtn"),
    timeDisplay: $("timeDisplay"),
    progressBar: $("progressBar"),
    statusLabel: $("statusLabel"),
    primaryLabel: $("primaryLabel"),
    secondaryLabel: $("secondaryLabel"),
    noteLabel: $("noteLabel"),
    tabs: [...document.querySelectorAll(".tab")],
    capTab: document.querySelector('[data-mode="cap"]'),
  };

  let capSeconds = 720;
  let elapsedBeforePause = 0;
  let startedAt = 0;
  let timer = null;

  const isCapMode = () => els.capPanel && !els.capPanel.classList.contains("is-hidden");
  const readCap = () => Math.max(1, (Number.parseInt(els.capMinutes.value, 10) || 0) * 60 + (Number.parseInt(els.capSeconds.value, 10) || 0));
  const format = (seconds) => {
    const safe = Math.max(0, seconds);
    const whole = Math.floor(safe);
    const minutes = Math.floor(whole / 60);
    const secs = whole % 60;
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${Math.floor((safe - whole) * 10)}`;
  };

  function setStatus(status) {
    els.statusLabel.textContent = status;
  }

  function render(elapsed) {
    const over = elapsed >= capSeconds;
    els.primaryLabel.textContent = "Time cap";
    els.secondaryLabel.textContent = over ? `Over by ${format(elapsed - capSeconds)}` : `Cap ${format(capSeconds)}`;
    els.noteLabel.textContent = over ? "Cap passed." : "Clock counts up.";
    els.timeDisplay.textContent = format(elapsed);
    els.timeDisplay.style.color = over ? "#ff8fa8" : "";
    els.progressBar.style.width = `${Math.min(100, (elapsed / capSeconds) * 100)}%`;
  }

  function setCap() {
    stop();
    capSeconds = readCap();
    elapsedBeforePause = 0;
    setStatus("READY");
    render(0);
  }

  function tick() {
    render((performance.now() - startedAt) / 1000 + elapsedBeforePause);
  }

  function start() {
    if (timer) return;
    if (!capSeconds) capSeconds = readCap();
    startedAt = performance.now();
    setStatus("RUNNING");
    tick();
    timer = setInterval(tick, 100);
  }

  function stop() {
    if (!timer) return;
    elapsedBeforePause += (performance.now() - startedAt) / 1000;
    clearInterval(timer);
    timer = null;
  }

  function pause() {
    stop();
    setStatus("PAUSED");
  }

  function reset() {
    stop();
    elapsedBeforePause = 0;
    setStatus("READY");
    render(0);
  }

  function capOnly(handler) {
    return (event) => {
      if (!isCapMode()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      handler();
    };
  }

  els.setCapBtn.addEventListener("click", capOnly(setCap), true);
  els.startBtn.addEventListener("click", capOnly(start), true);
  els.pauseBtn.addEventListener("click", capOnly(pause), true);
  els.resetBtn.addEventListener("click", capOnly(reset), true);
  els.capTab.addEventListener("click", () => setTimeout(setCap, 0));
  els.tabs
    .filter((tab) => tab.dataset.mode !== "cap")
    .forEach((tab) => tab.addEventListener("click", stop));
})();
