(() => {
  'use strict';

  const SUITS = [
    { key:'clubs', symbol:'♣', red:false },
    { key:'diamonds', symbol:'♦', red:true },
    { key:'hearts', symbol:'♥', red:true },
    { key:'spades', symbol:'♠', red:false }
  ];
  const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

  const state = {
    screen:'menu',
    deck:[],
    table:[],
    hand:[],
    botHand:[],
    captured: {player:[],bot:[]},
    score: {player:0,bot:0},
    turn:'player',
    difficulty:'easy',
    round:1,
    lastTaker:null,
    nextId:1,
    pendingCard:null,
    pendingGroups:[],
    pendingSelections:[],
    startedAt:Date.now(),
    history: readJSON('tabinet-battle-log', [])
  };

  const $ = id => document.getElementById(id);
  const qs = sel => document.querySelector(sel);
  const rules = window.TabinetRules || null;

  const settings = {
    sound: localStorage.getItem('tabinet-sound') !== 'off',
    animations: localStorage.getItem('tabinet-animations') !== 'off',
    volume: Math.max(0, Math.min(100, Number(localStorage.getItem('tabinet-volume') || 95))),
    language: localStorage.getItem('tabinet-language') || 'ro'
  };

  const profile = Object.assign(
    { name:'Jucător', id:'TB-'+Math.random().toString(36).slice(2,10).toUpperCase() },
    readJSON('tabinet-profile', {})
  );

  function readJSON(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v ?? fallback;
    } catch { return fallback; }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function setLoading(text, percent) {
    const t = $('loadingText');
    const b = $('loadingBarFill');
    if (t) t.textContent = text;
    if (b) b.style.width = percent + '%';
  }

  function card(rank, suitKey) {
    const s = SUITS.find(x => x.key === suitKey);
    const value = rank === 'A' ? 11 : rank === 'J' ? 12 : rank === 'Q' ? 13 : rank === 'K' ? 14 : Number(rank);
    return { id:state.nextId++, rank, suit:suitKey, symbol:s.symbol, red:s.red, value };
  }

  function createDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push(card(r, s.key));
    return d;
  }

  function shuffle(d) {
    for (let i=d.length-1;i>0;i--) {
      const j = Math.floor(Math.random()*(i+1));
      [d[i],d[j]]=[d[j],d[i]];
    }
    return d;
  }

  function valueOptions(c) { return c.rank === 'A' ? [1,11] : [c.value]; }

  function findCaptures(played, table) {
    if (rules && typeof rules.allCaptureGroups === 'function') return rules.allCaptureGroups(played, table);
    const out=[];
    for (const v of valueOptions(played)) {
      const combos=[];
      function dfs(i,total,picked) {
        if (total===v && picked.length) combos.push([...picked]);
        if (total>=v) return;
        for (let k=i;k<table.length;k++) for (const cv of valueOptions(table[k])) {
          if (total+cv<=v) dfs(k+1,total+cv,[...picked,table[k]]);
        }
      }
      dfs(0,0,[]);
      combos.forEach(g=>out.push(g));
    }
    const seen=new Set();
    return out.filter(g=>{const k=g.map(x=>x.id).sort().join(','); if(seen.has(k)) return false; seen.add(k); return true;});
  }

  function groupText(group) {
    return group.map(c => c.rank+c.symbol).join(' + ');
  }

  function specialPoints(c) {
    if (rules?.specialPoints) return rules.specialPoints(c);
    if (c.rank==='2' && c.suit==='clubs') return 1;
    if (['A','10','J','Q','K'].includes(c.rank)) return 1;
    return 0;
  }

  function scoreCapture(cards, tableMade, marker) {
    let s=cards.reduce((n,c)=>n+specialPoints(c),0);
    if (tableMade) s += marker && rules?.tableMarkerBonus ? rules.tableMarkerBonus(marker) : 1;
    return s;
  }

  function visibleScreens() {
    ['loadingScreen','menuScreen','modeScreen','difficultyScreen','gameScreen'].forEach(id=>{
      const el=$(id);
      if (el) el.classList.toggle('hidden', id !== ({
        loading:'loadingScreen',menu:'menuScreen',mode:'modeScreen',difficulty:'difficultyScreen',game:'gameScreen'
      }[state.screen]));
    });
  }

  function showScreen(name) {
    state.screen=name;
    visibleScreens();
    if (name==='menu') refreshMenu();
  }

  function refreshMenu() {
    if ($('profileMenuName')) $('profileMenuName').textContent = profile.name || 'Jucător';
    if ($('profileMenuId')) $('profileMenuId').textContent = 'ID: ' + profile.id;
    const resume = $('resumeMatchBar');
    if (resume) resume.classList.add('hidden');
  }

  function resetMatch() {
    state.deck=shuffle(createDeck());
    state.table=[];
    state.hand=[];
    state.botHand=[];
    state.captured={player:[],bot:[]};
    state.score={player:0,bot:0};
    state.turn='player';
    state.round=1;
    state.lastTaker=null;
    state.pendingCard=null;
    state.pendingGroups=[];
    state.pendingSelections=[];
    state.startedAt=Date.now();
    dealRound(true);
  }

  function dealRound(initial=false) {
    const count = initial ? 4 : 5;
    if (initial) {
      for (let i=0;i<4;i++) state.table.push(state.deck.pop());
    }
    while (state.hand.length<count && state.deck.length) state.hand.push(state.deck.pop());
    while (state.botHand.length<count && state.deck.length) state.botHand.push(state.deck.pop());
    renderGame();
    updateDeck();
  }

  function updateDeck() {
    if ($('deckCount')) $('deckCount').textContent = state.deck.length;
  }

  function renderGame() {
    updateDeck();
    if ($('playerScore')) $('playerScore').textContent = state.score.player;
    if ($('opponentScore')) $('opponentScore').textContent = state.score.bot;
    if ($('roundBadge')) $('roundBadge').textContent = 'MÂNA ' + state.round;
    if ($('botMeta')) $('botMeta').textContent = ({easy:'Ușor',medium:'Mediu',hard:'Mare'})[state.difficulty] || 'Ușor';
    if ($('playerTurnMeta')) $('playerTurnMeta').textContent = state.turn==='player' ? 'Rândul tău' : 'Botul joacă';
    const hint = $('actionHint');
    if (hint) hint.textContent = state.turn==='player' ? (state.hand.length ? 'Alege o carte.' : 'Se pregătește următoarea mână…') : 'Botul gândește…';

    const tableZone=$('tableStacks');
    if (tableZone) {
      tableZone.innerHTML = state.table.length
        ? state.table.map(c => cardHTML(c,'table-card')).join('')
        : '<div class="empty-table">Masa este goală</div>';
    }

    const ph=$('playerHand');
    if (ph) {
      ph.innerHTML = state.hand.map(c => cardHTML(c,'hand-card player-card')).join('');
      ph.querySelectorAll('[data-card-id]').forEach(el=>{
        el.addEventListener('click', () => playPlayerCard(Number(el.dataset.cardId)));
      });
    }

    const oh=$('opponentHand');
    if (oh) oh.innerHTML = state.botHand.map(() => '<div class="back-card"></div>').join('');

    const pPile=$('playerScorePile');
    if (pPile) pPile.innerHTML = state.captured.player.slice(-8).map(c=>cardHTML(c,'mini-card')).join('');
    const bPile=$('opponentScorePile');
    if (bPile) bPile.innerHTML = state.captured.bot.slice(-8).map(c=>cardHTML(c,'mini-card')).join('');
    if ($('playerTableauActive')) $('playerTableauActive').textContent = '0 active';
    if ($('opponentTableauActive')) $('opponentTableauActive').textContent = '0 active';
  }

  function cardHTML(c, cls) {
    return '<button type="button" class="card '+cls+(c.red?' red':'')+'" data-card-id="'+c.id+'"><span class="rank">'+c.rank+'</span><span class="suit">'+c.symbol+'</span></button>';
  }

  async function playPlayerCard(id) {
    if (state.turn!=='player' || state.pendingCard) return;
    const idx=state.hand.findIndex(c=>c.id===id);
    if (idx<0) return;
    const played=state.hand.splice(idx,1)[0];
    const groups=findCaptures(played,state.table);
    if (!groups.length) {
      state.table.push(played);
      state.lastTaker=null;
      renderGame();
      playTone('place');
      await afterPlayerAction();
      return;
    }

    state.pendingCard=played;
    state.pendingGroups=groups;
    state.pendingSelections=[];
    openCaptureDialog();
  }

  function openCaptureDialog() {
    const dialog=$('captureDialog');
    const opts=$('captureOptions');
    if (!dialog || !opts) { commitCapture([state.pendingGroups[0]]); return; }

    const choices = [];
    state.pendingGroups.forEach((g, i)=>{
      choices.push('<label class="capture-choice"><input type="checkbox" data-group-index="'+i+'"><span>'+groupText(g)+'</span></label>');
    });

    opts.innerHTML=choices.join('');
    opts.querySelectorAll('input').forEach(input=>input.addEventListener('change',()=>{
      state.pendingSelections=[...opts.querySelectorAll('input:checked')].map(x=>Number(x.dataset.groupIndex));
      const btn=$('captureConfirmBtn'); if(btn) btn.disabled=state.pendingSelections.length===0;
    }));
    $('captureTitle') && ($('captureTitle').textContent='Alege captura');
    $('captureCopy') && ($('captureCopy').textContent='Selectează una sau mai multe combinații care nu folosesc aceeași carte.');
    const confirm=$('captureConfirmBtn');
    if (confirm) { confirm.disabled=true; confirm.onclick=()=>commitCapture(state.pendingSelections.map(i=>state.pendingGroups[i])); }
    const cancel=$('cancelCaptureBtn');
    if (cancel) cancel.onclick=()=>{ state.hand.push(state.pendingCard); state.pendingCard=null; state.pendingGroups=[]; state.pendingSelections=[]; dialog.close(); renderGame(); };
    dialog.showModal();
  }

  async function commitCapture(selectedGroups) {
    if (!state.pendingCard) return;
    const selectedCards=[];
    const ids=new Set();
    for (const g of selectedGroups) for (const c of g) if(!ids.has(c.id)){ids.add(c.id);selectedCards.push(c);}
    if (!selectedCards.length) return;

    state.table=state.table.filter(c=>!ids.has(c.id));
    const played=state.pendingCard;
    const tableMade=state.table.length===0;
    state.captured.player.push(played,...selectedCards);
    state.lastTaker='player';
    state.score.player += scoreCapture([...selectedCards,played],tableMade,selectedCards[0] || played);
    state.pendingCard=null; state.pendingGroups=[]; state.pendingSelections=[];
    const d=$('captureDialog'); if(d?.open) d.close();
    renderGame();
    playTone(tableMade?'success':'capture');
    await afterPlayerAction();
  }

  async function afterPlayerAction() {
    state.turn='bot';
    renderGame();
    await sleep(settings.animations?650:120);
    if (state.botHand.length) await botMove();
    state.turn='player';
    renderGame();

    if (!state.hand.length && !state.botHand.length) {
      if (state.deck.length) {
        state.round++;
        await sleep(settings.animations?300:80);
        dealRound(false);
        state.turn='player';
        renderGame();
      } else {
        finishMatch();
      }
    }
  }

  async function botMove() {
    if (!state.botHand.length) return;
    let chosen = null;
    let chosenGroups = [];
    const ordered = [...state.botHand];

    if (state.difficulty==='hard') ordered.sort((a,b)=>specialPoints(b)-specialPoints(a));
    else if (state.difficulty==='medium') ordered.sort((a,b)=> (findCaptures(b,state.table).length?1:0) - (findCaptures(a,state.table).length?1:0));

    for (const c of ordered) {
      const gs=findCaptures(c,state.table);
      if (gs.length) { chosen=c; chosenGroups=[gs[0]]; break; }
    }
    if (!chosen) chosen=ordered[0];

    const idx=state.botHand.findIndex(c=>c.id===chosen.id);
    state.botHand.splice(idx,1);
    const groups=findCaptures(chosen,state.table);
    if (groups.length) {
      const g=groups[0];
      const ids=new Set(g.map(c=>c.id));
      state.table=state.table.filter(c=>!ids.has(c.id));
      const tableMade=state.table.length===0;
      state.captured.bot.push(chosen,...g);
      state.lastTaker='bot';
      state.score.bot += scoreCapture([...g,chosen],tableMade,g[0] || chosen);
      playTone(tableMade?'success':'capture');
    } else {
      state.table.push(chosen);
      state.lastTaker=null;
      playTone('place');
    }
    renderGame();
    await sleep(settings.animations?420:90);
  }

  function finishMatch() {
    if (state.table.length && state.lastTaker) {
      const extra=[...state.table];
      state.captured[state.lastTaker].push(...extra);
      state.score[state.lastTaker] += extra.reduce((n,c)=>n+specialPoints(c),0);
      state.table=[];
    }
    renderGame();
    const result = state.score.player===state.score.bot?'draw':state.score.player>state.score.bot?'win':'loss';
    const entry={id:Date.now(),timestamp:Date.now(),date:new Date().toLocaleString(),opponentName:'Bot',mode:'bot',difficulty:state.difficulty,playerScore:state.score.player,botScore:state.score.bot,result};
    const hist=Array.isArray(state.history)?state.history:readJSON('tabinet-battle-log',[]);
    hist.unshift(entry);
    writeJSON('tabinet-battle-log',hist.slice(0,8));
    showGameOver(entry);
  }

  function showGameOver(entry) {
    const d=$('gameOverDialog');
    if (!d) {
      alert('Meci terminat: '+entry.playerScore+' — '+entry.botScore);
      showScreen('menu');
      return;
    }
    const playerFinal=$('finalPlayerScore');
    const botFinal=$('finalBotScore');
    if(playerFinal) playerFinal.textContent=entry.playerScore;
    if(botFinal) botFinal.textContent=entry.botScore;
    const title=$('gameOverTitle');
    if(title) title.textContent=entry.result==='draw'?'Remiză':entry.result==='win'?'Ai câștigat':'Botul a câștigat';
    const copy=$('gameOverCopy');
    if(copy) copy.textContent='Partida s-a încheiat. Poți începe un meci nou din meniul principal.';
    const again=$('gameOverRematchBtn');
    if(again) again.onclick=()=>{d.close(); startGame();};
    const menu=$('gameOverMenuBtn');
    if(menu) menu.onclick=()=>{d.close();showScreen('menu');};
    d.showModal();
  }

  function playTone(kind) {
    if (!settings.sound || !settings.volume) return;
    try {
      const Ctx=window.AudioContext||window.webkitAudioContext;
      if(!Ctx) return;
      const ctx=new Ctx();
      const map={click:440,place:360,capture:620,success:780,button:500};
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      osc.type='sine';
      osc.frequency.value=map[kind]||map.click;
      gain.gain.value=0.0001;
      gain.gain.exponentialRampToValueAtTime(0.05*(settings.volume/100),ctx.currentTime+0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+0.09);
      osc.connect(gain).connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime+0.11);
      setTimeout(()=>ctx.close?.(),180);
    } catch {}
  }

  function startGame() {
    resetMatch();
    showScreen('game');
    renderGame();
    playTone('success');
  }

  function wire(id, fn) {
    const el=$(id); if(el) el.addEventListener('click',fn);
  }

  function setupSettings() {
    const st=$('settingsDialog');
    if($('soundToggle')){
      $('soundToggle').ariaPressed=String(settings.sound);
      $('soundToggle').textContent=settings.sound?'ON':'OFF';
      $('soundToggle').onclick=()=>{
        settings.sound=!settings.sound;
        localStorage.setItem('tabinet-sound',settings.sound?'on':'off');
        $('soundToggle').ariaPressed=String(settings.sound);
        $('soundToggle').textContent=settings.sound?'ON':'OFF';
      };
    }
    if($('animationToggle')){
      $('animationToggle').ariaPressed=String(settings.animations);
      $('animationToggle').textContent=settings.animations?'ON':'OFF';
      $('animationToggle').onclick=()=>{
        settings.animations=!settings.animations;
        localStorage.setItem('tabinet-animations',settings.animations?'on':'off');
        $('animationToggle').ariaPressed=String(settings.animations);
        $('animationToggle').textContent=settings.animations?'ON':'OFF';
      };
    }
    if($('soundVolume')){
      $('soundVolume').value=settings.volume;
      $('soundVolume').oninput=e=>{
        settings.volume=Number(e.target.value);
        localStorage.setItem('tabinet-volume',String(settings.volume));
        if($('soundVolumeValue')) $('soundVolumeValue').textContent=settings.volume+'%';
      };
    }
    if($('languageSelect')){
      $('languageSelect').value=settings.language;
      $('languageSelect').onchange=e=>{
        settings.language=e.target.value;
        localStorage.setItem('tabinet-language',settings.language);
      };
    }
    wire('closeSettingsBtn',()=>st?.close());
  }

  function setupDialogs() {
    wire('rulesMenuBtn',()=>{ const d=$('rulesDialog'); if(d) d.showModal(); });
    wire('closeRulesBtn',()=>$('rulesDialog')?.close());
    wire('settingsBtn',()=>$('settingsDialog')?.showModal());
    wire('gameSettingsBtn',()=>$('settingsDialog')?.showModal());
    wire('gameMenuBtn',()=>{ showScreen('menu'); });
    wire('profileMenuBtn',()=>openProfile());
    wire('openHistoryBtn',()=>openHistory());
    wire('cancelStackBtn',()=>$('stackDialog')?.close());

    document.querySelectorAll('[data-difficulty]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        state.difficulty=btn.dataset.difficulty;
        document.querySelectorAll('[data-difficulty]').forEach(b=>b.classList.toggle('active-difficulty',b===btn));
        startGame();
      });
    });

    wire('captureDialog',()=>{});
  }

  function openProfile() {
    const d=$('profileDialog'); if(!d) return;
    const input=$('profileNameInput');
    if(input) input.value=profile.name;
    if($('profileIdValue')) $('profileIdValue').textContent=profile.id;
    d.showModal();
  }

  function openHistory() {
    const d=$('historyDialog'); if(!d) return;
    const box=$('historyList') || $('historyBody') || $('profileRecentMatches');
    if (box) {
      const hist=readJSON('tabinet-battle-log',[]);
      box.innerHTML=hist.length ? hist.map(e=>'<div class="history-row"><strong>'+e.playerScore+' — '+e.botScore+'</strong><span>'+e.date+'</span></div>').join('') : '<div class="profile-empty">Nu există meciuri încă.</div>';
    }
    d.showModal();
  }

  function wireProfileDialog() {
    wire('closeProfileBtn',()=>$('profileDialog')?.close());
    wire('saveProfileBtn',()=>{
      const v=($('profileNameInput')?.value||'').trim().replace(/\s+/g,' ').slice(0,18);
      profile.name=v||'Jucător';
      writeJSON('tabinet-profile',profile);
      refreshMenu();
      $('profileDialog')?.close();
    });
    wire('deleteAvatarBtn',()=>{});
  }

  async function boot() {
    setLoading('Se încarcă masa…',25);
    await sleep(160);
    setLoading('Se pregătesc cărțile…',55);
    await sleep(160);
    setLoading('Se leagă regulile…',80);
    await sleep(160);
    setLoading('Gata.',100);
    await sleep(180);
    showScreen('menu');
    wire('menuPlayBtn',()=>showScreen('mode'));
    wire('modeBackBtn',()=>showScreen('menu'));
    wire('botModeBtn',()=>showScreen('difficulty'));
    wire('difficultyBackBtn',()=>showScreen('mode'));
    setupDialogs();
    setupSettings();
    wireProfileDialog();
    refreshMenu();
  }

  boot().catch(err=>{
    console.error(err);
    setLoading('Eroare la pornire. Reîncarcă pagina.',100);
  });

})();