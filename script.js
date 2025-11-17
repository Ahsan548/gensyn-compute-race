/* Gensyn Road Racer — pseudo-3D top approach with screen-split mobile controls
   Controls:
   - Keyboard: ArrowLeft / ArrowRight => lane change (instant)
               ArrowUp => small speed increase
               ArrowDown => small speed decrease / brake
               Space => big brake
               Esc => pause
   - Mobile: Tap left half => move left
             Tap right half => move right
             Swipe up => boost (short nitro)
             Swipe down => brake
*/

// Canvas + context
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Logical resolution (kept high so scaling works well)
let W = canvas.width;
let H = canvas.height;

// UI refs
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlayText = document.getElementById('overlayText');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const scoreEl = document.getElementById('score');
const speedEl = document.getElementById('speed');

// Images — use your provided filenames if present (falls back to rectangles)
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
  img.onerror = ()=> { /* missing is okay */ }
});

// Lanes positions (perspective)
function computeLanes() {
  // We will use three lanes across canvas width with perspective scaling
  const left = W*0.16;
  const middle = W*0.5;
  const right = W*0.84;
  return [left, middle, right];
}
let lanes = computeLanes();

// Player state
const player = {
  lane: 1,
  x: 0, y: 0,
  baseW: 160, baseH: 260, // base size (near)
  w: 160, h: 260,
  speedBoost: 0,
  alive: true
};

// Opponents
let opponents = []; // each: {type:'op1', dist: z (distance from player), lane:0|1|2, speed, overtaken}

// Camera / race parameters
let game = {
  running: false,
  score: 0,
  baseSpeed: 3.0,
  speedMultiplier: 1.0,
  spawnTimer: 0,
  lastTS: 0,
  nitroTimer: 0
};

// touch detection for screen-split & swipe
let touchState = {startX:0, startY:0, startTime:0, active:false};

// input state
const keys = {left:false, right:false, up:false, down:false, space:false};

// helpers
function resetGame() {
  opponents = [];
  game.running = false;
  game.score = 0;
  game.speedMultiplier = 1.0;
  game.spawnTimer = 0;
  game.nitroTimer = 0;
  player.lane = 1;
  player.speedBoost = 0;
  player.alive = true;
  overlayTitle.textContent = 'Gensyn Racer';
  overlayText.textContent = 'Tap left/right or use arrow keys. Swipe up = boost, swipe down = brake.';
  overlay.style.display = 'flex';
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
function updateUI(){
  if(scoreEl) scoreEl.textContent = `Score: ${game.score}`;
  if(speedEl) speedEl.textContent = `Speed: ${game.speedMultiplier.toFixed(2)}x`;
}

// resize handling: maintain logical resolution but scale canvas to CSS width
function fitCanvas(){
  // Keep internal W,H fixed for math; scale CSS size for responsiveness.
  const maxWidth = Math.min(window.innerWidth - 32, 720);
  canvas.style.width = maxWidth + 'px';
  // recompute lanes based on logical W
  lanes = computeLanes();
  player.x = lanes[player.lane];
  player.y = H - 240;
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

// keyboard events
window.addEventListener('keydown', e=>{
  if(e.key === 'ArrowLeft' || e.key === 'a'){ keys.left = true; e.preventDefault(); }
  if(e.key === 'ArrowRight' || e.key === 'd'){ keys.right = true; e.preventDefault(); }
  if(e.key === 'ArrowUp'){ keys.up = true; e.preventDefault(); }
  if(e.key === 'ArrowDown'){ keys.down = true; e.preventDefault(); }
  if(e.code === 'Space'){ keys.space = true; e.preventDefault(); }
  if(e.key === 'Escape'){ // pause
    if(game.running){ game.running = false; overlayTitle.textContent = 'Paused'; overlayText.textContent = 'Game paused — press Start to resume.'; overlay.style.display = 'flex'; }
  }
});
window.addEventListener('keyup', e=>{
  if(e.key === 'ArrowLeft' || e.key === 'a'){ keys.left = false; }
  if(e.key === 'ArrowRight' || e.key === 'd'){ keys.right = false; }
  if(e.key === 'ArrowUp'){ keys.up = false; }
  if(e.key === 'ArrowDown'){ keys.down = false; }
  if(e.code === 'Space'){ keys.space = false; }
});

// mouse click acts like tap (for desktop)
canvas.addEventListener('mousedown', (ev)=>{
  const rect = canvas.getBoundingClientRect();
  const cx = ev.clientX - rect.left;
  handleTap(cx, rect.width);
});

// touch events (screen-split + swipe)
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
  // prevent page scroll while interacting
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

  // swipe detection: vertical swipe with sufficient distance and short time
  const minSwipe = 40; // px
  if(Math.abs(dy) > minSwipe && Math.abs(dy) > Math.abs(dx)){
    if(dy < 0){
      // swipe up -> nitro
      applyNitro();
    } else {
      // swipe down -> brake
      applyBrake();
    }
  } else {
    // treat as tap — check left/right half
    handleTap(touchState.startX, rect.width);
  }
  touchState.active = false;
}, {passive:false});

