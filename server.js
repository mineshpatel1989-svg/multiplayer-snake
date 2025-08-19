import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
app.use(express.static("public"));

// --- Game Config ---
const GRID_WIDTH = 48;
const GRID_HEIGHT = 32;
const TICK_RATE = 10;               // ticks per second
const MAX_PLAYERS = 10;
const APPLE_COUNT = 3;
const ROUND_DURATION_MS = 2 * 60 * 1000; // 2 minutes

// --- Helpers ---
function randInt(n){ return Math.floor(Math.random()*n); }
function key(x,y){ return `${x},${y}`; }

const COLORS = [
  "#e11d48","#0ea5e9","#22c55e","#a855f7","#f97316",
  "#14b8a6","#f43f5e","#10b981","#f59e0b","#3b82f6"
];

// --- State ---
const players = new Map(); // id -> player
let apples = [];
let phase = "lobby";       // "lobby" | "playing" | "ended"
let hostId = null;
let roundEndsAt = 0;

// --- Core funcs ---
function assignHostIfNeeded(){
  if(hostId && players.has(hostId)) return;
  // pick first connected player (including spectators) as host
  const first = [...players.values()][0];
  hostId = first ? first.id : null;
}

function spawnApple(){
  let tries = 0;
  while(tries < 500){
    const x = randInt(GRID_WIDTH);
    const y = randInt(GRID_HEIGHT);
    if(!apples.some(a => a.x===x && a.y===y)){
      apples.push({x,y});
      return;
    }
    tries++;
  }
}

function spawnApplesIfNeeded(){
  while(apples.length < APPLE_COUNT){
    spawnApple();
  }
}

function createSnake(x,y){
  return [{x,y},{x:(x-1+GRID_WIDTH)%GRID_WIDTH,y},{x:(x-2+GRID_WIDTH)%GRID_WIDTH,y}];
}

function safeDirChange(current,next){
  if(!current) return next;
  if(current.x === -next.x && current.y === -next.y) return current;
  return next;
}

function resetToLobby(){
  phase = "lobby";
  apples = [];
  for(const p of players.values()){
    p.snake = [];
    p.dir = {x:1,y:0};
    p.pendingDir = null;
    p.alive = !p.spectator;
    p.score = 0;
    p.respawnAt = 0;
  }
  assignHostIfNeeded();
}

function startRound(){
  phase = "playing";
  roundEndsAt = Date.now() + ROUND_DURATION_MS;
  apples = [];
  // Spawn players
  for(const p of players.values()){
    if(p.spectator){
      p.alive = false;
      continue;
    }
    const x = randInt(GRID_WIDTH), y = randInt(GRID_HEIGHT);
    p.snake = createSnake(x,y);
    p.dir = {x:1,y:0};
    p.pendingDir = null;
    p.alive = true;
    p.score = 0;
    p.respawnAt = 0;
  }
  spawnApplesIfNeeded();
}

// --- Socket IO ---
io.on("connection", (socket) => {
  const id = socket.id;

  socket.on("hello", (payload) => {
    const rawName = (payload?.name || "").trim().slice(0, 16);
    const name = rawName || `Player-${id.slice(0,4)}`;

    const currentPlayers = [...players.values()].filter(p=>!p.spectator).length;
    const spectator = currentPlayers >= MAX_PLAYERS;

    const color = COLORS[players.size % COLORS.length];

    const player = {
      id, name, color, spectator,
      snake: [],
      dir: {x:1,y:0},
      pendingDir: null,
      alive: !spectator && (phase !== "ended"),
      score: 0,
      respawnAt: 0
    };
    players.set(id, player);
    assignHostIfNeeded();

    socket.emit("helloAck", {
      you: { id, spectator, name, color },
      grid: { width: GRID_WIDTH, height: GRID_HEIGHT },
      maxPlayers: MAX_PLAYERS,
      phase,
      hostId,
      timeRemainingMs: phase==="playing" ? Math.max(0, roundEndsAt - Date.now()) : 0
    });
  });

  socket.on("setName", (newName) => {
    const p = players.get(id);
    if(!p) return;
    const n = (newName || "").trim().slice(0,16);
    if(n) p.name = n;
  });

  socket.on("start", () => {
    if(id !== hostId) return;
    if(phase !== "lobby") return;
    startRound();
  });

  socket.on("restart", () => {
    if(id !== hostId) return;
    resetToLobby();
  });

  socket.on("dir", (d) => {
    const p = players.get(id);
    if(!p || p.spectator || !p.alive || phase!=="playing") return;
    const map = {up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
    const next = map[d];
    if(next) p.pendingDir = safeDirChange(p.dir, next);
  });

  socket.on("disconnect", () => {
    players.delete(id);
    if(id === hostId) assignHostIfNeeded();
  });
});

function gameTick(){
  const now = Date.now();

  if(phase === "playing"){
    if(now >= roundEndsAt){
      phase = "ended";
    }else{
      spawnApplesIfNeeded();

      for(const p of players.values()){
        if(p.spectator || !p.alive) continue;
        if(p.pendingDir){ p.dir = p.pendingDir; p.pendingDir=null; }
        const head = p.snake[0] || {x: randInt(GRID_WIDTH), y: randInt(GRID_HEIGHT)};
        const nx = (head.x + p.dir.x + GRID_WIDTH) % GRID_WIDTH;
        const ny = (head.y + p.dir.y + GRID_HEIGHT) % GRID_HEIGHT;
        const eat = apples.some(a => a.x===nx && a.y===ny);

        if(p.snake.some(s=>s.x===nx && s.y===ny && !(s===p.snake[p.snake.length-1] && !eat))){
          p.alive = false; p.respawnAt = now + 2000; // brief respawn penalty
          continue;
        }

        p.snake.unshift({x:nx,y:ny});
        if(eat){
          apples = apples.filter(a=>!(a.x===nx&&a.y===ny));
          p.score++;
        } else {
          p.snake.pop();
        }
      }

      // Respawns
      for(const p of players.values()){
        if(!p.spectator && !p.alive && p.respawnAt && now >= p.respawnAt){
          const x = randInt(GRID_WIDTH), y = randInt(GRID_HEIGHT);
          p.snake = createSnake(x,y);
          p.dir = {x:1,y:0};
          p.pendingDir = null;
          p.alive = true;
        }
      }
    }
  }

  const payload = {
    apples,
    players: [...players.values()].map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      snake: p.snake,
      alive: p.alive,
      spectator: p.spectator,
      score: p.score
    })),
    grid: { width: GRID_WIDTH, height: GRID_HEIGHT },
    phase,
    hostId,
    timeRemainingMs: phase==="playing" ? Math.max(0, roundEndsAt - now) : 0
  };

  io.emit("state", payload);
}

setInterval(gameTick, 1000 / TICK_RATE);
server.listen(PORT, () => console.log(`Multiplayer Snake running on http://localhost:${PORT}`));
