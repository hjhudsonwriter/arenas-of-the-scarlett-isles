/* Arenas of The Scarlett Isles
   GitHub Pages single-page app:
   - Map viewer with adjustable grid
   - Draggable player & enemy tokens
   - Arena rounds as skill-challenge mini-games:
     Round start rules modal -> per-turn roll modal -> end-of-round summary modal -> next round
*/

const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

const STORAGE_KEY = "tsi_arenas_state_v2";

const state = {
  arenas: [],
  arenaId: null,
  roundId: null,

  // persistent
  players: [],
  positions: {},
  gridEnabled: true,
  gridSize: 70,
  totalGold: 0,

  // run state
  runActive: false,
  turn: 1,
  successes: 0,
  failures: 0,
  pressure: 0,
  dcModifier: 0,
  enemies: [],
};

function uid(prefix="id"){
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function save(){
  const payload = {
    players: state.players,
    positions: state.positions,
    gridEnabled: state.gridEnabled,
    gridSize: state.gridSize,
    totalGold: state.totalGold
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function load(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return;
    const p = JSON.parse(raw);
    state.players = p.players || [];
    state.positions = p.positions || {};
    state.gridEnabled = p.gridEnabled ?? true;
    state.gridSize = p.gridSize ?? 70;
    state.totalGold = p.totalGold ?? 0;
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

function getArena(){
  return state.arenas.find(a => a.id === state.arenaId) || null;
}
function getRound(){
  const a = getArena();
  if(!a) return null;
  return a.rounds.find(r => r.id === state.roundId) || a.rounds[0] || null;
}

function setStatus(text){ $("#statusPill").textContent = text; }

function setGrid(){
  const overlay = $("#gridOverlay");
  overlay.style.display = state.gridEnabled ? "block" : "none";
  const s = state.gridSize;
  overlay.style.backgroundSize = `${s}px ${s}px`;
  overlay.style.backgroundImage = `
    linear-gradient(to right, rgba(255,255,255,.22) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255,255,255,.22) 1px, transparent 1px)
  `;
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
    roundSel.value = state.roundId;
  }
}

function renderMap(){
  const r = getRound();
  if(!r) return;
  $("#mapImage").src = r.map;
  renderRunStats();
}

function renderRunStats(){
  const r = getRound();
  const sc = r?.skill_challenge;
  $("#goldTotal").textContent = String(state.totalGold);
  $("#succCount").textContent = String(state.successes);
  $("#failCount").textContent = String(state.failures);
  $("#succTarget").textContent = String(sc?.target_successes ?? 0);
  $("#failMax").textContent = String(sc?.max_failures ?? 0);
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function computeTokenPx(size){
  if(size === 3) return 128;
  if(size === 2) return 96;
  return 64;
}

function ensurePos(id, kind){
  if(state.positions[id]) return state.positions[id];
  const baseX = kind === "player" ? 35 : 65;
  const spread = kind === "player" ? 12 : 18;
  const idx = Object.keys(state.positions).length % 6;
  const pos = { x: clamp(baseX + (idx-2)*spread, 8, 92), y: clamp(75 + ((idx%3)-1)*9, 10, 92) };
  state.positions[id] = pos;
  return pos;
}

function tokenSvg(fill){
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
    <rect x="18" y="18" width="220" height="220" rx="28" fill="${fill}" opacity="0.95"/>
    <rect x="28" y="28" width="200" height="200" rx="24" fill="rgba(0,0,0,0.25)"/>
    <circle cx="128" cy="128" r="64" fill="rgba(255,255,255,0.18)"/>
  </svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function enemyTokenImg(type){
  if(type === "wyvern") return "assets/wyvern.png";
  if(type === "beast") return tokenSvg("#d9b35f");
  if(type === "hazard") return tokenSvg("#7c7c86");
  if(type === "npc") return tokenSvg("#8aa7ff");
  return tokenSvg("#a11f2b");
}

function enableDrag(el, locked){
  if(locked) return;
  const viewport = $("#mapViewport");
  let dragging = false;

  el.addEventListener("pointerdown", (e)=>{
    if(e.button !== undefined && e.button !== 0) return;
    dragging = true;
    el.setPointerCapture?.(e.pointerId);
  });

  window.addEventListener("pointermove", (e)=>{
    if(!dragging) return;
    const rect = viewport.getBoundingClientRect();
    const cx = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const cy = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    const x = cx * 100;
    const y = cy * 100;
    el.style.left = x + "%";
    el.style.top = y + "%";
    state.positions[el.dataset.id] = {x,y};
    save();
  });

  window.addEventListener("pointerup", ()=>{ dragging = false; });
}

function makeToken({id, name, img, size, hpText, locked, kind}){
  const pos = ensurePos(id, kind);
  const el = document.createElement("div");
  el.className = "token";
  el.dataset.id = id;
  el.style.left = pos.x + "%";
  el.style.top = pos.y + "%";
  const px = computeTokenPx(size);
  el.style.width = px + "px";
  el.style.height = px + "px";

  const im = document.createElement("img");
  im.className = "token__img";
  im.src = img;
  im.alt = name;

  const label = document.createElement("div");
  label.className = "token__label";
  label.textContent = name;

  el.appendChild(im);
  el.appendChild(label);

  if(hpText){
    const hp = document.createElement("div");
    hp.className = "token__hp";
    hp.textContent = hpText;
    el.appendChild(hp);
  }

  enableDrag(el, locked);
  return el;
}

function renderTokens(){
  const layer = $("#tokenLayer");
  layer.innerHTML = "";

  for(const p of state.players){
    layer.appendChild(makeToken({
      id: p.id,
      name: p.name,
      img: p.image || "assets/tokens/ring.png",
      size: p.size,
      hpText: `${p.hp}`,
      locked: false,
      kind: "player"
    }));
  }

  for(const e of state.enemies){
    layer.appendChild(makeToken({
      id: e.id,
      name: e.name,
      img: e.image || enemyTokenImg(e.token),
      size: e.size || 1,
      hpText: e.maxHp ? `${e.hp}` : "",
      locked: !!e.locked,
      kind: "enemy"
    }));
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
      <div class="cardRow">
        <div>
          <div><strong>${escapeHtml(p.name)}</strong> ${p.tag ? `<span class="badge">${escapeHtml(p.tag)}</span>` : ""}</div>
          <div class="muted" style="font-size:12px;margin-top:2px;">HP ${p.hp}/${p.maxHp}</div>
        </div>
        <div class="badge">Size ${p.size}x</div>
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
        changeHp(p.id, parseInt(t.dataset.heal,10));
      }else if(t.dataset.dmg){
        changeHp(p.id, -parseInt(t.dataset.dmg,10));
      }else if(t.dataset.set !== undefined){
        const v = prompt(`Set HP for ${p.name} (0-${p.maxHp})`, String(p.hp));
        if(v === null) return;
        p.hp = clamp(parseInt(v,10)||0, 0, p.maxHp);
        save(); renderPartyList(); renderTokens();
      }else if(t.dataset.remove !== undefined){
        if(confirm(`Remove ${p.name}?`)){
          state.players = state.players.filter(x=>x.id !== p.id);
          delete state.positions[p.id];
          save(); renderPartyList(); renderTokens();
        }
      }
    });
  }
}

function renderEnemyList(){
  const host = $("#enemyList");
  host.innerHTML = "";
  if(state.enemies.length === 0){
    host.innerHTML = `<div class="card"><div class="muted">Enemies appear when you enter a round.</div></div>`;
    return;
  }

  for(const e of state.enemies){
    const card = document.createElement("div");
    card.className = "card";
    const hpPct = e.maxHp ? Math.max(0, Math.min(1, e.hp / e.maxHp)) : 1;
    card.innerHTML = `
      <div class="cardRow">
        <div>
          <div><strong>${escapeHtml(e.name)}</strong> ${e.locked ? `<span class="badge">Locked</span>` : ""}</div>
          ${e.maxHp ? `<div class="muted" style="font-size:12px;margin-top:2px;">HP ${e.hp}/${e.maxHp}</div>` : `<div class="muted" style="font-size:12px;margin-top:2px;">Prop / Hazard</div>`}
        </div>
        <div class="badge">Size ${e.size}x</div>
      </div>
      ${e.maxHp ? `<div class="hpBar"><div class="hpFill" style="width:${Math.round(hpPct*100)}%"></div></div>` : ""}
      <div class="smallBtns">
        ${e.maxHp ? `
          <button class="btn btn--ghost" data-dmg="10">-10</button>
          <button class="btn btn--ghost" data-dmg="25">-25</button>
          <button class="btn btn--ghost" data-heal="10">+10</button>
          <button class="btn btn--ghost" data-set>Set HP</button>
        ` : ""}
        <button class="btn btn--danger" data-remove>Remove</button>
      </div>
    `;
    host.appendChild(card);

    card.addEventListener("click", (ev)=>{
      const t = ev.target;
      if(!(t instanceof HTMLElement)) return;
      if(t.dataset.dmg && e.maxHp){
        e.hp = clamp(e.hp - parseInt(t.dataset.dmg,10), 0, e.maxHp);
        renderEnemyList(); renderTokens();
      }else if(t.dataset.heal && e.maxHp){
        e.hp = clamp(e.hp + parseInt(t.dataset.heal,10), 0, e.maxHp);
        renderEnemyList(); renderTokens();
      }else if(t.dataset.set !== undefined && e.maxHp){
        const v = prompt(`Set HP for ${e.name} (0-${e.maxHp})`, String(e.hp));
        if(v === null) return;
        e.hp = clamp(parseInt(v,10)||0, 0, e.maxHp);
        renderEnemyList(); renderTokens();
      }else if(t.dataset.remove !== undefined){
        state.enemies = state.enemies.filter(x=>x.id !== e.id);
        delete state.positions[e.id];
        renderEnemyList(); renderTokens();
      }
    });
  }
}

function changeHp(pid, delta){
  const p = state.players.find(x=>x.id===pid);
  if(!p) return;
  p.hp = clamp(p.hp + delta, 0, p.maxHp);
  save();
  renderPartyList();
  renderTokens();
}

function rollDice(expr){
  const m = String(expr).trim().match(/^(\d+)d(\d+)$/i);
  if(!m) return {total:0, rolls:[], expr};
  const c = parseInt(m[1],10);
  const s = parseInt(m[2],10);
  let total = 0;
  const rolls = [];
  for(let i=0;i<c;i++){
    const r = 1 + Math.floor(Math.random()*s);
    rolls.push(r);
    total += r;
  }
  return {total, rolls, expr};
}

function showModal({title, subtitle="", bodyHtml="", actions=[]}){
  $("#modalTitle").textContent = title;
  $("#modalSubtitle").textContent = subtitle;
  $("#modalBody").innerHTML = bodyHtml;

  const host = $("#modalActions");
  host.innerHTML = "";
  for(const a of actions){
    const b = document.createElement("button");
    b.className = "btn" + (a.variant ? ` btn--${a.variant}` : "");
    b.textContent = a.label;
    b.addEventListener("click", ()=> a.onClick?.());
    host.appendChild(b);
  }

  $("#modalBackdrop").classList.remove("hidden");
  $("#modal").classList.remove("hidden");
}
function closeModal(){
  $("#modalBackdrop").classList.add("hidden");
  $("#modal").classList.add("hidden");
  $("#modalBody").innerHTML = "";
  $("#modalActions").innerHTML = "";
}

function roundRulesHtml(round){
  const sc = round.skill_challenge;
  const notes = (sc.notes||[]).map(n=>`<li>${escapeHtml(n)}</li>`).join("");
  const actions = (sc.actions||[]).map(a=>`<li><strong>${escapeHtml(a.label)}</strong>${a.special==="team_once" ? ` <span class="badge">Team once/turn</span>`:""}</li>`).join("");
  const dce = sc.dcs.easy + state.dcModifier;
  const dcs = sc.dcs.standard + state.dcModifier;
  const dch = sc.dcs.hard + state.dcModifier;

  return `
    <div class="card">
      <div><strong>What you’re trying to do</strong></div>
      <ul style="margin:8px 0 0 18px;">${notes}</ul>
    </div>
    <div style="height:10px"></div>
    <div class="card">
      <div class="cardRow">
        <div><strong>Win Condition</strong></div>
        <div class="badge">${sc.target_successes} successes</div>
      </div>
      <div class="cardRow" style="margin-top:8px;">
        <div><strong>Lose Condition</strong></div>
        <div class="badge">${sc.max_failures} failures</div>
      </div>
      <div style="margin-top:8px;color:var(--muted);font-size:13px;">
        Failure damage: <span class="kbd">${escapeHtml(sc.damage_on_failure)}</span>
      </div>
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
        <span class="badge">Easy ${dce}</span>
        <span class="badge">Standard ${dcs}</span>
        <span class="badge">Hard ${dch}</span>
        ${state.pressure ? `<span class="badge">Pressure ${state.pressure}</span>`:""}
      </div>
    </div>
  `;
}

function resetPlayersToMax(){
  for(const p of state.players){
    p.hp = p.maxHp;
  }
  save();
  renderPartyList();
  renderTokens();
}

function resetRunState(){
  state.runActive = false;
  state.turn = 1;
  state.successes = 0;
  state.failures = 0;
  state.pressure = 0;
  state.dcModifier = 0;
  state.enemies = [];
  renderEnemyList();
  renderRunStats();
  renderTokens();
  setStatus("Run reset. Enter The Arena to start.");
  log("Run reset.");
}

function spawnEnemies(round){
  state.enemies = [];
  for(const def of (round.enemies||[])){
    for(let i=0;i<def.count;i++){
      const id = uid("e");
      const name = def.count > 1 ? `${def.name} ${i+1}` : def.name;
      state.enemies.push({
        id,
        name,
        token: def.token || "enemy",
        maxHp: def.hp ?? null,
        hp: def.hp ?? null,
        size: def.size ?? 1,
        locked: !!def.locked,
        image: def.image || null
      });
      ensurePos(id, "enemy");
    }
  }
}

function partyAlive(){
  return state.players.some(p => p.hp > 0);
}

function openTurnModal(){
  const round = getRound();
  if(!round) return;
  if(state.players.length === 0){
    showModal({
      title:"No players",
      subtitle:"Add at least one player first.",
      bodyHtml:`<div class="card"><div class="muted">Use <span class="kbd">Add Player</span> in the top bar.</div></div>`,
      actions:[{label:"Close",variant:"ghost",onClick:closeModal}]
    });
    return;
  }

  const sc = round.skill_challenge;
  const dcEasy = Math.max(14, sc.dcs.easy + state.dcModifier);
  const dcStd  = Math.max(15, sc.dcs.standard + state.dcModifier);
  const dcHard = Math.max(16, sc.dcs.hard + state.dcModifier);

  const actionOptions = sc.actions.map(a=>`<option value="${escapeHtml(a.id)}">${escapeHtml(a.label)}</option>`).join("");

  const rows = state.players.map(p=>{
    const disabled = p.hp <= 0 ? "disabled" : "";
    return `
      <div class="card" style="background:rgba(255,255,255,.02)">
        <div class="cardRow">
          <div><strong>${escapeHtml(p.name)}</strong> <span class="badge">HP ${p.hp}/${p.maxHp}</span></div>
          <div class="badge">d20</div>
        </div>
        <div class="grid2" style="margin-top:10px;">
          <label class="field">
            <span>Approach</span>
            <select data-action="${p.id}" ${disabled}>${actionOptions}</select>
          </label>
          <label class="field">
            <span>DC</span>
            <select data-dc="${p.id}" ${disabled}>
              <option value="easy">Easy (${dcEasy})</option>
              <option value="standard" selected>Standard (${dcStd})</option>
              <option value="hard">Hard (${dcHard})</option>
            </select>
          </label>
        </div>
        <div class="grid2" style="margin-top:10px;">
          <label class="field">
            <span>Modifier</span>
            <input type="number" data-mod="${p.id}" value="0" ${disabled}/>
          </label>
          <div class="field">
            <span>Roll</span>
            <button class="btn btn--primary" type="button" data-roll="${p.id}" ${disabled}>Roll d20</button>
          </div>
        </div>
        <div class="muted" style="font-size:12px;margin-top:8px;" data-out="${p.id}">${p.hp<=0 ? "0 HP (skipped)":"No roll yet."}</div>
      </div>
    `;
  }).join("");

  showModal({
    title:`${round.title}`,
    subtitle:`Turn ${state.turn} | Success ${state.successes}/${sc.target_successes} | Fail ${state.failures}/${sc.max_failures}`,
    bodyHtml:`
      <div class="card">
        <div class="cardRow">
          <div><strong>Turn ${state.turn}</strong></div>
          <div class="badge">DCs: Easy ${dcEasy} | Std ${dcStd} | Hard ${dcHard}</div>
        </div>
        <div style="margin-top:8px;color:var(--muted);font-size:13px;">
          Everyone rolls once. A pass = +1 success. A fail = +1 failure and damage.
        </div>
        ${round.id==="r5" ? `<div class="muted" style="font-size:13px;margin-top:8px;">Team Special: <span class="kbd">Work the winch</span> can be attempted once per turn.</div>` : ""}
        ${round.id==="r3" ? `<div class="muted" style="font-size:13px;margin-top:8px;">Pressure: <span class="kbd">${state.pressure}</span> (at 3, next failure spikes).</div>` : ""}
      </div>
      <div style="height:10px"></div>
      <div class="card">
        <div><strong>Rolls</strong></div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">${rows}</div>
      </div>
    `,
    actions:[
      {label:"Resolve Turn", variant:"primary", onClick: ()=> resolveTurn(round)},
      {label:"Cancel", variant:"ghost", onClick: closeModal}
    ]
  });

  const turnRolls = new Map(); // pid -> {pass, total, dc, actionId, dcLevel, d20, mod}

  $$("#modalBody [data-roll]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const pid = btn.getAttribute("data-roll");
      const p = state.players.find(x=>x.id===pid);
      if(!p || p.hp<=0) return;

      const actionId = $(`#modalBody [data-action="${pid}"]`).value;
      const dcLevel = $(`#modalBody [data-dc="${pid}"]`).value;
      const mod = parseInt($(`#modalBody [data-mod="${pid}"]`).value || "0", 10);

      const d20 = 1 + Math.floor(Math.random()*20);
      const total = d20 + mod;

      const baseDc = (dcLevel==="easy" ? sc.dcs.easy : dcLevel==="hard" ? sc.dcs.hard : sc.dcs.standard);
      let dc = baseDc + state.dcModifier;

      // keep minimums sane when DC modifier reduces
      if(dcLevel==="easy") dc = Math.max(14, dc);
      if(dcLevel==="standard") dc = Math.max(15, dc);
      if(dcLevel==="hard") dc = Math.max(16, dc);

      const pass = total >= dc;
      turnRolls.set(pid, {pass, total, dc, actionId, dcLevel, d20, mod});

      const out = $(`#modalBody [data-out="${pid}"]`);
      out.innerHTML = pass
        ? `✅ <span class="kbd">${d20}</span> + ${mod} = <strong>${total}</strong> vs DC ${dc}.`
        : `❌ <span class="kbd">${d20}</span> + ${mod} = <strong>${total}</strong> vs DC ${dc}.`;
    });
  });

  function resolveTurn(round){
    // Verify rolls
    for(const p of state.players){
      if(p.hp<=0) continue;
      if(!turnRolls.has(p.id)){
        alert(`Missing roll for ${p.name}.`);
        return;
      }
    }

    const sc = round.skill_challenge;
    let winchAttempted = false;
    let winchSucceeded = false;

    for(const p of state.players){
      if(p.hp<=0) continue;
      const rr = turnRolls.get(p.id);
      if(!rr) continue;

      // Round 5: winch team_once
      if(round.id === "r5" && rr.actionId === "winch"){
        if(winchAttempted){
          log(`${p.name} tried the winch, but it was already attempted this turn.`);
          continue;
        }
        winchAttempted = true;
        if(rr.pass) winchSucceeded = true;
      }

      // Round 4: once per player, Hard Animal Handling grants +2 successes on pass
      if(round.id === "r4" && rr.actionId === "animal_handling" && rr.dcLevel === "hard"){
        if(rr.pass){
          if(!p._beastBonusUsed){
            state.successes += 2;
            p._beastBonusUsed = true;
            log(`${p.name} calmed/redirected a beast (Hard): +2 successes!`);
          }else{
            state.successes += 1;
            log(`${p.name} succeeded (bonus already used): +1 success.`);
          }
        }else{
          applyFailure(p, sc.damage_on_failure, round);
        }
        continue;
      }

      if(rr.pass){
        state.successes += 1;
        log(`${p.name} succeeded (${rr.dcLevel}).`);
      }else{
        applyFailure(p, sc.damage_on_failure, round);
      }
    }

    if(round.id === "r5" && winchAttempted){
      if(winchSucceeded){
        // reduce dcModifier by 1 (more negative = easier), but cap so Easy DC won't go below 14
        const cap = -(sc.dcs.easy - 14);
        state.dcModifier = Math.max(state.dcModifier - 1, cap);
        log(`WINCH SUCCESS: DCs reduce by 1 next turn.`);
      }else{
        log(`Winch failed. Chains bite back.`);
      }
    }

    closeModal();
    renderRunStats();
    renderPartyList();
    renderTokens();

    const victory = state.successes >= sc.target_successes;
    const defeat = state.failures >= sc.max_failures || !partyAlive();

    if(victory) return endRound(true);
    if(defeat) return endRound(false);

    state.turn += 1;
    setStatus(`Turn ${state.turn}. Click Play Turn.`);
    log(`Turn ${state.turn} begins.`);
    renderRunStats();
  }
}