// handle tap position
function handleTap(x, width){
  if(x < width/2) {
    // left half
    moveLeft();
  } else {
    // right half
    moveRight();
  }
}

// lane movement helpers
function moveLeft(){ if(player.lane > 0){ player.lane--; player.x = lanes[player.lane]; } }
function moveRight(){ if(player.lane < 2){ player.lane++; player.x = lanes[player.lane]; } }

// nitro / brake
function applyNitro(){
  game.nitroTimer = 700; // ms of extra speed
}
function applyBrake(){
  // temporarily reduce speed multiplier
  game.speedMultiplier = Math.max(0.5, game.speedMultiplier - 0.25);
}

// spawn opponents with a distance (z). smaller z = closer
function spawnOpponent(){
  const types = ['op1','op2','op3'];
  const t = types[Math.floor(Math.random()*types.length)];
  const lane = Math.floor(Math.random()*3);
  const z = 1800 + Math.random()*1600; // far distance
  const speed = 0.9 + Math.random()*0.9; // base approach speed multiplier
  opponents.push({type:t, lane, z, speed, overtaken:false});
}

// convert world distance z to screen Y and scale (simple perspective)
function projectZtoY(z){
  // z large => near top; z small => near bottom
  // choose near plane at z=0 -> bottom (player position), far plane at z=3000 -> top
  const farZ = 3000;
  const t = Math.max(0, Math.min(1, z / farZ)); // 0..1
  // map t to Y: bottom = H - 220, top = 120
  const y = (H - 220) - t * (H - 340);
  // scale factor for size: near big, far small
  const scale = 0.6 + (1 - t) * 1.6; // between 0.6..2.2
  return { y, scale, t };
}

// collision test between player and opponent projected rects
function checkCollision(opponent, opRect){
  // approximate player rect at near fixed Y
  const playerRect = {
    x: player.x - player.w/2,
    y: player.y - player.h/2,
    w: player.w,
    h: player.h
  };
  return !(playerRect.x + playerRect.w < opRect.x ||
           playerRect.x > opRect.x + opRect.w ||
           playerRect.y + playerRect.h < opRect.y ||
           playerRect.y > opRect.y + opRect.h);
}

// main loop
function loop(ts){
  if(!game.running) return;
  const dt = Math.min(40, ts - game.lastTS);
  game.lastTS = ts;

  // handle keyboard discreet lane changes (trigger once)
  if(keys.left){ moveLeft(); keys.left = false; }
  if(keys.right){ moveRight(); keys.right = false; }
  if(keys.up){ game.speedMultiplier = Math.min(3.0, game.speedMultiplier + 0.08); keys.up=false; }
  if(keys.down){ applyBrake(); keys.down=false; }
  if(keys.space){ applyBrake(); keys.space=false; }

  // nitro timer
  if(game.nitroTimer > 0){
    game.nitroTimer -= dt;
    // temporary multiplier boost
    var nitroBoost = 1.6;
  } else nitroBoost = 1.0;

  // slowly restore multiplier to baseline
  if(game.speedMultiplier > 1.0) game.speedMultiplier = Math.max(1.0, game.speedMultiplier - 0.0008 * dt);

  // spawn opponents occasionally (spawn when far enough)
  game.spawnTimer += dt * (0.8 + game.score * 0.002);
  if(game.spawnTimer > 900) {
    game.spawnTimer = 0;
    spawnOpponent();
    // occasionally spawn a second one
    if(Math.random() < 0.33) spawnOpponent();
  }

  // update opponents: reduce z (approach player)
  for(let i=opponents.length-1;i>=0;i--){
    const o = opponents[i];
    // opponents attempt occasional lane change (try to overtake)
    if(Math.random() < 0.007) {
      const tryLane = Math.floor(Math.random()*3);
      o.lane = tryLane;
    }
    // approach speed is base * (global speed) * nitroBoost
    o.z -= (game.baseSpeed + (game.speedMultiplier - 1)*2.0 + o.speed*2.2) * nitroBoost * (dt/16);
    // if passed (z < 0) -> either overtaken (player avoided) or collided depending on lane overlap
    if(o.z <= 20 && !o.overtaken){
      // if lane different -> player successfully passed / avoided
      if(o.lane !== player.lane){
        o.overtaken = true;
        game.score += 20;
      } else {
        // collision zone, check precise collision using projected rect
        // collision handled later when drawing (projected position)
      }
    }
    // remove very near/behind items
    if(o.z < -220) opponents.splice(i,1);
  }

  // draw frame
  drawScene(nitroBoost);

  // check collisions after drawing accurate projected rects
  for(const o of opponents){
    const proj = projectZtoY(o.z);
    // screen X based on lane
    const laneX = lanes[o.lane];
    const scale = proj.scale;
    const w = Math.round(player.baseW * scale * 0.6);
    const h = Math.round(player.baseH * scale * 0.6);
    const x = laneX - w/2;
    const y = proj.y - h/2;
    const opRect = {x, y, w, h};
    // collision when opponent z small (close) and same lane and rect overlap
    if(o.z < 420 && o.lane === player.lane){
      if(checkCollision(o, opRect)){
        // game over
        game.running = false;
        player.alive = false;
        overlayTitle.textContent = 'Game Over';
        overlayText.textContent = `Score: ${game.score} — press Start to retry.`;
        overlay.style.display = 'flex';
      }
    }
  }

  // request next frame
  updateUI();
  if(game.running) requestAnimationFrame(loop);
}

