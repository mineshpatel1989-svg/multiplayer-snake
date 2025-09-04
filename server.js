import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

// -------- Config --------
const GRID_WIDTH = 48;
const GRID_HEIGHT = 32;
const TICK_RATE = 20;                 // network update frequency
const MAX_PLAYERS = 10;
const APPLE_COUNT = 4;
const POWERUP_MAX = 2;                // up to 2 powerups on grid
const ROUND_DURATION_MS = 60 * 1000;
const RESPAWN_DELAY_MS = 600;
const SHIELD_MS = 1500;               // 1.5s invulnerability on (re)spawn
const KILL_BONUS = 1;                 // +1 when your fireball deletes a segment

// Speed presets (movement cadence; lower is faster)
const SPEEDS = { slow: 110, normal: 70, fast: 50 };
let speed = "slow"; // default slightly slower
let lastMoveAt = 0;

// Powerups
const P_TYPES = ["ghost","fire"];
const P_ICON = { ghost:"👻", fire:"🔥" };
const GHOST_MS = 5000;
const FIRE_MS  = 6000;
const FIRE_SPEED = 1;                 // cells per movement step
const FIRE_RANGE = 16;                // max cells travelled

app.use(express.static("public"));

function randInt(n){ return Math.floor(Math.random()*n); }
function key(x,y){ return `${x},${y}`; }

const COLORS = ["#e11d48","#0ea5e9","#22c55e","#a855f7","#f97316",
  "#14b8a6","#f43f5e","#10b981","#f59e0b","#3b82f6"];
const HEADS = ["🐸","🦄","🐧","🐙","🐝","🐲","🦖","👾","😎","🦈"];

const players = new Map();
let apples = [];
let powerups = [];   // {x,y,type}
let projectiles = []; // {x,y,dx,dy,owner,rangeLeft}
let phase = "lobby";
let hostId = null;
let roundEndsAt = 0;

function assignHostIfNeeded(){
  if(hostId && players.has(hostId)) return;
  const first = [...players.values()][0];
  hostId = first ? first.id : null;
}

function spawnApple(){
  let tries = 0;
  while(tries < 500){
    const x = randInt(GRID_WIDTH), y = randInt(GRID_HEIGHT);
    if(!apples.some(a=>a.x===x&&a.y===y)){
      apples.push({x,y}); return;
    }
    tries++;
  }
}

function spawnPowerup(){
  let tries = 0;
  while(tries < 500){
    const x = randInt(GRID_WIDTH), y = randInt(GRID_HEIGHT);
    if(!apples.some(a=>a.x===x&&a.y===y) && !powerups.some(p=>p.x===x&&p.y===y)){
      const type = P_TYPES[randInt(P_TYPES.length)];
      powerups.push({x,y,type});
      return;
    }
    tries++;
  }
}

function maintainPickups(){
  while(apples.length < APPLE_COUNT) spawnApple();
  while(powerups.length < POWERUP_MAX) spawnPowerup();
}

function createSnake(x,y){
  return [{x,y},{x:(x-1+GRID_WIDTH)%GRID_WIDTH,y},{x:(x-2+GRID_WIDTH)%GRID_WIDTH,y}];
}

function safeDirChange(cur,next){
  if(!cur) return next;
  if(cur.x===-next.x && cur.y===-next.y) return cur;
  return next;
}

function resetToLobby(){
  phase = "lobby"; apples = []; powerups = []; projectiles = [];
  for(const p of players.values()){
    p.snake=[]; p.alive=!p.spectator; p.score=0; p.respawnAt=0; p.dir={x:1,y:0}; p.pendingDir=null;
    p.kills=0; p.deaths=0; p.applesEaten=0; p.longest=0; p.streak=0;
    p.ready=false; p.shieldUntil=0; p.ghostUntil=0; p.fireUntil=0;
  }
  assignHostIfNeeded();
}

function respawnPlayer(p){
  const x = randInt(GRID_WIDTH), y = randInt(GRID_HEIGHT);
  p.snake = createSnake(x,y);
  p.dir = {x:1,y:0};
  p.pendingDir = null;
  p.alive = true;
  p.shieldUntil = Date.now() + SHIELD_MS;
  p.ghostUntil = 0;
  p.fireUntil = 0;
}

function startRound(){
  const readyCount = [...players.values()].filter(p=>!p.spectator && p.ready).length;
  if(readyCount < 2) return;
  phase = "playing";
  roundEndsAt = Date.now() + ROUND_DURATION_MS;
  lastMoveAt = 0;
  apples = []; powerups = []; projectiles = [];
  for(const p of players.values()){
    if(p.spectator){ p.alive=false; continue; }
    respawnPlayer(p);
    p.score = 0;
    p.respawnAt = 0;
    p.kills=0; p.deaths=0; p.applesEaten=0; p.longest=p.snake.length; p.streak=0;
  }
  maintainPickups();
  io.emit("state", buildState());
}