function applyFailure(player, damageExpr, round){
  state.failures += 1;

  let expr = damageExpr;
  if(round.id === "r3"){
    state.pressure += 1;
    if(state.pressure >= 3){
      expr = "6d6";
      state.pressure = 0;
      log(`PRESSURE SPIKE triggered.`);
    }
  }

  const dmg = rollDice(expr);
  player.hp = clamp(player.hp - dmg.total, 0, player.maxHp);
  save();
  log(`${player.name} failed: ${dmg.total} damage (${expr}: ${dmg.rolls.join(", ")}).`);
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

  const actions = [];
  if(won && next){
    actions.push({
      label:"Proceed to Next Round",
      variant:"primary",
      onClick: ()=>{
        closeModal();
        startRound(next, true);
      }
    });
  }
  actions.push({
    label: won ? "Leave Arena" : "Leave Arena (Defeated)",
    variant:"ghost",
    onClick: ()=>{
      closeModal();
      state.runActive = false;
      state.enemies = [];
      renderEnemyList();
      renderTokens();
      setStatus("Run ended. Enter The Arena to start again.");
      log("Run ended.");
      renderRunStats();
    }
  });

  showModal({
    title: won ? "Round Cleared" : "Defeat",
    subtitle: won ? `You win ${prize} GP.` : `The Salt-Ring Trials end here.`,
    bodyHtml: `
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
    actions
  });
}

function getNextRoundId(){
  const a = getArena();
  if(!a) return null;
  const idx = a.rounds.findIndex(r => r.id === state.roundId);
  if(idx < 0) return null;
  return a.rounds[idx+1]?.id || null;
}

function startRound(roundId, fromProgression=false){
  const a = getArena();
  if(!a) return;
  const r = a.rounds.find(x=>x.id===roundId) || a.rounds[0];
  state.roundId = r.id;

  // reset counters, spawn enemies, reset per-round flags
  state.runActive = true;
  state.turn = 1;
  state.successes = 0;
  state.failures = 0;
  state.pressure = 0;
  state.dcModifier = 0;
  for(const p of state.players){ delete p._beastBonusUsed; }
  spawnEnemies(r);

  renderSelects();
  renderMap();
  renderEnemyList();
  renderTokens();
  renderRunStats();

  showModal({
    title: fromProgression ? `Next Round: ${r.title}` : `Enter The Arena: ${r.title}`,
    subtitle: `Prize: ${r.reward_gp} GP`,
    bodyHtml: roundRulesHtml(r),
    actions:[
      {label:"Begin Round", variant:"primary", onClick: ()=>{
        closeModal();
        setStatus("Turn 1. Click Play Turn.");
        log(`--- ${r.title} begins ---`);
        openTurnModal();
      }},
      {label:"Not yet", variant:"ghost", onClick: closeModal}
    ]
  });
}

function openRoundRules(){
  const r = getRound();
  if(!r) return;
  showModal({
    title: r.title,
    subtitle: `Prize: ${r.reward_gp} GP`,
    bodyHtml: roundRulesHtml(r),
    actions:[{label:"Close",variant:"ghost",onClick:closeModal}]
  });
}

function openAddPlayer(){
  const tpl = $("#tplAddPlayer");
  const node = tpl.content.cloneNode(true);
  const form = node.querySelector("#addPlayerForm");

  showModal({ title:"Add Player", subtitle:"Create a draggable token + HP tracker.", bodyHtml:"", actions:[] });
  $("#modalBody").appendChild(node);

  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get("name")||"").trim();
    const maxHp = clamp(parseInt(fd.get("maxHp")||"0",10) || 1, 1, 999);
    const size = clamp(parseInt(fd.get("size")||"1",10) || 1, 1, 3);
    const tag = String(fd.get("tag")||"").trim();
    const file = fd.get("image");

    let image = "";
    if(file && file instanceof File && file.size > 0){
      image = await new Promise((resolve,reject)=>{
        const reader = new FileReader();
        reader.onload = ()=> resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    const id = uid("p");
    state.players.push({ id, name, maxHp, hp:maxHp, size, tag, image });
    ensurePos(id, "player");
    save();
    renderPartyList();
    renderTokens();
    closeModal();
  });

  $("#modalBody").querySelector("[data-cancel]").addEventListener("click", closeModal);
}

async function init(){
  load();
  setGrid();

  const res = await fetch("data/arenas.json");
  const data = await res.json();
  state.arenas = data.arenas || [];
  state.arenaId = state.arenas[0]?.id || null;
  state.roundId = state.arenas[0]?.rounds?.[0]?.id || null;

  renderSelects();
  renderMap();
  renderPartyList();
  renderEnemyList();
  renderTokens();

  $("#gridToggle").checked = state.gridEnabled;
  $("#gridSize").value = state.gridSize;

  $("#arenaSelect").addEventListener("change", (e)=>{
    state.arenaId = e.target.value;
    const a = getArena();
    state.roundId = a?.rounds?.[0]?.id || null;
    resetRunState();
    renderSelects();
    renderMap();
  });

  $("#roundSelect").addEventListener("change", (e)=>{
    state.roundId = e.target.value;
    resetRunState();
    renderMap();
  });

  $("#enterArenaBtn").addEventListener("click", ()=>{
    startRound(state.roundId, false);
  });

  $("#addPlayerBtn").addEventListener("click", openAddPlayer);

  $("#gridToggle").addEventListener("change", (e)=>{
    state.gridEnabled = e.target.checked;
    setGrid();
    save();
  });

  $("#gridSize").addEventListener("input", (e)=>{
    state.gridSize = parseInt(e.target.value,10);
    setGrid();
    save();
  });

  $("#resetPositionsBtn").addEventListener("click", ()=>{
    if(!confirm("Reset all token positions?")) return;
    state.positions = {};
    save();
    renderTokens();
  });

  $("#restartRoundBtn").addEventListener("click", ()=>{
  if(!confirm("Restart this round from the beginning? (Resets successes/failures, respawns enemies, resets party HP)")) return;
  const current = getRound();
  if(!current) return;

  resetPlayersToMax();

  // Clear only enemy positions (keep player positions)
  state.positions = state.positions || {};
  for(const e of state.enemies){ delete state.positions[e.id]; }

  state.turn = 1;
  state.successes = 0;
  state.failures = 0;
  state.pressure = 0;
  state.dcModifier = 0;

  spawnEnemies(current);
  renderEnemyList();
  renderTokens();
  renderRunStats();

  state.runActive = true;
  setStatus("Round restarted. Click Play Turn.");
  log(`--- ${current.title} restarted ---`);
});

$("#restartArenaBtn").addEventListener("click", ()=>{
  if(!confirm("Back to Start? (Resets party HP, respawns enemies, returns to Round 1)")) return;
  const a = getArena();
  if(!a) return;

  resetPlayersToMax();

  // Back to Round 1
  state.roundId = a.rounds[0]?.id || state.roundId;

  // Clear enemies so they respawn fresh
  state.enemies = [];

  state.turn = 1;
  state.successes = 0;
  state.failures = 0;
  state.pressure = 0;
  state.dcModifier = 0;

  state.runActive = false;

  renderSelects();
  renderMap();
  renderEnemyList();
  renderTokens();
  renderRunStats();

  setStatus("Back to start. Enter The Arena to begin.");
  log("Returned to Round 1 (start).");
});
   
   $("#resetRunBtn").addEventListener("click", ()=>{
    if(!confirm("Reset the current run (success/fail counters, enemies, DC modifiers)?")) return;
    resetRunState();
  });

  $("#modalClose").addEventListener("click", closeModal);
  $("#modalBackdrop").addEventListener("click", closeModal);

  $("#openRoundRulesBtn").addEventListener("click", openRoundRules);

  $("#nextTurnBtn").addEventListener("click", ()=>{
    if(!state.runActive){
      setStatus("Start the round first: Enter The Arena.");
      return;
    }
    openTurnModal();
  });

  $("#endRoundBtn").addEventListener("click", ()=>{
  if(!state.runActive){
    setStatus("No active round.");
    return;
  }
  const living = state.enemies.filter(e=>e.maxHp && e.hp>0);
  const msg = living.length===0
    ? "All opponents appear defeated. End this round now?"
    : `There are still ${living.length} opponent(s) with HP remaining. End anyway?`;

  showModal({
    title: "End Round",
    subtitle: msg,
    bodyHtml: `<div class="card"><div class="muted">Choose how to resolve the round. If you are using the hybrid model, this is how you finish early when the fight is over.</div></div>`,
    actions: [
      { label: "Count as Win", variant: "primary", onClick: ()=>{ closeModal(); endRound(true); } },
      { label: "Count as Loss", variant: "danger", onClick: ()=>{ closeModal(); endRound(false); } },
      { label: "Cancel", variant: "ghost", onClick: closeModal }
    ]
  });
});
   
   $("#forfeitBtn").addEventListener("click", ()=>{
    if(!state.runActive) return;
    if(confirm("Forfeit this round?")){
      endRound(false);
    }
  });

  setStatus("Ready. Add players, then Enter The Arena.");
  log("Loaded Arenas of The Scarlett Isles.");
  renderRunStats();
}

init();
