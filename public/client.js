(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const nameInput = document.getElementById("nameInput");
  const saveNameBtn = document.getElementById("saveName");
  const startBtn = document.getElementById("startBtn");
  const restartBtn = document.getElementById("restartBtn");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayRestart = document.getElementById("overlayRestart");
  const hostBadge = document.getElementById("hostBadge");
  const lobbyEl = document.getElementById("lobby");
  const lobbyList = document.getElementById("lobbyList");
  const scoresEl = document.getElementById("scores");
  const finalScoresEl = document.getElementById("finalScores");
  const phaseEl = document.getElementById("phase");
  const timerEl = document.getElementById("timer");

  let grid = { width: 48, height: 32 };
  let cell = 20;
  let state = { apples: [], players: [], phase: "lobby", hostId: null, timeRemainingMs: 0 };
  let you = { id: null, name: "", color: "", spectator: false };

  function fitCanvas(){
    const maxW = Math.min(window.innerWidth-24, 1200);
    const maxH = Math.min(window.innerHeight-220, 860);
    const cw = Math.floor(maxW / grid.width);
    const ch = Math.floor(maxH / grid.height);
    cell = Math.max(10, Math.min(cw, ch));
    canvas.width  = grid.width * cell;
    canvas.height = grid.height * cell;
  }

  function draw(){
    ctx.clearRect(0,0,canvas.width, canvas.height);
    // background dots
    ctx.globalAlpha = 0.15;
    for(let y=0;y<grid.height;y++){
      for(let x=0;x<grid.width;x++){
        ctx.fillRect(x*cell+cell/2, y*cell+cell/2, 1, 1);
      }
    }
    ctx.globalAlpha = 1;

    // apples
    for(const a of state.apples){
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(a.x*cell, a.y*cell, cell, cell);
    }

    // snakes
    for(const p of state.players){
      if(p.spectator) continue;
      ctx.fillStyle = p.color;
      for(const s of p.snake){
        ctx.fillRect(s.x*cell, s.y*cell, cell, cell);
      }
    }
  }

  function updateLobby(){
    lobbyList.innerHTML = "";
    const list = state.players.slice().sort((a,b)=>a.name.localeCompare(b.name));
    for(const p of list){
      const li = document.createElement("li");
      li.innerHTML = `<b style="color:${p.color}">${p.name}</b>${p.spectator?' <span class="badge">spectator</span>':''}`;
      lobbyList.appendChild(li);
    }
  }

  function updateScores(){
    const players = state.players.filter(p=>!p.spectator).slice().sort((a,b)=>b.score-a.score);
    scoresEl.innerHTML = "";
    players.forEach((p,i) => {
      const li = document.createElement("li");
      li.textContent = `${p.name} — ${p.score}`;
      scoresEl.appendChild(li);
    });
  }

  function msToClock(ms){
    const s = Math.max(0, Math.floor(ms/1000));
    const m = Math.floor(s/60);
    const r = s % 60;
    return `${String(m).padStart(1,"0")}:${String(r).padStart(2,"0")}`;
  }

  function renderPhase(){
    phaseEl.textContent = `Phase: ${state.phase}`;
    hostBadge.classList.toggle("hidden", you.id !== state.hostId);

    // Controls visibility
    startBtn.classList.toggle("hidden", !(state.phase==="lobby" && you.id===state.hostId));
    restartBtn.classList.toggle("hidden", !(state.phase!=="lobby" && you.id===state.hostId));
    overlayRestart.classList.toggle("hidden", !(state.phase==="ended" && you.id===state.hostId));

    // Panels
    lobbyEl.classList.toggle("hidden", state.phase !== "lobby");
    overlay.classList.toggle("hidden", state.phase !== "ended");

    timerEl.textContent = state.phase==="playing" ? `⏱ ${msToClock(state.timeRemainingMs)}` : "";
  }

  // Socket
  const socket = io();

  socket.on("connect", () => {
    const initial = (new URLSearchParams(location.search)).get("name") || "";
    socket.emit("hello", { name: initial });
    if(initial) nameInput.value = initial;
  });

  socket.on("helloAck", (data) => {
    you = data.you;
    grid = data.grid || grid;
    state.phase = data.phase;
    state.hostId = data.hostId;
    state.timeRemainingMs = data.timeRemainingMs || 0;
    fitCanvas();
    renderPhase();
  });

  socket.on("state", (s) => {
    state = s;
    draw();
    updateLobby();
    updateScores();
    renderPhase();
  });

  // Inputs
  saveNameBtn.addEventListener("click", () => {
    const v = nameInput.value.trim().slice(0,16);
    socket.emit("setName", v);
  });

  startBtn.addEventListener("click", () => socket.emit("start"));
  restartBtn.addEventListener("click", () => socket.emit("restart"));
  overlayRestart.addEventListener("click", () => socket.emit("restart"));

  const keyMap = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    w: "up", s: "down", a: "left", d: "right"
  };
  window.addEventListener("keydown", (e) => {
    const d = keyMap[e.key];
    if(d){ e.preventDefault(); socket.emit("dir", d); }
  }, { passive: false });

  // Resize
  window.addEventListener("resize", fitCanvas);
  fitCanvas();
})();