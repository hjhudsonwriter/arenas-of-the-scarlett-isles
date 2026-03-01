/* Arenas of The Scarlett Isles (POV Mini-Game)
   - No tokens, no grid
   - Players tracked in sidebar (name, portrait, HP)
   - Individual turns: Skill roll -> Attack roll -> Resolve
   - Cinematic overlays on hit/fail
*/

const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

const STORAGE_KEY = "tsi_arenas_state_v3_pov";
/* =========================
   SFX (assets/sfx)
   ========================= */

const SFX = {
  crowd_loop: "assets/sfx/crowd_standard.mp3",
  crowd_hit:  "assets/sfx/crowd_hit.mp3",
  crowd_fail: "assets/sfx/crowd_fail.mp3",

  r1_hit: "assets/sfx/arena_duelist_hit.mp3",
  r1_fail:"assets/sfx/arena_duelist_fail.mp3",

  r4_hit: "assets/sfx/beast_pen_hit.mp3",
  r4_fail:"assets/sfx/beast_pen_fail.mp3",

  r5_hit: "assets/sfx/wyvern_hit.mp3",
  r5_fail:"assets/sfx/wyvern_fail.mp3",
};

let crowdLoopAudio = null;

function ensureCrowdLoop(){
  if(crowdLoopAudio) return;
  crowdLoopAudio = new Audio(SFX.crowd_loop);
  crowdLoopAudio.loop = true;
  crowdLoopAudio.volume = 0.35;
}

function startCrowdLoop(){
  ensureCrowdLoop();
  try{
    crowdLoopAudio.currentTime = 0;
    crowdLoopAudio.play();
  }catch(e){}
}

function stopCrowdLoop(){
  if(!crowdLoopAudio) return;
  try{
    crowdLoopAudio.pause();
    crowdLoopAudio.currentTime = 0;
  }catch(e){}
}

// one-shot that can overlap itself (new Audio each time)
function playOneShot(src, volume=0.7){
  if(!src) return;
  const a = new Audio(src);
  a.volume = volume;
  a.play().catch(()=>{});
}

function playHitSfx(roundId){
  // round-specific first (as requested), then crowd hit
  if(roundId === "r1") playOneShot(SFX.r1_hit, 0.9);
  if(roundId === "r4") playOneShot(SFX.r4_hit, 0.9);
  if(roundId === "r5") playOneShot(SFX.r5_hit, 0.9);
  playOneShot(SFX.crowd_hit, 0.75);
}

function playFailSfx(roundId){
  // round-specific first, then crowd fail
  if(roundId === "r1") playOneShot(SFX.r1_fail, 0.9);
  if(roundId === "r4") playOneShot(SFX.r4_fail, 0.9);
  if(roundId === "r5") playOneShot(SFX.r5_fail, 0.9);
  playOneShot(SFX.crowd_fail, 0.75);
}

const state = {
  arenas: [],
  arenaId: null,
  roundId: null,

  // persistent
  players: [],
  totalGold: 0,

  // run state
  runActive: false,
  turn: 0,
  turnIndex: 0,
  successes: 0,
  failures: 0,
  enemies: [], // {id,name,hp,maxHp,defId}
};

function uid(prefix="id"){
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

async function fileToSmallDataURL(file, maxSize=128, quality=0.78){
  const dataUrl = await new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onload = ()=>resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject)=>{
    const i = new Image();
    i.onload = ()=>resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });

  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  try{ return canvas.toDataURL("image/webp", quality); }
  catch(e){ return canvas.toDataURL("image/png"); }
}

function save(){
  // Keep storage lean: portraits are already compressed.
  const payload = {
    players: state.players.map(p=>({id:p.id,name:p.name,tag:p.tag,maxHp:p.maxHp,hp:p.hp,image:p.image||""})),
    totalGold: state.totalGold,
    arenaId: state.arenaId,
    roundId: state.roundId
  };

  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  }catch(err){
    if(String(err).includes("QuotaExceeded")){
      // Drop portraits if absolutely necessary
      const slim = JSON.parse(JSON.stringify(payload));
      for(const p of slim.players){ p.image = ""; }
      try{
        localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
        console.warn("Quota exceeded: saved without portraits.");
        return false;
      }catch(e2){
        console.error("Save failed:", e2);
        return false;
      }
    }
    console.error("Save failed:", err);
    return false;
  }
}

function load(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return;
    const p = JSON.parse(raw);
    state.players = p.players || [];
    state.totalGold = p.totalGold ?? 0;
    state.arenaId = p.arenaId ?? null;
    state.roundId = p.roundId ?? null;
  }catch(e){
    console.warn("Load failed", e);
  }
}

function log(msg){
  const c = $("#console");
  const stamp = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
  c.textContent += `[${stamp}] ${msg}\n`;
  c.scrollTop = c.scrollHeight;
}

