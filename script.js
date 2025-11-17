/**
 * Gensyn Road Racer — Expanded & Commented Version (with overlay fail-safe)
 * Expects assets in /assets/
 *
 * Files required in /assets/:
 *   assets/gensyn-car.jpg
 *   assets/singularitynet-car.jpg
 *   assets/fetchai-car.jpg
 *   assets/bittensor-car.jpg
 *   assets/bg-music.mp3
 *   assets/sfx-start.mp3
 *   assets/sfx-nitro.mp3
 *   assets/sfx-crash.mp3
 *   assets/sfx-overtake.mp3
 *
 * Author: Ahsan (project)
 */

/* ======================================================================
   Canvas + DOM references
   ====================================================================== */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let W = canvas.width; // logical canvas width used in calculations
let H = canvas.height; // logical canvas height used in calculations

// UI elements
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlayText = document.getElementById('overlayText');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const viewLBBtn = document.getElementById('viewLBBtn');
const lbList = document.getElementById('lbList');
const saveScoreRow = document.getElementById('saveScoreRow');
const saveScoreBtn = document.getElementById('saveScoreBtn');
const playerNameInput = document.getElementById('playerName');
const scoreEl = document.getElementById('score');
const speedEl = document.getElementById('speed');
const muteBtn = document.getElementById('muteBtn');

const LB_KEY = 'gensyn_racer_leaderboard_v1'; // localStorage key for leaderboard

/* ======================================================================
   AUDIO: files in /assets/  (update paths here if you change folder)
   ====================================================================== */
const AUDIO_FILES = {
  bg: 'assets/bg-music.mp3',
  start: 'assets/sfx-start.mp3',
  nitro: 'assets/sfx-nitro.mp3',
  crash: 'assets/sfx-crash.mp3',
  overtake: 'assets/sfx-overtake.mp3'
};

// audio objects container
const audio = { bg: null, start: null, nitro: null, crash: null, overtake: null };

// audio enabled flag persisted in localStorage ("1" means enabled)
let audioEnabled = (localStorage.getItem('gensyn_audio_enabled') === '1');

/**
 * initAudio()
 * Preloads audio objects. If files are missing browser will show console warnings.
 */
function initAudio() {
  try {
    audio.bg = new Audio(AUDIO_FILES.bg);
    audio.bg.loop = true;
    audio.bg.volume = 0.32;

    audio.start = new Audio(AUDIO_FILES.start); audio.start.volume = 0.9;
    audio.nitro = new Audio(AUDIO_FILES.nitro); audio.nitro.volume = 0.8;
    audio.crash = new Audio(AUDIO_FILES.crash); audio.crash.volume = 0.95;
    audio.overtake = new Audio(AUDIO_FILES.overtake); audio.overtake.volume = 0.9;
  } catch (e) {
    console.warn('Audio init failed:', e);
  }
}
initAudio();

/**
 * playSound(name)
 * Plays a named sound if audioEnabled. For non-loop SFX we clone nodes so overlapping plays are possible.
 */
function playSound(name) {
  if (!audioEnabled) return;
  const a = audio[name];
  if (!a) return;
  try {
    if (name !== 'bg') {
      // clone short SFX nodes for overlap
      const node = a.cloneNode();
      node.volume = a.volume;
      node.play().catch(() => { /* autoplay blocked until user gesture */ });
      return node;
    } else {
      // background music play (looped)
      a.play().catch(() => { /* autoplay blocked until user gesture */ });
    }
  } catch (e) {
    // ignore
  }
}

/**
 * setMuteUI() - updates mute button state and persists setting
 */
function setMuteUI() {
  if (!muteBtn) return;
  if (!audioEnabled) {
    muteBtn.classList.add('muted');
    muteBtn.textContent = '🔇';
  } else {
    muteBtn.classList.remove('muted');
    muteBtn.textContent = '🔊';
  }
  localStorage.setItem('gensyn_audio_enabled', audioEnabled ? '1' : '0');
}