// draw road, background, cars
let roadScroll = 0;
function drawScene(nitroBoost){
  // clear
  ctx.clearRect(0,0,W,H);

  // road background (parallax mountains / grass)
  drawBackground();

  // draw lane markers perspective
  drawRoadMarkers(nitroBoost);

  // draw opponents sorted by z descending (far first)
  const sorted = [...opponents].sort((a,b)=> b.z - a.z);
  for(const o of sorted) {
    drawOpponent(o);
  }

  // draw player at fixed near position
  drawPlayer();

  // HUD neon
  if(game.nitroTimer > 0){
    // tiny glow effect
    ctx.fillStyle = 'rgba(255,80,180,0.06)';
    roundRect(ctx, 12, H - 48, 140, 36, 8);
    ctx.fill();
  }
}

// background: simple parallax stripes + mountains
function drawBackground(){
  // sky gradient
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0, '#071020');
  g.addColorStop(1, '#02030a');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,W,H);

  // rolling hills (parallax using roadScroll)
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

// draw road markers
function drawRoadMarkers(nitroBoost){
  // simulate perspective dashed center line, moving by roadScroll
  const centerX = W/2;
  const dashH = 32;
  const gap = 28;
  const speed = 14 * (1 + (game.speedMultiplier-1)*0.8) * (nitroBoost || 1.0);
  const offset = (performance.now()/10) % (dashH + gap);
  // draw center dashes scaled by y to look perspective
  for(let y = -200; y < H + 200; y += dashH + gap){
    const px = y;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(centerX-6, y + (offset%80), 12, dashH);
  }
  // subtle side fades (road edges)
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0,0,W, H);
}

// draw an opponent car with perspective by z
function drawOpponent(o){
  const proj = projectZtoY(o.z);
  const laneX = lanes[o.lane];
  const scale = proj.scale;
  const w = Math.round(player.baseW * scale * 0.6);
  const h = Math.round(player.baseH * scale * 0.6);
  const x = laneX - w/2;
  const y = proj.y - h/2;

  // image or rectangle fallback
  const img = assets[o.type];
  if(img){
    ctx.drawImage(img, x, y, w, h);
  } else {
    ctx.save();
    ctx.translate(x,y);
    ctx.fillStyle = 'rgba(120,140,255,0.95)';
    roundRect(ctx, 0, 0, w, h, 12);
    ctx.fill();
    ctx.restore();
  }

  // small logo or mark at trunk
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `${Math.max(10, Math.round(12*scale))}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(o.type.toUpperCase(), laneX, y + h*0.82);
  ctx.restore();
}

// draw player car near bottom (always close & large)
function drawPlayer(){
  const laneX = lanes[player.lane];
  const scale = 1.0; // always near (we keep player large)
  player.w = Math.round(player.baseW * scale * 0.9);
  player.h = Math.round(player.baseH * scale * 0.9);
  player.x = laneX;
  player.y = H - 220;

  const x = player.x - player.w/2;
  const y = player.y - player.h/2;

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

  // small Gensyn badge / label in case image missing
  if(!img){
    ctx.save();
    ctx.fillStyle = '#ff2fa6';
    ctx.font = '700 18px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GENSYN', player.x, player.y + player.h*0.55);
    ctx.restore();
  }
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

// wire start/reset
startBtn.addEventListener('click', ()=>{
  overlayTitle.textContent = 'Gensyn Racer';
  overlayText.textContent = '';
  startGame();
});
resetBtn.addEventListener('click', ()=>{
  location.reload();
});

// init
resetGame();

/* Notes / tweak points for you:
 - spawnOpponents frequency, approach speed, and scoring are all adjustable in the top variables.
 - change image filenames in tryImgs if you renamed assets.
 - if you want opponents to actively try to change lane more aggressively (overtake), bump the chance in the loop (currently 0.007).
 - To add power-ups, spawn special objects with z and give boosts on collision.
*/