function setStatus(text){ $("#statusPill").textContent = text; }

function getArena(){
  return state.arenas.find(a => a.id === state.arenaId) || null;
}
function getRound(){
  const a = getArena();
  if(!a) return null;
  return a.rounds.find(r => r.id === state.roundId) || a.rounds[0] || null;
}

function rollDice(expr){
  const m = String(expr||"").trim().match(/^(\d+)d(\d+)$/i);
  if(!m) return {total:0, rolls:[], expr:String(expr||"")};
  const c = parseInt(m[1],10);
  const s = parseInt(m[2],10);
  let total = 0;
  const rolls = [];
  for(let i=0;i<c;i++){
    const r = 1 + Math.floor(Math.random()*s);
    rolls.push(r);
    total += r;
  }
  return {total, rolls, expr:`${c}d${s}`};
}

function renderSelects(){
  const arenaSel = $("#arenaSelect");
  arenaSel.innerHTML = "";
  for(const a of state.arenas){
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = a.name;
    arenaSel.appendChild(opt);
  }
  if(!state.arenaId) state.arenaId = state.arenas[0]?.id || null;
  arenaSel.value = state.arenaId;

  const roundSel = $("#roundSelect");
  roundSel.innerHTML = "";
  const a = getArena();
  if(a){
    for(const r of a.rounds){
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = r.title;
      roundSel.appendChild(opt);
    }
    if(!state.roundId) state.roundId = a.rounds[0]?.id || null;
    roundSel.value = state.roundId;
  }
}

function renderHeaderStats(){
  const r = getRound();
  const sc = r?.skill_challenge;
  $("#goldTotal").textContent = String(state.totalGold);
  $("#succCount").textContent = String(state.successes);
  $("#failCount").textContent = String(state.failures);
  $("#succTarget").textContent = String(sc?.target_successes ?? 0);
  $("#failMax").textContent = String(sc?.max_failures ?? 0);
  $("#turnCount").textContent = String(state.turn);
}

function setScene(){
  const r = getRound();
  if(!r) return;

  $("#sceneBase").src = r.scene?.base || "";
    const boss = $("#sceneBoss");
  const bossSrc = r.scene?.overlay_boss || "";

  // IMPORTANT: Only show the "standard/opponents present" overlay once the run is active.
  if(state.runActive && bossSrc){
    boss.src = bossSrc;
    boss.classList.remove("hidden");
  }else{
    boss.classList.add("hidden");
    boss.removeAttribute("src");
  }

  hideOverlay();
}

let overlayTimer = null;
let bossRestoreTimer = null;
let bossPrevSrc = "";
function showOverlay(src, ms=5200){
  // Replace the "boss" overlay temporarily (no stacking)
  if(!src) return;

  const boss = $("#sceneBoss");
  if(!boss) return;

  // Remember what the boss overlay was showing
  if(!bossPrevSrc) bossPrevSrc = boss.getAttribute("src") || "";

  // Force boss visible while we show the temporary overlay
  boss.src = src;
  boss.classList.remove("hidden");

  // Cancel any prior restore timer and restore after ms
  if(bossRestoreTimer) clearTimeout(bossRestoreTimer);
  bossRestoreTimer = setTimeout(()=>{
    const r = getRound();
    const standard = (state.runActive ? (r.scene?.overlay_boss || "") : "");

    bossPrevSrc = "";
    if(standard){
      boss.src = standard;
      boss.classList.remove("hidden");
    }else{
      boss.classList.add("hidden");
      boss.removeAttribute("src");
    }
  }, ms);
}
function hideOverlay(){
  // No-op now: we replace the boss overlay instead of stacking an overlay layer
  const el = $("#sceneOverlay");
  if(el){
    el.classList.add("hidden");
    el.removeAttribute("src");
  }
}

