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
    // Middlemount: Lion's Crown
  mm_r2_hit: "assets/sfx/lions_totems_hit.mp3",
  mm_r2_fail:"assets/sfx/lions_totems_fail.mp3",
  mm_r3_hit: "assets/sfx/lions_mark_hit.mp3",
  mm_r3_fail:"assets/sfx/lions_mark_fail.mp3", 
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
    if(roundId === "mm_r2") playOneShot(SFX.mm_r2_hit, 0.9);
  if(roundId === "mm_r3") playOneShot(SFX.mm_r3_hit, 0.9); 
  playOneShot(SFX.crowd_hit, 0.75);
}

function playFailSfx(roundId){
  // round-specific first, then crowd fail
  if(roundId === "r1") playOneShot(SFX.r1_fail, 0.9);
  if(roundId === "r4") playOneShot(SFX.r4_fail, 0.9);
  if(roundId === "r5") playOneShot(SFX.r5_fail, 0.9);
    if(roundId === "mm_r2") playOneShot(SFX.mm_r2_fail, 0.9);
  if(roundId === "mm_r3") playOneShot(SFX.mm_r3_fail, 0.9); 
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

  // Round 1 ("Arena Duelists") defeated-state tracking:
  // null = both alive, 1 = duelist 1 dropped first, 2 = duelist 2 dropped first
  r1FirstDefeated: null,
     // Round 2 / Beast-Pen (round id "r4") defeated-state tracking:
  // boar = Razor-Boar, hyena1/hyena2 = Hooked Hyenas (slots 1 and 2)
  r4Dead: { boar:false, hyena1:false, hyena2:false },
     // Middlemount Round 2: Lion Totems tracking
  mmR2TotemsDown: 0, // 0-3

  // Middlemount Round 3: Lion's Mark tracking
  mmR3MarkPlayerId: null,
  mmR3LastMarkedId: null,
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

/* =========================
   Round 1 ("Arena Duelists") defeated-state overlays
   ========================= */

const R1_OVERLAYS = {
  defeated_1: "assets/overlays/arena_duelists_defeated_1.png",
  defeated_2: "assets/overlays/arena_duelists_defeated_2.png",
  hit_1:      "assets/overlays/arena_duelists_hit_1.png",
  hit_2:      "assets/overlays/arena_duelists_hit_2.png",
  fail_1:     "assets/overlays/arena_duelists_fail_1.png",
  fail_2:     "assets/overlays/arena_duelists_fail_2.png",
};

function ensureR1Slots(){
  const r = getRound();
    if(!r || (r.id !== "r1" && r.id !== "mm_r1")) return;

  // If _slot already exists for 1 and 2, keep it.
  const hpEnemies = state.enemies.filter(e => e.maxHp != null);
  const already = hpEnemies.filter(e => e._slot === 1 || e._slot === 2);
  if(already.length >= 2) return;

  // Otherwise assign the first two HP enemies as duelist 1 and 2.
  for(let i=0;i<Math.min(2, hpEnemies.length);i++){
    if(hpEnemies[i]._slot == null) hpEnemies[i]._slot = i + 1;
  }
}

function syncR1FirstDefeatedFromHp(){
  const r = getRound();
    if(!r || (r.id !== "r1" && r.id !== "mm_r1")) return;
  if(state.r1FirstDefeated) return;

  ensureR1Slots();

  const duelists = state.enemies.filter(e => e.maxHp != null && (e._slot === 1 || e._slot === 2));
  for(const e of duelists){
    if((e.hp ?? 0) <= 0){
      state.r1FirstDefeated = e._slot;
      break;
    }
  }
}

function getR1RemainingSlot(){
  if(state.r1FirstDefeated === 1) return 2;
  if(state.r1FirstDefeated === 2) return 1;
  return null;
}

function getPersistentBossOverlaySrc(round){
  if(!round || !state.runActive) return "";

  // Special: Swyth R4 (Beast Pen) uses dynamic persistent overlays based on deaths.
  if(round.id === "r4") return getR4PersistentBossOverlaySrc(round);

  // Special: Middlemount Round 2 (Lion Totems) primary layer = Lion Swordsmen overlays
  if(round.id === "mm_r2") return getMMR2SwordsmenPersistentOverlaySrc(round);

    // Special: Arena Duelists (Swyth r1 + Middlemount mm_r1) swaps to defeated overlay once a duelist drops.
  if(round.id === "r1" || round.id === "mm_r1"){
    syncR1FirstDefeatedFromHp();
    if(state.r1FirstDefeated === 1) return R1_OVERLAYS.defeated_1;
    if(state.r1FirstDefeated === 2) return R1_OVERLAYS.defeated_2;
  }

  // Default: whatever arenas.json says is the standard boss overlay.
  return round.scene?.overlay_boss || "";
}

function getPersistentSecondaryOverlaySrc(round){
  if(!round || !state.runActive) return "";
  if(round.id === "mm_r2") return getMMR2TotemsPersistentOverlaySrc(round);
  return round.scene?.secondary_overlay_boss || "";
}

// ===== Middlemount Round 2 (Lion Totems) overlay logic =====
const MMR2_SWORDSMAN_OVERLAYS = {
  standard: "assets/overlays/lion_swordsman_standard.png",
  hit: "assets/overlays/lion_swordsman_hit.png",
  fail: "assets/overlays/lion_swordsman_fail.png",
  dead_1: "assets/overlays/lion_swordsman_1_dead.png",
  dead_2: "assets/overlays/lion_swordsman_2_dead.png",
  dead_both: "assets/overlays/lion_swordsman_both_dead.png",
};

const MMR2_TOTEM_OVERLAYS = {
  standard: "assets/overlays/lions_totems_standard.png",
  hit: "assets/overlays/lions_totems_hit.png",
  fail: "assets/overlays/lions_totems_fail.png",
  down_1: "assets/overlays/lions_totems_standard_1_dead.png",
  down_2: "assets/overlays/lions_totems_standard_2_dead.png",
  down_3: "assets/overlays/lions_totems_standard_3_dead.png",
};
function isMMR2TotemTarget(target){
  return !!target && target.defId === "lion_totem";
}

function getMMR2TempOverlay(kind, target){
  // kind: "hit" | "fail"
  if(isMMR2TotemTarget(target)) return (kind === "hit") ? MMR2_TOTEM_OVERLAYS.hit : MMR2_TOTEM_OVERLAYS.fail;
  return (kind === "hit") ? MMR2_SWORDSMAN_OVERLAYS.hit : MMR2_SWORDSMAN_OVERLAYS.fail;
}

function ensureMMR2Slots(){
  if(!state.mmR2Dead) state.mmR2Dead = { swordsman1:false, swordsman2:false };
  if(typeof state.mmR2TotemsDown !== "number") state.mmR2TotemsDown = 0;
}

function markMMR2Dead(enemy){
  ensureMMR2Slots();

  if(enemy.defId === "lion_swordsman"){
    if(enemy._slot === 1) state.mmR2Dead.swordsman1 = true;
    if(enemy._slot === 2) state.mmR2Dead.swordsman2 = true;
  }

  if(enemy.defId === "lion_totem"){
    const totems = state.enemies.filter(e => e.maxHp && e.defId === "lion_totem");
    state.mmR2TotemsDown = totems.filter(t => (t.hp ?? 0) <= 0).length;
  }
}

function syncMMR2DeathsFromHp(){
  const r = getRound();
  if(!r || r.id !== "mm_r2") return;

  ensureMMR2Slots();

  for(const e of state.enemies){
    if(!e.maxHp) continue;
    if((e.hp ?? 0) <= 0) markMMR2Dead(e);
  }
}

function getMMR2SwordsmenPersistentOverlaySrc(round){
  syncMMR2DeathsFromHp();

  const d = state.mmR2Dead || { swordsman1:false, swordsman2:false };
  const deadCount = (d.swordsman1 ? 1 : 0) + (d.swordsman2 ? 1 : 0);

  if(deadCount === 0) return round.scene?.overlay_boss || MMR2_SWORDSMAN_OVERLAYS.standard;
  if(deadCount === 2) return MMR2_SWORDSMAN_OVERLAYS.dead_both;

  // exactly one dead
  return d.swordsman2 ? MMR2_SWORDSMAN_OVERLAYS.dead_2 : MMR2_SWORDSMAN_OVERLAYS.dead_1;
}

function getMMR2TotemsPersistentOverlaySrc(round){
  syncMMR2DeathsFromHp();

  const down = Math.max(0, Math.min(3, state.mmR2TotemsDown || 0));
  if(down === 0) return round.scene?.secondary_overlay_boss || MMR2_TOTEM_OVERLAYS.standard;
  if(down === 1) return MMR2_TOTEM_OVERLAYS.down_1;
  if(down === 2) return MMR2_TOTEM_OVERLAYS.down_2;
  return MMR2_TOTEM_OVERLAYS.down_3;
}

function getHitOverlaySrc(round){
  const ov = round.scene?.overlays || {};

    if(round.id === "r4") return getR4HitOverlaySrc(round);
    if(round.id !== "r1" && round.id !== "mm_r1") return ov.pc_hit;

  syncR1FirstDefeatedFromHp();
  const remain = getR1RemainingSlot();

  // After first death: only show the remaining-duelist hit overlay.
  if(remain === 1) return R1_OVERLAYS.hit_1;
  if(remain === 2) return R1_OVERLAYS.hit_2;

  // Before any death: keep your existing Round 1 hit overlay from arenas.json.
  return ov.pc_hit;
}

function getFailOverlaySrc(round){
  const ov = round.scene?.overlays || {};

    if(round.id === "r4") return getR4FailOverlaySrc(round);
    if(round.id !== "r1" && round.id !== "mm_r1") return ov.pc_fail;

  syncR1FirstDefeatedFromHp();
  const remain = getR1RemainingSlot();

  // After first death: only show the remaining-duelist fail overlay.
  if(remain === 1) return R1_OVERLAYS.fail_1;
  if(remain === 2) return R1_OVERLAYS.fail_2;

  // Before any death: keep your existing Round 1 fail overlay from arenas.json.
  return ov.pc_fail;
}
/* =========================
   Round 2 ("Beast-Pen", id "r4") death-state overlays
   ========================= */

const R4_OVERLAYS = {
  // persistent standards
  standard:               "assets/overlays/beast_pen_standard.png",
  standard_boar_dead:     "assets/overlays/beast_pen_standard_boar_dead.png",
  standard_hyena_1_dead:  "assets/overlays/beast_pen_standard_hyena_1_dead.png",
  standard_hyena_2_dead:  "assets/overlays/beast_pen_standard_hyena_2_dead.png",
  standard_hyena_both_dead:"assets/overlays/beast_pen_standard_hyena_both_dead.png",
  standard_boar_hyena_dead:"assets/overlays/beast_pen_standard_boar_hyena_dead.png",

  // hits
  hit_standard:           "assets/overlays/beast_pen_hit_standard.png",
  hit_boar_dead:          "assets/overlays/beast_pen_hit_boar_dead.png",
  hit_hyena_dead:         "assets/overlays/beast_pen_hit_hyena_dead.png",        // use when either hyena is dead
  hit_hyena_both_dead:    "assets/overlays/beast_pen_hit_hyena_both_dead.png",
  hit_boar_hyena_dead:    "assets/overlays/beast_pen_hit_boar_hyena_dead.png",

  // fails (boar-attacks family)
  boar_fail_standard:       "assets/overlays/beast_pen_boar_fail_standard.png",
  boar_fail_hyena_1_dead:   "assets/overlays/beast_pen_boar_fail_hyena_1_dead.png",
  boar_fail_hyena_2_dead:   "assets/overlays/beast_pen_boar_fail_hyena_2_dead.png",
  boar_fail_hyena_both_dead:"assets/overlays/beast_pen_boar_fail_hyena_both_dead.png",

  // fails (hyena-attacks family)
  hyena_fail_standard:        "assets/overlays/beast_pen_hyena_fail_standard.png",
  hyena_fail_hyena_dead:      "assets/overlays/beast_pen_hyena_fail_hyena_dead.png",
  hyena_fail_hyena_boar_dead: "assets/overlays/beast_pen_hyena_fail_hyena_boar_dead.png",
};

function ensureR4Slots(){
  const r = getRound();
  if(!r || r.id !== "r4") return;

  // Hyenas should have _slot 1 and 2 (for "hyena_1" / "hyena_2" overlays).
  const hyenas = state.enemies.filter(e =>
    e.maxHp != null && (e.defId === "hooked_hyena" || /hyena/i.test(e.name || ""))
  );

  const already = hyenas.filter(h => h._slot === 1 || h._slot === 2);
  if(already.length >= 2) return;

  for(let i=0;i<Math.min(2, hyenas.length);i++){
    if(hyenas[i]._slot == null) hyenas[i]._slot = i + 1;
  }
}

function markR4Dead(enemy){
  if(!enemy) return;
  if(!state.r4Dead) state.r4Dead = { boar:false, hyena1:false, hyena2:false };

  ensureR4Slots();

  const def = enemy.defId || "";
  const name = enemy.name || "";
  const isBoar = (def === "razor_boar") || /boar/i.test(name);
  const isHyena = (def === "hooked_hyena") || /hyena/i.test(name);

  if(isBoar) state.r4Dead.boar = true;

  if(isHyena){
    if(enemy._slot === 2) state.r4Dead.hyena2 = true;
    else state.r4Dead.hyena1 = true; // default slot 1
  }
}

function syncR4DeathsFromHp(){
  const r = getRound();
  if(!r || r.id !== "r4") return;

  ensureR4Slots();

  for(const e of state.enemies){
    if(!e.maxHp) continue;
    if((e.hp ?? 0) <= 0) markR4Dead(e);
  }
}

function getR4DeadSummary(){
  syncR4DeathsFromHp();
  const d = state.r4Dead || { boar:false, hyena1:false, hyena2:false };
  const hyDeadCount = (d.hyena1 ? 1 : 0) + (d.hyena2 ? 1 : 0);
  return { boarDead: !!d.boar, hy1Dead: !!d.hyena1, hy2Dead: !!d.hyena2, hyDeadCount };
}

function getR4PersistentBossOverlaySrc(round){
  const s = getR4DeadSummary();

  if(!s.boarDead && s.hyDeadCount === 0) return round.scene?.overlay_boss || R4_OVERLAYS.standard;

  if(s.boarDead && s.hyDeadCount === 0) return R4_OVERLAYS.standard_boar_dead;

  if(!s.boarDead && s.hyDeadCount === 1){
    return s.hy2Dead ? R4_OVERLAYS.standard_hyena_2_dead : R4_OVERLAYS.standard_hyena_1_dead;
  }

  if(!s.boarDead && s.hyDeadCount >= 2) return R4_OVERLAYS.standard_hyena_both_dead;

  // boar dead + (one or both) hyenas dead -> use the combined overlay you named
  if(s.boarDead && s.hyDeadCount >= 1) return R4_OVERLAYS.standard_boar_hyena_dead;

  return round.scene?.overlay_boss || R4_OVERLAYS.standard;
}

function getR4HitOverlaySrc(round){
  const ov = round.scene?.overlays || {};
  const s = getR4DeadSummary();

  // Before any deaths, use arenas.json's "pc_hit" (now beast_pen_hit_standard.png)
  if(!s.boarDead && s.hyDeadCount === 0) return ov.pc_hit || R4_OVERLAYS.hit_standard;

  if(s.boarDead && s.hyDeadCount === 0) return R4_OVERLAYS.hit_boar_dead;

  if(!s.boarDead && s.hyDeadCount === 1) return R4_OVERLAYS.hit_hyena_dead;

  if(!s.boarDead && s.hyDeadCount >= 2) return R4_OVERLAYS.hit_hyena_both_dead;

  if(s.boarDead && s.hyDeadCount >= 1) return R4_OVERLAYS.hit_boar_hyena_dead;

  return ov.pc_hit || R4_OVERLAYS.hit_standard;
}

function getR4FailOverlaySrc(round){
  const s = getR4DeadSummary();

  // Weighted attacker pool based on what is still alive:
  // boar counts once; each living hyena counts once.
  const pool = [];
  if(!s.boarDead) pool.push("boar");
  const hyAlive = Math.max(0, 2 - s.hyDeadCount);
  for(let i=0;i<hyAlive;i++) pool.push("hyena");

  const attacker = pool.length ? pool[Math.floor(Math.random()*pool.length)] : null;

  if(attacker === "boar"){
    if(s.hyDeadCount === 0) return R4_OVERLAYS.boar_fail_standard;
    if(s.hyDeadCount === 1){
      return s.hy2Dead ? R4_OVERLAYS.boar_fail_hyena_2_dead : R4_OVERLAYS.boar_fail_hyena_1_dead;
    }
    return R4_OVERLAYS.boar_fail_hyena_both_dead;
  }

  if(attacker === "hyena"){
    // Special file you provided for "boar dead + one hyena dead"
    if(s.boarDead && s.hyDeadCount === 1) return R4_OVERLAYS.hyena_fail_hyena_boar_dead;

    // One hyena dead (boar still alive) -> your generic hyena_dead file
    if(s.hyDeadCount === 1) return R4_OVERLAYS.hyena_fail_hyena_dead;

    // Otherwise (no deaths OR boar-only dead), fall back to hyena standard
    return R4_OVERLAYS.hyena_fail_standard;
  }

  // absolute fallback
  const ov = round.scene?.overlays || {};
  if(Array.isArray(ov.pc_fail_variants) && ov.pc_fail_variants.length) return ov.pc_fail_variants[0];
  return ov.pc_fail;
}

function syncBossOverlayNow(){
  const r = getRound();

  const boss = $("#sceneBoss");
  const boss2 = $("#sceneBoss2");

  const bossSrc = getPersistentBossOverlaySrc(r) || "";
  const boss2Src = getPersistentSecondaryOverlaySrc(r) || "";

  if(boss){
    if(state.runActive && bossSrc){
      boss.src = bossSrc;
      boss.classList.remove("hidden");
    }else{
      boss.classList.add("hidden");
      boss.removeAttribute("src");
    }
  }

  if(boss2){
    if(state.runActive && boss2Src){
      boss2.src = boss2Src;
      boss2.classList.remove("hidden");
    }else{
      boss2.classList.add("hidden");
      boss2.removeAttribute("src");
    }
  }
}

function setScene(){
  const r = getRound();
  if(!r) return;

    $("#sceneBase").src = r.scene?.base || "";

  const boss = $("#sceneBoss");
  const boss2 = $("#sceneBoss2");

  const bossSrc = getPersistentBossOverlaySrc(r) || "";
  const boss2Src = getPersistentSecondaryOverlaySrc(r) || "";

  // IMPORTANT: Only show overlays once the run is active.
  if(state.runActive && bossSrc){
    boss.src = bossSrc;
    boss.classList.remove("hidden");
  }else{
    boss.classList.add("hidden");
    boss.removeAttribute("src");
  }

  if(boss2){
    if(state.runActive && boss2Src){
      boss2.src = boss2Src;
      boss2.classList.remove("hidden");
    }else{
      boss2.classList.add("hidden");
      boss2.removeAttribute("src");
    }
  }
  renderLionsMarkHud();
  hideOverlay();
}

let overlayTimer = null;

// Each overlay layer has its own restore timer so they can run simultaneously.
let bossRestoreTimer = null;
let boss2RestoreTimer = null;

let bossPrevSrc = "";
let boss2PrevSrc = "";

/**
 * Temporarily replace an overlay layer for ~ms, then restore the correct persistent overlay.
 * layer: "primary" (sceneBoss) or "secondary" (sceneBoss2)
 */
function showOverlay(src, ms=5200, layer="primary"){
  if(!src) return;

  const isSecondary = (layer === "secondary");
  const el = isSecondary ? $("#sceneBoss2") : $("#sceneBoss");
  if(!el) return;

  // Remember what the layer was showing
  if(isSecondary){
    if(!boss2PrevSrc) boss2PrevSrc = el.getAttribute("src") || "";
  }else{
    if(!bossPrevSrc) bossPrevSrc = el.getAttribute("src") || "";
  }

  // Force layer visible while we show the temporary overlay
  el.src = src;
  el.classList.remove("hidden");

  // Cancel any prior restore timer and restore after ms
  if(isSecondary){
    if(boss2RestoreTimer) clearTimeout(boss2RestoreTimer);
    boss2RestoreTimer = setTimeout(()=>{
      const r = getRound();
      const standard2 = getPersistentSecondaryOverlaySrc(r);

      boss2PrevSrc = "";
      boss2RestoreTimer = null;

      if(standard2){
        el.src = standard2;
        el.classList.remove("hidden");
      }else{
        el.classList.add("hidden");
        el.removeAttribute("src");
      }
    }, ms);
  }else{
    if(bossRestoreTimer) clearTimeout(bossRestoreTimer);
    bossRestoreTimer = setTimeout(()=>{
      const r = getRound();
      const standard = getPersistentBossOverlaySrc(r);

      bossPrevSrc = "";
      bossRestoreTimer = null;

      if(standard){
        el.src = standard;
        el.classList.remove("hidden");
      }else{
        el.classList.add("hidden");
        el.removeAttribute("src");
      }
    }, ms);
  }
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
        hp: def.hp ?? null,

        // If a definition spawns multiple copies (count > 1), track which copy this is (1,2,3...).
        _slot: (def.count || 1) > 1 ? (i + 1) : null
      });
    }
  }
     // Round 1: ensure the two duelists are always slotted as 1 and 2.
  if(round.id === "r1"){
    const hpEnemies = state.enemies.filter(e => e.maxHp != null);
    for(let i=0;i<Math.min(2, hpEnemies.length);i++){
      if(hpEnemies[i]._slot == null) hpEnemies[i]._slot = i + 1;
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

      const r = getRound();
            const isR1 = r && r.id === "r1";
      const isR4 = r && r.id === "r4";
      if(isR1) ensureR1Slots();
      if(isR4) ensureR4Slots();

      if(t.dataset.dmg && e.maxHp){
        e.hp = clamp(e.hp - parseInt(t.dataset.dmg,10), 0, e.maxHp);

        if(isR1 && !state.r1FirstDefeated && (e._slot === 1 || e._slot === 2) && e.hp === 0){
          state.r1FirstDefeated = e._slot;
        }
                 if(isR4 && e.hp === 0){
          markR4Dead(e);
        }

        renderEnemyList();
        syncBossOverlayNow();

      }else if(t.dataset.heal && e.maxHp){
        e.hp = clamp(e.hp + parseInt(t.dataset.heal,10), 0, e.maxHp);
        renderEnemyList();
        syncBossOverlayNow();

      }else if(t.dataset.set !== undefined && e.maxHp){
        const v = prompt(`Set HP for ${e.name} (0-${e.maxHp})`, String(e.hp));
        if(v === null) return;
        e.hp = clamp(parseInt(v,10)||0, 0, e.maxHp);

        if(isR1 && !state.r1FirstDefeated && (e._slot === 1 || e._slot === 2) && e.hp === 0){
          state.r1FirstDefeated = e._slot;
        }
                 if(isR4 && e.hp === 0){
          markR4Dead(e);
        }

        renderEnemyList();
        syncBossOverlayNow();

      }else if(t.dataset.remove !== undefined){
        // Treat removing a duelist as "defeated" for the purposes of the persistent overlay.
        if(isR1 && !state.r1FirstDefeated && (e._slot === 1 || e._slot === 2)){
          state.r1FirstDefeated = e._slot;
        }
                 if(isR4){
          markR4Dead(e);
        }

        state.enemies = state.enemies.filter(x=>x.id !== e.id);
        renderEnemyList();
        syncBossOverlayNow();
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
  state.r1FirstDefeated = null; 
    state.r4Dead = { boar:false, hyena1:false, hyena2:false };
    state.mmR2TotemsDown = 0;
  state.mmR3MarkPlayerId = null;
  state.mmR3LastMarkedId = null; 
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
  state.r1FirstDefeated = null; 
    state.r4Dead = { boar:false, hyena1:false, hyena2:false };
    state.mmR2TotemsDown = 0;
  state.mmR3MarkPlayerId = null;
  state.mmR3LastMarkedId = null; 
   

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

function renderLionsMarkHud(){
  const hud = document.getElementById("lionsMarkHud");
  if(!hud) return;

  const r = getRound();
  if(!state.runActive || !r || r.id !== "mm_r3"){
    hud.classList.add("hidden");
    return;
  }

  const mp = state.players.find(p => p.id === state.mmR3MarkPlayerId && p.hp > 0);
  if(!mp){
    hud.classList.add("hidden");
    return;
  }

  const nameEl = document.getElementById("lionsMarkHudName");
  if(nameEl) nameEl.textContent = mp.name;

  hud.classList.remove("hidden");
}

function ensureLionsMark(){
  const r = getRound();
  if(!r || r.id !== "mm_r3") return;

  const alive = state.players.filter(p => p.hp > 0);
  if(alive.length === 0){
    state.mmR3MarkPlayerId = null;
    return;
  }

  // Prefer a new mark each turn if possible
  let pool = alive.filter(p => p.id !== state.mmR3LastMarkedId);
  if(pool.length === 0) pool = alive;

  const pick = pool[Math.floor(Math.random() * pool.length)];
    state.mmR3MarkPlayerId = pick.id;
  state.mmR3LastMarkedId = pick.id;

  renderLionsMarkHud();
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

  // Middlemount Round 3: failures hit the marked player, not the active player
  let victim = p;
  if(round.id === "mm_r3"){
    const marked = state.players.find(x => x.id === state.mmR3MarkPlayerId && x.hp > 0);
    if(marked) victim = marked;
  }

  victim.hp = clamp(victim.hp - dmg.total, 0, victim.maxHp);

        const ov = round.scene?.overlays || {};

  // Default: keep your existing behaviour (including arenas.json variants).
  let failSrc = ov.pc_fail;

  // Round 2 / Beast-Pen (id "r4"): fail overlay depends on which beasts are dead + which beast attacks.
  if(round.id === "r4"){
    failSrc = getFailOverlaySrc(round);

  // Round 1 special behaviour (unchanged)
  }else if(round.id === "r1"){
    syncR1FirstDefeatedFromHp();
    if(state.r1FirstDefeated){
      failSrc = getFailOverlaySrc(round);
    }else if(Array.isArray(ov.pc_fail_variants) && ov.pc_fail_variants.length){
      failSrc = ov.pc_fail_variants[Math.floor(Math.random() * ov.pc_fail_variants.length)];
    }

  // Other rounds: random variant from arenas.json (unchanged)
  }else if(Array.isArray(ov.pc_fail_variants) && ov.pc_fail_variants.length){
    failSrc = ov.pc_fail_variants[Math.floor(Math.random() * ov.pc_fail_variants.length)];
  }

  // Keep FAIL overlays visible ~5s like HIT overlays.
// In Middlemount Round 2, a SKILL check failure represents the swordsmen punishing the party,
// so the FAIL overlay must be on the PRIMARY (swordsmen) layer.
// Keep FAIL overlays visible ~5s like HIT overlays.
if(round.id === "mm_r2"){
  // Skill failure in Lion Totems round = the TOTEMS retaliate.
  const totemFail =
    (round.scene?.secondary_overlays?.pc_fail_variants?.[0])
    || "assets/overlays/lions_totems_fail.png";

  showOverlay(totemFail, 5200, "secondary");
}else{
  showOverlay(failSrc, 5200, "primary");
}
playFailSfx(round.id);
   
    if(round.id === "mm_r3" && victim.id !== p.id){
    log(`${p.name} failed: the Lion Knight strikes ${victim.name} for -${dmg.total} HP (${dmg.expr}: ${dmg.rolls.join(", ")}).`);
  }else{
    log(`${p.name} failed: -${dmg.total} HP (${dmg.expr}: ${dmg.rolls.join(", ")}).`);
  }
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
      <div class="card">
        <div><strong>Party HP</strong></div>
        <div style="margin-top:10px;color:var(--muted);font-size:13px;">${partyHp}</div>
      </div>
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
  state.dockOpen = true; 
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
function setTurnDockBlocked(isBlocked){
  const td = document.getElementById("turnDock");
  if(!td) return;
  if(isBlocked) td.classList.add("hidden");
  else{
    // Only unhide if it was supposed to be open
    // (If your code uses a separate flag, keep it consistent)
    if(state.dockOpen) td.classList.remove("hidden");
  }
}
function hideDock(){
  setTurnDockBlocked(false); 
  state.dockOpen = false; 
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
      <div class="card">
        <div class="cardRow"><div><strong>Win</strong></div><div class="badge">${sc.target_successes} successes</div></div>
        <div class="cardRow" style="margin-top:8px;"><div><strong>Lose</strong></div><div class="badge">${sc.max_failures} failures</div></div>
        <div style="margin-top:8px;color:var(--muted);font-size:13px;">
          Failure damage: <span class="kbd">${escapeHtml(sc.damage_on_failure)}</span>
        </div>
        ${sc.turn_limit ? `<div style="margin-top:8px;color:var(--muted);font-size:13px;">Tempo limit: <span class="kbd">${sc.turn_limit}</span> turns (overtime hurts).</div>` : ""}
      </div>
      <div class="card">
        <div><strong>Approaches</strong></div>
        <ul style="margin:8px 0 0 18px;">${actions}</ul>
      </div>
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

  // Middlemount Round 3: Lion’s Mark changes once per full rotation (once everyone has acted)
  if(round.id === "mm_r3"){
    const markedAlive = alivePlayers.some(x => x.id === state.mmR3MarkPlayerId);
    const isNewRotation = (state.turnIndex % alivePlayers.length === 0);

    // Pick a mark at the start of the rotation, or if the current mark is dead/missing
    if(isNewRotation || !markedAlive){
      ensureLionsMark();
    }else{
      renderLionsMarkHud();
    }
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

    <div class="dockSplit">
    <div class="dockPane">
      <div class="dockPaneTitle">Skill Check</div>

      <div class="grid2">
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

      <div class="grid2" style="margin-top:6px;">
        <label class="field">
          <span>Modifier</span>
          <input id="t_skillMod" type="number" value="0" />
        </label>

        <div class="field">
          <span>Roll</span>
          <button id="t_skillRoll" class="btn btn--primary" type="button">Roll d20</button>
        </div>
      </div>

      <div id="t_skillOut" class="muted" style="font-size:12px;margin-top:6px;">No roll yet.</div>
    </div>

    <div class="dockPane">
      <div class="dockPaneTitle">Attack Roll</div>
      <div class="dockMeta">
        Hit DC: <span class="kbd">${atk.hit_dc}</span>
        &nbsp;|&nbsp;
        Default damage: <span class="kbd">${escapeHtml(atk.default_damage)}</span>
      </div>

      <div class="grid2">
        <label class="field">
          <span>Modifier</span>
          <input id="t_atkMod" type="number" value="0" />
        </label>

        <div class="field">
          <span>Roll</span>
          <button id="t_atkRoll" class="btn btn--primary" type="button">Roll d20</button>
        </div>
      </div>

      <div class="grid2" style="margin-top:8px;">
        <label class="field">
          <span>Damage</span>
          <input id="t_dmg" value="${escapeHtml(atk.default_damage)}" />
        </label>

        <div class="field">
          <span>Apply</span>
          <button id="t_applyDmg" class="btn btn--ghost" type="button">Apply</button>
        </div>
      </div>

      <div id="t_atkOut" class="muted" style="font-size:12px;margin-top:6px;">No attack yet.</div>
    </div>
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
         // On a MISS, flash the correct FAIL overlay for the currently selected target (mm_r2 supports totem-vs-swordsman layers)
    if(!hit){
  const tid = $("#t_target").value;
  const target = state.enemies.find(e=>e.id===tid);

  if(round.id === "mm_r2"){
    // IMPORTANT:
    // Totem FAIL overlay means "totem retaliates / deals magical damage".
    // A missed attack roll does NOT deal damage to the party, so do NOT show totem fail on an attack miss.
    if(!isMMR2TotemTarget(target)){
      // Missed attack against a swordsman: show swordsman fail (reads as "they outplay you").
      const failSrc = MMR2_SWORDSMAN_OVERLAYS.fail;
      showOverlay(failSrc, 5200, "primary");
      playFailSfx(round.id);
    }
    // If targeting a totem and you miss: no overlay, no fail SFX (just the miss text).
  }else{
    const failSrc = getFailOverlaySrc(round);
    showOverlay(failSrc, 5200, "primary");
    playFailSfx(round.id);
  }
}
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

    // Decide which HIT overlay to show BEFORE we possibly mark the first defeated duelist.
        let hitOverlaySrc = getHitOverlaySrc(round);
    let hitOverlayLayer = "primary";

    if(round.id === "mm_r2"){
      hitOverlaySrc = getMMR2TempOverlay("hit", target);
      hitOverlayLayer = isMMR2TotemTarget(target) ? "secondary" : "primary";
    }

    if(target.maxHp){
      target.hp = clamp(target.hp - dmg, 0, target.maxHp);
      if(target.hp === 0){
        log(`${target.name} is defeated.`);
                 // Middlemount Round 2: Lion Totems puzzle
        // When the last totem falls, the round is effectively cleared.
        if(round.id === "mm_r2" && (target.defId === "lion_totem" || /totem/i.test(target.name || ""))){
          // Count how many totems are down right now
          const totems = state.enemies.filter(e => e.maxHp && (e.defId === "lion_totem" || /totem/i.test(e.name || "")));
          const down = totems.filter(t => (t.hp ?? 0) <= 0).length;
          state.mmR2TotemsDown = down;

          if(down >= 3){
            log("All three Lion Totems are shattered. The guardians falter and withdraw.");
            // Remove / defeat all remaining enemies so victory-by-KO triggers cleanly
            for(const e of state.enemies){
              if(e.maxHp && e.hp > 0) e.hp = 0;
            }
            // Immediately refresh persistent overlay
            syncBossOverlayNow();
            renderEnemyList();
          }
        }

        // Round 1: the first duelist to hit 0 becomes the defeated-state that persists.
        if(round.id === "r1" && !state.r1FirstDefeated && (target._slot === 1 || target._slot === 2)){
          state.r1FirstDefeated = target._slot;
        }
                         if(round.id === "mm_r2"){
          markMMR2Dead(target);
        }
        if(round.id === "r4"){
          markR4Dead(target);
        }
      }
    }

    showOverlay(hitOverlaySrc, 5200, hitOverlayLayer);
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
  setTurnDockBlocked(true); 
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

  const closeAddPlayer = ()=>{
    setTurnDockBlocked(false);
    hideDock();
  };

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
    closeAddPlayer();
  });

  $("#dockBody").querySelector("[data-cancel]").addEventListener("click", closeAddPlayer);
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
  if(!confirm("Back to Start? This will restore party HP, clear all gold earned, and reset round progress (players remain).")) return;

  const a = getArena();
  if(!a) return;

  // Return to Round 1 selection
  state.roundId = a.rounds[0]?.id || state.roundId;

  // Restore party HP (keep the players themselves)
  for(const p of state.players){
    p.hp = p.maxHp;
    delete p._beastBonusUsed;
  }

  // Clear earned gold
  state.totalGold = 0;

  // Cancel any pending overlay restore so nothing pops back after the wipe
  if(bossRestoreTimer){
    clearTimeout(bossRestoreTimer);
    bossRestoreTimer = null;
  }
  bossPrevSrc = "";

  // Reset run state (no active run, no enemies, counters zero)
  resetRunState("Fresh start. Enter The Arena to begin.");

  // Persist the wiped gold + restored HP + round selection
  save();

  // Refresh UI
  renderSelects();
  setScene();
  renderPartyList();
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
