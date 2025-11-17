/* Gensyn Road Racer — PRO upgrade
   - Neon animated start screen
   - Smarter AI opponents
   - Nitro flames visual
   - Leaderboard (localStorage, top 5)
   Keep your images in repo root:
     gensyn-car.jpg, singularitynet-car.jpg, fetchai-car.jpg, bittensor-car.jpg
*/

// Canvas + context
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Logical resolution
let W = canvas.width;
let H = canvas.height;

// UI refs
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

const LB_KEY = 'gensyn_racer_leaderboard_v1';

// Images
const assets = {};
const tryImgs = {
  player: 'gensyn-car.jpg',
  op1: 'singularitynet-car.jpg',
  op2: 'fetchai-car.jpg',
  op3: 'bittensor-car.jpg'
};
Object.keys(tryImgs).forEach(k=>{
  const img = new Image();
  img.src = tryImgs[k];
  img.onload = ()=> assets[k] = img;
  img.onerror = ()=> { /* ok fallback */ }
});

// lanes positions
function computeLanes() {
  return [ W*0.18, W*0.5, W*0.82 ];
}
let lanes = computeLanes();

// player base
const player = {
  lane:1, x:0, y:0,
  baseW:160, baseH:260,
  w:160, h:260,
  alive:true
};

// opponents
let opponents = [];

// game state
let game = {
  running:false,
  score:0,
  baseSpeed:3.0,
  speedMultiplier:1.0,
  spawnTimer:0,
  lastTS:0,
  nitroTimer:0
};

// input & touch
let touchState = {startX:0, startY:0, startTime:0, active:false};
const keys = {left:false,right:false,up:false,down:false,space:false};

// leaderboard helpers
function readLeaderboard(){
  try{
    const raw = localStorage.getItem(LB_KEY);
    if(!raw) return [];
    return JSON.parse(raw);
  }catch(e){ return []; }
}
function saveLeaderboard(arr){
  localStorage.setItem(LB_KEY, JSON.stringify(arr.slice(0,10)));
}
function addScoreToLB(name, score){
  const lb = readLeaderboard();
  lb.push({name: name || 'anon', score: Number(score), ts: Date.now()});
  lb.sort((a,b)=> b.score - a.score || a.ts - b.ts);
  saveLeaderboard(lb.slice(0,10));
}
function renderLB(){
  const lb = readLeaderboard().slice(0,5);
  lbList.innerHTML = lb.length ? lb.map(x=>`<li><strong>${x.name}</strong> — ${x.score}</li>`).join('') : '<li>No scores yet</li>';
}