function renderPartyList(){
  const host = $("#partyList");
  host.innerHTML = "";
  if(state.players.length === 0){
    host.innerHTML = `<div class="card"><div class="muted">No players yet. Click <span class="kbd">Add Player</span>.</div></div>`;
    return;
  }

  for(const p of state.players){
    const card = document.createElement("div");
    card.className = "card";
    const hpPct = Math.max(0, Math.min(1, p.hp / p.maxHp));
    card.innerHTML = `
      <div class="cardRow portraitRow">
        <img class="portrait" src="${p.image ? escapeHtml(p.image) : ""}" alt="" />
        <div style="flex:1;">
          <div><strong>${escapeHtml(p.name)}</strong> ${p.tag ? `<span class="badge">${escapeHtml(p.tag)}</span>`:""}</div>
          <div class="muted" style="font-size:12px;margin-top:2px;">HP ${p.hp}/${p.maxHp}</div>
        </div>
        <div class="badge">d20</div>
      </div>
      <div class="hpBar"><div class="hpFill" style="width:${Math.round(hpPct*100)}%"></div></div>
      <div class="smallBtns">
        <button class="btn btn--ghost" data-heal="5">+5</button>
        <button class="btn btn--ghost" data-dmg="5">-5</button>
        <button class="btn btn--ghost" data-heal="10">+10</button>
        <button class="btn btn--ghost" data-dmg="10">-10</button>
        <button class="btn btn--ghost" data-set>Set HP</button>
        <button class="btn btn--danger" data-remove>Remove</button>
      </div>
    `;
    host.appendChild(card);

    card.addEventListener("click", (e)=>{
      const t = e.target;
      if(!(t instanceof HTMLElement)) return;

      if(t.dataset.heal){
        p.hp = clamp(p.hp + parseInt(t.dataset.heal,10), 0, p.maxHp);
        save(); renderPartyList();
      }else if(t.dataset.dmg){
        p.hp = clamp(p.hp - parseInt(t.dataset.dmg,10), 0, p.maxHp);
        save(); renderPartyList();
      }else if(t.dataset.set !== undefined){
        const v = prompt(`Set HP for ${p.name} (0-${p.maxHp})`, String(p.hp));
        if(v === null) return;
        p.hp = clamp(parseInt(v,10)||0, 0, p.maxHp);
        save(); renderPartyList();
      }else if(t.dataset.remove !== undefined){
        if(confirm(`Remove ${p.name}?`)){
          state.players = state.players.filter(x=>x.id !== p.id);
          save(); renderPartyList();
        }
      }
    });
  }
}

function spawnEnemiesForRound(round){
  state.enemies = [];
  for(const def of (round.enemies || [])){
    for(let i=0;i<(def.count||1);i++){
      const id = uid("e");
      const name = (def.count||1) > 1 ? `${def.name} ${i+1}` : def.name;
      state.enemies.push({
        id,
        defId: def.id || def.name,
        name,
        maxHp: def.hp ?? null,
        hp: def.hp ?? null
      });
    }
  }
}

function renderEnemyList(){
  const host = $("#enemyList");
  host.innerHTML = "";
  if(!state.runActive){
    host.innerHTML = `<div class="card"><div class="muted">Opponents appear after you Enter The Arena.</div></div>`;
    return;
  }
  if(state.enemies.length === 0){
    host.innerHTML = `<div class="card"><div class="muted">No opponents remain.</div></div>`;
    return;
  }

  for(const e of state.enemies){
    const card = document.createElement("div");
    card.className = "card";
    if(e.maxHp){
      const hpPct = Math.max(0, Math.min(1, e.hp / e.maxHp));
      card.innerHTML = `
        <div class="cardRow">
          <div><strong>${escapeHtml(e.name)}</strong></div>
          <div class="badge">HP ${e.hp}/${e.maxHp}</div>
        </div>
        <div class="hpBar"><div class="hpFill" style="width:${Math.round(hpPct*100)}%"></div></div>
        <div class="smallBtns">
          <button class="btn btn--ghost" data-dmg="10">-10</button>
          <button class="btn btn--ghost" data-dmg="25">-25</button>
          <button class="btn btn--ghost" data-heal="10">+10</button>
          <button class="btn btn--ghost" data-set>Set HP</button>
          <button class="btn btn--danger" data-remove>Remove</button>
        </div>
      `;
    }else{
      card.innerHTML = `
        <div class="cardRow">
          <div><strong>${escapeHtml(e.name)}</strong></div>
          <div class="badge">Prop</div>
        </div>
        <div class="smallBtns">
          <button class="btn btn--danger" data-remove>Remove</button>
        </div>
      `;
    }

    host.appendChild(card);

    card.addEventListener("click", (ev)=>{
      const t = ev.target;
      if(!(t instanceof HTMLElement)) return;

      if(t.dataset.dmg && e.maxHp){
        e.hp = clamp(e.hp - parseInt(t.dataset.dmg,10), 0, e.maxHp);
        renderEnemyList();
      }else if(t.dataset.heal && e.maxHp){
        e.hp = clamp(e.hp + parseInt(t.dataset.heal,10), 0, e.maxHp);
        renderEnemyList();
      }else if(t.dataset.set !== undefined && e.maxHp){
        const v = prompt(`Set HP for ${e.name} (0-${e.maxHp})`, String(e.hp));
        if(v === null) return;
        e.hp = clamp(parseInt(v,10)||0, 0, e.maxHp);
        renderEnemyList();
      }else if(t.dataset.remove !== undefined){
        state.enemies = state.enemies.filter(x=>x.id !== e.id);
        renderEnemyList();
      }
    });
  }
}

function resetRunState(msg="Run reset."){
  stopCrowdLoop();
  state.runActive = false;
  state.turn = 0;
  state.turnIndex = 0; 
  state.successes = 0;
  state.failures = 0;
  state.enemies = [];
  renderEnemyList();
  renderHeaderStats();
  setStatus(msg);
  log(msg);
  hideDock();
}