// toggle mute when user clicks the button
muteBtn && muteBtn.addEventListener('click', () => {
  audioEnabled = !audioEnabled;
  if (!audioEnabled) {
    // stop background music immediately
    if (audio.bg && !audio.bg.paused) { audio.bg.pause(); audio.bg.currentTime = 0; }
  } else {
    try { audio.bg && audio.bg.play().catch(() => {}); } catch (e) { }
  }
  setMuteUI();
});
setMuteUI();

/* ======================================================================
   IMAGE ASSETS (load from assets/ folder)
   ====================================================================== */
const assets = {};
const tryImgs = {
  player: 'assets/gensyn-car.jpg',
  op1: 'assets/singularitynet-car.jpg',
  op2: 'assets/fetchai-car.jpg',
  op3: 'assets/bittensor-car.jpg'
};

Object.keys(tryImgs).forEach(key => {
  const img = new Image();
  img.src = tryImgs[key];
  img.onload = () => { assets[key] = img; };
  img.onerror = () => { /* fallback is rectangle drawing */ };
});

/* ======================================================================
   GAME WORLD: lanes, player, opponents, state
   ====================================================================== */

/**
 * computeLanes()
 * Lanes are placed across the screen width. Use same function on resize.
 */
function computeLanes() {
  return [ W * 0.18, W * 0.5, W * 0.82 ];
}
let lanes = computeLanes();

// player parameters
const player = {
  lane: 1,             // 0..2
  x: 0, y: 0,          // computed positions
  baseW: 160, baseH: 260,
  w: 160, h: 260,
  alive: true
};

// opponents list: each has { type, lane, z, speed, overtaken, aggr }
let opponents = [];

// game controlling variables
let game = {
  running: false,
  score: 0,
  baseSpeed: 3.0,
  speedMultiplier: 1.0,
  spawnTimer: 0,
  lastTS: 0,
  nitroTimer: 0
};

/* ======================================================================
   INPUT HANDLING: keyboard + mouse + touch (screen-split & swipe)
   ====================================================================== */
const keys = { left: false, right: false, up: false, down: false, space: false };

window.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft' || e.key === 'a') { keys.left = true; e.preventDefault(); }
  if (e.key === 'ArrowRight' || e.key === 'd') { keys.right = true; e.preventDefault(); }
  if (e.key === 'ArrowUp') { keys.up = true; e.preventDefault(); }
  if (e.key === 'ArrowDown') { keys.down = true; e.preventDefault(); }
  if (e.code === 'Space') { keys.space = true; e.preventDefault(); }
  if (e.key === 'Escape') {
    if (game.running) {
      game.running = false;
      overlayTitle.textContent = 'Paused';
      overlayText.textContent = 'Game paused — press Start to resume.';
      overlay.style.display = 'flex';
      if (audio.bg) audio.bg.pause();
    }
  }
});

window.addEventListener('keyup', e => {
  if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = false;
  if (e.key === 'ArrowRight' || e.key === 'd') keys.right = false;
  if (e.key === 'ArrowUp') keys.up = false;
  if (e.key === 'ArrowDown') keys.down = false;
  if (e.code === 'Space') keys.space = false;
});

// desktop click acts like a tap (left/right split)
canvas.addEventListener('mousedown', ev => {
  const rect = canvas.getBoundingClientRect();
  const cx = ev.clientX - rect.left;
  handleTap(cx, rect.width);
});

// touch handling for mobile: detect taps vs vertical swipes
let touchState = { startX: 0, startY: 0, startTime: 0, active: false };

canvas.addEventListener('touchstart', ev => {
  if (ev.touches.length > 1) return;
  const t = ev.touches[0];
  const rect = canvas.getBoundingClientRect();
  touchState.startX = t.clientX - rect.left;
  touchState.startY = t.clientY - rect.top;
  touchState.startTime = performance.now();
  touchState.active = true;
});

canvas.addEventListener('touchmove', ev => {
  if (touchState.active) ev.preventDefault();
}, { passive: false });

