// Dashboard HTML — backtick chars inside JS are written as \x60 to avoid TS template literal conflicts

const CSS = `
  :root {
    --bg:#0d0f17;--surface:#13151f;--surface2:#1c1f2e;--border:#252839;
    --text:#e2e8f0;--muted:#4a5568;--green:#22c55e;--yellow:#f59e0b;
    --red:#ef4444;--blue:#3b82f6;--critical:#dc2626;--error:#ef4444;
    --warn:#f59e0b;--info:#3b82f6;--font:'SF Mono','Fira Code','Consolas',monospace;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.5}
  header{background:var(--surface);border-bottom:1px solid var(--border);padding:10px 20px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:10}
  header h1{font-size:15px;font-weight:600;letter-spacing:-.2px;display:flex;align-items:center}
  .dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:7px;flex-shrink:0}
  .dot.live{background:var(--green);animation:pulse 2s infinite}
  .dot.dead{background:var(--red)}
  .hdr-stat{color:var(--muted);font-size:12px}
  .hdr-stat b{color:var(--text);font-weight:500}
  .badge{padding:2px 7px;border-radius:2px;font-size:11px;font-weight:600;letter-spacing:.5px}
  .badge-green{background:rgba(34,197,94,.12);color:var(--green)}
  .badge-red{background:rgba(239,68,68,.12);color:var(--red)}
  .badge-yellow{background:rgba(245,158,11,.12);color:var(--yellow)}
  .badge-blue{background:rgba(59,130,246,.12);color:var(--blue)}
  .badge-muted{background:var(--surface2);color:var(--muted)}
  #conn-status{margin-left:auto;font-size:11px}
  nav{display:flex;gap:0;padding:0 16px;background:var(--surface);border-bottom:1px solid var(--border);overflow-x:auto}
  nav button{background:none;border:none;border-bottom:2px solid transparent;color:var(--muted);cursor:pointer;padding:8px 14px;font-size:12px;font-weight:500;white-space:nowrap;transition:color .1s,border-color .1s}
  nav button:hover{color:var(--text)}
  nav button.active{color:var(--text);border-bottom-color:var(--blue)}
  main{padding:0}
  .tab{display:none} .tab.active{display:block}
  .grid{display:grid;gap:0;border-top:1px solid var(--border);border-left:1px solid var(--border)} .grid-2{grid-template-columns:1fr 1fr} .grid-3{grid-template-columns:1fr 1fr 1fr}
  @media(max-width:900px){.grid-2,.grid-3{grid-template-columns:1fr}}
  .card{background:var(--surface);border-right:1px solid var(--border);border-bottom:1px solid var(--border);padding:16px 20px}
  .card h2{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)}
  .stat-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px}
  .stat-row:last-child{border-bottom:none}
  .stat-val{font-family:var(--font);color:var(--text);font-weight:600}
  .empty{color:var(--muted);font-size:12px;text-align:center;padding:32px;font-family:var(--font)}
  .alert-item{padding:10px 14px;border-left:2px solid;background:var(--surface2);margin-bottom:1px}
  .alert-item.critical{border-color:var(--critical)} .alert-item.error{border-color:var(--error)}
  .alert-item.warn{border-color:var(--warn)} .alert-item.info{border-color:var(--info)}
  .alert-title{font-weight:600;font-size:13px}
  .alert-detail{font-size:12px;color:var(--muted);margin-top:2px}
  .alert-meta{font-size:11px;color:var(--muted);margin-top:4px;font-family:var(--font)}
  .agent-card{border-left:2px solid var(--blue);padding-left:12px;margin-bottom:12px}
  .agent-name{font-size:15px;font-weight:700}
  .doc-preview{background:var(--bg);border:1px solid var(--border);padding:12px;font-size:12px;font-family:var(--font);white-space:pre-wrap;word-break:break-word;max-height:200px;overflow-y:auto;color:var(--muted);line-height:1.6;margin-top:8px}
  .cron-item{padding:10px 14px;border-bottom:1px solid var(--border);background:var(--surface2)}
  .cron-item:last-child{border-bottom:none}
  .cron-item.error{border-left:2px solid var(--red)} .cron-item.success{border-left:2px solid var(--green)}
  .cron-name{font-weight:600;font-size:13px}
  .cron-meta{font-size:12px;color:var(--muted);margin-top:2px;font-family:var(--font)}
  .cron-error{font-size:11px;color:var(--red);margin-top:4px;font-family:var(--font);word-break:break-all}
  .session-item{padding:8px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px}
  .session-item:last-child{border-bottom:none}
  .session-key{font-family:var(--font);font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .session-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
  .session-dot.active{background:var(--green);box-shadow:0 0 4px var(--green)} .session-dot.idle{background:var(--muted)}
  .diag-item{font-size:12px;font-family:var(--font);padding:4px 10px;border-bottom:1px solid var(--border);color:var(--muted)}
  .diag-item:last-child{border-bottom:none}
  .diag-ts{color:var(--blue);margin-right:8px} .diag-type{color:var(--text)}
  .delivery-item{padding:8px 14px;border-bottom:1px solid var(--border);font-size:12px}
  .delivery-item:last-child{border-bottom:none}
  .delivery-item.pending{border-left:2px solid var(--yellow)} .delivery-item.failed{border-left:2px solid var(--red)}
  .hb-row{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px}
  .pulse{width:7px;height:7px;border-radius:50%;animation:pulse 2s infinite}
  .pulse.ok{background:var(--green);box-shadow:0 0 0 0 rgba(34,197,94,.7)} .pulse.err{background:var(--red);animation:none}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,.7)}70%{box-shadow:0 0 0 6px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
  .scrollable{max-height:400px;overflow-y:auto}
  .section{margin-bottom:0}
  .ts{color:var(--muted);font-size:11px}
  /* ── Overview two-panel layout ── */
  .ov-layout{display:flex;height:calc(100vh - 88px);overflow:hidden}
  .ov-panel{display:flex;flex-direction:column;overflow:hidden;flex:1;min-width:0}
  .ov-right{width:300px;flex-shrink:0;display:flex;flex-direction:column;border-left:1px solid var(--border)}
  .panel-hdr{background:var(--surface);padding:6px 12px;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:space-between}
  .panel-scroll{flex:1;overflow-y:auto;min-height:0}
  .panel-scroll::-webkit-scrollbar{width:5px}
  .panel-scroll::-webkit-scrollbar-thumb{background:var(--border)}
  .ov-stat-row{display:flex;justify-content:space-between;align-items:center;padding:5px 12px;border-bottom:1px solid var(--border);font-size:12px}
  .ov-stat-row:last-child{border-bottom:none}
  /* ── Overview panel content indent ── */
  .ov-panel .panel-scroll{padding-left:10px}
  /* ── Log-style activity feed ── */
  .log-row{display:flex;align-items:baseline;gap:6px;padding:3px 0;border-bottom:1px solid rgba(37,40,57,.6);font-size:12px;font-family:var(--font);line-height:1.4}
  .log-row:last-child{border-bottom:none}
  .log-ts{color:var(--blue);flex-shrink:0;font-size:11px;min-width:60px}
  .log-sub{flex-shrink:0;width:56px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:var(--muted)}
  .log-msg{flex:1;color:var(--text);word-break:break-word;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .log-sk{font-size:10px;color:var(--muted);flex-shrink:0;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .log-ok .log-sub{color:var(--green)} .log-ok .log-msg{color:var(--muted);font-size:11px}
  .log-err .log-sub{color:var(--red)} .log-err .log-msg{color:var(--red)}
  .log-warn .log-sub{color:var(--yellow)} .log-warn .log-msg{color:var(--yellow)}
  .log-info .log-sub{color:var(--blue)} .log-info .log-msg{color:var(--text)}
  .log-user .log-sub{color:#a78bfa} .log-user .log-msg{color:var(--text);font-style:italic}
  .log-tool .log-sub{color:#a78bfa} .log-tool .log-msg{color:var(--text)}
  .log-dim .log-msg,.log-dim .log-sub{color:var(--muted)}
  /* ── Heartbeat debug row ── */
  .hbd-row{display:flex;align-items:center;gap:8px;padding:3px 12px;border-bottom:1px solid rgba(37,40,57,.6);font-size:12px;font-family:var(--font)}
  .hbd-row:last-child{border-bottom:none}
  .hbd-ts{color:var(--blue);font-size:11px;flex-shrink:0;min-width:60px}
  .hbd-body{flex:1;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .hbd-ok{color:var(--green);font-weight:600} .hbd-err{color:var(--red);font-weight:600}
  .hbd-kv{color:var(--muted);font-size:11px} .hbd-kv span{color:var(--text)}
  .hbd-ago{color:var(--muted);font-size:10px;flex-shrink:0}
  /* ── Gateway gate overlay ── */
  #gw-gate{position:fixed;inset:0;z-index:100;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;transition:opacity .4s}
  #gw-gate.hidden{opacity:0;pointer-events:none}
  .gate-spinner{width:36px;height:36px;border:2px solid var(--border);border-top-color:var(--blue);border-radius:50%;animation:spin 1s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .gate-title{font-size:16px;font-weight:600;color:var(--text)}
  .gate-sub{font-size:12px;color:var(--muted);text-align:center;max-width:340px;line-height:1.7}
  .gate-url{font-family:var(--font);font-size:12px;color:var(--blue);background:var(--surface);padding:3px 10px;border:1px solid var(--border)}
  .gate-dot{width:6px;height:6px;border-radius:50%;background:var(--yellow);animation:pulse 1.4s infinite;display:inline-block;margin-right:6px}
  /* ── Live Monitor ── */
  #tab-live{margin:0}
  .live-layout{display:flex;height:calc(100vh - 88px);min-height:500px;overflow:hidden}
  .live-sidebar{width:220px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--border);padding:8px 0;background:var(--surface);display:flex;flex-direction:column;gap:0}
  .live-sidebar-hdr{font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;padding:6px 12px 8px;flex-shrink:0;border-bottom:1px solid var(--border);margin-bottom:4px}
  .live-main{flex:1;overflow-y:auto;padding:8px 0}
  .live-sess-item{padding:6px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;border-left:2px solid transparent;transition:background .1s}
  .live-sess-item:hover{background:var(--surface2)}
  .live-sess-item.lsel{background:var(--surface2);border-left-color:var(--blue)}
  .live-sess-key{font-family:var(--font);font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}
  .live-sess-meta{font-size:10px;color:var(--muted);margin-top:1px}
  .live-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;background:var(--muted)}
  .live-dot.ok{background:var(--green);box-shadow:0 0 4px var(--green)}
  .live-dot.think{background:var(--yellow);box-shadow:0 0 4px var(--yellow);animation:pulse 1.2s infinite}
  .run-card{background:var(--surface);border:1px solid var(--border);margin-bottom:1px;overflow:hidden}
  .run-header{padding:7px 12px;background:var(--surface2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:6px;font-size:12px;flex-wrap:wrap}
  .run-skey{font-family:var(--font);font-size:11px;color:var(--blue);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .run-steps{padding:4px 12px 8px}
  .step-item{display:flex;align-items:flex-start;gap:8px;padding:5px 0;font-size:12px;border-bottom:1px solid rgba(37,40,57,.6)}
  .step-item:last-child{border-bottom:none}
  .step-ic{width:16px;text-align:center;flex-shrink:0;font-size:12px;color:var(--muted);margin-top:2px}
  .step-body{flex:1;min-width:0}
  .step-lbl{font-weight:600;color:var(--text)}
  .step-txt{color:var(--muted);font-size:11px;font-family:var(--font);margin-top:2px;white-space:pre-wrap;word-break:break-word;max-height:80px;overflow:hidden}
  .step-ts{font-size:10px;color:var(--muted);flex-shrink:0;font-family:var(--font);margin-top:2px}
  .s-user .step-lbl{color:var(--text)} .s-user .step-ic{color:#a78bfa}
  .s-start .step-ic{color:var(--green)}
  .s-done .step-lbl{color:var(--green)} .s-done .step-ic{color:var(--green)}
  .s-err .step-lbl{color:var(--red)} .s-err .step-ic{color:var(--red)}
  .s-tool .step-ic{color:var(--blue)} .s-tool .step-lbl{color:var(--blue)}
  .s-stream .step-lbl{color:var(--muted)}
  .live-empty{display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:12px;text-align:center;line-height:2;font-family:var(--font)}
`;

