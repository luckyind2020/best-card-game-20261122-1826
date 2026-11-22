// Crown of Embers — browser UI.
// Drives the shared rules module (window.CrownRules from rules.js):
// the player duels an AI Rival on a felt table. Mouse + keyboard.
// No network: all state lives in this page.

(function () {
  "use strict";
  const R = window.CrownRules;
  const $ = (id) => document.getElementById(id);

  // ---------- sound (WebAudio, no files) ----------
  let audioCtx = null;
  let soundOn = true;
  function beep(freq, dur, type, vol, when) {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime + (when || 0);
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(vol || 0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch (e) { /* audio unavailable — game still plays */ }
  }
  const sfx = {
    play: () => { beep(520, 0.12, "triangle", 0.1); beep(780, 0.1, "triangle", 0.07, 0.06); },
    hurt: () => beep(140, 0.22, "sawtooth", 0.08),
    heal: () => { beep(660, 0.12, "sine", 0.08); beep(880, 0.16, "sine", 0.07, 0.08); },
    turn: () => beep(440, 0.08, "square", 0.04),
    win: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.22, "triangle", 0.1, i * 0.13)),
    lose: () => [392, 330, 262, 196].forEach((f, i) => beep(f, 0.25, "sine", 0.09, i * 0.15)),
  };

  // ---------- state ----------
  let game = null;
  let busy = false; // AI is animating
  let seed = (Date.now() % 100000) | 0;

  function newGame(fixedSeed) {
    seed = fixedSeed != null ? fixedSeed : (Date.now() % 100000) | 0;
    game = new R.EmberGame(seed);
    busy = false;
    hideAllOverlays();
    logLines = [];
    render();
    setBanner("Your turn — play a card, then end your turn.");
  }

  // ---------- logging ----------
  let logLines = [];
  function renderLog() {
    const el = $("log");
    el.innerHTML = logLines.slice(-8).map((l) => {
      if (/^Turn \d+/.test(l)) return `<div class="turn-head">${esc(l)}</div>`;
      return `<div>${esc(l)}</div>`;
    }).join("");
    el.scrollTop = el.scrollHeight;
  }
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }

  // ---------- rendering ----------
  function cardEl(card, index, playable) {
    const el = document.createElement("div");
    const red = card.suit === "hearts" || card.suit === "diamonds";
    el.className = "card" + (red ? " red" : "") + (playable === false ? " unaffordable" : "");
    el.innerHTML =
      `<span class="cost" title="Energy cost">${card.cost}⚡</span>` +
      `<span class="rank">${card.label}</span>` +
      `<span class="suit">${card.symbol}</span>` +
      `<span class="suit-name">${card.suitName} · ${card.power}</span>` +
      `<span class="power">${card.attack} attack — ${card.powerText}</span>` +
      (index != null ? `<span class="key-hint">${index + 1}</span>` : "");
    return el;
  }

  function backEl() {
    const el = document.createElement("div");
    el.className = "card back small";
    el.innerHTML = `<span class="emblem">♛</span>`;
    return el;
  }

  function renderEnergy(el, cur, max) {
    let html = "Energy ";
    for (let i = 0; i < max; i++) {
      html += `<span class="pip${i < cur ? " full" : ""}"></span>`;
    }
    html += ` &nbsp;${cur} / ${max}`;
    el.innerHTML = html;
  }

  function render() {
    if (!game) return;
    const you = game.players[0];
    const rival = game.players[1];

    // Life totals
    $("playerLifeNum").textContent = `${you.life} / ${R.START_LIFE}`;
    $("rivalLifeNum").textContent = `${rival.life} / ${R.START_LIFE}`;
    $("playerLifeFill").style.width = (you.life / R.START_LIFE * 100) + "%";
    $("rivalLifeFill").style.width = (rival.life / R.START_LIFE * 100) + "%";
    const ps = $("playerShield"), rs = $("rivalShield");
    ps.hidden = you.shield <= 0; ps.textContent = `🛡 ${you.shield}`;
    rs.hidden = rival.shield <= 0; rs.textContent = `🛡 ${rival.shield}`;

    renderEnergy($("playerEnergy"), you.energy, you.maxEnergy);
    renderEnergy($("rivalEnergy"), rival.energy, rival.maxEnergy);
    $("playerDeckCount").textContent = `Deck: ${you.deck.length} · Discard: ${you.discard.length}`;
    $("rivalDeckCount").textContent = `Deck: ${rival.deck.length} · Discard: ${rival.discard.length}`;
    $("rivalHandLabel").textContent = `Rival's hand — ${rival.hand.length} card${rival.hand.length === 1 ? "" : "s"} (face down)`;

    // Rival hand: face-down backs.
    const rh = $("rivalHand");
    rh.innerHTML = "";
    rival.hand.forEach(() => rh.appendChild(backEl()));

    // Player hand: face-up, clickable.
    const ph = $("playerHand");
    ph.innerHTML = "";
    you.hand.forEach((card, i) => {
      const playable = !game.over && !busy && game.active === 0 && card.cost <= you.energy;
      const el = cardEl(card, i, playable);
      if (playable) {
        el.addEventListener("click", () => playPlayerCard(i));
      }
      ph.appendChild(el);
    });

    $("endTurnBtn").disabled = game.over || busy || game.active !== 0;
    renderLog();

    if (game.over) showEndScreen();
  }

  function setBanner(text) {
    $("turnBanner").textContent = text;
  }

  // ---------- play flow ----------
  function syncLog() {
    logLines = game.log.slice();
  }

  function playPlayerCard(i) {
    if (!game || game.over || busy || game.active !== 0) return;
    const res = game.playCard(0, i);
    if (!res.ok) {
      setBanner(res.reason + " — pick another card.");
      return;
    }
    if (res.damage > 0) sfx.hurt();
    else sfx.play();
    if (res.card && res.card.suit === "hearts") sfx.heal();
    syncLog();
    render();
    if (game.over) return;
    if (game.players[0].energy === 0) {
      setBanner("Out of energy — end your turn.");
    }
  }

  function endPlayerTurn() {
    if (!game || game.over || busy || game.active !== 0) return;
    game.endTurn();
    syncLog();
    busy = true;
    render();
    setBanner("Rival is thinking…");
    sfx.turn();
    // Animate the Rival's plays one card at a time.
    setTimeout(aiStep, 700);
  }

  function aiStep() {
    if (!game || game.over) { busy = false; render(); return; }
    const before = game.players[1].hand.length;
    const beforeLife = game.players[0].life;
    // Mirror the AI: play its single best affordable card, then pause.
    const me = game.players[1];
    let best = -1, bestScore = -1;
    for (let i = 0; i < me.hand.length; i++) {
      const c = me.hand[i];
      if (c.cost > me.energy) continue;
      let score = c.attack;
      if (c.suit === "spades") score += 2;
      if (c.suit === "hearts" && me.life < R.START_LIFE) score += 3;
      if (c.suit === "clubs") score += 1;
      if (c.suit === "diamonds") score += 2;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best >= 0 && !game.over) {
      const res = game.playCard(1, best);
      if (res.damage > 0 && game.players[0].life < beforeLife) sfx.hurt();
      else sfx.play();
      syncLog();
      render();
      if (game.over) { busy = false; render(); return; }
      setTimeout(aiStep, 650);
    } else {
      game.endTurn();
      syncLog();
      busy = false;
      render();
      setBanner("Your turn — play a card, then end your turn.");
      sfx.turn();
    }
    void before;
  }

  // ---------- end screens ----------
  function showEndScreen() {
    const s = game.summary();
    if (s.winner === "You") {
      $("winScore").textContent = `Final life — You ${s.life[0]} : Rival ${s.life[1]}`;
      $("winDetail").textContent =
        `Victory in ${s.turns} turns, ${s.plays} cards played. The Rival bows and the crown is yours.`;
      $("winScreen").classList.remove("hidden");
      sfx.win();
    } else {
      $("lossScore").textContent = `Final life — You ${s.life[0]} : Rival ${s.life[1]}`;
      $("lossDetail").textContent =
        `Defeat in ${s.turns} turns, ${s.plays} cards played. The court keeps the crown — shuffle up and challenge it again.`;
      $("lossScreen").classList.remove("hidden");
      sfx.lose();
    }
  }

  function hideAllOverlays() {
    ["titleScreen", "howScreen", "winScreen", "lossScreen"].forEach((id) => $(id).classList.add("hidden"));
  }

  // ---------- debug hooks for screenshots ----------
  // ?state=table — jump to a real mid-game table (4 AI turns played).
  // ?state=win / ?state=loss — play real AI-vs-AI matches until the
  // requested side wins, then show that genuine end screen.
  function applyDebugState() {
    const q = new URLSearchParams(location.search);
    const state = q.get("state");
    if (!state) return;
    const baseSeed = parseInt(q.get("seed") || "20261122", 10);
    if (state === "table") {
      game = new R.EmberGame(baseSeed);
      let guard = 0;
      while (!game.over && guard++ < 4) game.aiTakeTurn(game.active);
      if (game.over) game = new R.EmberGame(baseSeed + 5);
      syncLog();
      render();
      setBanner("Your turn — play a card, then end your turn.");
    } else if (state === "win" || state === "loss") {
      const want = state === "win" ? 0 : 1;
      for (let s = 0; s < 40; s++) {
        const g = R.simulateMatch(baseSeed + s);
        if (g.winner === want) {
          game = g;
          syncLog();
          render();
          return;
        }
      }
      // Fallback: show the first simulated match as-is.
      game = R.simulateMatch(baseSeed);
      syncLog();
      render();
    }
  }

  // ---------- wiring ----------
  $("playBtn").addEventListener("click", () => {
    sfx.play();
    $("titleScreen").classList.add("hidden");
    newGame();
  });
  $("howBtn").addEventListener("click", () => $("howScreen").classList.remove("hidden"));
  $("titleHowBtn").addEventListener("click", () => $("howScreen").classList.remove("hidden"));
  $("howCloseBtn").addEventListener("click", () => {
    $("howScreen").classList.add("hidden");
    if (!game) $("titleScreen").classList.remove("hidden");
  });
  $("newBtn").addEventListener("click", () => { newGame(); $("titleScreen").classList.add("hidden"); });
  $("soundBtn").addEventListener("click", (e) => {
    soundOn = !soundOn;
    e.target.textContent = soundOn ? "Sound: On" : "Sound: Off";
    if (soundOn) sfx.play();
  });
  $("endTurnBtn").addEventListener("click", endPlayerTurn);
  $("winAgainBtn").addEventListener("click", () => newGame());
  $("lossAgainBtn").addEventListener("click", () => newGame());

  document.addEventListener("keydown", (e) => {
    if (!$("titleScreen").classList.contains("hidden") || !$("howScreen").classList.contains("hidden")) {
      if (e.key === "Enter" && !$("titleScreen").classList.contains("hidden")) $("playBtn").click();
      return;
    }
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); endPlayerTurn(); return; }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 7) playPlayerCard(n - 1);
  });

  // Boot: fresh table behind the title screen; debug states skip the title.
  newGame(20261122);
  $("titleScreen").classList.remove("hidden");
  if (new URLSearchParams(location.search).get("state")) {
    $("titleScreen").classList.add("hidden");
    applyDebugState();
  }
})();