canvas.addEventListener('touchend', ev => {
  if (!touchState.active) return;
  const rect = canvas.getBoundingClientRect();
  const t = (ev.changedTouches && ev.changedTouches[0]) || {};
  const endX = t.clientX ? (t.clientX - rect.left) : touchState.startX;
  const endY = t.clientY ? (t.clientY - rect.top) : touchState.startY;
  const dx = endX - touchState.startX;
  const dy = endY - touchState.startY;
  const dt = performance.now() - touchState.startTime;
  const minSwipe = 40; // px threshold for swipe detection

  if (Math.abs(dy) > minSwipe && Math.abs(dy) > Math.abs(dx)) {
    // vertical swipe
    if (dy < 0) applyNitro();     // swipe up -> nitro
    else applyBrake();             // swipe down -> brake
  } else {
    // treat as tap left/right
    handleTap(touchState.startX, rect.width);
  }
  touchState.active = false;
}, { passive: false });

/* helper: handleTap(x, width)
   If tap/x < width/2 -> left, else right.
*/
function handleTap(x, width) {
  if (x < width / 2) moveLeft();
  else moveRight();
}

function moveLeft() { if (player.lane > 0) { player.lane--; player.x = lanes[player.lane]; } }
function moveRight() { if (player.lane < 2) { player.lane++; player.x = lanes[player.lane]; } }

/* nitro & brake */
function applyNitro() {
  // nitro lasts ~900ms
  game.nitroTimer = 900;
  playSound('nitro');
}
function applyBrake() {
  game.speedMultiplier = Math.max(0.6, game.speedMultiplier - 0.25);
}

/* ======================================================================
   OPPONENT SPAWN & AI
   ====================================================================== */

/**
 * spawnOpponent()
 * Creates a new opponent with random lane, speed and aggressiveness.
 */
function spawnOpponent() {
  const types = ['op1', 'op2', 'op3'];
  const type = types[Math.floor(Math.random() * types.length)];
  const lane = Math.floor(Math.random() * 3);
  const z = 2000 + Math.random() * 1400; // distance in "z" units (far to near)
  const speed = 0.9 + Math.random() * 0.9;
  const aggr = Math.random() * 1.2; // aggressiveness factor
  opponents.push({ type, lane, z, speed, overtaken: false, aggr });
}

/**
 * opponentAIUpdate(o, dt)
 * Adjusts lane and z based on aggression and proximity to player.
 */
function opponentAIUpdate(o, dt) {
  const distanceToPlayer = o.z;

  // aggressive opponents occasionally target the player's lane to block/overtake
  if (o.aggr > 0.9 && distanceToPlayer < 1400 && Math.random() < 0.015) {
    const prefer = player.lane + (Math.random() < 0.6 ? 0 : (Math.random() < 0.5 ? -1 : 1));
    o.lane = Math.max(0, Math.min(2, prefer));
  } else {
    // random lane jitter
    if (Math.random() < 0.008) o.lane = Math.floor(Math.random() * 3);
  }

  // z reduction (approach player) depends on speed, game speed and closeness
  if (o.z > 900) {
    o.z -= (o.speed * 1.6 + (game.speedMultiplier - 1) * 1.2) * (dt / 16);
  } else {
    if (o.lane === player.lane && o.z < 600) {
      // when close and in same lane, more dynamic behavior (slight acceleration)
      o.z -= (o.speed * 2.2 + (0.6 + o.aggr)) * (dt / 16);
    } else {
      o.z -= (o.speed * 1.8 + (game.speedMultiplier - 1)) * (dt / 16);
    }
  }
}

/* ======================================================================
   Projection & collision helpers
   ====================================================================== */

/**
 * projectZtoY(z) -> { y, scale, t }
 * Convert a world 'z' distance into screen Y and scale factor for pseudo-3D effect.
 */
function projectZtoY(z) {
  const farZ = 3600;
  const t = Math.max(0, Math.min(1, z / farZ)); // normalized 0..1
  const y = (H - 220) - t * (H - 380);
  const scale = 0.6 + (1 - t) * 1.6;
  return { y, scale, t };
}

/**
 * rectsOverlap(a,b) -> boolean
 * Axis-aligned bounding box overlap check
 */
function rectsOverlap(a, b) {
  return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
}

/* ======================================================================
   RENDERING: background, road, cars, nitro
   ====================================================================== */

/**
 * drawScene(nitroBoost)
 * Main drawing function called each frame.
 */
