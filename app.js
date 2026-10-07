// Utility to fetch JSON via fetch API
async function fetchJSON(url){const res=await fetch(url, {headers:{'Accept':'application/json'}});if(!res.ok) throw new Error(`Network error ${res.status}`);return await res.json();}

// Draw gauge with value and label
function drawGauge(value){const svg=document.getElementById('gauge');const radius=80;const cx=svg.width/2, cy=svg.height/2;const startAngle=Math.PI;const endAngle=Math.PI*(value/100+1);svg.innerHTML='';
const arc=new Path2D();arc.arc(cx,cy,radius,startAngle,endAngle,false);
const ctx=svg.getContext('2d');ctx.clearRect(0,0,svg.width,svg.height);
ctx.strokeStyle='var(--secondary)';ctx.lineWidth=10;ctx.stroke(arc);
ctx.fillStyle='var(--text)';ctx.font='20px Arial';ctx.textAlign='center';ctx.fillText(`${value} / 5`, cx, cy+5);
}

// Init: fetch metrics and audits
(async()=>{try{const meta=await fetchJSON('https://script.google.com/macros/s/AKfycbyDtJAWnp5ushY_fKztxS9h1d34_KVSCjVEDfSQnF_9yBur1pOGhcfuvRXIDWN86alw/exec?req=metrics');const gaugeVal=meta.score/5*100;drawGauge(gaugeVal);
const audits=await fetchJSON('https://script.google.com/macros/s/AKfycbyDtJAWnp5ushY_fKztxS9h1d34_KVSCjVEDfSQnF_9yBur1pOGhcfuvRXIDWN86alw/exec?req=audits');const tbody=document.querySelector('.matrix-table tbody');tbody.innerHTML='';audits.forEach(a=>{const tr=document.createElement('tr');tr.innerHTML=`<td>${a.date}</td><td>${a.visits}</td><td>${a.orders}</td>`;tbody.appendChild(tr);});}
catch(e){console.error(e);}
})();

// Modal logic
const modal=document.getElementById('modal');const btn=document.getElementById('openModal');const close=document.getElementById('closeModal');btn.onclick=()=>modal.style.display='block';close.onclick=()=>modal.style.display='none';window.onclick=e=>{if(e.target===modal)modal.style.display='none';};