function startRound(roundId){
  const a = getArena();
  if(!a) return;
  const r = a.rounds.find(x=>x.id===roundId) || a.rounds[0];
  state.roundId = r.id;

  state.runActive = true;
  state.turn = 0;
  state.successes = 0;
  state.failures = 0;
  state.turnIndex = 0; 

  // per-round flags
  for(const p of state.players){
    delete p._beastBonusUsed;
  }

  spawnEnemiesForRound(r);
  setScene();
  renderEnemyList();
  renderHeaderStats();

  setStatus("Round loaded. Begin when ready.");
  log(`--- ${r.title} loaded ---`);

  openRulesDock(true);
}

function partyAlive(){
  return state.players.some(p => (p.hp||0) > 0);
}
function enemiesAlive(){
  return state.enemies.some(e => e.maxHp && e.hp > 0);
}

function applyFailureToPlayer(p, round){
  const sc = round.skill_challenge;
  state.failures += 1;

  const dmg = rollDice(sc.damage_on_failure);
  p.hp = clamp(p.hp - dmg.total, 0, p.maxHp);

    const ov = round.scene?.overlays || {};

  // If JSON provides multiple fail variants, pick one at random.
  let failSrc = ov.pc_fail;
  if(Array.isArray(ov.pc_fail_variants) && ov.pc_fail_variants.length){
    failSrc = ov.pc_fail_variants[Math.floor(Math.random() * ov.pc_fail_variants.length)];
  }

  showOverlay(failSrc, 950);
    playFailSfx(round.id); 

  log(`${p.name} failed: -${dmg.total} HP (${dmg.expr}: ${dmg.rolls.join(", ")}).`);
}

function applyOvertimePressure(round){
  const sc = round.skill_challenge;
  const limit = sc.turn_limit || 0;
  if(!limit) return;

  if(state.turn <= limit) return;

  const over = sc.overtime || {};
  const extraFail = parseInt(over.failure_each_turn||0, 10) || 0;
  const partyDmgExpr = over.party_damage_each_turn || "";

  if(extraFail > 0){
    state.failures += extraFail;
    log(`OVERTIME: crowd turns. +${extraFail} failure(s).`);
  }

  if(partyDmgExpr){
    const alive = state.players.filter(x=>x.hp>0);
    if(alive.length){
      const target = alive[Math.floor(Math.random()*alive.length)];
      const dmg = rollDice(partyDmgExpr);
      target.hp = clamp(target.hp - dmg.total, 0, target.maxHp);
      log(`OVERTIME: ${target.name} is battered by the tempo: -${dmg.total} HP (${dmg.expr}).`);
    }
  }
}

function endRound(won){
  const round = getRound();
  const sc = round.skill_challenge;

  const prize = won ? round.reward_gp : 0;
  if(won){
    state.totalGold += prize;
    save();
  }

  const partyHp = state.players.map(p => `${escapeHtml(p.name)}: <span class="kbd">${p.hp}/${p.maxHp}</span>`).join("<br/>");
  const next = getNextRoundId();

  const title = won ? "Round Cleared" : "Defeat";
  const subtitle = won ? `You win ${prize} GP.` : `The Salt-Ring Trials end here.`;

  showDock({
    title,
    sub: subtitle,
    body: `
      <div class="card">
        <div class="cardRow"><div><strong>Prize</strong></div><div class="badge">${won ? prize + " GP" : "—"}</div></div>
        <div style="margin-top:8px;color:var(--muted);font-size:13px;">Total gold: <span class="kbd">${state.totalGold}</span></div>
      </div>
      <div style="height:10px"></div>
      <div class="card">
        <div><strong>Party HP</strong></div>
        <div style="margin-top:10px;color:var(--muted);font-size:13px;">${partyHp}</div>
      </div>
      <div style="height:10px"></div>
      <div class="card">
        <div><strong>Score</strong></div>
        <div style="margin-top:8px;color:var(--muted);font-size:13px;">
          Successes: <span class="kbd">${state.successes}/${sc.target_successes}</span> |
          Failures: <span class="kbd">${state.failures}/${sc.max_failures}</span>
        </div>
      </div>
    `,
    actions: [
      ...(won && next ? [{
        label: "Proceed to Next Round",
        variant: "primary",
        onClick: ()=>{
          hideDock();
          startRound(next);
        }
      }] : []),
      {
        label: "Leave Arena",
        variant: "ghost",
        onClick: ()=>{
          stopCrowdLoop(); 
          hideDock();
          resetRunState("Run ended. Enter The Arena to start again.");
        }
      }
    ]
  });
}

function getNextRoundId(){
  const a = getArena();
  if(!a) return null;
  const idx = a.rounds.findIndex(r => r.id === state.roundId);
  if(idx < 0) return null;
  return a.rounds[idx+1]?.id || null;
}