const BODY = `
<div id="gw-gate">
  <div class="gate-spinner"></div>
  <div class="gate-title">Connecting to OpenClaw&hellip;</div>
  <div class="gate-sub">
    <span class="gate-dot"></span>Waiting for the OpenClaw gateway at<br>
    <span class="gate-url" id="gate-url">ws://127.0.0.1:18789</span>
  </div>
  <div class="gate-sub" style="font-size:12px">Make sure OpenClaw is running: <code style="font-family:var(--font)">openclaw gateway run</code></div>
</div>
<header>
  <h1><span class="dot dead" id="sDot"></span>OpenAlerts</h1>
  <span class="hdr-stat" id="hdr-conn">connecting&hellip;</span>
  <span class="hdr-stat">sessions: <b id="sess-val">--</b></span>
  <span class="hdr-stat">queue: <b id="queue-val">0</b></span>
  <span class="hdr-stat">tools: <b id="hdr-tools">0</b></span>
  <span class="hdr-stat">err: <b id="hdr-errs">0</b></span>
  <span id="conn-status" class="badge badge-muted" style="margin-left:auto">connecting&hellip;</span>
</header>
<nav>
  <button class="active" onclick="showTab('overview',this)">Overview</button>
  <button onclick="showTab('agents',this)">Workspaces</button>
  <button onclick="showTab('alerts',this)">Alerts <span id="alert-count-badge"></span></button>
  <button onclick="showTab('sessions',this)">Sessions</button>
  <button onclick="showTab('live',this)">&#9654; Live Monitor</button>
  <button onclick="showTab('cron',this)">Cron Jobs</button>
  <button onclick="showTab('diagnostics',this)">Diagnostics</button>
  <button onclick="showTab('delivery',this)">Delivery Queue</button>
</nav>
<main>
<div id="tab-overview" class="tab active">
  <div class="ov-layout">
    <div class="ov-panel">
      <div class="panel-hdr"><span>Live Activity</span><span id="ov-ev-cnt" style="font-weight:400">0</span></div>
      <div class="panel-scroll" id="live-diag"><div class="empty">Waiting for events&hellip;</div></div>
    </div>
    <div class="ov-right">
      <div class="panel-hdr">Recent Alerts</div>
      <div class="panel-scroll" style="max-height:220px" id="overview-alerts"><div class="empty">No alerts</div></div>
      <div class="panel-hdr" style="border-top:1px solid var(--border)">24h Stats</div>
      <div class="ov-stat-row"><span>Agent runs</span><span class="stat-val" id="s-agent-starts">0</span></div>
      <div class="ov-stat-row"><span>Tool calls</span><span class="stat-val" id="s-tool-calls">0</span></div>
      <div class="ov-stat-row"><span>Errors</span><span class="stat-val" id="s-errors">0</span></div>
      <div class="ov-stat-row"><span>Tokens</span><span class="stat-val" id="s-tokens">0</span></div>
      <div class="ov-stat-row" style="border-bottom:none"><span>Cost (24h)</span><span class="stat-val" id="s-cost">$0.00</span></div>
      <div class="panel-hdr" style="border-top:1px solid var(--border)">Gateway Health</div>
      <div class="panel-scroll" id="hb-log"><div class="empty">No heartbeats yet</div></div>
    </div>
  </div>
</div>
<div id="tab-agents" class="tab"><div class="grid grid-2" id="agents-grid"><div class="empty">Loading&hellip;</div></div></div>
<div id="tab-alerts" class="tab"><div id="alerts-list"></div></div>
<div id="tab-sessions" class="tab"><div id="sessions-list"></div></div>
<div id="tab-live" class="tab">
  <div class="live-layout">
    <div class="live-sidebar">
      <div class="live-sidebar-hdr">Sessions</div>
      <div id="live-sess-list"></div>
    </div>
    <div class="live-main" id="live-runs">
      <div class="live-empty">No activity yet &mdash; waiting for agent events&hellip;<br><span style="font-size:11px;color:var(--muted)">Events appear here as Claude runs tools and calls the LLM</span></div>
    </div>
  </div>
</div>
<div id="tab-cron" class="tab"><div id="cron-list"></div></div>
<div id="tab-diagnostics" class="tab"><div id="diag-list"></div></div>
<div id="tab-delivery" class="tab"><div id="delivery-list"></div></div>
</main>
`;

