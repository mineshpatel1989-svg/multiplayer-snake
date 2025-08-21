import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

const GRID_WIDTH = 48;
const GRID_HEIGHT = 32;
const TICK_RATE = 20;
const MAX_PLAYERS = 10;
const APPLE_COUNT = 4;
const ROUND_DURATION_MS = 60 * 1000;
const RESPAWN_DELAY_MS = 500;
const SHIELD_MS = 2000;
const KILL_BONUS = 2;

const MODES = { classic:{deathPenalty:"reset"}, balanced:{deathPenalty:"minus3"} };
let mode = "balanced";

const SPEEDS = { slow:110, normal:70, fast:50 };
let speed = "slow";
let lastMoveAt = 0;

app.use(express.static("public"));

function randInt(n){ return Math.floor(Math.random()*n); }
function key(x,y){ return `${x},${y}`; }

const COLORS = ["#e11d48","#0ea5e9","#22c55e","#a855f7","#f97316",
  "#14b8a6","#f43f5e","#10b981","#f59e0b","#3b82f6"];
const HEADS = ["🐸","🦄","🐧","🐙","🐝","🐲","🦖","👾","😎","🦈"];

const players = new Map();
let apples = [];
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

function spawnApplesIfNeeded(){ while(apples.length < APPLE_COUNT) spawnApple(); }
function createSnake(x,y){ return [{x,y},{x:(x-1+GRID_WIDTH)%GRID_WIDTH,y},{x:(x-2+GRID_WIDTH)%GRID_WIDTH,y}]; }
function safeDirChange(cur,next){ if(!cur) return next; if(cur.x===-next.x && cur.y===-next.y) return cur; return next; }

function resetToLobby(){
  phase = "lobby"; apples = [];
  for(const p of players.values()){
    p.snake=[]; p.alive=!p.spectator; p.score=0; p.respawnAt=0; p.dir={x:1,y:0}; p.pendingDir=null;
    p.kills=0; p.deaths=0; p.applesEaten=0; p.longest=0; p.streak=0;
    p.ready=false; p.shieldUntil=0;
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
}

function startRound(){
  const readyCount = [...players.values()].filter(p=>!p.spectator && p.ready).length;
  if(readyCount < 2) return;
  phase = "playing";
  roundEndsAt = Date.now() + ROUND_DURATION_MS;
  lastMoveAt = 0;
  apples = [];
  for(const p of players.values()){
    if(p.spectator){ p.alive=false; continue; }
    respawnPlayer(p);
    p.score = 0;
    p.respawnAt = 0;
    p.kills=0; p.deaths=0; p.applesEaten=0; p.longest=p.snake.length; p.streak=0;
  }
  spawnApplesIfNeeded();
  io.emit("state", buildState());
}

function buildState(){
  return {
    apples,
    players: [...players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color, head: p.head,
      snake: p.snake, alive: p.alive, spectator: p.spectator, score: p.score,
      kills: p.kills||0, deaths: p.deaths||0, applesEaten: p.applesEaten||0, longest: p.longest||0,
      ready: !!p.ready, shield: p.shieldUntil && Date.now() < p.shieldUntil
    })),
    grid: { width: GRID_WIDTH, height: GRID_HEIGHT },
    phase, hostId, mode, speed,
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
      kills:0, deaths:0, applesEaten:0, longest:0, streak:0, ready:false, shieldUntil:0
    });
    assignHostIfNeeded();
    socket.emit("helloAck", {
      you: { id, spectator, name, color, head },
      grid: { width: GRID_WIDTH, height: GRID_HEIGHT },
      maxPlayers: MAX_PLAYERS,
      phase, hostId, timeRemainingMs: 0, mode, speed
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
  socket.on("hostSetMode",(m)=>{ if(id !== hostId) return; if(Object.keys(MODES).includes(m)) mode = m; });
  socket.on("hostSetSpeed",(sp)=>{ if(id !== hostId) return; if(Object.keys(SPEEDS).includes(sp)) speed = sp; });

  socket.on("start",()=>{ if(id===hostId && phase==="lobby") startRound(); });
  socket.on("restart",()=>{ if(id===hostId) resetToLobby(); });

  socket.on("dir",(d)=>{
    const p = players.get(id);
    if(!p || p.spectator || !p.alive || phase!=="playing") return;
    const map = {up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
    const next = map[d]; if(next) p.pendingDir = safeDirChange(p.dir, next);
  });

  socket.on("disconnect",()=>{
    players.delete(id);
    if(id===hostId) assignHostIfNeeded();
  });
});

function applyDeathPenalty(p){
  if(mode === "classic"){ p.score = 0; }
  else { p.score = Math.max(0, (p.score||0) - 3); }
}

function doMovement(now){
  const interval = (SPEEDS[speed] ?? SPEEDS.normal);
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
    const eat = apples.some(a=>a.x===nx && a.y===ny);

    const shielded = p.shieldUntil && now < p.shieldUntil;

    let collided = false, killerId = null;
    if(!shielded){
      const info = occ.get(cellKey);
      if(info){
        if(info.ownerId === p.id){
          const isOwnTail = (info.idx === p.snake.length - 1);
          if(!(isOwnTail && !eat)) collided = true;
        } else {
          collided = true;
          killerId = info.ownerId;
        }
      }
    }

    if(collided){
      p.alive = false;
      p.deaths = (p.deaths||0) + 1;
      applyDeathPenalty(p);
      p.respawnAt = now + RESPAWN_DELAY_MS;
      p.streak = 0;
      if(killerId && players.has(killerId)){
        const k = players.get(killerId);
        k.kills = (k.kills||0) + 1;
        k.streak = (k.streak||0) + 1;
        k.score = (k.score||0) + KILL_BONUS;
      }
      continue;
    }

    p.snake.unshift({x:nx,y:ny});
    if(eat){
      apples = apples.filter(a=>!(a.x===nx && a.y===ny));
      p.score += 1;
      p.applesEaten = (p.applesEaten||0) + 1;
    } else {
      p.snake.pop();
    }
    if(p.snake.length > (p.longest||0)) p.longest = p.snake.length;
  }

  for(const p of players.values()){
    if(!p.spectator && !p.alive && p.respawnAt && now >= p.respawnAt){
      respawnPlayer(p);
    }
  }
}

function gameTick(){
  const now = Date.now();
  if(phase === "playing"){
    if(now >= roundEndsAt){ phase = "ended"; }
    else { spawnApplesIfNeeded(); doMovement(now); }
  }
  io.emit("state", buildState());
}

setInterval(gameTick, 1000 / TICK_RATE);
server.listen(PORT, ()=>console.log("Running on http://localhost:"+PORT));