/* Turn Dock (left panel) */

function showDock({title, sub="", body="", actions=[]}){
  $("#dockTitle").textContent = title;
  $("#dockSub").textContent = sub;
  $("#dockBody").innerHTML = body;

  const host = $("#dockActions");
  host.innerHTML = "";
  for(const a of actions){
    const b = document.createElement("button");
    b.className = "btn" + (a.variant ? ` btn--${a.variant}` : "");
    b.textContent = a.label;
    b.addEventListener("click", ()=> a.onClick?.());
    host.appendChild(b);
  }

  $("#turnDock").classList.remove("hidden");
}
function hideDock(){
  $("#turnDock").classList.add("hidden");
  $("#dockBody").innerHTML = "";
  $("#dockActions").innerHTML = "";
}
function openRulesDock(isStart=false){
  const r = getRound();
  if(!r) return;
  const sc = r.skill_challenge;
  const notes = (sc.notes||[]).map(n=>`<li>${escapeHtml(n)}</li>`).join("");
  const actions = (sc.actions||[]).map(a=>`<li><strong>${escapeHtml(a.label)}</strong>${a.special ? ` <span class="badge">${escapeHtml(a.special)}</span>`:""}</li>`).join("");

  showDock({
    title: isStart ? `Enter The Arena: ${r.title}` : r.title,
    sub: `Prize: ${r.reward_gp} GP`,
    body: `
      <div class="card">
        <div><strong>What you’re trying to do</strong></div>
        <ul style="margin:8px 0 0 18px;">${notes}</ul>
      </div>
      <div style="height:10px"></div>
      <div class="card">
        <div class="cardRow"><div><strong>Win</strong></div><div class="badge">${sc.target_successes} successes</div></div>
        <div class="cardRow" style="margin-top:8px;"><div><strong>Lose</strong></div><div class="badge">${sc.max_failures} failures</div></div>
        <div style="margin-top:8px;color:var(--muted);font-size:13px;">
          Failure damage: <span class="kbd">${escapeHtml(sc.damage_on_failure)}</span>
        </div>
        ${sc.turn_limit ? `<div style="margin-top:8px;color:var(--muted);font-size:13px;">Tempo limit: <span class="kbd">${sc.turn_limit}</span> turns (overtime hurts).</div>` : ""}
      </div>
      <div style="height:10px"></div>
      <div class="card">
        <div><strong>Approaches</strong></div>
        <ul style="margin:8px 0 0 18px;">${actions}</ul>
      </div>
      <div style="height:10px"></div>
      <div class="card">
        <div><strong>DCs</strong></div>
        <div style="margin-top:8px; display:flex; gap:10px; flex-wrap:wrap;">
          <span class="badge">Easy ${sc.dcs.easy}</span>
          <span class="badge">Standard ${sc.dcs.standard}</span>
          <span class="badge">Hard ${sc.dcs.hard}</span>
        </div>
      </div>
    `,
    actions: isStart ? [
      { label: "Begin Round", variant: "primary", onClick: ()=>{
        hideDock();
        setStatus("Round started. Click Play Turn.");
        log(`--- ${r.title} begins ---`);
      }},
      { label: "Not yet", variant: "ghost", onClick: hideDock }
    ] : [
      { label: "Close", variant: "ghost", onClick: hideDock }
    ]
  });
}

