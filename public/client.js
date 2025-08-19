const canvas=document.getElementById("game");const ctx=canvas.getContext("2d");
const nameInput=document.getElementById("nameInput");const saveNameBtn=document.getElementById("saveName");
const startBtn=document.getElementById("startBtn");const restartBtn=document.getElementById("restartBtn");
const overlay=document.getElementById("overlay");const overlayRestart=document.getElementById("overlayRestart");
const scoresEl=document.getElementById("scores");const phaseEl=document.getElementById("phase");
const timerEl=document.getElementById("timer");const hostBadge=document.getElementById("hostBadge");

let state={apples:[],players:[],phase:"lobby",timeRemainingMs:0,hostId:null};let you={id:null};

function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);
for(const a of state.apples){ctx.fillStyle="red";ctx.fillRect(a.x*20,a.y*20,20,20);}for(const p of state.players){ctx.fillStyle=p.color;for(const s of p.snake){ctx.fillRect(s.x*20,s.y*20,20,20);}}}
function updateScores(){scoresEl.innerHTML="";state.players.forEach(p=>{const li=document.createElement("li");li.textContent=`${p.name} ${p.score}`;scoresEl.appendChild(li);});}
function msToClock(ms){const s=Math.floor(ms/1000);return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;}
function renderPhase(){phaseEl.textContent=`Phase: ${state.phase}`;hostBadge.classList.toggle("hidden",you.id!==state.hostId);
startBtn.classList.toggle("hidden",!(state.phase==="lobby"&&you.id===state.hostId));
restartBtn.classList.toggle("hidden",!(state.phase!=="lobby"&&you.id===state.hostId));
overlayRestart.classList.toggle("hidden",!(state.phase==="ended"&&you.id===state.hostId));
if(state.phase==="ended")overlay.classList.remove("hidden");else overlay.classList.add("hidden");
timerEl.textContent=state.phase==="playing"?`⏱ ${msToClock(state.timeRemainingMs)}`:"";}

const socket=io();
socket.on("connect",()=>{socket.emit("hello",{name:(new URLSearchParams(location.search)).get("name")||""});});
socket.on("helloAck",d=>{you=d.you;state.phase=d.phase;state.hostId=d.hostId;renderPhase();});
socket.on("state",s=>{state=s;draw();updateScores();renderPhase();});
saveNameBtn.onclick=()=>socket.emit("setName",nameInput.value);startBtn.onclick=()=>socket.emit("start");restartBtn.onclick=()=>socket.emit("restart");overlayRestart.onclick=()=>socket.emit("restart");
window.addEventListener("keydown",e=>{const map={ArrowUp:"up",ArrowDown:"down",ArrowLeft:"left",ArrowRight:"right"};if(map[e.key])socket.emit("dir",map[e.key]);});