// reset / start
function resetGame(){
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
function startGame(){
  overlay.style.display = 'none';
  game.running = true;
  game.lastTS = performance.now();
  game.spawnTimer = 0;
  opponents = [];
  game.score = 0;
  player.lane = 1;
  player.alive = true;
  requestAnimationFrame(loop);
}

// resize handling
function fitCanvas(){
  const maxWidth = Math.min(window.innerWidth - 32, 720);
  canvas.style.width = maxWidth + 'px';
  lanes = computeLanes();
  player.x = lanes[player.lane];
  player.y = H - 220;
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

// keyboard
window.addEventListener('keydown', e=>{
  if(e.key === 'ArrowLeft' || e.key === 'a'){ keys.left = true; e.preventDefault(); }
  if(e.key === 'ArrowRight' || e.key === 'd'){ keys.right = true; e.preventDefault(); }
  if(e.key === 'ArrowUp'){ keys.up = true; e.preventDefault(); }
  if(e.key === 'ArrowDown'){ keys.down = true; e.preventDefault(); }
  if(e.code === 'Space'){ keys.space = true; e.preventDefault(); }
  if(e.key === 'Escape'){ if(game.running){ game.running=false; overlayTitle.textContent='Paused'; overlayText.textContent='Game paused — press Start to resume.'; overlay.style.display='flex'; } }
});
window.addEventListener('keyup', e=>{
  if(e.key === 'ArrowLeft' || e.key === 'a'){ keys.left = false; }
  if(e.key === 'ArrowRight' || e.key === 'd'){ keys.right = false; }
  if(e.key === 'ArrowUp'){ keys.up = false; }
  if(e.key === 'ArrowDown'){ keys.down = false; }
  if(e.code === 'Space'){ keys.space = false; }
});

// tap/click
canvas.addEventListener('mousedown', (ev)=>{
  const rect = canvas.getBoundingClientRect();
  const cx = ev.clientX - rect.left;
  handleTap(cx, rect.width);
});

// touchstart/move/end
canvas.addEventListener('touchstart', (ev) => {
  if(ev.touches.length > 1) return;
  const t = ev.touches[0];
  const rect = canvas.getBoundingClientRect();
  touchState.startX = t.clientX - rect.left;
  touchState.startY = t.clientY - rect.top;
  touchState.startTime = performance.now();
  touchState.active = true;
});
canvas.addEventListener('touchmove', (ev)=>{
  if(touchState.active) ev.preventDefault();
}, {passive:false});
canvas.addEventListener('touchend', (ev)=>{
  if(!touchState.active) return;
  const rect = canvas.getBoundingClientRect();
  const t = (ev.changedTouches && ev.changedTouches[0]) || {};
  const endX = t.clientX ? (t.clientX - rect.left) : touchState.startX;
  const endY = t.clientY ? (t.clientY - rect.top) : touchState.startY;
  const dx = endX - touchState.startX;
  const dy = endY - touchState.startY;
  const dt = performance.now() - touchState.startTime;
  const minSwipe = 40;
  if(Math.abs(dy) > minSwipe && Math.abs(dy) > Math.abs(dx)){
    if(dy < 0) applyNitro();
    else applyBrake();
  } else {
    handleTap(touchState.startX, rect.width);
  }
  touchState.active = false;
}, {passive:false});

function handleTap(x, width){
  if(x < width/2) moveLeft(); else moveRight();
}

function moveLeft(){ if(player.lane > 0){ player.lane--; player.x = lanes[player.lane]; } }
function moveRight(){ if(player.lane < 2){ player.lane++; player.x = lanes[player.lane]; } }

// nitro / brake
function applyNitro(){ game.nitroTimer = 900; } // ms
function applyBrake(){ game.speedMultiplier = Math.max(0.6, game.speedMultiplier - 0.25); }

// spawn smarter opponents
function spawnOpponent(){
  const types = ['op1','op2','op3'];
  const t = types[Math.floor(Math.random()*types.length)];
  const lane = Math.floor(Math.random()*3);
  const z = 2000 + Math.random()*1400;
  const speed = 0.9 + Math.random()*0.9;
  // aggressiveness factor (higher -> tries to overtake/player-block more)
  const aggr = Math.random()*1.2;
  opponents.push({type:t, lane, z, speed, overtaken:false, aggr});
}

// world projection
function projectZtoY(z){
  const farZ = 3600;
  const t = Math.max(0, Math.min(1, z / farZ));
  const y = (H - 220) - t * (H - 380);
  const scale = 0.6 + (1 - t) * 1.6;
  return {y, scale, t};
}

function rectsOverlap(a,b){
  return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
}

// smarter AI behavior function
function opponentAIUpdate(o, dt){
  // If opponent far away, it can choose a lane to target: sometimes aim to player's lane
  const distanceToPlayer = o.z;
  // If aggressive and fairly close, try to move to player's lane to overtake/block
  if(o.aggr > 0.9 && distanceToPlayer < 1400 && Math.random() < 0.015){
    // choose lane near player (maybe same or adjacent)
    const prefer = player.lane + (Math.random() < 0.6 ? 0 : (Math.random() < 0.5 ? -1 : 1));
    const newLane = Math.max(0, Math.min(2, prefer));
    o.lane = newLane;
  } else {
    // occasional random lane jitter
    if(Math.random() < 0.008) {
      o.lane = Math.floor(Math.random()*3);
    }
  }
  // adapt speed: if behind player (larger z) try to speed up; if too close reduce to attempt lane change
  if(o.z > 900){
    o.z -= (o.speed * 1.6 + (game.speedMultiplier-1)*1.2) * (dt/16);
  } else {
    // close-range behavior: try to sync lane movement to either block or be overtaken
    if(o.lane === player.lane && o.z < 600){
      // if same lane and close, adjust to attempt slight acceleration or jitter to cause challenge
      o.z -= (o.speed * 2.2 + (0.6 + o.aggr)) * (dt/16);
    } else {
      // normal approach
      o.z -= (o.speed * 1.8 + (game.speedMultiplier-1) ) * (dt/16);
    }
  }
}

// draw helpers
let roadScroll = 0;
function drawScene(nitroBoost){
  ctx.clearRect(0,0,W,H);
  drawBackground();
  drawRoad();
  // opponents sorted far->near
  const sorted = [...opponents].sort((a,b)=> b.z - a.z);
  for(const o of sorted) drawOpponent(o);
  drawPlayer(nitroBoost);
  drawHUD();
}

function drawBackground(){
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0, '#071020');
  g.addColorStop(1, '#02030a');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,W,H);

  roadScroll += 1 + game.speedMultiplier*0.2;
  for(let i=0;i<4;i++){
    const amp = 40 + i*18;
    const yBase = 140 + i*40;
    ctx.fillStyle = `rgba(255,46,134,${0.02 + i*0.01})`;
    ctx.beginPath();
    ctx.moveTo(0,H);
    for(let x=0;x<=W;x+=10){
      const y = yBase + Math.sin((x/140) + roadScroll/220 + i)*amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W,H);
    ctx.closePath();
    ctx.fill();
  }
}