function openTurnDock(){
  const round = getRound();
  if(!round) return;

  if(!state.runActive){
    setStatus("Start the round first: Enter The Arena.");
    return;
  }
  if(state.players.length === 0){
    showDock({
      title: "No players",
      sub: "Add at least one player first.",
      body: `<div class="card"><div class="muted">Use <span class="kbd">Add Player</span> in the top bar.</div></div>`,
      actions: [{label:"Close", variant:"ghost", onClick: hideDock}]
    });
    return;
  }

  // advance turn
  state.turn += 1;

  const sc = round.skill_challenge;
  const atk = round.attack || {hit_dc: 14, default_damage:"2d8"};

    const alivePlayers = state.players.filter(p=>p.hp>0);
  if(alivePlayers.length === 0){
    endRound(false);
    return;
  }

  // Auto-pick next alive player (round-robin)
  const p = alivePlayers[state.turnIndex % alivePlayers.length];
  state.turnIndex += 1;
  const actionOptions = (sc.actions||[]).map(a=>`<option value="${escapeHtml(a.id)}">${escapeHtml(a.label)}</option>`).join("");

  const livingEnemies = state.enemies.filter(e=>!e.maxHp || e.hp>0);
  const enemyOptions = livingEnemies.map(e=>`<option value="${e.id}">${escapeHtml(e.name)}${e.maxHp ? ` (HP ${e.hp}/${e.maxHp})` : ""}</option>`).join("");

  const tempoWarn = sc.turn_limit && state.turn > sc.turn_limit
    ? `<div class="card" style="border-color:rgba(210,61,61,.55);background:rgba(210,61,61,.08)">
         <strong>OVERTIME</strong>
         <div class="muted" style="font-size:12px;margin-top:6px;">The tempo is out of control. Extra attrition applies when you resolve.</div>
       </div><div style="height:10px"></div>`
    : "";

  showDock({
    title: `${round.title}`,
    sub: `Turn ${state.turn} | Success ${state.successes}/${sc.target_successes} | Fail ${state.failures}/${sc.max_failures}`,
    body: `
      ${tempoWarn}
      <div class="card">
        <div class="grid2">
  <div class="field">
    <span>Active Player</span>
    <div class="badge" style="display:flex;align-items:center;gap:10px;padding:9px 10px;">
      ${p.image ? `<img class="portrait" src="${escapeHtml(p.image)}" alt="" />` : ``}
      <strong>${escapeHtml(p.name)}</strong>
      <span class="muted">HP ${p.hp}/${p.maxHp}</span>
    </div>
    <input id="t_player" type="hidden" value="${p.id}" />
  </div>
  <label class="field">
    <span>Target</span>
    <select id="t_target">${enemyOptions || `<option value="">(no targets)</option>`}</select>
  </label>
</div>
      </div>

      <div style="height:10px"></div>

      <div class="card">
        <div><strong>1) Skill Check</strong></div>
        <div class="grid2" style="margin-top:10px;">
          <label class="field">
            <span>Approach</span>
            <select id="t_action">${actionOptions}</select>
          </label>
          <label class="field">
            <span>DC</span>
            <select id="t_dc">
              <option value="easy">Easy (${sc.dcs.easy})</option>
              <option value="standard" selected>Standard (${sc.dcs.standard})</option>
              <option value="hard">Hard (${sc.dcs.hard})</option>
            </select>
          </label>
        </div>
        <div class="grid2" style="margin-top:10px;">
          <label class="field">
            <span>Skill Modifier</span>
            <input id="t_skillMod" type="number" value="0" />
          </label>
          <div class="field">
            <span>Roll</span>
            <button id="t_skillRoll" class="btn btn--primary" type="button">Roll d20</button>
          </div>
        </div>
        <div id="t_skillOut" class="muted" style="font-size:12px;margin-top:8px;">No roll yet.</div>
      </div>

      <div style="height:10px"></div>

      <div class="card">
        <div><strong>2) Attack Roll</strong></div>
        <div class="muted" style="font-size:12px;margin-top:6px;">
          Hit DC: <span class="kbd">${atk.hit_dc}</span> | Default damage: <span class="kbd">${escapeHtml(atk.default_damage)}</span>
        </div>

        <div class="grid2" style="margin-top:10px;">
          <label class="field">
            <span>Attack Modifier</span>
            <input id="t_atkMod" type="number" value="0" />
          </label>
          <div class="field">
            <span>Roll</span>
            <button id="t_atkRoll" class="btn btn--primary" type="button">Roll d20</button>
          </div>
        </div>

        <div class="grid2" style="margin-top:10px;">
          <label class="field">
            <span>Damage (dice like 2d8 or number)</span>
            <input id="t_dmg" value="${escapeHtml(atk.default_damage)}" />
          </label>
          <div class="field">
            <span>Apply Damage</span>
            <button id="t_applyDmg" class="btn btn--ghost" type="button">Apply</button>
          </div>
        </div>

        <div id="t_atkOut" class="muted" style="font-size:12px;margin-top:8px;">No attack yet.</div>
      </div>
    `,
    actions: [
      { label: "Resolve Turn", variant: "primary", onClick: ()=> resolveTurnFromDock(round) },
      { label: "Cancel", variant: "ghost", onClick: hideDock }
    ]
  });

  // Local per-dock memory
  const mem = {
    skill: null,   // {pass,total,dc,d20,mod,dcLevel,actionId}
    attack: null,  // {hit,total,dc,d20,mod}
    damageApplied: false,
    lastDamage: 0
  };

  $("#t_skillRoll").addEventListener("click", ()=>{
    const pid = $("#t_player").value;
    const p = state.players.find(x=>x.id===pid);
    if(!p) return;

    const dcLevel = $("#t_dc").value;
    const baseDc = (dcLevel==="easy" ? sc.dcs.easy : dcLevel==="hard" ? sc.dcs.hard : sc.dcs.standard);
    const mod = parseInt($("#t_skillMod").value||"0",10);
    const d20 = 1 + Math.floor(Math.random()*20);
    const total = d20 + mod;
    const pass = total >= baseDc;

    const actionId = $("#t_action").value;

    mem.skill = {pass,total,dc:baseDc,d20,mod,dcLevel,actionId};

    $("#t_skillOut").innerHTML = pass
      ? `✅ Skill: <span class="kbd">${d20}</span> + ${mod} = <strong>${total}</strong> vs DC ${baseDc}.`
      : `❌ Skill: <span class="kbd">${d20}</span> + ${mod} = <strong>${total}</strong> vs DC ${baseDc}.`;
  });

  $("#t_atkRoll").addEventListener("click", ()=>{
    const mod = parseInt($("#t_atkMod").value||"0",10);
    const d20 = 1 + Math.floor(Math.random()*20);
    const total = d20 + mod;
    const dc = atk.hit_dc || 14;
    const hit = total >= dc;

    mem.attack = {hit,total,dc,d20,mod};
    mem.damageApplied = false;
    mem.lastDamage = 0;

    $("#t_atkOut").innerHTML = hit
      ? `✅ Attack: <span class="kbd">${d20}</span> + ${mod} = <strong>${total}</strong> vs DC ${dc}. (Hit)`
      : `❌ Attack: <span class="kbd">${d20}</span> + ${mod} = <strong>${total}</strong> vs DC ${dc}. (Miss)`;
  });

  $("#t_applyDmg").addEventListener("click", ()=>{
    if(!mem.attack){
      alert("Roll an attack first.");
      return;
    }
    if(!mem.attack.hit){
      alert("Attack missed. No damage to apply.");
      return;
    }

    const tid = $("#t_target").value;
    const target = state.enemies.find(e=>e.id===tid);
    if(!target){
      alert("Pick a valid target.");
      return;
    }
    if(target.maxHp && target.hp<=0){
      alert("That target is already defeated.");
      return;
    }

    const raw = String($("#t_dmg").value||"").trim();
    let dmg = 0;

    if(/^\d+d\d+$/i.test(raw)){
      dmg = rollDice(raw).total;
    }else{
      dmg = parseInt(raw,10) || 0;
    }

    if(dmg <= 0){
      alert("Enter damage as dice (e.g. 2d8) or a positive number.");
      return;
    }

    mem.damageApplied = true;
    mem.lastDamage = dmg;

    if(target.maxHp){
      target.hp = clamp(target.hp - dmg, 0, target.maxHp);
      if(target.hp === 0){
        log(`${target.name} is defeated.`);
      }
    }

        const ov = round.scene?.overlays || {};
    showOverlay(ov.pc_hit, 5200);
    playHitSfx(round.id);

    log(`Attack damage to ${target.name}: -${dmg} HP.`);
    renderEnemyList();

    $("#t_atkOut").innerHTML += ` <span class="badge">Damage applied: ${dmg}</span>`;
  });

  renderHeaderStats();
  save();
}