function buildState(){
  const now = Date.now();
  return {
    apples,
    powerups,
    projectiles: projectiles.map(pr => ({x:pr.x,y:pr.y})),
    players: [...players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color, head: p.head,
      snake: p.snake, alive: p.alive, spectator: p.spectator, score: p.score,
      kills: p.kills||0, deaths: p.deaths||0, applesEaten: p.applesEaten||0, longest: p.longest||0,
      ready: !!p.ready,
      shield: p.shieldUntil && now < p.shieldUntil,
      ghost: p.ghostUntil && now < p.ghostUntil,
      fire: p.fireUntil && now < p.fireUntil
    })),
    grid: { width: GRID_WIDTH, height: GRID_HEIGHT },
    phase, hostId,
    speed,
    timeRemainingMs: phase==="playing" ? Math.max(0, roundEndsAt - Date.now()) : 0,
    readyCount: [...players.values()].filter(p=>p.ready && !p.spectator).length,
    playerCount: [...players.values()].filter(p=>!p.spectator).length
  };
}

io.on("connection",(socket)=>{
  const id = socket.id;
  socket.on("hello",(payload)=>{
    const raw = (payload?.name || "").trim().slice(0,16);
    const name = raw || `Player-${id.slice(0,4)}`;
    const currentPlayers = [...players.values()].filter(p=>!p.spectator).length;
    const spectator = currentPlayers >= MAX_PLAYERS;
    const color = COLORS[players.size % COLORS.length];
    const head = HEADS[players.size % HEADS.length];
    players.set(id, { id, name, color, head, spectator,
      snake:[], dir:{x:1,y:0}, pendingDir:null, alive:!spectator, score:0, respawnAt:0,
      kills:0, deaths:0, applesEaten:0, longest:0, streak:0, ready:false,
      shieldUntil:0, ghostUntil:0, fireUntil:0
    });
    assignHostIfNeeded();
    socket.emit("helloAck", {
      you: { id, spectator, name, color, head },
      grid: { width: GRID_WIDTH, height: GRID_HEIGHT },
      maxPlayers: MAX_PLAYERS,
      phase, hostId, timeRemainingMs: 0, speed
    });
  });

  socket.on("setName",(n)=>{ const p=players.get(id); if(!p) return;
    const nn=(n||"").trim().slice(0,16); if(nn) p.name=nn; });

  socket.on("setCosmetics",({color, head})=>{
    const p = players.get(id); if(!p) return;
    if(typeof color === "string" && /^#?[0-9a-fA-F]{6}$/.test(color)){
      p.color = color.startsWith("#") ? color : ("#"+color);
    }
    if(typeof head === "string" && ["🐸","🦄","🐧","🐙","🐝","🐲","🦖","👾","😎","🦈"].includes(head)){ p.head = head; }
  });

  socket.on("setReady",(val)=>{ const p=players.get(id); if(!p) return; p.ready = !!val; });
  socket.on("hostSetSpeed",(sp)=>{ if(id !== hostId) return; if(Object.keys(SPEEDS).includes(sp)) speed = sp; });
  socket.on("start",()=>{ if(id===hostId && phase==="lobby") startRound(); });
  socket.on("restart",()=>{ if(id===hostId) resetToLobby(); });

  socket.on("dir",(d)=>{
    const p = players.get(id);
    if(!p || p.spectator || !p.alive || phase!=="playing") return;
    const map = {up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
    const next = map[d]; if(next) p.pendingDir = safeDirChange(p.dir, next);
  });

  socket.on("shoot",()=>{
    const p = players.get(id);
    if(!p || p.spectator || !p.alive || phase!=="playing") return;
    const now = Date.now();
    if(!(p.fireUntil && now < p.fireUntil)) return;
    const head = p.snake[0]; if(!head) return;
    projectiles.push({ x: head.x, y: head.y, dx: p.dir.x, dy: p.dir.y, owner: id, rangeLeft: FIRE_RANGE });
  });

  socket.on("disconnect",()=>{
    players.delete(id);
    if(id===hostId) assignHostIfNeeded();
  });
});

function shrinkSnake(p, amount=1){
  for(let i=0;i<amount;i++){
    if(p.snake.length > 2) p.snake.pop();
    else {
      p.alive = false;
      p.deaths = (p.deaths||0) + 1;
      p.score = Math.max(0, (p.score||0) - 1); // -1 on death
      p.respawnAt = Date.now() + RESPAWN_DELAY_MS;
      p.streak = 0;
      return true;
    }
  }
  if(p.snake.length > (p.longest||0)) p.longest = p.snake.length;
  return false;
}

function doProjectiles(){
  const occ = new Map();
  for(const q of players.values()){
    if(q.spectator || !q.alive) continue;
    for(let i=0;i<q.snake.length;i++){
      const s=q.snake[i];
      occ.set(key(s.x,s.y), { ownerId: q.id, idx: i });
    }
  }
  for(let i=projectiles.length-1;i>=0;i--){
    const pr = projectiles[i];
    pr.x = (pr.x + pr.dx + GRID_WIDTH) % GRID_WIDTH;
    pr.y = (pr.y + pr.dy + GRID_HEIGHT) % GRID_HEIGHT;
    pr.rangeLeft -= 1;
    const victim = occ.get(key(pr.x, pr.y));
    if(victim && victim.ownerId !== pr.owner){
      const v = players.get(victim.ownerId);
      if(v){
        const died = shrinkSnake(v, 1);
        const k = players.get(pr.owner);
        if(k){ k.kills = (k.kills||0)+1; k.score = (k.score||0) + KILL_BONUS; }
      }
      projectiles.splice(i,1);
      continue;
    }
    if(pr.rangeLeft <= 0) projectiles.splice(i,1);
  }
}

function doMovement(now){
  const interval = SPEEDS[speed] ?? SPEEDS.normal;
  if(lastMoveAt && now - lastMoveAt < interval) return;
  lastMoveAt = now;

  const occ = new Map();
  for(const p of players.values()){
    if(p.spectator || !p.alive) continue;
    for(let i=0;i<p.snake.length;i++){
      const s = p.snake[i];
      occ.set(key(s.x,s.y), { ownerId: p.id, idx: i });
    }
  }

  for(const p of players.values()){
    if(p.spectator || !p.alive) continue;
    if(p.pendingDir){ p.dir = p.pendingDir; p.pendingDir=null; }

    const head = p.snake[0] || {x: randInt(GRID_WIDTH), y: randInt(GRID_HEIGHT)};
    const nx = (head.x + p.dir.x + GRID_WIDTH) % GRID_WIDTH;
    const ny = (head.y + p.dir.y + GRID_HEIGHT) % GRID_HEIGHT;
    const cellKey = key(nx,ny);

    // pick-ups
    let ateApple = false;
    apples = apples.filter(a=>{
      if(a.x===nx && a.y===ny){ ateApple = true; return false; }
      return true;
    });
    let grabbedPower = null;
    powerups = powerups.filter(pp=>{
      if(pp.x===nx && pp.y===ny){ grabbedPower = pp; return false; }
      return true;
    });

    const nowMs = now;
    const shielded = p.shieldUntil && nowMs < p.shieldUntil;
    const ghosted = p.ghostUntil && nowMs < p.ghostUntil;

    let collided = false;
    if(!shielded){
      const info = occ.get(cellKey);
      if(info){
        if(info.ownerId === p.id){
          const isOwnTail = (info.idx === p.snake.length - 1);
          if(!(isOwnTail && !ateApple)) collided = true;
        } else {
          const victim = players.get(info.ownerId);
          const victimGhost = victim && victim.ghostUntil && nowMs < victim.ghostUntil;
          if(!victimGhost) collided = true;
        }
      }
    }

    // advance
    p.snake.unshift({x:nx,y:ny});

    if(ateApple){
      p.score += 1;
      p.applesEaten = (p.applesEaten||0) + 1;
    } else {
      p.snake.pop();
    }

    if(collided){
      shrinkSnake(p, 1);
    }

    if(grabbedPower){
      if(grabbedPower.type === "ghost"){
        p.ghostUntil = Date.now() + GHOST_MS;
      } else if(grabbedPower.type === "fire"){
        p.fireUntil = Date.now() + FIRE_MS;
      }
    }

    if(p.snake.length > (p.longest||0)) p.longest = p.snake.length;
  }

  doProjectiles();

  for(const p of players.values()){
    if(!p.spectator && !p.alive && p.respawnAt && now >= p.respawnAt){
      respawnPlayer(p);
    }
  }

  maintainPickups();
}

function gameTick(){
  const now = Date.now();
  if(phase === "playing"){
    if(now >= roundEndsAt){
      phase = "ended";
    } else {
      doMovement(now);
    }
  }
  io.emit("state", buildState());
}

setInterval(gameTick, 1000 / TICK_RATE);
server.listen(PORT, ()=>console.log("Running on http://localhost:"+PORT));
