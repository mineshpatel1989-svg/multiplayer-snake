const canvas=document.getElementById("game");const ctx=canvas.getContext("2d");
let state={apples:[],players:[],grid:{width:48,height:32}};const socket=io();
socket.on("state",s=>{state=s;draw();});
function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);
for(const a of state.apples){ctx.fillStyle="red";ctx.fillRect(a.x*20,a.y*20,20,20);}
for(const p of state.players){if(p.spectator)continue;ctx.fillStyle=p.color;for(const s of p.snake){ctx.fillRect(s.x*20,s.y*20,20,20);}}}