// JS uses only single/double quotes — no backtick literals inside, safe to embed in template
const SCRIPT = `
/* ── Gateway gate ─────────────────────────────────────────────────────────── */
var gateOpen = true;
function dismissGate(){
  if(!gateOpen) return;
  gateOpen = false;
  var g = document.getElementById('gw-gate');
  if(g){ g.classList.add('hidden'); setTimeout(function(){ g.style.display='none'; }, 450); }
  var dot=document.getElementById('sDot');
  if(dot) dot.className='dot live';
  var hc=document.getElementById('hdr-conn');
  if(hc){hc.style.color='';hc.textContent='connected';}
}
function checkGateway(){
  fetch('/api/engine').then(function(r){ return r.json(); }).then(function(d){
    if(d.gatewayConnected) dismissGate();
  }).catch(function(){});
}
/* Check immediately on load, then every 3s until connected */
checkGateway();
var gateTimer = setInterval(function(){
  if(!gateOpen){ clearInterval(gateTimer); return; }
  checkGateway();
}, 3000);

function showTab(name,btn){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active')});
  document.querySelectorAll('nav button').forEach(function(b){b.classList.remove('active')});
  document.getElementById('tab-'+name).classList.add('active');
  if(btn) btn.classList.add('active');
  if(name==='live') renderLiveTab();
}
function fmtTs(ms){
  if(!ms) return '--';
  return new Date(ms).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function fmtAgo(ms){
  if(!ms) return '--';
  var diff=Date.now()-ms;
  if(diff<60000) return Math.round(diff/1000)+'s ago';
  if(diff<3600000) return Math.round(diff/60000)+'m ago';
  return Math.round(diff/3600000)+'h ago';
}
function fmtDur(ms){
  if(!ms) return '';
  if(ms<1000) return ms+'ms';
  return (ms/1000).toFixed(1)+'s';
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function svr(sev){var m={critical:'badge-red',error:'badge-red',warn:'badge-yellow',warning:'badge-yellow',info:'badge-blue'};return '<span class="badge '+(m[sev]||'badge-muted')+'">'+esc(sev)+'</span>'}
var state={agents:[],cronJobs:[],sessions:[],recentAlerts:[],recentDiagnostics:[],recentHeartbeats:[],pendingDeliveries:[],recentActions:[]};
var engineState={running:false,stats:{}};
var liveActivityLog=[];   // mixed diagnostic + action events for overview feed, newest first
/* helpers for activity log */
function actSub(type){
  if(!type) return 'sys';
  var t=String(type);
  if(t==='user_message') return 'user';
  if(t==='tool_call'||t==='tool_result') return 'tool';
  if(t==='start'||t==='complete'||t==='streaming') return 'agent';
  if(t==='error'||t==='aborted') return 'agent';
  if(t==='exec') return 'exec';
  var prefix=t.split('.')[0];
  if(prefix==='llm') return 'llm';
  if(prefix==='tool') return 'tool';
  if(prefix==='agent') return 'agent';
  if(prefix==='infra') return 'infra';
  if(prefix==='session') return 'sess';
  return 'sys';
}
function actCls(type){
  if(!type) return 'log-dim';
  var t=String(type).toLowerCase();
  if(t.indexOf('error')>=0||t.indexOf('fail')>=0) return 'log-err';
  if(t.indexOf('warn')>=0) return 'log-warn';
  if(t==='user_message') return 'log-user';
  if(t==='tool_call'||t==='tool.call') return 'log-tool';
  if(t==='tool_result') return 'log-dim';
  if(t==='streaming') return 'log-dim';
  if(t==='complete'||t.indexOf('agent.end')>=0) return 'log-ok';
  if(t==='start'||t.indexOf('agent.start')>=0) return 'log-info';
  if(t.indexOf('llm')>=0) return 'log-info';
  if(t==='infra.heartbeat'||t==='infra.heartbeat:success') return 'log-dim';
  return '';
}
function actMsg(type, summary, toolName, content){
  /* diagnostic events have summary like "agent.start" or "tool.call" or "infra.heartbeat:success" */
  if(summary){
    var s=String(summary);
    if(s==='infra.heartbeat:success'||s==='infra.heartbeat') return 'heartbeat ok';
    if(s==='infra.heartbeat:error') return 'heartbeat FAIL';
    var ci=s.indexOf(':');
    if(ci>0){var after=s.substring(ci+1); if(after) return after;}
    return s;
  }
  /* action events */
  if(type==='user_message') return 'user message';
  if(type==='start') return 'agent started';
  if(type==='streaming') return 'thinking\u2026';
  if(type==='tool_call') return (toolName?'tool: '+toolName:'tool call');
  if(type==='tool_result') return 'tool result received';
  if(type==='complete') return 'response complete'+(content?' \u2014 '+content.substring(0,50):'');
  if(type==='error') return 'error'+(content?' \u2014 '+content.substring(0,60):'');
  if(type==='aborted') return 'aborted';
  if(type==='exec') return 'exec'+(toolName?' '+toolName:'');
  return type||'event';
}
function pushActivity(entry){
  liveActivityLog.unshift(entry);
  if(liveActivityLog.length>80) liveActivityLog.pop();
  var cnt=document.getElementById('ov-ev-cnt');
  if(cnt) cnt.textContent=String(liveActivityLog.length);
}

/* ── Live Monitor state ────────────────────────────────────────────────────── */
var liveRuns={};        // runId -> run object
var runOrder=[];        // runIds newest-first
var filterKey=null;     // currently selected sessionKey (null = all)
var liveSessions={};    // sessionKey -> {status, lastActivity, agentId}

function shortKey(k){
  if(!k) return '?';
  var parts=String(k).split(':');
  var id=parts[parts.length-1]||k;
  return id.length>14 ? id.substring(0,14)+'\u2026' : id;
}
function safeKey(k){ return String(k||'').replace(/['"]/g,''); }

function stepCls(type){
  if(type==='user_message') return 's-user';
  if(type==='complete') return 's-done';
  if(type==='error'||type==='aborted') return 's-err';
  if(type==='tool_call') return 's-tool';
  if(type==='tool_result') return 's-tool';
  if(type==='streaming') return 's-stream';
  if(type==='start') return 's-start';
  return '';
}
function stepIc(type){
  if(type==='user_message') return '\u{1F4AC}';
  if(type==='start') return '\u25b6';
  if(type==='streaming') return '\u22ef';
  if(type==='tool_call') return '\u26a1';
  if(type==='tool_result') return '\u21a9';
  if(type==='complete') return '\u2713';
  if(type==='error') return '\u2717';
  if(type==='aborted') return '\u2298';
  if(type==='exec') return '$';
  return '\u2022';
}
function stepLbl(type,eventType,toolName,platform){
  if(type==='user_message'){
    var src=platform?(' <span class="badge badge-muted" style="font-size:9px">'+esc(platform)+'</span>'):'';
    return 'User message'+src;
  }
  if(type==='start') return 'Agent start';
  if(type==='streaming') return 'Thinking\u2026';
  if(type==='tool_call') return 'Tool: '+(toolName||eventType||'?');
  if(type==='tool_result') return 'Tool result';
  if(type==='complete'){
    return eventType==='exec' ? 'Exec done' : 'Response complete';
  }
  if(type==='error') return 'Error';
  if(type==='aborted') return 'Aborted';
  if(type==='exec') return 'Exec: '+(toolName||'?');
  return type;
}

function handleLiveAction(a){
  var runId=a.runId;
  if(!runId) return;
  var sessionKey=a.sessionKey||'';

  // Update session tracker
  if(sessionKey){
    if(!liveSessions[sessionKey]) liveSessions[sessionKey]={status:'active',lastActivity:a.ts,agentId:''};
    liveSessions[sessionKey].lastActivity=a.ts;
    if(a.type==='start'||a.type==='streaming') liveSessions[sessionKey].status='thinking';
    else if(a.type==='complete'||a.type==='error'||a.type==='aborted') liveSessions[sessionKey].status='active';
  }

  // Create run if new
  if(!liveRuns[runId]){
    liveRuns[runId]={runId:runId,sessionKey:sessionKey,steps:[],startTs:a.ts,endTs:null,toolCount:0,tokIn:0,tokOut:0};
    runOrder.unshift(runId);
    if(runOrder.length>30){ var old=runOrder.pop(); delete liveRuns[old]; }
  }
  var run=liveRuns[runId];
  if(!run.sessionKey && sessionKey) run.sessionKey=sessionKey;

  // Coalesce consecutive streaming steps
  if(a.type==='streaming'){
    var last=run.steps[run.steps.length-1];
    if(last && last.type==='streaming'){
      if(a.content) last.content=(last.content||'')+a.content;
      last.ts=a.ts;
      return;
    }
  }

  if(a.type==='tool_call') run.toolCount++;
  if(a.inputTokens) run.tokIn+=a.inputTokens;
  if(a.outputTokens) run.tokOut+=a.outputTokens;
  if(a.type==='complete'||a.type==='error'||a.type==='aborted') run.endTs=a.ts;

  run.steps.push({
    type:a.type, eventType:a.eventType||'', toolName:a.toolName||'',
    content:a.content||'', ts:a.ts, durationMs:a.durationMs||0,
    inputTokens:a.inputTokens||0, outputTokens:a.outputTokens||0,
    platform:a.platform||''
  });
}

function handleLiveHealth(h){
  var sessions=Array.isArray(h.sessions)?h.sessions:[];
  var now=h.ts||Date.now();
  sessions.forEach(function(s){
    var k=s.key||s.sessionKey;
    if(!k) return;
    if(!liveSessions[k]) liveSessions[k]={status:s.status||'active',lastActivity:s.lastActivityAt||now,agentId:s.agentId||''};
    else{
      if(s.lastActivityAt) liveSessions[k].lastActivity=s.lastActivityAt;
      if(s.agentId) liveSessions[k].agentId=s.agentId;
      if(s.status) liveSessions[k].status=s.status;
    }
  });
  // Also update gateway status indicator on overview tab
  var gwEl=document.getElementById('gw-val');
  if(gwEl) gwEl.textContent='connected';
  var sessEl=document.getElementById('sess-val');
  if(sessEl) sessEl.textContent=String(h.activeSessions||sessions.length||0);
  var qEl=document.getElementById('queue-val');
  if(qEl) qEl.textContent=String(h.queueDepth||0);
  var hbEl=document.getElementById('hb-val');
  if(hbEl) hbEl.textContent=fmtTs(now);
}

function handleLiveExec(ex){
  var runId=ex.runId;
  if(!runId) return;
  if(!liveRuns[runId]){
    liveRuns[runId]={runId:runId,sessionKey:ex.sessionId||'',steps:[],startTs:ex.ts||Date.now(),endTs:null,toolCount:0,tokIn:0,tokOut:0};
    runOrder.unshift(runId);
    if(runOrder.length>30){ var o2=runOrder.pop(); delete liveRuns[o2]; }
  }
  var r2=liveRuns[runId];
  if(ex.type==='started'){
    r2.steps.push({type:'exec',eventType:'exec',toolName:(ex.command||'').substring(0,40),content:'pid '+ex.pid,ts:ex.ts||Date.now(),durationMs:0,inputTokens:0,outputTokens:0});
  } else if(ex.type==='completed'){
    var ok=ex.exitCode===0;
    r2.steps.push({type:ok?'complete':'error',eventType:'exec',toolName:'exec',content:'exit '+ex.exitCode+(ex.durationMs?' ('+fmtDur(ex.durationMs)+')':''),ts:ex.ts||Date.now(),durationMs:ex.durationMs||0,inputTokens:0,outputTokens:0});
    if(!ok) r2.endTs=ex.ts||Date.now();
  } else if(ex.type==='output' && ex.output){
    // Coalesce exec output into last exec step
    var ls=r2.steps[r2.steps.length-1];
    if(ls && ls.type==='exec') ls.content=(ls.content||'')+'\\n'+(ex.output||'').substring(0,100);
  }
}

function renderRunCard(runId){
  var run=liveRuns[runId];
  if(!run) return '';
  if(filterKey && run.sessionKey !== filterKey) return '';

  var dur=run.endTs ? fmtDur(run.endTs-run.startTs) : '';
  var toks=run.tokIn+run.tokOut;

  var hdr='<div class="run-header">'
    +'<span class="run-skey">'+esc(shortKey(run.sessionKey))+'</span>'
    +(run.toolCount?'<span class="badge badge-blue">'+run.toolCount+' tools</span>':'')
    +(toks?'<span class="badge badge-muted">'+toks+' tok</span>':'')
    +'<span class="badge badge-muted">'+fmtTs(run.startTs)+'</span>'
    +(run.endTs?'<span class="badge badge-muted">'+dur+'</span>':'<span class="badge badge-green">live</span>')
    +'</div>';

  var steps=run.steps.map(function(s){
    var cls=stepCls(s.type);
    var txt=s.content?s.content.substring(0,250):'';
    return '<div class="step-item '+cls+'">'
      +'<div class="step-ic">'+stepIc(s.type)+'</div>'
      +'<div class="step-body">'
      +'<div class="step-lbl">'+stepLbl(s.type,s.eventType,s.toolName,s.platform)
      +(s.durationMs?' <span style="color:var(--muted);font-weight:400">('+fmtDur(s.durationMs)+')</span>':'')
      +(s.inputTokens?' <span style="color:var(--muted);font-weight:400;font-size:10px">'+s.inputTokens+'+'+s.outputTokens+' tok</span>':'')
      +'</div>'
      +(txt?'<div class="step-txt">'+esc(txt)+'</div>':'')
      +'</div>'
      +'<div class="step-ts">'+fmtTs(s.ts)+'</div>'
      +'</div>';
  }).join('');

  return '<div class="run-card">'+hdr+'<div class="run-steps">'+(steps||'<div class="empty" style="padding:8px">Starting\u2026</div>')+'</div></div>';
}

function renderLiveSessions(){
  var el=document.getElementById('live-sess-list');
  if(!el) return;
  var keys=Object.keys(liveSessions).sort(function(a,b){return (liveSessions[b].lastActivity||0)-(liveSessions[a].lastActivity||0);});
  var html='<div class="live-sess-item '+(filterKey?'':'lsel')+'" onclick="filterLive(null)">'
    +'<div class="live-dot ok"></div>'
    +'<div><div class="live-sess-key">All sessions</div>'
    +'<div class="live-sess-meta">'+runOrder.length+' runs buffered</div></div>'
    +'</div>';
  html+=keys.map(function(k){
    var s=liveSessions[k];
    var dotCls=s.status==='thinking'?'think':(s.status==='active'?'ok':'');
    var sk=safeKey(k);
    return '<div class="live-sess-item '+(filterKey===k?'lsel':'')+'" onclick="filterLive(\\''+sk+'\\')">'+
      '<div class="live-dot '+dotCls+'"></div>'
      +'<div style="flex:1;min-width:0">'
      +'<div class="live-sess-key">'+esc(shortKey(k))+'</div>'
      +'<div class="live-sess-meta">'+(s.status==='thinking'?'\u22ef thinking':'')+(s.status==='active'?fmtAgo(s.lastActivity):'')+'</div>'
      +'</div>'
      +'</div>';
  }).join('');
  el.innerHTML=html;
}

function renderLiveTab(){
  renderLiveSessions();
  var el=document.getElementById('live-runs');
  if(!el) return;
  var cards=runOrder.map(renderRunCard).filter(function(c){return !!c;});
  if(!cards.length){
    el.innerHTML='<div class="live-empty">No activity yet &mdash; waiting for agent events&hellip;<br><span style="font-size:11px;color:var(--muted)">Events appear here as Claude runs tools and calls the LLM</span></div>';
    return;
  }
  el.innerHTML=cards.join('');
}

function filterLive(key){
  filterKey=key;
  renderLiveTab();
}

/* ── Standard render functions ─────────────────────────────────────────────── */
function renderOverview(){
  var al=state.recentAlerts||[];
  var cb=document.getElementById('alert-count-badge');
  if(cb) cb.innerHTML=al.length?'<span class="badge badge-red">'+al.length+'</span>':'';
  var oa=document.getElementById('overview-alerts');
  if(oa){
    if(!al.length){oa.innerHTML='<div class="empty">No alerts</div>';}
    else{oa.innerHTML=al.slice(0,5).map(function(a){return '<div class="alert-item '+esc(a.severity)+'"><div class="alert-title">'+esc(a.title)+'</div><div class="alert-meta">'+esc(a.rule_id)+' &middot; '+fmtTs(a.ts)+'</div></div>';}).join('');}
  }
  var hbs=state.recentHeartbeats||[];
  var hbEl=document.getElementById('hb-log');
  if(hbEl){
    if(!hbs.length){hbEl.innerHTML='<div class="empty">No heartbeats yet</div>';}
    else{hbEl.innerHTML=hbs.slice(0,30).map(function(h){
      var ok=!!h.gateway_connected;
      return '<div class="hbd-row">'
        +'<span class="hbd-ts">'+fmtTs(h.ts)+'</span>'
        +'<div class="pulse '+(ok?'ok':'err')+'" style="flex-shrink:0"></div>'
        +'<div class="hbd-body">'
        +(ok?'<span class="hbd-ok">connected</span>':'<span class="hbd-err">disconnected</span>')
        +(h.active_sessions!=null?'<span class="hbd-kv">sessions=<span>'+h.active_sessions+'</span></span>':'')
        +'<span class="hbd-kv">queue=<span'+(h.queue_depth?'>'+h.queue_depth+' &#9654;':' style="color:var(--muted)">0')+'</span></span>'
        +'</div>'
        +'<span class="hbd-ago">'+fmtAgo(h.ts)+'</span>'
        +'</div>';
    }).join('');}
  }
  /* live activity log — mix of diagnostic + action events */
  var ld=document.getElementById('live-diag');
  if(ld){
    /* seed from state.recentDiagnostics on first state push if liveActivityLog is empty */
    var src = liveActivityLog.length ? liveActivityLog : (state.recentDiagnostics||[]).map(function(d){
      return {ts:d.ts,sub:actSub(d.event_type),cls:actCls(d.event_type||d.summary||''),msg:actMsg(null,d.summary||d.event_type,null,null),sk:d.session_key||''};
    });
    if(!src.length){ld.innerHTML='<div class="empty">No events yet</div>';}
    else{ld.innerHTML=src.slice(0,40).map(function(e){
      return '<div class="log-row '+esc(e.cls)+'">'
        +'<span class="log-ts">'+fmtTs(e.ts)+'</span>'
        +'<span class="log-sub">'+esc(e.sub)+'</span>'
        +'<span class="log-msg">'+esc(e.msg)+'</span>'
        +(e.sk?'<span class="log-sk">'+esc(shortKey(e.sk))+'</span>':'')
        +'</div>';
    }).join('');}
  }
  var s=engineState.stats||{};
  function set(id,v){var e=document.getElementById(id);if(e)e.textContent=v;}
  set('s-agent-starts',s.agentStarts||0);
  set('s-tool-calls',s.toolCalls||0);
  set('s-errors',(s.agentErrors||0)+(s.toolErrors||0));
  set('s-tokens',(s.totalTokens||0).toLocaleString());
  set('s-cost','$'+(s.totalCostUsd||0).toFixed(4));
  set('hdr-tools',s.toolCalls||0);
  set('hdr-errs',(s.agentErrors||0)+(s.toolErrors||0));
}
function renderAgents(){
  var agents=state.agents||[];
  var grid=document.getElementById('agents-grid');
  if(!grid) return;
  if(!agents.length){grid.innerHTML='<div class="empty">No agents found</div>';return;}
  grid.innerHTML=agents.map(function(a){
    var docs='';
    var pairs=[['SOUL',a.soul_md],['HEARTBEAT',a.heartbeat_md],['MEMORY',a.memory_md],['USER',a.user_md]];
    pairs.forEach(function(p){
      if(p[1]) docs+='<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:4px">'+p[0]+'</div><div class="doc-preview">'+esc(p[1]).substring(0,600)+(p[1].length>600?'&hellip;':'')+'</div></div>';
    });
    if(!docs) docs='<div class="empty">No docs loaded</div>';
    return '<div class="card"><div class="agent-card"><span style="font-size:24px;margin-right:8px">'+esc(a.emoji||'X')+'</span><span class="agent-name">'+esc(a.name||a.agent_id)+'</span><span class="badge badge-muted" style="margin-left:8px">'+esc(a.agent_id)+'</span></div><div style="margin-top:12px">'+docs+'</div></div>';
  }).join('');
}
function renderAlerts(){
  var al=state.recentAlerts||[];
  var el=document.getElementById('alerts-list');
  if(!el) return;
  if(!al.length){el.innerHTML='<div class="empty">No alerts recorded</div>';return;}
  el.innerHTML=al.map(function(a){return '<div class="alert-item '+esc(a.severity)+'"><div class="alert-title">'+svr(a.severity)+' '+esc(a.title)+'</div><div class="alert-detail">'+esc(a.detail||'')+'</div><div class="alert-meta">'+esc(a.rule_id)+' &middot; '+esc(a.fingerprint)+' &middot; '+fmtTs(a.ts)+'</div></div>';}).join('');
}
function renderSessions(){
  var ss=state.sessions||[];
  var el=document.getElementById('sessions-list');
  if(!el) return;
  if(!ss.length){el.innerHTML='<div class="empty">No sessions</div>';return;}
  el.innerHTML=ss.map(function(s){return '<div class="session-item"><div class="session-dot '+(s.status==='active'?'active':'idle')+'"></div><span class="session-key">'+esc(s.session_key)+'</span>'+(s.agent_id?'<span class="badge badge-blue">'+esc(s.agent_id)+'</span>':'')+(s.recipient?'<span class="badge badge-muted">'+esc(s.recipient)+'</span>':'')+(s.total_cost_usd?'<span class="badge badge-yellow">$'+Number(s.total_cost_usd).toFixed(4)+'</span>':'')+'<span class="ts">'+fmtAgo(s.last_activity_at)+'</span></div>';}).join('');
}
function renderCron(){
  var jobs=state.cronJobs||[];
  var el=document.getElementById('cron-list');
  if(!el) return;
  if(!jobs.length){el.innerHTML='<div class="card"><div class="empty">No cron jobs</div></div>';return;}
  el.innerHTML=jobs.map(function(j){return '<div class="cron-item '+(j.last_status==='error'?'error':(j.last_status==='success'?'success':''))+'"><div class="cron-name">'+esc(j.name||j.id)+'</div>'+(j.description?'<div class="cron-meta">'+esc(j.description.substring(0,80))+'</div>':'')+'<div class="cron-meta">'+(j.schedule_expr?esc(j.schedule_expr)+' '+(j.schedule_tz||''):'')+' &middot; agent: '+esc(j.agent_id||'?')+' &middot; status: <strong style="color:'+(j.last_status==='error'?'var(--red)':'var(--green)')+'">'+esc(j.last_status||'unknown')+'</strong>'+(j.consecutive_errors?' &middot; <span style="color:var(--red)">'+j.consecutive_errors+' errors</span>':'')+'</div><div class="cron-meta">Last: '+fmtAgo(j.last_run_at)+' &middot; Next: '+fmtTs(j.next_run_at)+'</div>'+(j.last_error?'<div class="cron-error">'+esc(j.last_error.substring(0,200))+'</div>':'')+'</div>';}).join('');
}
function renderDiagnostics(){
  var diags=state.recentDiagnostics||[];
  var el=document.getElementById('diag-list');
  if(!el) return;
  if(!diags.length){el.innerHTML='<div class="empty">No diagnostics yet</div>';return;}
  el.innerHTML=diags.map(function(d){return '<div class="diag-item"><span class="diag-ts">'+fmtTs(d.ts)+'</span><span class="diag-type">'+esc(d.event_type)+'</span>'+(d.channel?'<span style="color:#94a3b8;margin-left:6px">@'+esc(d.channel)+'</span>':'')+(d.session_key?'<span style="color:#64748b;margin-left:6px">'+esc(d.session_key)+'</span>':'')+'</div>';}).join('');
}
function renderDelivery(){
  var items=state.pendingDeliveries||[];
  var el=document.getElementById('delivery-list');
  if(!el) return;
  if(!items.length){el.innerHTML='<div class="empty">Queue is empty</div>';return;}
  el.innerHTML=items.map(function(d){return '<div class="delivery-item '+(d.status||'pending')+'"><strong>'+esc(d.channel||'?')+'</strong> &rarr; '+esc(d.to_address||'?')+(d.retry_count?'<span class="badge badge-yellow">retry '+d.retry_count+'</span>':'')+'<div style="font-size:11px;color:var(--muted);margin-top:2px">'+esc((d.text||'').substring(0,100))+'</div>'+(d.last_error?'<div style="font-size:11px;color:var(--red);margin-top:2px">'+esc(d.last_error.substring(0,100))+'</div>':'')+'</div>';}).join('');
}
function renderAll(){renderOverview();renderAgents();renderAlerts();renderSessions();renderCron();renderDiagnostics();renderDelivery();}
function pollEngine(){
  fetch('/api/engine').then(function(r){return r.json();}).then(function(d){engineState=d;renderOverview();}).catch(function(){});
}
setInterval(pollEngine,30000);
pollEngine();

/* ── SSE connection ─────────────────────────────────────────────────────────── */
function connect(){
  var es=new EventSource('/events');
  var conn=document.getElementById('conn-status');
  es.addEventListener('state',function(e){
    state=JSON.parse(e.data);renderAll();
    if(conn){conn.className='badge badge-green';conn.textContent='live';}
  });
  es.addEventListener('openalerts',function(e){
    var a=JSON.parse(e.data);
    state.recentAlerts=[a].concat(state.recentAlerts).slice(0,50);
    renderAlerts();renderOverview();
    var btn=document.querySelectorAll('nav button')[2];
    if(btn){btn.style.background='rgba(239,68,68,.2)';setTimeout(function(){btn.style.background='';},2000);}
  });
  es.addEventListener('diagnostic',function(e){
    var d=JSON.parse(e.data);
    state.recentDiagnostics=[d].concat(state.recentDiagnostics).slice(0,100);
    pushActivity({ts:d.ts,sub:actSub(d.event_type),cls:actCls(d.event_type||d.summary||''),msg:actMsg(null,d.summary||d.event_type,null,null),sk:d.session_key||''});
    renderDiagnostics();renderOverview();
  });
  es.addEventListener('action',function(e){
    var a=JSON.parse(e.data);
    handleLiveAction(a);
    /* Skip streaming steps in overview feed to avoid noise — only meaningful events */
    if(a.type!=='streaming'&&a.type!=='tool_result'){
      pushActivity({ts:a.ts,sub:actSub(a.type),cls:actCls(a.type),msg:actMsg(a.type,null,a.toolName,a.content),sk:a.sessionKey||''});
      var ovTab=document.getElementById('tab-overview');
      if(ovTab&&ovTab.classList.contains('active')) renderOverview();
    }
    /* Only re-render live tab if visible */
    var liveTab=document.getElementById('tab-live');
    if(liveTab&&liveTab.classList.contains('active')) renderLiveTab();
  });
  es.addEventListener('health',function(e){
    var h=JSON.parse(e.data);
    dismissGate();
    handleLiveHealth(h);
    /* add a heartbeat row to the activity feed & heartbeat log */
    var hb={ts:h.ts||Date.now(),status:'ok',gateway_connected:1,queue_depth:h.queueDepth||0,active_sessions:h.activeSessions||0};
    state.recentHeartbeats=[hb].concat(state.recentHeartbeats).slice(0,50);
    pushActivity({ts:hb.ts,sub:'infra',cls:'log-dim',msg:'heartbeat ok  sessions='+hb.active_sessions+'  queue='+hb.queue_depth,sk:''});
    var ovTab=document.getElementById('tab-overview');
    if(ovTab&&ovTab.classList.contains('active')) renderOverview();
    var liveTab=document.getElementById('tab-live');
    if(liveTab&&liveTab.classList.contains('active')) renderLiveSessions();
  });
  es.addEventListener('exec',function(e){
    var ex=JSON.parse(e.data);
    handleLiveExec(ex);
    var liveTab=document.getElementById('tab-live');
    if(liveTab && liveTab.classList.contains('active')) renderLiveTab();
  });
  es.onopen=function(){
    if(conn){conn.className='badge badge-green';conn.textContent='connected';}
    var dot=document.getElementById('sDot');if(dot) dot.className='dot live';
    var hc=document.getElementById('hdr-conn');if(hc){hc.style.color='';hc.textContent='connected';}
  };
  es.onerror=function(){
    if(conn){conn.className='badge badge-red';conn.textContent='disconnected';}
    var dot=document.getElementById('sDot');if(dot) dot.className='dot dead';
    var hc=document.getElementById('hdr-conn');if(hc){hc.style.color='var(--red)';hc.textContent='disconnected';}
    setTimeout(connect,3000);es.close();
  };
}
connect();
`;

export function getDashboardHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>OpenAlerts</title>
<style>${CSS}</style>
</head>
<body>
${BODY}
<script>${SCRIPT}<\/script>
</body>
</html>`;
}