function drawRoad(){
  // subtle vignette road
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fillRect(0,0,W,H);
  // dashed center
  const centerX = W/2;
  const dashH = 28;
  const gap = 26;
  const offset = (performance.now()/7) % (dashH + gap);
  for(let y = -200; y < H + 200; y += dashH + gap){
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    // perspective scaling of dash width
    const yy = y + offset;
    ctx.fillRect(centerX-6, yy, 12, dashH);
  }
  // lane separators subtle
  ctx.strokeStyle = 'rgba(255,46,134,0.02)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W*0.33,0); ctx.lineTo(W*0.33,H);
  ctx.moveTo(W*0.66,0); ctx.lineTo(W*0.66,H);
  ctx.stroke();
}

function drawOpponent(o){
  const proj = projectZtoY(o.z);
  const laneX = lanes[o.lane];
  const scale = proj.scale;
  const w = Math.round(player.baseW * scale * 0.6);
  const h = Math.round(player.baseH * scale * 0.6);
  const x = laneX - w/2;
  const y = proj.y - h/2;

  // image fallback
  const img = assets[o.type];
  if(img){
    ctx.drawImage(img, x, y, w, h);
  } else {
    ctx.save();
    ctx.fillStyle = 'rgba(120,140,255,0.95)';
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.restore();
  }

  // logo label (tiny)
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `${Math.max(10, Math.round(12*scale))}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(o.type.toUpperCase(), laneX, y + h*0.82);
  ctx.restore();
}

function drawPlayer(nitroBoost){
  const laneX = lanes[player.lane];
  const scale = 1.0;
  player.w = Math.round(player.baseW * scale * 0.9);
  player.h = Math.round(player.baseH * scale * 0.9);
  player.x = laneX;
  player.y = H - 220;
  const x = player.x - player.w/2;
  const y = player.y - player.h/2;

  // nitro flames behind player
  if(game.nitroTimer > 0){
    drawNitroFlame(player.x, player.y + player.h*0.28, player.w*0.5, game.nitroTimer);
  }

  const img = assets.player;
  if(img){
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

  if(!img){
    ctx.save();
    ctx.fillStyle = '#ff2fa6';
    ctx.font = '700 18px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GENSYN', player.x, player.y + player.h*0.55);
    ctx.restore();
  }
}

function drawNitroFlame(cx, cy, width, remainingMs){
  // flame composed of layered bezier shapes, color gradient magenta->pink->orangeish
  const t = Math.max(0, Math.min(1, remainingMs / 900));
  const length = 40 + Math.round(80 * t);
  for(let i=0;i<3;i++){
    const alpha = 0.12 * (1 - i*0.25);
    ctx.fillStyle = `rgba(255,${80 + i*60},${160 - i*20},${alpha})`;
    ctx.beginPath();
    const w = width * (1 - i*0.18);
    ctx.ellipse(cx, cy + (i*6) + length/6, w, length*(0.5 - i*0.12), 0, 0, Math.PI*2);
    ctx.fill();
  }
  // animated particles
  const count = 8;
  for(let p=0;p<count;p++){
    const rx = (Math.sin(performance.now()/150 + p) * (width*0.5)) * (0.6 + Math.random()*0.4);
    const ry = Math.random()*length + 6;
    ctx.fillStyle = `rgba(255,${160 + (p%3)*20},${200 - p*8},${0.08})`;
    ctx.fillRect(cx + rx - 2, cy + ry, 3, 3);
  }
}

function drawHUD(){
  // optional HUD elements (score handled via DOM)
}

// roundRect helper
function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

// spawn & update loop
function loop(ts){
  if(!game.running) return;
  const dt = Math.min(40, ts - game.lastTS);
  game.lastTS = ts;

  // inputs: discrete lane moves on key press
  if(keys.left){ moveLeft(); keys.left = false; }
  if(keys.right){ moveRight(); keys.right = false; }
  if(keys.up){ game.speedMultiplier = Math.min(3.0, game.speedMultiplier + 0.08); keys.up=false; }
  if(keys.down){ applyBrake(); keys.down=false; }
  if(keys.space){ applyBrake(); keys.space=false; }

  // nitro timer
  let nitroBoost = 1.0;
  if(game.nitroTimer > 0){ game.nitroTimer -= dt; nitroBoost = 1.6; }
  else game.nitroTimer = 0;

  // gradually restore speed multiplier
  if(game.speedMultiplier > 1.0) game.speedMultiplier = Math.max(1.0, game.speedMultiplier - 0.0008 * dt);

  // spawn opponents more as score increases
  game.spawnTimer += dt * (0.8 + game.score * 0.002);
  if(game.spawnTimer > 850){
    game.spawnTimer = 0;
    spawnOpponent();
    if(Math.random() < 0.36) spawnOpponent();
  }

  // update opponents with smarter AI
  for(let i=opponents.length-1;i>=0;i--){
    const o = opponents[i];
    opponentAIUpdate(o, dt);
    // make sure z decreases based on o.speed and global speed and nitro
    // (the AI update already reduces z in parts; ensure minimum decrease)
    if(o.z > -100){
      o.z -= (game.baseSpeed * 0.9 + (game.speedMultiplier - 1)*1.6) * (dt/16);
    }
    // scoring: mark overtaken when z crosses small threshold and in different lane -> player successfully dodged
    if(!o.overtaken && o.z < 60){
      if(o.lane !== player.lane){
        o.overtaken = true;
        game.score += 25;
      }
    }
    if(o.z < -360) opponents.splice(i,1);
  }

  // draw
  drawScene(nitroBoost);

  // collisions check with precise projected rectangles if near
  for(const o of opponents){
    const proj = projectZtoY(o.z);
    const laneX = lanes[o.lane];
    const scale = proj.scale;
    const w = Math.round(player.baseW * scale * 0.6);
    const h = Math.round(player.baseH * scale * 0.6);
    const x = laneX - w/2;
    const y = proj.y - h/2;
    if(o.z < 420 && o.lane === player.lane){
      const opRect = {x,y,w,h};
      const playerRect = {x: player.x - player.w/2, y: player.y - player.h/2, w: player.w, h: player.h};
      if(rectsOverlap(playerRect, opRect)){
        // game over
        game.running = false;
        player.alive = false;
        overlayTitle.textContent = 'Game Over';
        overlayText.textContent = `Score: ${game.score} — save your score below`;
        overlay.style.display = 'flex';
        // show save controls
        saveScoreRow.style.display = 'flex';
        playerNameInput.value = '';
      }
    }
  }

  updateUI();
  if(game.running) requestAnimationFrame(loop);
}

// UI updates
function updateUI(){
  scoreEl.textContent = `Score: ${game.score}`;
  speedEl.textContent = `Speed: ${game.speedMultiplier.toFixed(2)}x`;
}

// wire buttons
startBtn.addEventListener('click', ()=> { saveScoreRow.style.display='none'; startGame(); });
resetBtn.addEventListener('click', ()=> { location.reload(); });
viewLBBtn.addEventListener('click', ()=> { renderLB(); });

// save score handling
saveScoreBtn && saveScoreBtn.addEventListener('click', ()=>{
  const name = playerNameInput.value.trim().slice(0,12) || 'anon';
  addScoreToLB(name, game.score);
  saveScoreRow.style.display = 'none';
  renderLB();
});

// initial renderLB
renderLB();

// init
resetGame();

/* NOTES:
 - Tweak AI aggressiveness by changing spawnOpponent aggr or opponentAIUpdate chance values.
 - Tweak scoring and spawn rates near top variables.
 - Add power-ups by creating items with z and checking collisions; on collision apply effect.
*/