function resolveTurnFromDock(round){
  const sc = round.skill_challenge;

  const pid = $("#t_player").value;
  const p = state.players.find(x=>x.id===pid);
  if(!p){
    alert("Pick an active player.");
    return;
  }
  if(p.hp <= 0){
    alert("That player is at 0 HP.");
    return;
  }

  // Must have a skill roll to resolve
  const skillLine = $("#t_skillOut").textContent || "";
  if(skillLine.includes("No roll yet")){
    alert("Roll the Skill check first.");
    return;
  }

  // Reconstruct from output is messy; instead store on window:
  // We'll store last skill in a hidden dataset:
  // To keep this simple: require user to click Roll and we infer pass/fail by presence of ✅/❌.
  const skillPass = $("#t_skillOut").innerHTML.includes("✅");
  const actionId = $("#t_action").value;
  const dcLevel = $("#t_dc").value;

  // Apply skill result
  if(skillPass){
    let gained = 1;

    // Beast-Pen special: Hard animal_handling gives +2 successes once per player
    const isBeastBonus = round.id === "r4" && actionId === "animal_handling" && dcLevel === "hard";
    if(isBeastBonus && !p._beastBonusUsed){
      gained = 2;
      p._beastBonusUsed = true;
      log(`${p.name} mastered the beast line (Hard): +2 successes (once per player).`);
    }else{
      log(`${p.name} succeeded: +1 success.`);
    }

    state.successes += gained;
  }else{
    applyFailureToPlayer(p, round);
  }

  // Overtime pressure (after turn_limit)
  applyOvertimePressure(round);

  // Check victory/defeat conditions
  const victoryByScore = state.successes >= sc.target_successes;
  const defeatByFails = state.failures >= sc.max_failures;
  const defeatByWipe = !partyAlive();

  // Alternate win: all enemies defeated (hybrid pace)
  const victoryByKO = !enemiesAlive();

  hideDock();

  renderPartyList();
  renderEnemyList();
  renderHeaderStats();
  save();

  if(victoryByKO){
    setStatus("Opponents defeated. Round can end now.");
    log("All opponents defeated. You may End Round as a win.");
    return;
  }

  if(victoryByScore){
    endRound(true);
    return;
  }

  if(defeatByFails || defeatByWipe){
    endRound(false);
    return;
  }

  setStatus("Turn resolved. Click Play Turn for the next player.");
}

