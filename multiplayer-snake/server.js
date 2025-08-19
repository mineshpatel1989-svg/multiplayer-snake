import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
app.use(express.static("public"));

const GRID_WIDTH = 48;
const GRID_HEIGHT = 32;
const TICK_RATE = 10; // updates per second
const MAX_PLAYERS = 10;
const APPLE_COUNT = 3;

function randInt(n){ return Math.floor(Math.random()*n); }
function key(x,y){ return `${x},${y}`; }

const COLORS = [
  "#e11d48","#0ea5e9","#22c55e","#a855f7","#f97316",
  "#14b8a6","#f43f5e","#10b981","#f59e0b","#3b82f6"
];

const players = new Map();
let apples = [];

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

io.on("connection", (socket) => {
  const id = socket.id;

  socket.on("hello", (payload) => {
    const name = (payload?.name || "").trim().slice(0,16) || `Player-${id.slice(0,4)}`;
    const currentPlayers = [...players.values()].filter(p=>!p.spectator).length;
    const spectator = currentPlayers >= MAX_PLAYERS;
    const color = COLORS[players.size % COLORS.length];

    let snake = [];
    let dir = {x:1,y:0};
    let alive = !spectator;
    if(!spectator){
      const x = randInt(GRID_WIDTH);
      const y = randInt(GRID_HEIGHT);
      snake = createSnake(x,y);
    }

    players.set(id, {id,name,color,spectator,snake,dir,pendingDir:null,alive,score:0,respawnAt:0});

    socket.emit("helloAck", {
      you: { id, spectator, name, color },
      grid: { width: GRID_WIDTH, height: GRID_HEIGHT },
      maxPlayers: MAX_PLAYERS
    });
  });

  socket.on("dir", (d) => {
    const p = players.get(id);
    if(!p || p.spectator || !p.alive) return;
    const map = {up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
    const next = map[d];
    if(next) p.pendingDir = safeDirChange(p.dir, next);
  });

  socket.on("disconnect", () => players.delete(id));
});

function gameTick(){
  const now = Date.now();
  spawnApplesIfNeeded();

  for(const p of players.values()){
    if(!p.spectator && !p.alive && p.respawnAt && now >= p.respawnAt){
      const x = randInt(GRID_WIDTH), y = randInt(GRID_HEIGHT);
      p.snake = createSnake(x,y);
      p.dir = {x:1,y:0};
      p.pendingDir = null;
      p.alive = true;
    }
  }

  for(const p of players.values()){
    if(p.spectator || !p.alive) continue;
    if(p.pendingDir){ p.dir = p.pendingDir; p.pendingDir=null; }
    const head = p.snake[0];
    const nx = (head.x + p.dir.x + GRID_WIDTH) % GRID_WIDTH;
    const ny = (head.y + p.dir.y + GRID_HEIGHT) % GRID_HEIGHT;
    const eat = apples.some(a => a.x===nx && a.y===ny);

    if(p.snake.some(s=>s.x===nx && s.y===ny && !(s===p.snake[p.snake.length-1] && !eat))){
      p.alive = false; p.respawnAt = now+3000; continue;
    }

    p.snake.unshift({x:nx,y:ny});
    if(eat){
      apples = apples.filter(a=>!(a.x===nx&&a.y===ny));
      p.score++;
    } else {
      p.snake.pop();
    }
  }

  io.emit("state", {
    apples,
    players: [...players.values()].map(p=>({
      id:p.id,name:p.name,color:p.color,snake:p.snake,
      alive:p.alive,spectator:p.spectator,score:p.score
    })),
    grid:{width:GRID_WIDTH,height:GRID_HEIGHT}
  });
}

setInterval(gameTick, 1000/TICK_RATE);
spawnApplesIfNeeded();
server.listen(PORT, ()=>console.log("Snake on http://localhost:"+PORT));