let roadScroll = 0;
function drawScene(nitroBoost) {
  ctx.clearRect(0, 0, W, H);

  drawBackground();
  drawRoad();

  // draw opponents from far to near
  const sortedOpp = [...opponents].sort((a, b) => b.z - a.z);
  for (const opp of sortedOpp) drawOpponent(opp);

  // draw player as last (on top)
  drawPlayer(nitroBoost);

  // HUD handled via DOM; keep canvas focused on visuals
  drawHUD();
}

/**
 * drawBackground()
 * Simple gradient + wavy parallax hills; gives neon vibe.
 */
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#071020');
  g.addColorStop(1, '#02030a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  roadScroll += 1 + game.speedMultiplier * 0.2;

  for (let i = 0; i < 4; i++) {
    const amp = 40 + i * 18;
    const yBase = 140 + i * 40;
    ctx.fillStyle = `rgba(255,46,134,${0.02 + i * 0.01})`;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 10) {
      const y = yBase + Math.sin((x / 140) + roadScroll / 220 + i) * amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * drawRoad()
 * Draws dashed center line and subtle lane separators.
 */
function drawRoad() {
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fillRect(0, 0, W, H);

  const centerX = W / 2;
  const dashH = 28;
  const gap = 26;
  const offset = (performance.now() / 7) % (dashH + gap);

  for (let y = -200; y < H + 200; y += dashH + gap) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    const yy = y + offset;
    ctx.fillRect(centerX - 6, yy, 12, dashH);
  }

  // lane separators (very subtle)
  ctx.strokeStyle = 'rgba(255,46,134,0.02)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W * 0.33, 0); ctx.lineTo(W * 0.33, H);
  ctx.moveTo(W * 0.66, 0); ctx.lineTo(W * 0.66, H);
  ctx.stroke();
}

/**
 * drawOpponent(o)
 * Projects opponent's z into screen space and draws image (or fallback rect).
 */
function drawOpponent(o) {
  const proj = projectZtoY(o.z);
  const laneX = lanes[o.lane];
  const scale = proj.scale;

  const w = Math.round(player.baseW * scale * 0.6);
  const h = Math.round(player.baseH * scale * 0.6);
  const x = laneX - w / 2;
  const y = proj.y - h / 2;

  const img = assets[o.type];
  if (img) {
    ctx.drawImage(img, x, y, w, h);
  } else {
    ctx.save();
    ctx.fillStyle = 'rgba(120,140,255,0.95)';
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.restore();
  }

  // tiny label text (for debugging/identification)
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `${Math.max(10, Math.round(12 * scale))}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(o.type.toUpperCase(), laneX, y + h * 0.82);
  ctx.restore();
}

/**
 * drawPlayer(nitroBoost)
 * Draw the player car and nitro flame when active.
 */
function drawPlayer(nitroBoost) {
  const laneX = lanes[player.lane];
  const scale = 1.0;
  player.w = Math.round(player.baseW * scale * 0.9);
  player.h = Math.round(player.baseH * scale * 0.9);
  player.x = laneX;
  player.y = H - 220;

  const x = player.x - player.w / 2;
  const y = player.y - player.h / 2;

  if (game.nitroTimer > 0) {
    drawNitroFlame(player.x, player.y + player.h * 0.28, player.w * 0.5, game.nitroTimer);
  }

  const img = assets.player;
  if (img) {
    ctx.drawImage(img, x, y, player.w, player.h);
  } else {
    ctx.save();
    ctx.fillStyle = 'rgba(20,20,20,0.98)';
    roundRect(ctx, x, y, player.w, player.h, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,46,134,0.08)';
    ctx.stroke();
    ctx.restore();
  }

  // fallback label
  if (!img) {
    ctx.save();
    ctx.fillStyle = '#ff2fa6';
    ctx.font = '700 18px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GENSYN', player.x, player.y + player.h * 0.55);
    ctx.restore();
  }
}

/**
 * drawNitroFlame(cx, cy, width, remainingMs)
 * Draws layered ellipses + particles to simulate a neon nitro effect.
 */
function drawNitroFlame(cx, cy, width, remainingMs) {
  const t = Math.max(0, Math.min(1, remainingMs / 900));
  const length = 40 + Math.round(80 * t);

  for (let i = 0; i < 3; i++) {
    const alpha = 0.12 * (1 - i * 0.25);
    ctx.fillStyle = `rgba(255,${80 + i * 60},${160 - i * 20},${alpha})`;
    ctx.beginPath();
    const w = width * (1 - i * 0.18);
    ctx.ellipse(cx, cy + (i * 6) + length / 6, w, length * (0.5 - i * 0.12), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // small animated particles
  const count = 8;
  for (let p = 0; p < count; p++) {
    const rx = (Math.sin(performance.now() / 150 + p) * (width * 0.5)) * (0.6 + Math.random() * 0.4);
    const ry = Math.random() * length + 6;
    ctx.fillStyle = `rgba(255,${160 + (p % 3) * 20},${200 - p * 8},${0.08})`;
    ctx.fillRect(cx + rx - 2, cy + ry, 3, 3);
  }
}

/* roundRect() helper (used to draw fallback rectangles) */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ======================================================================
   GAME LOOP: update, spawn, collision, scoring
   ====================================================================== */

/**
 * loop(ts)
 * Main game update loop driven by requestAnimationFrame.
 */
function loop(ts) {
  if (!game.running) return;

  // clamp dt for stable simulation
  const dt = Math.min(40, ts - game.lastTS);
  game.lastTS = ts;

  // handle discrete keyboard moves (left/right triggers)
  if (keys.left) { moveLeft(); keys.left = false; }
  if (keys.right) { moveRight(); keys.right = false; }
  if (keys.up) { game.speedMultiplier = Math.min(3.0, game.speedMultiplier + 0.08); keys.up = false; }
  if (keys.down) { applyBrake(); keys.down = false; }
  if (keys.space) { applyBrake(); keys.space = false; }

  // nitro timer handling
  let nitroBoost = 1.0;
  if (game.nitroTimer > 0) {
    game.nitroTimer -= dt;
    nitroBoost = 1.6;
  } else {
    game.nitroTimer = 0;
  }

  // slowly restore speed multiplier toward 1.0
  if (game.speedMultiplier > 1.0) {
    game.speedMultiplier = Math.max(1.0, game.speedMultiplier - 0.0008 * dt);
  }

  // spawn opponents with increasing frequency as score increases
  game.spawnTimer += dt * (0.8 + game.score * 0.002);
  if (game.spawnTimer > 850) {
    game.spawnTimer = 0;
    spawnOpponent();
    if (Math.random() < 0.36) spawnOpponent();
  }

  // update opponents with smarter AI and z motion
  for (let i = opponents.length - 1; i >= 0; i--) {
    const o = opponents[i];
    opponentAIUpdate(o, dt);

    // safety z reduction if AI didn't move it
    if (o.z > -100) {
      o.z -= (game.baseSpeed * 0.9 + (game.speedMultiplier - 1) * 1.6) * (dt / 16);
    }

    // scoring: mark as overtaken when it passes near if lanes differ
    if (!o.overtaken && o.z < 60) {
      if (o.lane !== player.lane) {
        o.overtaken = true;
        game.score += 25;
        playSound('overtake');
      }
    }

    // remove passed opponents far behind
    if (o.z < -360) opponents.splice(i, 1);
  }

  // draw everything
  drawScene(nitroBoost);

  // collision check for near opponents (projected bounding boxes)
  for (const o of opponents) {
    const proj = projectZtoY(o.z);
    const laneX = lanes[o.lane];
    const scale = proj.scale;
    const w = Math.round(player.baseW * scale * 0.6);
    const h = Math.round(player.baseH * scale * 0.6);
    const x = laneX - w / 2;
    const y = proj.y - h / 2;

    if (o.z < 420 && o.lane === player.lane) {
      const opRect = { x, y, w, h };
      const playerRect = { x: player.x - player.w / 2, y: player.y - player.h / 2, w: player.w, h: player.h };
      if (rectsOverlap(playerRect, opRect)) {
        // collision -> game over
        game.running = false;
        player.alive = false;
        overlayTitle.textContent = 'Game Over';
        overlayText.textContent = `Score: ${game.score} — save your score below`;
        overlay.style.display = 'flex';
        saveScoreRow.style.display = 'flex';
        playerNameInput.value = '';
        playSound('crash');
        if (audio.bg) audio.bg.pause();
      }
    }
  }

  updateUI();

  if (game.running) requestAnimationFrame(loop);
}

/* ======================================================================
   UI helpers: leaderboard, start/reset, updateUI
   ====================================================================== */

function updateUI() {
  scoreEl.textContent = `Score: ${game.score}`;
  speedEl.textContent = `Speed: ${game.speedMultiplier.toFixed(2)}x`;
}

/* Leaderboard functions (localStorage) */
function readLeaderboard() {
  try {
    const raw = localStorage.getItem(LB_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}
function saveLeaderboard(arr) {
  localStorage.setItem(LB_KEY, JSON.stringify(arr.slice(0, 10)));
}
function addScoreToLB(name, score) {
  const lb = readLeaderboard();
  lb.push({ name: name || 'anon', score: Number(score), ts: Date.now() });
  lb.sort((a, b) => b.score - a.score || a.ts - b.ts);
  saveLeaderboard(lb.slice(0, 10));
}
function renderLB() {
  const lb = readLeaderboard().slice(0, 5);
  lbList.innerHTML = lb.length ? lb.map(x => `<li><strong>${x.name}</strong> — ${x.score}</li>`).join('') : '<li>No scores yet</li>';
}

/* Start / reset game helpers */
function resetGame() {
  opponents = [];
  game.running = false;
  game.score = 0;
  game.speedMultiplier = 1.0;
  game.spawnTimer = 0;
  game.nitroTimer = 0;
  player.lane = 1;
  player.alive = true;
  overlayTitle.textContent = 'Gensyn Racer';
  overlayText.textContent = 'Tap left/right or use arrow keys. Swipe up = boost, swipe down = brake.';
  overlay.style.display = 'flex';
  saveScoreRow.style.display = 'none';
  renderLB();
  updateUI();
}

function startGame() {
  overlay.style.display = 'none';
  game.running = true;
  game.lastTS = performance.now();
  game.spawnTimer = 0;
  opponents = [];
  game.score = 0;
  player.lane = 1;
  player.alive = true;

  // start background audio after user gesture (Start button click)
  if (audioEnabled && audio.bg) {
    audio.bg.currentTime = 0;
    audio.bg.play().catch(() => { /* may be blocked without user gesture */ });
  }

  playSound('start');
  requestAnimationFrame(loop);
}

/* Wire up UI buttons */
startBtn.addEventListener('click', () => { saveScoreRow.style.display = 'none'; startGame(); });
resetBtn.addEventListener('click', () => { location.reload(); });
viewLBBtn.addEventListener('click', () => { renderLB(); });
saveScoreBtn && saveScoreBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim().slice(0, 12) || 'anon';
  addScoreToLB(name, game.score);
  saveScoreRow.style.display = 'none';
  renderLB();
});

/* ======================================================================
   Resize handling to keep responsive layout (CSS scales canvas visually)
   ====================================================================== */
function fitCanvas() {
  const maxWidth = Math.min(window.innerWidth - 32, 720);
  canvas.style.width = maxWidth + 'px'; // CSS scaling for responsiveness
  lanes = computeLanes();
  player.x = lanes[player.lane];
  player.y = H - 220;
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

/* ======================================================================
   QUICK FAIL-SAFE: overlay visible on load + Enter starts
   ====================================================================== */
window.addEventListener('load', () => {
  try {
    if (overlay) {
      overlay.style.display = 'flex';
      const panel = document.querySelector('.neon-panel');
      if (panel) panel.style.zIndex = 10001;
    }
    if (saveScoreRow) saveScoreRow.style.display = 'none';
  } catch (e) { /* ignore */ }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (overlay && overlay.style.display !== 'none') {
      const s = document.getElementById('startBtn');
      if (s) s.click();
    }
  }
});

/* ======================================================================
   Initialize: show overlay and leaderboard
   ====================================================================== */
renderLB();
resetGame();

/* End of script.js */