function openAddPlayer(){
  const tpl = $("#tplAddPlayer");
  const node = tpl.content.cloneNode(true);
  const form = node.querySelector("#addPlayerForm");

  showDock({
    title: "Add Player",
    sub: "Portrait + HP tracker only (no tokens).",
    body: "",
    actions: []
  });

  $("#dockBody").appendChild(node);

  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get("name")||"").trim();
    const maxHp = clamp(parseInt(fd.get("maxHp")||"0",10) || 1, 1, 999);
    const tag = String(fd.get("tag")||"").trim();
    const file = fd.get("image");

    let image = "";
    if(file && file instanceof File && file.size > 0){
      image = await fileToSmallDataURL(file, 96, 0.78);
    }

    const id = uid("p");
    state.players.push({ id, name, tag, maxHp, hp:maxHp, image });

    const ok = save();
    if(!ok){
      // rollback (prevents duplicates)
      state.players = state.players.filter(p=>p.id !== id);
      alert("Storage is full (usually portraits). Try a smaller image.");
      renderPartyList();
      return;
    }

    renderPartyList();
    hideDock();
  });

  $("#dockBody").querySelector("[data-cancel]").addEventListener("click", hideDock);
}

async function init(){
  load();

  const res = await fetch("data/arenas.json");
  const data = await res.json();
  state.arenas = data.arenas || [];

  // Restore selection if possible, otherwise default
  if(!state.arenaId) state.arenaId = state.arenas[0]?.id || null;
  if(!state.roundId) state.roundId = state.arenas[0]?.rounds?.[0]?.id || null;

  renderSelects();
  setScene();
  renderPartyList();
  renderEnemyList();
  renderHeaderStats();

  $("#arenaSelect").addEventListener("change", (e)=>{
    state.arenaId = e.target.value;
    const a = getArena();
    state.roundId = a?.rounds?.[0]?.id || null;
    save();
    resetRunState("Arena changed. Ready.");
    renderSelects();
    setScene();
    renderHeaderStats();
  });

  $("#roundSelect").addEventListener("change", (e)=>{
    state.roundId = e.target.value;
    save();
    resetRunState("Round changed. Ready.");
    setScene();
    renderHeaderStats();
  });

  $("#enterArenaBtn").addEventListener("click", ()=>{
  // user gesture: safe moment to start audio
  startCrowdLoop();
  startRound(state.roundId);
});
   
  $("#addPlayerBtn").addEventListener("click", openAddPlayer);

  $("#backToStartBtn").addEventListener("click", ()=>{
    if(!confirm("Back to Start? (Resets run counters and returns to first round)")) return;
    const a = getArena();
    if(!a) return;
    state.roundId = a.rounds[0]?.id || state.roundId;
    save();
    resetRunState("Back to start. Enter The Arena to begin.");
    renderSelects();
    setScene();
    renderHeaderStats();
  });

  $("#resetRunBtn").addEventListener("click", ()=>{
    if(!confirm("Reset current run (success/fail/turn/opponents)?")) return;
    resetRunState("Run reset. Enter The Arena to start again.");
    setScene();
  });

  $("#dockClose").addEventListener("click", hideDock);

  $("#viewRulesBtn").addEventListener("click", ()=> openRulesDock(false));

  $("#playTurnBtn").addEventListener("click", openTurnDock);

  $("#endRoundBtn").addEventListener("click", ()=>{
    if(!state.runActive){
      setStatus("No active round.");
      return;
    }
    const living = state.enemies.filter(e=>e.maxHp && e.hp>0);
    const msg = living.length===0
      ? "All opponents appear defeated. End this round now?"
      : `There are still ${living.length} opponent(s) with HP remaining. End anyway?`;

    showDock({
      title: "End Round",
      sub: msg,
      body: `<div class="card"><div class="muted">Use this if you want the hybrid model: defeat opponents first, then finish the round.</div></div>`,
      actions: [
        { label:"Count as Win", variant:"primary", onClick: ()=>{ hideDock(); endRound(true); } },
        { label:"Count as Loss", variant:"danger", onClick: ()=>{ hideDock(); endRound(false); } },
        { label:"Cancel", variant:"ghost", onClick: hideDock }
      ]
    });
  });

  $("#forfeitBtn").addEventListener("click", ()=>{
    if(!state.runActive){
      setStatus("No active round.");
      return;
    }
    if(confirm("Forfeit this round?")){
      endRound(false);
    }
  });

  setStatus("Ready. Add players, then Enter The Arena.");
  log("Loaded Arenas (POV mini-game mode).");
  renderHeaderStats();
}

init();
