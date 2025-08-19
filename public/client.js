(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const statusEl = document.getElementById("status");
  const youEl = document.getElementById("you");
  const scoresEl = document.getElementById("scores");

  let grid = { width: 48, height: 32 };
  let cell = 20;
  let state = { apples: [], players: [] };
  let you = { id: null, name: null, color: null, spectator: false };

  function draw(){
    ctx.clearRect(0,0,canvas.width, canvas.height);

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

  function updateScores(){
    const players = state.players.filter(p=>!p.spectator).slice().sort((a,b)=>b.score-a.score);
    scoresEl.innerHTML = "";
    players.forEach(p => {
      const li = document.createElement("li");
      li.textContent = `${p.name} — ${p.score}`;
      scoresEl.appendChild(li);
    });
  }

  const socket = io();

  socket.on("connect", () => {
    statusEl.textContent = "Connected";
    const n = (new URLSearchParams(location.search)).get("name") || prompt("Enter your name (optional):") || "";
    socket.emit("hello", { name: n });
  });

  socket.on("disconnect", () => {
    statusEl.textContent = "Disconnected — reconnecting…";
  });

  socket.on("helloAck", (data) => {
    you = data.you;
    grid = data.grid || grid;
    youEl.textContent = `You: ${you.name}${you.spectator ? " (spectator)" : ""}`;
  });

  socket.on("state", (s) => {
    state = s;
    draw();
    updateScores();
  });

  const keyMap = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    w: "up", s: "down", a: "left", d: "right",
    W: "up", S: "down", A: "left", D: "right"
  };
  window.addEventListener("keydown", (e) => {
    const d = keyMap[e.key];
    if(d){ e.preventDefault(); socket.emit("dir", d); }
  }, { passive: false });
})();