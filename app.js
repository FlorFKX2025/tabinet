const SUITS = [
  { key: 'clubs', symbol: '♣', red: false },
  { key: 'diamonds', symbol: '♦', red: true },
  { key: 'hearts', symbol: '♥', red: true },
  { key: 'spades', symbol: '♠', red: false },
];
const RANKS = [
  { key: 'A', value: 11 }, { key: '2', value: 2 }, { key: '3', value: 3 }, { key: '4', value: 4 },
  { key: '5', value: 5 }, { key: '6', value: 6 }, { key: '7', value: 7 }, { key: '8', value: 8 },
  { key: '9', value: 9 }, { key: '10', value: 10 }, { key: 'J', value: 12 }, { key: 'Q', value: 13 }, { key: 'K', value: 14 }
];

const state = {
  screen: 'loading',
  selectedMode: 'bot',
  difficulty: 'easy',
  deck: [],
  tableStacks: [],
  hand: [],
  opponentHand: [],
  score: 0,
  opponentScore: 0,
  captured: { player: [], opponent: [] },
  played: { player: [], opponent: [] },
  tableauMarkers: { player: [], opponent: [] },
  lastTaker: null,
  message: '',
  round: 1,
  lastDeal: false,
  pendingPlay: null,
  pendingCaptureGroups: [],
  pendingSelection: [],
  pendingStackCard: null,
  pendingPlaySourceRect: null,
  waitingForTableau: false,
  dealing: false,
  matchToken: 0,
  nextStackId: 1,
  matchEvents: [],
  visualAnimation: null,
  animating: false,
  draggingCardId: null,
  nativeDrag: null,
  lastRenderedTurn: null,
  lastRenderedScores: { player: null, opponent: null },
  pendingDealSourceRect: null,
  turn: 'menu',
};

const $ = (id) => document.getElementById(id);
const rules = window.TabinetRules;
let deferredPrompt = null;
let audioContext = null;
let settings = loadSettings();
let battleHistory = loadBattleHistory();
let profile = loadProfile();
let pausedMatch = loadPausedMatch();
let resumeTimer = null;

const dialogElements = () => Array.from(document.querySelectorAll('dialog'));
let modalLockedScrollY = 0;
let modalScrollWasLocked = false;
function syncModalScrollLock() {
  const hasOpenDialog = dialogElements().some(dialog => dialog.open);
  const html = document.documentElement;
  const body = document.body;
  if (!body) return;

  html.classList.toggle('modal-scroll-locked', hasOpenDialog);
  body.classList.toggle('modal-scroll-locked', hasOpenDialog);

  if (hasOpenDialog && !modalScrollWasLocked) {
    modalLockedScrollY = window.scrollY || window.pageYOffset || 0;
    body.style.position = 'fixed';
    body.style.top = `-${modalLockedScrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    modalScrollWasLocked = true;
    return;
  }

  if (!hasOpenDialog && modalScrollWasLocked) {
    body.style.position = '';
    body.style.top = '';
    body.style.left = '';
    body.style.right = '';
    body.style.width = '';
    modalScrollWasLocked = false;
    window.scrollTo(0, modalLockedScrollY);
  }
}

function preventBackgroundScroll(event) {
  if (!document.body.classList.contains('modal-scroll-locked')) return;
  // The profile dialog is the only modal allowed to scroll internally.
  // Background scrolling remains locked, while wheel/touch gestures inside
  // #profileDialog are handled by the dialog's own scroll container.
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('#profileDialog')) return;
  event.preventDefault();
}

function preventMainMenuScroll(event) {
  if (!document.body.classList.contains('menu-screen-locked')) return;
  event.preventDefault();
}

const modalScrollObserver = new MutationObserver(syncModalScrollLock);

function loadSettings() {
  try {
    const storedVolume = Number(localStorage.getItem('tabinet-volume'));
    const volume = Number.isFinite(storedVolume) ? Math.min(1, Math.max(0, storedVolume)) : 0.95;
    return {
      sound: localStorage.getItem('tabinet-sound') !== 'off',
      volume,
      animations: localStorage.getItem('tabinet-animations') !== 'off',
      language: localStorage.getItem('tabinet-language') || 'ro',
    };
  } catch {
    return { sound: true, volume: 0.95, animations: true, language: 'ro' };
  }
}

function loadBattleHistory() {
  try {
    const raw = localStorage.getItem('tabinet-battle-log');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function saveSettings() {
  try {
    localStorage.setItem('tabinet-sound', settings.sound ? 'on' : 'off');
    localStorage.setItem('tabinet-volume', String(settings.volume));
    localStorage.setItem('tabinet-animations', settings.animations ? 'on' : 'off');
    localStorage.setItem('tabinet-language', settings.language);
  } catch { /* storage is optional */ }
}

function saveBattleHistory() {
  try {
    localStorage.setItem('tabinet-battle-log', JSON.stringify(battleHistory));
  } catch { /* storage is optional */ }
}

const PAUSED_MATCH_KEY = 'tabinet-paused-match';
const PAUSE_WINDOW_MS = 10_000;
function loadPausedMatch() {
  try {
    const raw = localStorage.getItem(PAUSED_MATCH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || Number(parsed.expiresAt) <= Date.now()) {
      localStorage.removeItem(PAUSED_MATCH_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
function savePausedMatch(snapshot) {
  pausedMatch = snapshot;
  try { localStorage.setItem(PAUSED_MATCH_KEY, JSON.stringify(snapshot)); } catch {}
}
function clearPausedMatch() {
  pausedMatch = null;
  if (resumeTimer) { clearInterval(resumeTimer); resumeTimer = null; }
  try { localStorage.removeItem(PAUSED_MATCH_KEY); } catch {}
  $('resumeMatchBar')?.classList.add('hidden');
}

const AVATAR_TEMPLATES = [
  { id:'01', bg:'#1c5842', accent:'#e9c76f', glyph:'◆' },
  { id:'02', bg:'#173f59', accent:'#e9c76f', glyph:'✦' },
  { id:'03', bg:'#5a3b2e', accent:'#f0d98f', glyph:'♣' },
  { id:'04', bg:'#3d315c', accent:'#e9c76f', glyph:'◈' },
  { id:'05', bg:'#234b55', accent:'#f0d98f', glyph:'✧' },
  { id:'06', bg:'#5b3b22', accent:'#e9c76f', glyph:'♠' },
];

function makeDefaultProfileId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'TB-';
  for (let i = 0; i < 8; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function loadProfile() {
  try {
    const raw = localStorage.getItem('tabinet-profile');
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      return { name: String(parsed.name || 'Jucător').slice(0,18), id: String(parsed.id || makeDefaultProfileId()), avatar: parsed.avatar || { kind:'template', id:'01' } };
    }
  } catch {}
  return { name: 'Jucător', id: makeDefaultProfileId(), avatar: { kind:'template', id:'01' } };
}

function saveProfile() {
  try { localStorage.setItem('tabinet-profile', JSON.stringify(profile)); } catch {}
}

function getAvatarTemplate(id) { return AVATAR_TEMPLATES.find(item => item.id === id) || AVATAR_TEMPLATES[0]; }

function avatarMarkup(avatar) {
  if (avatar?.kind === 'custom' && avatar.dataUrl) {
    return `<img src="${escapeHtml(avatar.dataUrl)}" alt="" class="avatar-image">`;
  }
  const tpl = getAvatarTemplate(avatar?.id);
  return `<span class="avatar-template-art" style="--avatar-bg:${tpl.bg};--avatar-accent:${tpl.accent}"><span class="avatar-glyph">${tpl.glyph}</span><span class="avatar-silhouette"></span></span>`;
}

function renderAvatar(el, avatar = profile.avatar) {
  if (!el) return;
  el.innerHTML = avatarMarkup(avatar);
}

function profileHistory() {
  const realMatches = battleHistory.filter(entry => entry.mode === 'player');
  return realMatches.length ? realMatches : battleHistory.filter(entry => entry.mode === 'bot');
}

function entryResult(entry) {
  if (entry?.result === 'win' || entry?.result === 'loss' || entry?.result === 'draw') return entry.result;
  return Number(entry?.playerScore) === Number(entry?.botScore) ? 'draw' : Number(entry?.playerScore) > Number(entry?.botScore) ? 'win' : 'loss';
}
function profileStats() {
  const matches = profileHistory();
  const wins = matches.filter(entry => entryResult(entry) === 'win').length;
  const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
  const last12h = matches.filter(entry => Number(entry.timestamp || entry.id || 0) >= twelveHoursAgo).length;
  return { matches, wins, last12h, winRate: matches.length ? Math.round((wins / matches.length) * 100) : 0 };
}

function renderProfile() {
  renderAvatar($('profileAvatarPreview'));
  renderAvatar($('profileAvatarMini'));
  if ($('profileMenuName')) $('profileMenuName').textContent = profile.name;
  if ($('profileMenuId')) $('profileMenuId').textContent = `ID: ${profile.id}`;
  if ($('profileNameInput') && document.activeElement !== $('profileNameInput')) $('profileNameInput').value = profile.name;
  if ($('profileIdValue')) $('profileIdValue').textContent = profile.id;

  const grid = $('avatarTemplateGrid');
  if (grid) {
    grid.innerHTML = '';
    AVATAR_TEMPLATES.forEach(template => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'avatar-template-choice';
      button.dataset.avatarId = template.id;
      button.classList.toggle('selected', profile.avatar?.kind === 'template' && profile.avatar?.id === template.id);
      button.setAttribute('aria-label', `${t('avatarTemplate')} ${template.id}`);
      button.innerHTML = `<span class="avatar-template-art" style="--avatar-bg:${template.bg};--avatar-accent:${template.accent}"><span class="avatar-glyph">${template.glyph}</span><span class="avatar-silhouette"></span></span><small>${template.id}</small>`;
      button.addEventListener('click', () => {
        profile.avatar = { kind:'template', id:template.id };
        saveProfile();
        renderProfile();
        playTone('button');
      });
      grid.appendChild(button);
    });
  }

  const stats = profileStats();
  if ($('profileWinRate')) $('profileWinRate').textContent = `${stats.winRate}%`;
  if ($('profile12h')) $('profile12h').textContent = stats.last12h;
  if ($('profileTotal')) $('profileTotal').textContent = stats.matches.length;
  const recent = $('profileRecentMatches');
  if (recent) {
    recent.innerHTML = '';
    if (!stats.matches.length) {
      recent.innerHTML = `<div class="profile-empty">${t('profileNoMatches')}</div>`;
    } else {
      stats.matches.slice(0,3).forEach(entry => {
        const item = document.createElement('div');
        item.className = 'profile-recent-row';
        const outcome = entryResult(entry);
        const won = outcome === 'win';
        const draw = outcome === 'draw';
        const mode = entry.mode === 'player' ? t('playerMode') : t('botMode');
        const result = entry.abandoned ? t('abandoned') : draw ? t('draw') : won ? t('profileWin') : t('profileLoss');
        item.innerHTML = `<div><span class="battle-mode ${entry.mode === 'player' ? 'player-mode' : 'bot-mode'}">${mode}</span><strong>${escapeHtml(entry.opponentName || t('opponentBot'))}</strong></div><div class="profile-recent-right"><strong>${entry.playerScore} — ${entry.botScore}</strong><small>${escapeHtml(entry.date || t('dateNow'))} · ${escapeHtml(result)}</small></div>`;
        recent.appendChild(item);
      });
    }
  }
  document.querySelectorAll('.avatar-template-choice').forEach(btn => btn.classList.toggle('selected', profile.avatar?.kind === 'template' && profile.avatar?.id === btn.dataset.avatarId));
}

function openProfile() { renderProfile(); $('profileDialog').showModal(); }

function currentProfileName() {
  const value = ($('profileNameInput')?.value || '').trim().replace(/\s+/g,' ');
  return value.slice(0,18) || 'Jucător';
}

function playTone(kind = 'click') {
  if (!settings.sound || settings.volume <= 0) return;
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') void audioContext.resume();
    const patterns = {
      button: [{f:420, to:500, d:0, l:.08, w:'sine', a:1}, {f:620, to:620, d:.035, l:.055, w:'triangle', a:.55}],
      click: [{f:430, to:470, d:0, l:.065, w:'sine', a:.85}],
      place: [{f:210, to:250, d:0, l:.10, w:'triangle', a:.95}, {f:360, to:390, d:.05, l:.09, w:'sine', a:.85}],
      stack: [{f:250, to:285, d:0, l:.08, w:'triangle', a:.95}, {f:430, to:470, d:.055, l:.10, w:'sine', a:.95}],
      capture: [{f:380, to:430, d:0, l:.09, w:'triangle', a:.85}, {f:560, to:620, d:.07, l:.12, w:'sine', a:1}, {f:780, to:900, d:.16, l:.16, w:'sine', a:1.1}],
      nextHand: [{f:280, to:315, d:0, l:.08, w:'triangle', a:.8}, {f:400, to:450, d:.09, l:.09, w:'sine', a:.9}, {f:560, to:650, d:.18, l:.13, w:'sine', a:1}],
      shuffle: [{f:190, to:260, d:0, l:.11, w:'triangle', a:.7}, {f:310, to:390, d:.12, l:.11, w:'triangle', a:.8}, {f:240, to:330, d:.24, l:.11, w:'triangle', a:.75}, {f:360, to:480, d:.36, l:.10, w:'sine', a:.85}],
      success: [{f:520, to:610, d:0, l:.09, w:'sine', a:.9}, {f:700, to:830, d:.09, l:.12, w:'sine', a:1}],
      gameover: [{f:430, to:380, d:0, l:.14, w:'triangle', a:.85}, {f:350, to:300, d:.16, l:.14, w:'sine', a:.8}, {f:560, to:720, d:.32, l:.22, w:'sine', a:1.1}],
    };
    const notes = patterns[kind] || patterns.button;
    const now = audioContext.currentTime;
    const master = Math.min(1, Math.max(0, settings.volume));
    notes.forEach(note => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = note.w || 'sine';
      osc.frequency.setValueAtTime(note.f, now + note.d);
      if (note.to && note.to !== note.f) osc.frequency.linearRampToValueAtTime(note.to, now + note.d + note.l * .82);
      gain.gain.setValueAtTime(0.0001, now + note.d);
      const peak = 0.12 * master * (note.a ?? 1);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), now + note.d + 0.009);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.d + note.l);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(now + note.d);
      osc.stop(now + note.d + note.l + 0.025);
    });
  } catch { /* audio is optional */ }
}

function animationsEnabled() { return Boolean(settings.animations); }
function motionDelay(kind='action') {
  const full = { place:390, stack:420, capture:500, botPlace:390, botCapture:510, deal:920, turn:220 };
  const reduced = { place:140, stack:145, capture:165, botPlace:135, botCapture:170, deal:240, turn:130 };
  return (animationsEnabled() ? full : reduced)[kind] ?? (animationsEnabled() ? 360 : 130);
}
function queueVisualAnimation(spec) { state.visualAnimation = animationsEnabled() ? spec : null; }
function beginActionMotion() { state.animating = true; }
function releaseActionMotion(kind='action') { window.setTimeout(() => { state.animating = false; renderGame(); }, motionDelay(kind)); }

function cardVisual(card) {
  const el = document.createElement('div');
  el.className = `flight-card${card?.red ? ' red' : ''}`;
  el.innerHTML = `<span class="rank">${card?.rank ?? ''}</span><span class="center">${card?.symbol ?? '✦'}</span><span class="suit">${card?.symbol ?? ''}</span>`;
  return el;
}

function flyCard(card, fromRect, targetEl, opts = {}) {
  if (!animationsEnabled() || !fromRect || !targetEl) return;
  const targetRect = targetEl.getBoundingClientRect();
  if (!targetRect.width || !targetRect.height) return;
  const ghost = cardVisual(card || {});
  ghost.classList.add(`flight-${opts.kind || 'move'}`);
  ghost.style.left = `${fromRect.left}px`;
  ghost.style.top = `${fromRect.top}px`;
  ghost.style.width = `${Math.max(48, fromRect.width)}px`;
  ghost.style.height = `${Math.max(68, fromRect.height)}px`;
  ghost.style.setProperty('--flight-rot', `${opts.rotate ?? (Math.random() * 8 - 4)}deg`);
  document.body.appendChild(ghost);
  const startX = fromRect.left + fromRect.width / 2;
  const startY = fromRect.top + fromRect.height / 2;
  const endX = targetRect.left + targetRect.width / 2;
  const endY = targetRect.top + targetRect.height / 2;
  const dx = endX - startX;
  const dy = endY - startY;
  const duration = opts.duration ?? (opts.kind === 'capture' ? 470 : 370);
  const delayMs = opts.delay ?? 0;
  ghost.style.transition = `transform ${duration}ms cubic-bezier(.18,.86,.24,1), opacity ${duration * .72}ms ease-out, filter ${duration}ms ease-out`;
  const begin = () => {
    ghost.classList.add('flight-active');
    ghost.style.transform = `translate(${dx}px,${dy}px) scale(${opts.scale ?? .42}) rotate(${(opts.rotate ?? 0) + (opts.kind === 'capture' ? 8 : 0)}deg)`;
    ghost.style.opacity = '0';
    ghost.style.filter = 'brightness(1.08) drop-shadow(0 18px 28px rgba(0,0,0,.28))';
  };
  if (delayMs) window.setTimeout(() => requestAnimationFrame(begin), delayMs);
  else requestAnimationFrame(begin);
  window.setTimeout(() => ghost.remove(), duration + delayMs + 80);
}

function pulseElement(id, className = 'anim-pop') {
  if (!animationsEnabled()) return;
  const el = $(id);
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  window.setTimeout(() => el.classList.remove(className), 620);
}

function runVisualAnimation(spec) {
  if (!animationsEnabled() || !spec) return;
  if (spec.kind === 'place' || spec.kind === 'stack') {
    const target = $(spec.targetId || 'tableZone');
    flyCard(spec.card, spec.fromRect, target, { kind: spec.kind, duration: spec.kind === 'stack' ? 400 : 360, scale: .52 });
    pulseElement('tableZone', 'anim-table');
    return;
  }
  if (spec.kind === 'capture') {
    const target = $(spec.targetId || 'playerScorePile');
    const cards = Array.isArray(spec.captured) ? spec.captured : [];
    cards.slice(0, 9).forEach((card, index) => {
      flyCard(card, spec.fromRect, target, { kind: 'capture', delay: index * 45, duration: 470, scale: .38, rotate: (index % 2 ? 5 : -5) });
    });
    pulseElement(spec.targetId || 'playerScorePile', 'anim-score');
    pulseElement('tableZone', 'anim-table');
    return;
  }
  if (spec.kind === 'deal') {
    const deckRect = spec.fromRect;
    const targets = [
      { id: 'tableCards', count: spec.tableCount || 0 },
      { id: 'playerHand', count: spec.playerCount || 0 },
      { id: 'opponentHand', count: spec.opponentCount || 0 },
    ];
    let offset = 0;
    targets.forEach(targetSpec => {
      const target = $(targetSpec.id);
      for (let i = 0; i < targetSpec.count; i += 1) {
        flyCard({ rank: '', symbol: '✦', red: false }, deckRect, target, {
          kind: 'deal', delay: offset * 48, duration: 420, scale: targetSpec.id === 'opponentHand' ? .42 : .48, rotate: (i % 2 ? 4 : -4)
        });
        offset += 1;
      }
    });
    pulseElement('deckCounter', 'anim-pop');
  }
}

function getCardRectById(cardId) {
  const el = document.querySelector(`.player-hand .card[data-id="${cardId}"]`);
  return el ? el.getBoundingClientRect() : null;
}

function startAnimationsForRender() {
  const spec = state.visualAnimation;
  state.visualAnimation = null;
  const turnChanged = state.lastRenderedTurn !== null && state.lastRenderedTurn !== state.turn;
  const playerScoreChanged = state.lastRenderedScores.player !== null && state.lastRenderedScores.player !== state.score;
  const opponentScoreChanged = state.lastRenderedScores.opponent !== null && state.lastRenderedScores.opponent !== state.opponentScore;
  state.lastRenderedTurn = state.turn;
  state.lastRenderedScores = { player: state.score, opponent: state.opponentScore };
  requestAnimationFrame(() => {
    if (turnChanged) pulseElement('turnBanner', 'anim-turn');
    if (playerScoreChanged) pulseElement('playerScore', 'anim-score-text');
    if (opponentScoreChanged) pulseElement('opponentScore', 'anim-score-text');
    runVisualAnimation(spec);
  });
}


function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function createDeck() {
  let id = 0;
  return SUITS.flatMap(suit => RANKS.map(rank => ({
    id: id++, suit: suit.key, symbol: suit.symbol, red: suit.red, rank: rank.key, value: rank.value
  })));
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function deal(n) { return Array.from({ length: n }, () => state.deck.pop()).filter(Boolean); }
function makeStack(card) { return { id: state.nextStackId++, cards: [card] }; }
function tableCards() { return state.tableStacks.flatMap(stack => stack.cards); }
function tableCardCount() { return state.tableStacks.reduce((sum, stack) => sum + stack.cards.length, 0); }
function cardLabel(card) { return `${card.rank} ${card.symbol}`; }
function sumGroup(group) { return group.reduce((sum, card) => sum + (card.rank === 'A' ? 1 : card.value), 0); }
function scoreLabel(score) { return `${score} ${score === 1 ? 'punct' : 'puncte'}`; }
function difficultyLabel(value) { return value === 'easy' ? (settings?.language === 'en' ? 'Easy' : 'Ușor') : value === 'medium' ? (settings?.language === 'en' ? 'Medium' : 'Mediu') : (settings?.language === 'en' ? 'Hard' : 'Mare'); }
function groupKey(group) { return group.map(card => card.id).sort((a, b) => a - b).join('-'); }

const I18N = {
  ro: {
    menuTitle: 'Joacă simplu. Ia tot.', menuSubtitle: 'Intră într-o partidă în câteva secunde.', menuPill: 'MVP • BOT DISPONIBIL', menuHeroTitle: 'O partidă relaxată, direct în browser.', menuHeroCopy: 'Nu ai nevoie de instalări. Alegi adversarul, dificultatea și intri la masă.', menuVersion: 'v0.7.6 • Profil + statistici + start aleator',
    settings: 'Setări', settingsCopy: 'Sunete, animații și limbă', realPlayer: 'Player real', comingSoon: 'În curând', rules: 'Reguli', rulesCopy: 'Vezi cum se joacă', play: 'Joacă', back: 'Înapoi',
    step1: 'PASUL 1', modeTitle: 'Cum vrei să joci?', modeCopy: 'Alege un adversar. Multiplayer-ul cu alt jucător vine în curând.', bot: 'Cu bot', botCopy: 'Joacă acum împotriva unui adversar controlat de joc.', choose: 'Alege →', realCopy: 'Conectarea online este pregătită pentru o etapă viitoare.', historyKicker: 'ISTORIC', historyTitle: 'Log-uri meciuri', historyCopyMode: 'Vezi cu cine ai jucat, scorurile și cum a decurs partida.', viewLogs: 'Vezi log-urile',
    step2: 'PASUL 2', difficultyTitle: 'Cât de greu vrei să fie?', difficultyCopy: 'Alege ritmul și nivelul botului.', easy: 'Ușor', easyCopy: 'Bot relaxat, potrivit pentru primele partide.', medium: 'Mediu', mediumCopy: 'Bot echilibrat, caută capturi și puncte.', hard: 'Mare', hardCopy: 'Bot competitiv, analizează mai multe mutări.',
    matchBot: 'Meci cu bot', deck: 'în pachet', table: 'MASĂ', opponent: 'ADVERSAR', yourHand: 'MÂNA TA', you:'TU', botLabel:'BOT', pile: 'teanc de puncte', playerTableauLabel:'TABLELE', opponentTableauLabel:'TABLELE', playerTableauActive:'active', opponentTableauActive:'active', newGame: 'Joc nou', round: 'MÂNA', lastHand: 'ULTIMA MÂNĂ', yourTurn: 'Este rândul tău', botThinking: 'Botul se gândește…', gameEnded: 'Partida s-a încheiat', chooseCard: 'Alege o carte.', waitBot: 'Așteaptă mutarea botului.', tapHint: 'Click = joacă · Ține apăsat = stivă · Trage pe masă = pune fără captură.', waitHint: 'Așteaptă mutarea botului.', deckRemaining:'în pachet', battleLogTitle:'BATTLE LOG', recentMatches:'ultimele meciuri', playerStarts:'Începi tu.', botStarts:'Botul începe această mână.',
    captureKicker:'CAPTURĂ', captureTitle:'Ai mai multe variante', cancel:'Anulează', takeCards:'Ia cărțile', selected:'Ai selectat', cardsWord:'cărți', cardWord:'carte', selectCapture:'Selectează cel puțin o captură.', optionTarget:'Cu {card} ai {count} variante. Selectează una sau mai multe variante care nu folosesc aceleași cărți.',
    tableauKicker:'TABLĂ!', tableauTitle:'Alege cartea pentru tablă', tableauCopy:'Ai golit masa. Alege una dintre cărțile capturate de pe masă ca marcaj pentru această tablă.', tableauBonus:'+{bonus} bonus', tableauNoBonus:'fără bonus suplimentar', tableMarker:'Cartea devine marcajul acestei table',
    stackKicker:'STIVĂ', stackTitle:'Pune cartea peste aceeași valoare', stackCancel:'Anulează', stackTarget:'Ai ținut apăsat pe {card}. Alege stiva de {rank} peste care vrei să o așezi.', stackTop:'deasupra',
    rulesKicker:'REGULI', rulesTitle:'Cum se joacă Tabinet', ruleCaptureTitle:'1. Captură', ruleCaptureCopy:'Joci o carte și iei combinațiile de pe masă care au aceeași valoare totală. Poți selecta mai multe combinații compatibile.', ruleAceTitle:'2. Asul', ruleAceCopy:'Asul poate fi folosit ca 1 sau 11. J = 12, Q = 13, K = 14.', ruleStackTitle:'3. Stivă', ruleStackCopy:'Ține apăsat pe o carte și pune-o peste aceeași valoare. Orice stivă de 2 sau mai multe cărți se ia doar cu aceeași valoare și nu intră în sume cu alte cărți.', rulePointsTitle:'4. Puncte', rulePointsCopy:'La o captură, cartea jucată A, 10, J, Q, K sau 2♣ își păstrează și ea punctul, iar cărțile luate de pe masă își păstrează punctele lor. 10♦ este un 10 normal. Pentru tablă, 2–9 dau punctul tablei, A/10/J/Q/K nu primesc un bonus suplimentar de marcaj, iar 2♣ primește +1.', ruleTableauTitle:'5. Tablă', ruleTableauCopy:'Când golești masa, alegi cartea care marchează tabla. Când adversarul ia o tablă, una dintre tablele tale este anulată.', ruleLastHandTitle:'6. Ultima mână', ruleLastHandCopy:'Cine face ultima captură ia automat și toate cărțile rămase pe masă și punctele speciale ale lor.', understood:'Am înțeles',
    settingsKicker:'SETĂRI', settingsTitle:'Preferințe', soundLabel:'Sunete', soundCopy:'Feedback audio pentru acțiuni.', volumeLabel:'Volum', animationsLabel:'Animații', animationsCopy:'Animații complete; OFF păstrează doar tranziții discrete.', languageLabel:'Limbă', languageCopy:'Alege limba interfeței.', done:'Gata',
    profileKicker:'PROFIL', profileTitle:'Profilul meu', profileCopy:'Numele și ID-ul tău sunt salvate local pe acest dispozitiv.', profileNameLabel:'Nume', profileIdLabel:'ID jucător', copyId:'Copiază', copiedId:'Copiat', avatarSectionTitle:'Imagine de profil', avatarSectionCopy:'Alege un avatar.', avatarUploadTitle:'Imagine proprie', avatarUploadCopy:'Alege o imagine de pe dispozitiv.', profileStatsTitle:'Statistici', profileStatsCopy:'Rezumatul meciurilor disponibile.', profileWinRateLabel:'Win rate', profile12hLabel:'Meciuri în ultimele 12h', profileTotalLabel:'Meciuri înregistrate', profileRecentTitle:'Ultimele 3 meciuri', profileRecentCopy:'Momentan sunt afișate meciurile cu botul.', profileNoMatches:'Nu există meciuri disponibile încă.', profileWin:'Victorie', profileLoss:'Înfrângere', avatarTemplate:'Avatar', saveProfile:'Salvează', closeProfile:'Închide', profileMenu:'Profil',
    historyKicker:'ISTORIC MECIURI', historyTitleFull:'Log-uri de meciuri', historyCopy:'Vezi rezultatele și rezumatul fiecărei partide.', close:'Închide', emptyHistory:'Niciun meci terminat încă.', botMode:'BOT', playerMode:'PLAYER', watch:'Watch', soon:'În curând', opponentBot:'Bot', resultYou:'Tu', resultBot:'Botul', draw:'Egalitate', dateNow:'acum', details:'Vezi desfășurarea',
    gameOverKicker:'PARTIDĂ TERMINATĂ', gameOverDraw:'Egalitate', gameOverWin:'Ai câștigat partida', gameOverLoss:'Botul a câștigat partida', gameOverCopy:'Punctajul final include cărțile capturate și tablele active.', menu:'Meniu', rematch:'Mai joci o dată', you:'Tu', abandoned:'Abandonat', pauseKicker:'PARTIDĂ PUSĂ PE PAUZĂ', pauseTitle:'Poți reveni în această partidă.', pauseCopy:'Botul așteaptă. Dacă nu revii la timp, partida va fi declarată pierdută.', rejoin:'Reintră în meci', abandon:'Abandonează', seconds:'sec', pauseExpired:'Timpul a expirat. Partida a fost declarată pierdută.', pauseAbandoned:'Ai abandonat partida. Victoria a fost acordată adversarului.', pauseSaved:'Partida a fost pusă pe pauză.', leaveMatch:'Ieși din meci',
    loading1:'Se pregătește masa…', loading2:'Se încarcă pachetul…', loading3:'Gata de joc.', shuffleKicker:'PREGĂTEȘTE-TE', shuffleTitle:'Se amestecă pachetul', shuffleCopy:'Se distribuie cărțile și începe partida.',
    noMatchRank:'{card} nu are aceeași valoare ca nicio carte de pe masă.', placedStack:'Ai pus {card} peste {rank}. Acum stiva are {count} cărți.', placedTable:'Ai pus {card} pe masă. Ține apăsat pe o carte pentru a o pune peste aceeași valoare.', forcedPlace:'Ai pus {card} direct pe masă, fără captură.', captureMessage:'Ai jucat {played} și ai luat {count} {word} · +{gain} {points}.', captureBotMessage:'Botul a jucat {played} și a capturat {count} {word} · +{gain} {points}.', tableauPrompt:'Ai golit masa — alege cartea care marchează tabla.', tableExclamation:'Tablă!', tableauChosen:'Ai ales {card} ca marcaj pentru tablă.', botTableau:' Tablă! Marcaj: {card}.', lastDealMessage:'Ultima mână a fost împărțită. Cine face ultima captură ia și toate cărțile rămase pe masă.', dealMessage:'Mâna {round} a fost împărțită.', botPlaced:'Botul a pus {card} pe masă.', lastCapture:' Ultima captură: {who} a luat automat toate cele {count} cărți rămase · +{gain} {points}.', lastCaptureNoPoints:' Ultima captură: {who} a luat automat toate cele {count} cărți rămase.'
  },
  en: {
    menuTitle: 'Play simple. Take it all.', menuSubtitle: 'Get into a match in a few seconds.', menuPill: 'MVP • BOT AVAILABLE', menuHeroTitle: 'A relaxed match, right in your browser.', menuHeroCopy: 'No installs needed. Choose your opponent, difficulty and sit at the table.', menuVersion: 'v0.7.6 • Profile + stats + random starter',
    settings: 'Settings', settingsCopy: 'Sounds, animations and language', realPlayer: 'Real player', comingSoon: 'Coming soon', rules: 'Rules', rulesCopy: 'See how to play', play: 'Play', back: 'Back',
    step1: 'STEP 1', modeTitle: 'How do you want to play?', modeCopy: 'Choose an opponent. Online multiplayer is coming soon.', bot: 'Play vs bot', botCopy: 'Play now against a game-controlled opponent.', choose: 'Choose →', realCopy: 'Online connection is prepared for a future stage.', historyKicker: 'HISTORY', historyTitle: 'Match logs', historyCopyMode: 'See who you played, the scores and how the match went.', viewLogs: 'View logs',
    step2: 'STEP 2', difficultyTitle: 'How hard should it be?', difficultyCopy: 'Choose the bot pace and level.', easy: 'Easy', easyCopy: 'Relaxed bot, good for first matches.', medium: 'Medium', mediumCopy: 'Balanced bot, looks for captures and points.', hard: 'Hard', hardCopy: 'Competitive bot, analyzes more moves.',
    matchBot: 'Match vs bot', deck: 'in deck', table: 'TABLE', opponent: 'OPPONENT', yourHand: 'YOUR HAND', you:'YOU', botLabel:'BOT', pile: 'point pile', playerTableauLabel:'TABLES', opponentTableauLabel:'TABLES', playerTableauActive:'active', opponentTableauActive:'active', newGame: 'New game', round: 'HAND', lastHand: 'LAST HAND', yourTurn: 'Your turn', botThinking: 'The bot is thinking…', gameEnded: 'Match ended', chooseCard: 'Choose a card.', waitBot: 'Wait for the bot move.', tapHint: 'Click = play · Hold = stack · Drag onto the table = place without capturing.', waitHint: 'Wait for the bot move.', deckRemaining:'in deck', battleLogTitle:'BATTLE LOG', recentMatches:'recent matches', playerStarts:'You start.', botStarts:'The bot starts this hand.',
    captureKicker:'CAPTURE', captureTitle:'You have multiple options', cancel:'Cancel', takeCards:'Take cards', selected:'You selected', cardsWord:'cards', cardWord:'card', selectCapture:'Select at least one capture.', optionTarget:'With {card} you have {count} options. Select one or more options that do not reuse the same cards.',
    tableauKicker:'TABLE!', tableauTitle:'Choose the card for the table', tableauCopy:'You cleared the table. Choose one captured card to mark this table.', tableauBonus:'+{bonus} bonus', tableauNoBonus:'no extra bonus', tableMarker:'This card becomes the marker for this table',
    stackKicker:'STACK', stackTitle:'Place the card over the same value', stackCancel:'Cancel', stackTarget:'You held {card}. Choose the {rank} stack to place it on.', stackTop:'on top',
    rulesKicker:'RULES', rulesTitle:'How to play Tabinet', ruleCaptureTitle:'1. Capture', ruleCaptureCopy:'Play a card and take table combinations whose total value matches it. You can select multiple compatible combinations.', ruleAceTitle:'2. Ace', ruleAceCopy:'An Ace can count as 1 or 11. J = 12, Q = 13, K = 14.', ruleStackTitle:'3. Stack', ruleStackCopy:'Hold a card and place it over the same value. Any stack of 2 or more cards can only be taken by the same value and never participates in sums with other cards.', rulePointsTitle:'4. Points', rulePointsCopy:'A, 10, J, Q, K and 2♣ are worth 1 point when captured. 10♦ is a normal 10. For a table marker, 2–9 provide the table point, A/10/J/Q/K add nothing extra, and 2♣ gets +1.', ruleTableauTitle:'5. Table', ruleTableauCopy:'When you clear the table, choose the card that marks it. When the opponent takes a table, one of your table markers is cancelled.', ruleLastHandTitle:'6. Last hand', ruleLastHandCopy:'Whoever makes the final capture also takes all cards left on the table and their special points.', understood:'Got it',
    settingsKicker:'SETTINGS', settingsTitle:'Preferences', soundLabel:'Sounds', soundCopy:'Audio feedback for actions.', volumeLabel:'Volume', animationsLabel:'Animations', animationsCopy:'Full animations; OFF keeps only subtle transitions.', languageLabel:'Language', languageCopy:'Choose interface language.', done:'Done',
    profileKicker:'PROFILE', profileTitle:'My profile', profileCopy:'Your name and ID are stored locally on this device.', profileNameLabel:'Name', profileIdLabel:'Player ID', copyId:'Copy', copiedId:'Copied', avatarSectionTitle:'Profile picture', avatarSectionCopy:'Choose an avatar.', avatarUploadTitle:'Custom image', avatarUploadCopy:'Choose an image from your device.', profileStatsTitle:'Statistics', profileStatsCopy:'Summary of available matches.', profileWinRateLabel:'Win rate', profile12hLabel:'Matches in the last 12h', profileTotalLabel:'Recorded matches', profileRecentTitle:'Last 3 matches', profileRecentCopy:'For now, bot matches are shown here.', profileNoMatches:'No matches available yet.', profileWin:'Win', profileLoss:'Loss', avatarTemplate:'Avatar', saveProfile:'Save', closeProfile:'Close', profileMenu:'Profile',
    historyKicker:'MATCH HISTORY', historyTitleFull:'Match logs', historyCopy:'See results and a summary of each match.', close:'Close', emptyHistory:'No finished matches yet.', botMode:'BOT', playerMode:'PLAYER', watch:'Watch', soon:'Coming soon', opponentBot:'Bot', resultYou:'You', resultBot:'Bot', draw:'Draw', dateNow:'now', details:'View match flow',
    gameOverKicker:'MATCH OVER', gameOverDraw:'Draw', gameOverWin:'You won the match', gameOverLoss:'The bot won the match', gameOverCopy:'Final score includes captured cards and active tables.', menu:'Menu', rematch:'Play again', you:'You', abandoned:'Abandoned', pauseKicker:'MATCH PAUSED', pauseTitle:'You can rejoin this match.', pauseCopy:'The bot is waiting. If you do not return in time, the match is declared a loss.', rejoin:'Rejoin match', abandon:'Abandon', seconds:'sec', pauseExpired:'Time expired. The match was declared a loss.', pauseAbandoned:'You abandoned the match. The win was awarded to the opponent.', pauseSaved:'The match has been paused.', leaveMatch:'Leave match',
    loading1:'Setting up the table…', loading2:'Loading the deck…', loading3:'Ready to play.', shuffleKicker:'GET READY', shuffleTitle:'Shuffling the deck', shuffleCopy:'Dealing cards and starting the match.',
    noMatchRank:'{card} has no same-value card on the table.', placedStack:'You placed {card} over {rank}. The stack now has {count} cards.', placedTable:'You placed {card} on the table. Hold a card to stack it over the same value.', forcedPlace:'You placed {card} directly on the table without capturing.', captureMessage:'You played {played} and took {count} {word} · +{gain} {points}.', captureBotMessage:'The bot played {played} and captured {count} {word} · +{gain} {points}.', tableauPrompt:'You cleared the table — choose the card that marks it.', tableExclamation:'Table!', tableauChosen:'You chose {card} as the table marker.', botTableau:' Table! Marker: {card}.', lastDealMessage:'Last hand dealt. Whoever makes the final capture takes all cards left on the table.', dealMessage:'Hand {round} dealt.', botPlaced:'The bot placed {card} on the table.', lastCapture:' Last capture: {who} automatically took all {count} remaining cards · +{gain} {points}.', lastCaptureNoPoints:' Last capture: {who} automatically took all {count} remaining cards.'
  }
};

function t(key, vars = {}) {
  const dict = I18N[settings.language] || I18N.ro;
  let value = dict[key] ?? I18N.ro[key] ?? key;
  Object.entries(vars).forEach(([name, val]) => { value = value.replaceAll(`{${name}}`, String(val)); });
  return value;
}
function wordCards(count) { return settings.language === 'en' ? (count === 1 ? t('cardWord') : t('cardsWord')) : (count === 1 ? t('cardWord') : t('cardsWord')); }
function pointsWord(count) { return settings.language === 'en' ? (count === 1 ? 'point' : 'points') : (count === 1 ? 'punct' : 'puncte'); }

function applyLanguage() {
  const l = settings.language;
  document.documentElement.lang = l;
  const set = (id, key) => { const el = $(id); if (el) el.textContent = t(key); };
  const many = {
    menuTitle:'menuTitle', menuHeroTitle:'menuHeroTitle', menuHeroCopy:'menuHeroCopy', menuPill:'menuPill', menuVersion:'menuVersion',
    modeHistoryKicker:'historyKicker', modeHistoryTitle:'historyTitle', modeHistoryCopy:'historyCopyMode', openHistoryBtn:'viewLogs',
    playerRailLabel:'you', opponentRailLabel:'opponentBot', scorePileCaption:'pile', tableLabel:'table', opponentLabel:'opponent', playerHandLabel:'yourHand', restartMatchBtn:'newGame', playerTableauLabel:'playerTableauLabel', opponentTableauLabel:'opponentTableauLabel', playerTableauActive:'playerTableauActive', opponentTableauActive:'opponentTableauActive',
    rulesKicker:'rulesKicker', rulesTitle:'rulesTitle', ruleCaptureTitle:'ruleCaptureTitle', ruleCaptureCopy:'ruleCaptureCopy', ruleAceTitle:'ruleAceTitle', ruleAceCopy:'ruleAceCopy', ruleStackTitle:'ruleStackTitle', ruleStackCopy:'ruleStackCopy', rulePointsTitle:'rulePointsTitle', rulePointsCopy:'rulePointsCopy', ruleTableauTitle:'ruleTableauTitle', ruleTableauCopy:'ruleTableauCopy', ruleLastHandTitle:'ruleLastHandTitle', ruleLastHandCopy:'ruleLastHandCopy', closeRulesBtn:'understood',
    captureKicker:'captureKicker', captureTitle:'captureTitle', cancelCaptureBtn:'cancel', captureConfirmBtn:'takeCards', tableauKicker:'tableauKicker', tableauTitle:'tableauTitle', stackKicker:'stackKicker', stackTitle:'stackTitle', cancelStackBtn:'stackCancel', settingsKicker:'settingsKicker', settingsTitle:'settingsTitle', settingsLanguageLabel:'languageLabel', settingsLanguageCopy:'languageCopy', settingsAnimationsLabel:'animationsLabel', settingsAnimationsCopy:'animationsCopy', closeSettingsBtn:'done',
    historyKicker:'historyKicker', historyTitle:'historyTitleFull', historyCopy:'historyCopy', closeHistoryBtn:'close', profileKicker:'profileKicker', profileTitle:'profileTitle', profileCopy:'profileCopy', profileNameLabel:'profileNameLabel', profileIdLabel:'profileIdLabel', avatarSectionTitle:'avatarSectionTitle', avatarSectionCopy:'avatarSectionCopy', avatarUploadTitle:'avatarUploadTitle', avatarUploadCopy:'avatarUploadCopy', profileStatsTitle:'profileStatsTitle', profileStatsCopy:'profileStatsCopy', profileWinRateLabel:'profileWinRateLabel', profile12hLabel:'profile12hLabel', profileTotalLabel:'profileTotalLabel', profileRecentTitle:'profileRecentTitle', profileRecentCopy:'profileRecentCopy',
    finalYouLabel:'you', finalBotLabel:'opponentBot', gameOverMenuBtn:'menu', gameOverRematchBtn:'rematch',
    shuffleKicker:'shuffleKicker', shuffleTitle:'shuffleTitle'
  };
  Object.entries(many).forEach(([id,key]) => set(id,key));
  set('playerTableauLabel','playerTableauLabel');
  set('opponentTableauLabel','opponentTableauLabel');
  set('playerTableauActive','playerTableauActive');
  set('opponentTableauActive','opponentTableauActive');
  // Menu actions and mode/difficulty content
  const textPairs = [
    ['settingsBtn','settings','settingsCopy'], ['realPlayerBtn','realPlayer','comingSoon'], ['rulesMenuBtn','rules','rulesCopy'],
    ['menuPlayBtn','play'], ['modeBackBtn','back'], ['difficultyBackBtn','back'], ['botModeBtn','bot','botCopy','choose'],
  ];
  const setNested = (id, titleKey, copyKey, ctaKey) => {
    const el = $(id); if (!el) return;
    const strong = el.querySelector('strong'); if (strong && titleKey) strong.textContent = t(titleKey);
    const small = el.querySelector('small'); if (small && copyKey) small.textContent = t(copyKey);
    const cta = el.querySelector('.choice-cta'); if (cta && ctaKey) cta.textContent = t(ctaKey);
  };
  setNested('settingsBtn','settings','settingsCopy');
  setNested('realPlayerBtn','realPlayer','comingSoon');
  setNested('rulesMenuBtn','rules','rulesCopy');
  $('menuPlayBtn').textContent = t('play');
  $('modeBackBtn').textContent = `← ${t('back')}`;
  $('difficultyBackBtn').textContent = `← ${t('back')}`;
  setNested('botModeBtn','bot','botCopy','choose');
  const real = document.querySelector('#modeScreen .disabled-choice');
  if (real) { real.querySelector('.big-choice-title').textContent=t('realPlayer'); real.querySelector('.big-choice-copy').textContent=t('realCopy'); real.querySelector('.choice-cta').textContent=t('comingSoon'); }
  const difficultyText = {
    easy:['easy','easyCopy'], medium:['medium','mediumCopy'], hard:['hard','hardCopy']
  };
  document.querySelectorAll('.difficulty-card').forEach(btn => {
    const [name, copy] = difficultyText[btn.dataset.difficulty] || [];
    const n = btn.querySelector('.difficulty-name'); const c=btn.querySelector('.difficulty-copy');
    if(n) n.textContent=t(name); if(c) c.textContent=t(copy);
  });
  set('modeTitle','modeTitle'); set('difficultyTitle','difficultyTitle');
  const modeHeading = $('modeScreen')?.querySelector('.screen-heading .eyebrow'); if(modeHeading) modeHeading.textContent=t('step1');
  const modeCopy = $('modeScreen')?.querySelector('.screen-heading p:last-child'); if(modeCopy) modeCopy.textContent=t('modeCopy');
  const diffHeading = $('difficultyScreen')?.querySelector('.screen-heading .eyebrow'); if(diffHeading) diffHeading.textContent=t('step2');
  const diffCopy = $('difficultyScreen')?.querySelector('.screen-heading p:last-child'); if(diffCopy) diffCopy.textContent=t('difficultyCopy');
  set('gameTitle','matchBot');
  set('playerRailLabel','you'); set('opponentRailLabel','botLabel'); set('deckCaption','deckRemaining');
  set('battleLogTitle','battleLogTitle'); set('recentMatches','recentMatches');
  if ($('handHint')) $('handHint').textContent = state.turn === 'player' ? t('tapHint') : t('waitHint');
  $('playerTurnMeta').textContent = state.turn === 'player' ? t('yourTurn') : t('waitBot');
  $('botCardCount').textContent = `${state.opponentHand.length} ${wordCards(state.opponentHand.length)} ${settings.language==='en'?'in hand':'în mână'}`;
  $('gameMenuBtn').setAttribute('aria-label', t('leaveMatch'));
  if ($('resumeMatchKicker')) $('resumeMatchKicker').textContent = t('pauseKicker');
  if ($('resumeMatchTitle')) $('resumeMatchTitle').textContent = t('pauseTitle');
  if ($('resumeMatchCopy')) $('resumeMatchCopy').textContent = t('pauseCopy');
  if ($('rejoinMatchBtn')) $('rejoinMatchBtn').textContent = t('rejoin');
  if ($('abandonMatchBtn')) $('abandonMatchBtn').textContent = t('abandon');
  if ($('resumeSecondsLabel')) $('resumeSecondsLabel').textContent = t('seconds');
  if ($('profileMenuBtn')) $('profileMenuBtn').setAttribute('aria-label', t('profileMenu'));
  if ($('copyProfileIdBtn')) $('copyProfileIdBtn').textContent = t('copyId');
  if ($('saveProfileBtn')) $('saveProfileBtn').textContent = t('saveProfile');
  if ($('closeProfileBtn')) $('closeProfileBtn').textContent = t('closeProfile');
  $('gameSettingsBtn').setAttribute('aria-label', t('settings'));
  $('menuInstallBtn').setAttribute('aria-label', settings.language==='en'?'Install PWA':'Instalează PWA');
  const finalK = $('gameOverDialog')?.querySelector('.dialog-kicker'); if(finalK) finalK.textContent=t('gameOverKicker');
  const gameCopy = $('gameOverCopy'); if(gameCopy) gameCopy.textContent=t('gameOverCopy');
  const gameOverTitle = $('gameOverTitle');
  if (gameOverTitle && state.turn === 'done') gameOverTitle.textContent = state.score === state.opponentScore ? t('gameOverDraw') : state.score > state.opponentScore ? t('gameOverWin') : t('gameOverLoss');
  updateSettingsUI(); renderBattleLog(); renderHistoryEntries(); renderProfile(); renderResumeBar();
}

function addMatchEvent(actor, text, kind = 'move') {
  state.matchEvents.push({ actor, text, kind, round: state.round, time: new Date().toLocaleTimeString(settings.language === 'en' ? 'en-GB' : 'ro-RO', { hour:'2-digit', minute:'2-digit' }) });
  if (state.matchEvents.length > 80) state.matchEvents.shift();
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
  $(id).classList.remove('hidden');
  state.screen = id.replace('Screen', '').toLowerCase();
  const onMainMenu = id === 'menuScreen';
  document.body.classList.toggle('menu-screen-active', onMainMenu);
  document.body.classList.toggle('menu-screen-locked', onMainMenu);
  document.documentElement.classList.toggle('menu-screen-locked', onMainMenu);
  if (id === 'menuScreen') renderResumeBar();
  else $('resumeMatchBar')?.classList.add('hidden');
}

function renderCard(card, container, opts = {}) {
  const el = document.createElement('button');
  el.className = `card${card.red ? ' red' : ''}${opts.highlight ? ' highlight' : ''}`;
  el.type = 'button';
  el.dataset.id = card.id;
  if (opts.stackIndex !== undefined) {
    el.style.setProperty('--stack-index', String(opts.stackIndex));
  }
  el.setAttribute('aria-label', cardLabel(card));
  el.innerHTML = `<span class="rank">${card.rank}</span><span class="center">${card.symbol}</span><span class="suit">${card.symbol}</span>`;

  if (!opts.onClick && !opts.onHold) {
    el.tabIndex = -1;
    el.style.cursor = 'default';
  }

  let longPressHandled = false;
  let pressTimer = null;
  let startX = 0;
  let startY = 0;

  const clearPress = () => {
    if (pressTimer) window.clearTimeout(pressTimer);
    pressTimer = null;
  };

  if (opts.onHold) {
    el.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      longPressHandled = false;
      startX = event.clientX;
      startY = event.clientY;
      clearPress();
      pressTimer = window.setTimeout(() => {
        pressTimer = null;
        if (Math.hypot(event.clientX - startX, event.clientY - startY) > 10) return;
        longPressHandled = true;
        el.classList.add('long-pressed');
        opts.onHold(card);
      }, 480);
    });
    el.addEventListener('pointermove', event => {
      if (!pressTimer) return;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 10) clearPress();
    });
    ['pointerup', 'pointercancel'].forEach(type => el.addEventListener(type, clearPress));
  }

  if (opts.onClick) {
    el.addEventListener('click', event => {
      if (longPressHandled) {
        event.preventDefault();
        event.stopPropagation();
        el.classList.remove('long-pressed');
        longPressHandled = false;
        return;
      }
      opts.onClick(card);
    });
  }

  if (opts.dragToTable) {
    el.draggable = true;
    el.classList.add('draggable-card');
    el.addEventListener('dragstart', event => {
      if (state.turn !== 'player' || state.dealing || state.animating) { event.preventDefault(); return; }
      clearPress();
      longPressHandled = true;
      state.draggingCardId = card.id;
      state.nativeDrag = { card, fromRect: el.getBoundingClientRect() };
      document.body.classList.add('dragging-card');
      try { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(card.id)); } catch {}
      $('tableZone')?.classList.add('drop-target-ready');
    });
    el.addEventListener('dragend', () => {
      document.body.classList.remove('dragging-card');
      $('tableZone')?.classList.remove('drop-target-ready','drop-target-active');
      state.nativeDrag = null;
      state.draggingCardId = null;
      longPressHandled = true;
      window.setTimeout(() => { longPressHandled = false; }, 90);
    });

    el.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse') return;
      if (state.turn !== 'player' || state.dealing || state.animating) return;
      const pointerId = event.pointerId;
      const originRect = el.getBoundingClientRect();
      const x0 = event.clientX; const y0 = event.clientY;
      const maybeStartDrag = moveEvent => {
        if (state.draggingCardId !== null || longPressHandled) return;
        if (Math.hypot(moveEvent.clientX - x0, moveEvent.clientY - y0) < 12) return;
        clearPress();
        longPressHandled = true;
        startPointerDrag(card, originRect, pointerId, moveEvent.clientX, moveEvent.clientY);
        cleanupPending();
      };
      const cleanupPending = () => {
        el.removeEventListener('pointermove', maybeStartDrag);
        el.removeEventListener('pointerup', cleanupPending);
        el.removeEventListener('pointercancel', cleanupPending);
      };
      el.addEventListener('pointermove', maybeStartDrag);
      el.addEventListener('pointerup', cleanupPending, { once: true });
      el.addEventListener('pointercancel', cleanupPending, { once: true });
    });
  }
  container.appendChild(el);
}

function startPointerDrag(card, fromRect, pointerId, x, y) {
  state.draggingCardId = card.id;
  state.nativeDrag = { card, fromRect, pointerId, ghost: cardVisual(card) };
  const ghost = state.nativeDrag.ghost;
  ghost.classList.add('drag-ghost');
  document.body.appendChild(ghost);
  positionDragGhost(ghost, x, y);
  document.body.classList.add('dragging-card');
  $('tableZone')?.classList.add('drop-target-ready');
  const onMove = event => {
    if (!state.nativeDrag || state.nativeDrag.pointerId !== event.pointerId) return;
    positionDragGhost(ghost, event.clientX, event.clientY);
    const rect = $('tableZone')?.getBoundingClientRect();
    $('tableZone')?.classList.toggle('drop-target-active', Boolean(rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom));
  };
  const onUp = event => {
    if (!state.nativeDrag || state.nativeDrag.pointerId !== event.pointerId) return;
    const active = state.nativeDrag;
    const rect = $('tableZone')?.getBoundingClientRect();
    const inside = Boolean(rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
    cleanup();
    if (inside && state.hand.some(c => c.id === active.card.id)) forcePlaceCard(active.card, active.fromRect);
  };
  const onCancel = event => { if (state.nativeDrag?.pointerId === event.pointerId) cleanup(); };
  function cleanup() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    activeGhostCleanup();
    document.body.classList.remove('dragging-card');
    $('tableZone')?.classList.remove('drop-target-ready','drop-target-active');
    state.nativeDrag = null;
    state.draggingCardId = null;
  }
  function activeGhostCleanup() {
    ghost.remove();
  }
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
}

function positionDragGhost(ghost, x, y) {
  ghost.style.left = `${x - 36}px`;
  ghost.style.top = `${y - 52}px`;
}

function renderOpponentBacks() {
  const wrap = $('opponentHand');
  wrap.innerHTML = '';
  state.opponentHand.forEach((_, index) => {
    const back = document.createElement('div');
    back.className = 'card-back';
    back.style.setProperty('--back-index', String(index));
    wrap.appendChild(back);
  });
  $('botCardCount').textContent = `${state.opponentHand.length} ${wordCards(state.opponentHand.length)} ${settings.language === 'en' ? 'in hand' : 'în mână'}`;
}

function renderScorePile(container, score, side) {
  container.innerHTML = '';
  const count = Math.max(0, score);
  container.style.setProperty('--point-count', String(count));
  container.style.height = `${Math.min(230, 62 + count * 3)}px`;
  for (let i = 0; i < count; i += 1) {
    const card = document.createElement('div');
    card.className = `score-pile-card ${side === 'player' ? 'score-pile-player' : 'score-pile-bot'}`;
    card.style.setProperty('--pile-index', String(i));
    card.setAttribute('aria-hidden', 'true');
    card.innerHTML = '<span>✦</span>';
    container.appendChild(card);
  }
}

function renderTableauPile(container, markers, side) {
  if (!container) return;
  container.innerHTML = '';
  const cards = Array.isArray(markers) ? markers : [];
  container.classList.toggle('has-tableau', cards.length > 0);
  const rail = container.closest('.tableau-mini-box');
  const activeLabel = rail?.querySelector('.tableau-mini-head small');
  if (activeLabel) activeLabel.textContent = `${cards.length} ${settings.language === 'en' ? (cards.length === 1 ? 'active' : 'active') : 'active'}`;
  cards.forEach((card, index) => {
    const el = document.createElement('div');
    el.className = `tableau-pile-card ${card.red ? 'red' : ''}`;
    el.style.setProperty('--tableau-index', String(index));
    el.setAttribute('title', cardLabel(card));
    el.setAttribute('aria-label', cardLabel(card));
    el.innerHTML = `<span class="rank">${card.rank}</span><span class="suit">${card.symbol}</span><span class="table-badge">TABLĂ</span>`;
    container.appendChild(el);
  });
  if (!cards.length) {
    const empty = document.createElement('div');
    empty.className = 'tableau-pile-empty';
    empty.textContent = settings.language === 'en' ? 'No active tables yet' : 'Nicio tablă activă încă';
    container.appendChild(empty);
  }
}

function renderBattleLog() {
  const list = $('battleLogList');
  if (!list) return;
  list.innerHTML = '';
  if (!battleHistory.length) {
    list.innerHTML = `<div class="battle-empty">${t('emptyHistory')}</div>`;
    return;
  }
  battleHistory.slice(0, 5).forEach(entry => {
    const row = document.createElement('div');
    row.className = 'battle-row';
    const modeLabel = entry.mode === 'player' ? t('playerMode') : t('botMode');
    const difficulty = entry.mode === 'bot' ? difficultyLabel(entry.difficulty) : '';
    const outcome = entryResult(entry);
    const result = outcome === 'draw' ? t('draw') : outcome === 'win' ? t('resultYou') : entry.abandoned ? t('abandoned') : t('resultBot');
    row.innerHTML = `
      <div class="battle-row-top"><span class="battle-mode ${entry.mode === 'player' ? 'player-mode' : 'bot-mode'}">${modeLabel}</span><span class="battle-date">${entry.date}</span></div>
      <div class="battle-score"><strong>${entry.playerScore}</strong><span>—</span><strong>${entry.botScore}</strong></div>
      <div class="battle-meta"><span>${result}</span><span>${difficulty}</span></div>
    `;
    list.appendChild(row);
  });
}

function renderHistoryEntries() {
  const list = $('historyEntries');
  const total = $('historyTotal');
  if (!list) return;
  if (total) total.textContent = battleHistory.length;
  list.innerHTML = '';
  if (!battleHistory.length) {
    list.innerHTML = `<div class="history-empty">${t('emptyHistory')}</div>`;
    return;
  }
  battleHistory.forEach((entry, index) => {
    const item = document.createElement('article');
    item.className = 'history-entry';
    const mode = entry.mode === 'player' ? t('playerMode') : t('botMode');
    const opponent = entry.opponentName || t('opponentBot');
    const outcome = entryResult(entry);
    const result = outcome === 'draw' ? t('draw') : outcome === 'win' ? t('resultYou') : entry.abandoned ? t('abandoned') : t('resultBot');
    const diff = entry.mode === 'bot' ? difficultyLabel(entry.difficulty) : '';
    const events = Array.isArray(entry.events) ? entry.events : [];
    const preview = events.slice(-5).map(ev => `<li><span>${ev.time || ''}</span>${escapeHtml(ev.text)}</li>`).join('');
    item.innerHTML = `
      <div class="history-entry-top"><div><span class="battle-mode ${entry.mode === 'player' ? 'player-mode' : 'bot-mode'}">${mode}</span><strong>${escapeHtml(opponent)}</strong></div><span class="battle-date">${escapeHtml(entry.date || '')}</span></div>
      <div class="history-entry-score"><strong>${entry.playerScore}</strong><span>—</span><strong>${entry.botScore}</strong><em>${escapeHtml(result)}</em></div>
      <div class="history-entry-meta"><span>${escapeHtml(diff)}</span><span>${events.length} ${settings.language === 'en' ? 'events' : 'acțiuni'}</span></div>
      <details class="history-details"><summary>${t('details')}</summary><ol>${preview || `<li>${t('emptyHistory')}</li>`}</ol><button class="secondary watch-btn" type="button" disabled>${t('watch')} · ${t('soon')}</button></details>
    `;
    item.dataset.index = index;
    list.appendChild(item);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch]));
}

function renderTable() {
  const table = $('tableCards');
  table.innerHTML = '';
  $('tableEmpty').classList.toggle('hidden', state.tableStacks.length > 0);
  state.tableStacks.forEach(stack => {
    const pile = document.createElement('div');
    pile.className = `table-stack${stack.cards.length > 1 ? ' locked-stack' : ''}`;
    pile.style.height = `${104 + Math.max(0, stack.cards.length - 1) * 14}px`;
    pile.setAttribute('aria-label', stack.cards.length > 1 ? `Stivă ${stack.cards.map(cardLabel).join(', ')}` : cardLabel(stack.cards[0]));
    stack.cards.forEach((card, index) => renderCard(card, pile, { stackIndex: index }));
    table.appendChild(pile);
  });
}

function renderGame() {
  document.body.classList.toggle('player-turn', state.turn === 'player');
  document.body.classList.toggle('opponent-turn', state.turn === 'opponent');
  document.body.classList.toggle('game-ended', state.turn === 'done');
  document.body.dataset.turn = state.turn;
  const tableCount = tableCardCount();
  $('playerScore').textContent = state.score;
  $('opponentScore').textContent = state.opponentScore;
  $('deckCount').textContent = state.deck.length;
  const deckCaption = $('deckCaption'); if (deckCaption) deckCaption.textContent = t('deckRemaining');
  const playerRailLabel = $('playerRailLabel'); if (playerRailLabel) playerRailLabel.textContent = t('you');
  const opponentRailLabel = $('opponentRailLabel'); if (opponentRailLabel) opponentRailLabel.textContent = t('botLabel');
  const battleLogTitle = $('battleLogTitle'); if (battleLogTitle) battleLogTitle.textContent = t('battleLogTitle');
  const recentMatches = $('recentMatches'); if (recentMatches) recentMatches.textContent = t('recentMatches');
  $('botMeta').textContent = difficultyLabel(state.difficulty);
  $('playerTurnMeta').textContent = state.turn === 'player' ? t('yourTurn') : t('waitBot');
  $('turnBanner').textContent = state.turn === 'player' ? t('yourTurn') : state.turn === 'opponent' ? t('botThinking') : t('gameEnded');
  $('handHint').textContent = state.turn === 'player' ? t('tapHint') : t('waitHint');
  $('tableCount').textContent = `${tableCount} ${wordCards(tableCount)} · ${state.tableStacks.length} ${state.tableStacks.length === 1 ? (settings.language==='en'?'stack':'stivă') : (settings.language==='en'?'stacks':'stive')}`;
  $('gameLog').textContent = state.message;
  $('scoreHelp').textContent = state.lastDeal ? `${t('lastHand')} · ${settings.language==='en'?'Tables active':'Tabla activă'}: ${state.tableauMarkers.player.length}-${state.tableauMarkers.opponent.length}` : `${settings.language==='en'?'Tables active':'Tabla activă'}: ${state.tableauMarkers.player.length}-${state.tableauMarkers.opponent.length}`;
  $('roundBadge').textContent = state.lastDeal ? t('lastHand') : `${t('round')} ${state.round}`;

  renderTable();

  const hand = $('playerHand');
  hand.innerHTML = '';
  state.hand.forEach(card => renderCard(card, hand, {
    onClick: () => state.turn === 'player' && playCard(card),
    onHold: () => state.turn === 'player' && stackCard(card),
    dragToTable: true,
  }));
  renderOpponentBacks();
  renderScorePile($('playerScorePile'), state.score, 'player');
  renderScorePile($('opponentScorePile'), state.opponentScore, 'bot');
  renderTableauPile($('playerTableauPile'), state.tableauMarkers.player, 'player');
  renderTableauPile($('opponentTableauPile'), state.tableauMarkers.opponent, 'bot');
  renderBattleLog();
  startAnimationsForRender();
}

function selectionCards(selection) { return rules.flattenSelection(selection); }
function selectionOverlaps(a, b) {
  const idsA = new Set(selectionCards(a).map(card => card.id));
  return selectionCards(b).some(card => idsA.has(card.id));
}
function groupText(group) { return group.map(cardLabel).join(' + '); }

function closeCaptureChooser(keepSource = false) {
  if ($('captureDialog').open) $('captureDialog').close();
  state.pendingCaptureGroups = [];
  state.pendingSelection = [];
  state.pendingPlay = null;
  if (!keepSource) state.pendingPlaySourceRect = null;
  renderTable();
}

function updateCaptureChooser() {
  const selectedIds = new Set(selectionCards(state.pendingSelection).map(card => card.id));
  [...$('captureOptions').children].forEach((btn, index) => {
    const group = state.pendingCaptureGroups[index];
    const isSelected = state.pendingSelection.some(item => groupKey(item) === groupKey(group));
    const overlaps = group.some(card => selectedIds.has(card.id)) && !isSelected;
    btn.classList.toggle('selected', isSelected);
    btn.classList.toggle('disabled', overlaps);
    btn.disabled = overlaps;
  });
  const count = selectionCards(state.pendingSelection).length;
  $('captureSelectionSummary').textContent = count ? `${t('selected')} ${count} ${wordCards(count)}.` : t('selectCapture');
  $('captureConfirmBtn').disabled = state.pendingSelection.length === 0;
  const selected = new Set(selectionCards(state.pendingSelection).map(card => card.id));
  [...$('tableCards').querySelectorAll('.card')].forEach(el => el.classList.toggle('highlight', selected.has(Number(el.dataset.id))));
}

function toggleCaptureGroup(index) {
  const group = state.pendingCaptureGroups[index];
  const key = groupKey(group);
  const exists = state.pendingSelection.some(item => groupKey(item) === key);
  if (exists) {
    state.pendingSelection = state.pendingSelection.filter(item => groupKey(item) !== key);
  } else if (!state.pendingSelection.some(item => selectionOverlaps([item], [group]))) {
    state.pendingSelection.push(group);
  }
  playTone('button');
  updateCaptureChooser();
}

function openCaptureChooser(card, groups) {
  state.pendingPlay = card;
  state.pendingCaptureGroups = groups;
  state.pendingSelection = [];
  const list = $('captureOptions');
  list.innerHTML = '';
  groups.forEach((group, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'capture-option';
    const isStack = group.length > 1 && group.every(c => c.rank === group[0].rank);
    btn.innerHTML = `<span class="capture-option-main">${groupText(group)}${isStack ? ` <span class="inline-stack-tag">${settings.language==='en'?'STACK':'STIVĂ'}</span>` : ''}</span><span class="capture-option-sub">${group.length} ${wordCards(group.length)} · ${settings.language==='en'?'total':'total'} ${sumGroup(group)}</span>`;
    btn.addEventListener('click', () => toggleCaptureGroup(index));
    list.appendChild(btn);
  });
  $('captureTarget').textContent = t('optionTarget', { card: cardLabel(card), count: groups.length });
  $('captureDialog').showModal();
  updateCaptureChooser();
}

function confirmCapture() {
  const card = state.pendingPlay;
  const captured = selectionCards(state.pendingSelection);
  const sourceRect = state.pendingPlaySourceRect;
  closeCaptureChooser(true);
  if (!card || !captured.length) return;
  state.hand = state.hand.filter(c => c.id !== card.id);
  state.lastTaker = 'player';
  beginActionMotion();
  completeCapture('player', card, captured, sourceRect);
  state.pendingPlaySourceRect = null;
  playTone('capture');
  finishTurnOrDeal();
  releaseActionMotion('botCapture');
}

function findMatchingStacks(card) {
  return state.tableStacks.filter(stack => stack.cards.length && stack.cards[stack.cards.length - 1].rank === card.rank);
}

function stackCard(card) {
  if (state.turn !== 'player' || state.dealing) return;
  const matches = findMatchingStacks(card);
  if (!matches.length) {
    state.message = t('noMatchRank', { card: cardLabel(card) });
    renderGame();
    return;
  }
  if (matches.length === 1) {
    commitStack(card, matches[0].id);
    return;
  }
  openStackChooser(card, matches);
}

function openStackChooser(card, stacks) {
  state.pendingStackCard = card;
  const list = $('stackOptions');
  list.innerHTML = '';
  $('stackTarget').textContent = t('stackTarget', { card: cardLabel(card), rank: card.rank });
  stacks.forEach(stack => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'capture-option stack-choice';
    const top = stack.cards[stack.cards.length - 1];
    btn.innerHTML = `<span class="capture-option-main">${stack.cards.map(cardLabel).join(' + ')}</span><span class="capture-option-sub">${stack.cards.length} ${stack.cards.length === 1 ? 'carte' : 'cărți'} · deasupra ${cardLabel(top)}</span>`;
    btn.addEventListener('click', () => {
      $('stackDialog').close();
      commitStack(card, stack.id);
    });
    list.appendChild(btn);
  });
  $('stackDialog').showModal();
}

function commitStack(card, stackId) {
  const stack = state.tableStacks.find(item => item.id === stackId);
  if (!stack || !state.hand.some(c => c.id === card.id)) return;
  const sourceRect = getCardRectById(card.id);
  beginActionMotion();
  state.hand = state.hand.filter(c => c.id !== card.id);
  stack.cards.push(card);
  state.message = t('placedStack', { card: cardLabel(card), rank: card.rank, count: stack.cards.length });
  addMatchEvent('player', state.message, 'stack');
  state.pendingStackCard = null;
  state.pendingTableauCards = [];
  queueVisualAnimation({ kind: 'stack', card, fromRect: sourceRect, targetId: 'tableZone' });
  playTone('stack');
  finishTurnOrDeal();
  releaseActionMotion('stack');
}

function forcePlaceCard(card, sourceRect = null) {
  if (state.turn !== 'player' || state.dealing || state.animating) return;
  if (!state.hand.some(c => c.id === card.id)) return;
  beginActionMotion();
  state.hand = state.hand.filter(c => c.id !== card.id);
  state.tableStacks.push(makeStack(card));
  state.message = t('forcedPlace', { card: cardLabel(card) });
  addMatchEvent('player', state.message, 'place');
  queueVisualAnimation({ kind: 'place', card, fromRect: sourceRect, targetId: 'tableZone' });
  playTone('place');
  finishTurnOrDeal();
  releaseActionMotion('place');
}

function playCard(card) {
  if (state.turn !== 'player' || state.dealing || state.animating) return;
  const sourceRect = getCardRectById(card.id);
  const groups = rules.allCaptureGroupsForStacks(card, state.tableStacks);
  if (!groups.length) {
    beginActionMotion();
    state.hand = state.hand.filter(c => c.id !== card.id);
    state.tableStacks.push(makeStack(card));
    state.message = t('placedTable', { card: cardLabel(card) });
    addMatchEvent('player', state.message, 'place');
    queueVisualAnimation({ kind: 'place', card, fromRect: sourceRect, targetId: 'tableZone' });
    playTone('place');
    finishTurnOrDeal();
    releaseActionMotion('place');
    return;
  }
  if (groups.length === 1) {
    state.hand = state.hand.filter(c => c.id !== card.id);
    state.lastTaker = 'player';
    completeCapture('player', card, groups[0], sourceRect);
    playTone('capture');
    finishTurnOrDeal();
    releaseActionMotion('capture');
    return;
  }
  state.pendingPlaySourceRect = sourceRect;
  openCaptureChooser(card, groups);
}

function applyTableauMarker(who, markerCard) {
  const other = who === 'player' ? 'opponent' : 'player';
  const otherScoreKey = other === 'player' ? 'score' : 'opponentScore';

  // Each active table contributes 1 point. Only 2♣ contributes one extra point.
  // When a new table is made, one active opponent table is cancelled.
  if (state.tableauMarkers[other].length) {
    const removedMarker = state.tableauMarkers[other].shift();
    state[otherScoreKey] = Math.max(0, state[otherScoreKey] - rules.tableMarkerBonus(removedMarker));
  }

  state.tableauMarkers[who].push(markerCard);
  const tableGain = rules.tableMarkerBonus(markerCard);
  state[who === 'player' ? 'score' : 'opponentScore'] += tableGain;
  return tableGain;
}

function completeCapture(who, playedCard, captured, sourceRect = null) {
  const capturedIds = new Set(captured.map(card => card.id));
  state.tableStacks = state.tableStacks.filter(stack => !stack.cards.some(card => capturedIds.has(card.id)));
  const madeTable = state.tableStacks.length === 0;

  // The played card leaves the hand, but it does NOT score as a captured card.
  state.played[who].push(playedCard);
  state.captured[who].push(...captured);

  const baseGain = rules.capturePoints(captured) + rules.specialPoints(playedCard);
  state.animating = state.animating || animationsEnabled();
  queueVisualAnimation({ kind: 'capture', card: playedCard, captured, fromRect: sourceRect, targetId: who === 'player' ? 'playerScorePile' : 'opponentScorePile' });
  state[who === 'player' ? 'score' : 'opponentScore'] += baseGain;
  state.lastTaker = who;

  let message = who === 'player'
    ? t('captureMessage', { played: cardLabel(playedCard), count: captured.length, word: wordCards(captured.length), gain: baseGain, points: pointsWord(baseGain) })
    : t('captureBotMessage', { played: cardLabel(playedCard), count: captured.length, word: wordCards(captured.length), gain: baseGain, points: pointsWord(baseGain) });

  if (madeTable) {
    if (who === 'player') {
      state.waitingForTableau = true;
      state.pendingTableauCards = [...captured];
      message += ` ${t('tableauPrompt')}`;
      openTableauChooser(captured);
    } else {
      const marker = chooseBotTableauMarker(captured);
      applyTableauMarker('opponent', marker);
      message += marker ? t('botTableau',{card:cardLabel(marker)}) : ` ${t('tableExclamation')}`;
    }
  }

  state.message = message;
  addMatchEvent(who === 'player' ? 'player' : 'bot', message, 'capture');
  renderGame();
}

function chooseBotTableauMarker(cards) {
  if (!cards.length) return null;
  return [...cards].sort((a, b) => rules.tableMarkerBonus(b) - rules.tableMarkerBonus(a) || rules.specialPoints(b) - rules.specialPoints(a))[0];
}

function openTableauChooser(cards) {
  const list = $('tableauOptions');
  list.innerHTML = '';
  const unique = [...new Map(cards.map(card => [card.id, card])).values()];
  if (!unique.length) {
    state.waitingForTableau = false;
    finishTurnOrDeal();
    return;
  }
  $('tableauOptions').dataset.cards = unique.map(card => card.id).join(',');
  unique.forEach(card => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tableau-option';
    const bonus = rules.tableMarkerBonus(card);
    btn.innerHTML = `<span class="tableau-card-mini${card.red ? ' red' : ''}"><strong>${card.rank}</strong><span>${card.symbol}</span></span><span><strong>${cardLabel(card)}</strong><small>${t('tableMarker')}${bonus ? ` · ${t('tableauBonus',{bonus})}` : ` · ${t('tableauNoBonus')}`}</small></span>`;
    btn.addEventListener('click', () => {
      $('tableauDialog').close();
      applyTableauMarker('player', card);
      state.waitingForTableau = false;
      state.pendingTableauCards = [];
      state.message += ` ${t('tableauChosen',{card:cardLabel(card)})}`;
      playTone('success');
      renderGame();
      finishTurnOrDeal();
    });
    list.appendChild(btn);
  });
  $('tableauDialog').showModal();
}

function candidateBotMoves() {
  const moves = [];
  for (const card of state.opponentHand) {
    const groups = rules.allCaptureGroupsForStacks(card, state.tableStacks);
    if (!groups.length) {
      moves.push({ card, capture: [], captured: [], madeTable: false, gain: 0, kind: 'place' });
      continue;
    }
    const selections = rules.findCaptureSelections(groups);
    const bestSelections = selections.length ? selections : [[groups[0]]];
    bestSelections.forEach(selection => {
      const captured = selectionCards(selection);
      const madeTable = captured.length === tableCardCount();
      moves.push({ card, capture: selection, captured, madeTable, gain: rules.scoreCapture(captured, madeTable, chooseBotTableauMarker(captured), card), kind: 'capture' });
    });
  }
  return moves;
}

function playerBestImmediateGainForTable(tableStacks) {
  let best = 0;
  for (const card of state.hand) {
    const groups = rules.allCaptureGroupsForStacks(card, tableStacks);
    if (!groups.length) continue;
    const selections = rules.findCaptureSelections(groups);
    for (const selection of selections) {
      const captured = selectionCards(selection);
      const madeTable = captured.length === tableStacks.reduce((sum, stack) => sum + stack.cards.length, 0);
      best = Math.max(best, rules.scoreCapture(captured, madeTable, chooseBotTableauMarker(captured), card));
    }
  }
  return best;
}

function chooseBotMove() {
  const moves = candidateBotMoves();
  if (!moves.length) return null;
  if (state.difficulty === 'easy') {
    const captures = moves.filter(move => move.kind === 'capture');
    if (captures.length && Math.random() < .62) return captures[Math.floor(Math.random() * captures.length)];
    return moves[Math.floor(Math.random() * moves.length)];
  }
  if (state.difficulty === 'medium') {
    return [...moves].sort((a, b) => b.gain - a.gain || Number(b.madeTable) - Number(a.madeTable) || (b.captured?.length || 0) - (a.captured?.length || 0))[0];
  }
  return [...moves].sort((a, b) => {
    const score = move => {
      if (move.kind === 'place') {
        const simulated = [...state.tableStacks, makeVirtualStack(move.card)];
        return -1.4 * playerBestImmediateGainForTable(simulated);
      }
      const capturedIds = new Set(move.captured.map(card => card.id));
      const simulated = state.tableStacks.filter(stack => !stack.cards.some(card => capturedIds.has(card.id)));
      return move.gain * 4 + (move.madeTable ? 3 : 0) - 1.6 * playerBestImmediateGainForTable(simulated);
    };
    return score(b) - score(a);
  })[0];
}

function makeVirtualStack(card) { return { id: -card.id - 1, cards: [card] }; }

async function opponentMove(token) {
  if (token !== state.matchToken || state.turn !== 'opponent' || !state.opponentHand.length) return;
  await delay(settings.animations ? 620 : 220);
  if (token !== state.matchToken || state.turn !== 'opponent') return;
  const choice = chooseBotMove();
  if (!choice) { finishTurnOrDeal(); return; }
  const botIndex = state.opponentHand.findIndex(card => card.id === choice.card.id);
  const botCards = [...document.querySelectorAll('#opponentHand .card-back')];
  const sourceRect = (botCards[botIndex] || $('opponentHand'))?.getBoundingClientRect() || null;
  beginActionMotion();
  state.opponentHand = state.opponentHand.filter(card => card.id !== choice.card.id);
  if (choice.kind === 'capture') {
    completeCapture('opponent', choice.card, selectionCards(choice.capture), sourceRect);
    playTone('capture');
    finishTurnOrDeal();
    releaseActionMotion('botCapture');
  } else {
    state.tableStacks.push(makeStack(choice.card));
    state.message = t('botPlaced',{card:cardLabel(choice.card)});
    addMatchEvent('bot', state.message, 'place');
    queueVisualAnimation({ kind:'place', card:choice.card, fromRect:sourceRect, targetId:'tableZone' });
    playTone('place');
    finishTurnOrDeal();
    releaseActionMotion('place');
  }
}

function dealNextHands() {
  if (state.deck.length < 2) return false;
  state.round += 1;
  state.pendingDealSourceRect = $('deckCounter')?.getBoundingClientRect() || null;

  // Always deal equally to both players. In a two-player game the deck is
  // exhausted in blocks of 12 after the initial four cards on the table.
  const each = Math.min(6, Math.floor(state.deck.length / 2));
  if (each < 1) return false;

  state.hand = deal(each);
  state.opponentHand = deal(each);
  state.lastDeal = state.deck.length === 0;
  state.message = state.lastDeal ? t('lastDealMessage') : t('dealMessage',{round:state.round});
  addMatchEvent('system', state.message, 'deal');
  queueVisualAnimation({ kind:'deal', fromRect: state.pendingDealSourceRect, tableCount: state.tableStacks.length ? 0 : 0, playerCount: state.hand.length, opponentCount: state.opponentHand.length });
  playTone('nextHand');
  return true;
}

function finishTurnOrDeal() {
  if (state.waitingForTableau) { renderGame(); return; }

  // With equal hands, both become empty together. Only then do we deal again.
  if (!state.hand.length && !state.opponentHand.length) {
    if (state.deck.length > 0) {
      const current = state.turn;
      if (dealNextHands()) {
        state.turn = current === 'player' ? 'opponent' : 'player';
        renderGame();
        if (state.turn === 'opponent') void opponentMove(state.matchToken);
        return;
      }
    }
    endGame();
    return;
  }

  state.turn = state.turn === 'player' ? 'opponent' : 'player';
  renderGame();
  if (state.turn === 'opponent') void opponentMove(state.matchToken);
}

function recordBattleResult() {
  const entry = {
    id: Date.now(),
    timestamp: Date.now(),
    mode: 'bot',
    difficulty: state.difficulty,
    playerScore: state.score,
    botScore: state.opponentScore,
    result: state.score === state.opponentScore ? 'draw' : state.score > state.opponentScore ? 'win' : 'loss',
    opponentName: 'Bot',
    events: state.matchEvents.slice(-80),
    date: new Date().toLocaleDateString(settings.language === 'en' ? 'en-GB' : 'ro-RO', { day: '2-digit', month: '2-digit' }),
  };
  battleHistory = [entry, ...battleHistory].slice(0, 8);
  saveBattleHistory();
}

function endGame() {
  if (state.tableStacks.length && state.lastTaker) {
    const remaining = tableCards();
    const who = state.lastTaker;
    const gained = rules.capturePoints(remaining);
    state[who === 'player' ? 'score' : 'opponentScore'] += gained;
    state.captured[who].push(...remaining);
    state.tableStacks = [];
    state.message += gained ? t('lastCapture',{who:who==='player'?t('resultYou'):t('resultBot'),count:remaining.length,gain:gained,points:pointsWord(gained)}) : t('lastCaptureNoPoints',{who:who==='player'?t('resultYou'):t('resultBot'),count:remaining.length});
  }
  state.turn = 'done';
  addMatchEvent(state.lastTaker || 'system', state.message, 'end');
  renderGame();
  recordBattleResult();
  renderBattleLog();
  $('finalPlayerScore').textContent = state.score;
  $('finalBotScore').textContent = state.opponentScore;
  $('gameOverTitle').textContent = state.score === state.opponentScore ? t('gameOverDraw') : state.score > state.opponentScore ? t('gameOverWin') : t('gameOverLoss');
  $('gameOverCopy').textContent = t('gameOverCopy');
  $('gameOverDialog').showModal();
  playTone('gameover');
}

async function startMatch(difficulty = state.difficulty) {
  if (pausedMatch) abandonPausedMatch('new_match');
  state.difficulty = difficulty;
  state.matchToken += 1;
  state.dealing = true;
  state.round = 0;
  state.lastDeal = false;
  $('gameOverDialog').open && $('gameOverDialog').close();
  showScreen('gameScreen');
  renderGame();
  await runShuffleAnimation(state.matchToken);
  if (state.matchToken !== Number(state.matchToken)) return;
  initializeMatch();
}

async function runShuffleAnimation(token) {
  if (token !== state.matchToken) return;
  $('shuffleOverlay').classList.remove('hidden');
  $('shuffleOverlay').classList.toggle('reduced-motion', !animationsEnabled());
  $('shuffleProgress').style.width = '0%';
  $('shuffleTitle').textContent = t('shuffleTitle');
  playTone('shuffle');
  const start = performance.now();
  const duration = animationsEnabled() ? 1900 : 680;
  await new Promise(resolve => {
    const tick = now => {
      if (token !== state.matchToken) { resolve(); return; }
      const pct = Math.min(100, ((now - start) / duration) * 100);
      $('shuffleProgress').style.width = `${pct}%`;
      if (pct < 100) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
  await delay(animationsEnabled() ? 160 : 90);
  $('shuffleOverlay').classList.add('hidden');
}

function initializeMatch() {
  state.nextStackId = 1;
  state.matchEvents = [];
  state.pendingDealSourceRect = null;
  state.lastRenderedTurn = null;
  state.lastRenderedScores = { player: null, opponent: null };
  state.animating = false;
  state.deck = shuffle(createDeck());
  state.tableStacks = deal(4).map(makeStack);
  state.hand = deal(6);
  state.opponentHand = deal(6);
  state.round = 1;
  state.lastDeal = state.deck.length === 0;
  state.score = 0;
  state.opponentScore = 0;
  state.captured = { player: [], opponent: [] };
  state.played = { player: [], opponent: [] };
  state.tableauMarkers = { player: [], opponent: [] };
  state.lastTaker = null;
  state.turn = Math.random() < 0.5 ? 'player' : 'opponent';
  state.message = state.turn === 'player' ? t('playerStarts') : t('botStarts');
  state.pendingPlay = null;
  state.pendingCaptureGroups = [];
  state.pendingSelection = [];
  state.pendingStackCard = null;
  state.waitingForTableau = false;
  state.dealing = false;
  renderGame();
  {
    state.animating = true;
    const deckRect = $('deckCounter')?.getBoundingClientRect() || null;
    state.visualAnimation = { kind:'deal', fromRect: deckRect, tableCount: 4, playerCount: 6, opponentCount: 6 };
    renderGame();
    window.setTimeout(() => { state.animating = false; renderGame(); }, motionDelay('deal'));
  }
  playTone('success');
  if (state.turn === 'opponent') window.setTimeout(() => opponentMove(state.matchToken), motionDelay('deal') + 70);
}

function pauseCurrentMatch() {
  if (state.turn === 'done' || state.turn === 'menu' || state.screen !== 'game') { goToMenu(); return; }
  const snapshot = {
    version: 1,
    expiresAt: Date.now() + PAUSE_WINDOW_MS,
    difficulty: state.difficulty,
    deck: state.deck,
    tableStacks: state.tableStacks,
    hand: state.hand,
    opponentHand: state.opponentHand,
    score: state.score,
    opponentScore: state.opponentScore,
    captured: state.captured,
    played: state.played,
    tableauMarkers: state.tableauMarkers,
    lastTaker: state.lastTaker,
    message: state.message,
    round: state.round,
    lastDeal: state.lastDeal,
    nextStackId: state.nextStackId,
    matchEvents: state.matchEvents,
    turn: state.turn,
    waitingForTableau: Boolean(state.waitingForTableau),
    pendingTableauCards: state.pendingTableauCards || [],
    selectedMode: state.selectedMode,
    pausedAt: Date.now(),
  };
  savePausedMatch(snapshot);
  addMatchEvent('system', t('pauseSaved'), 'pause');
  state.matchToken += 1;
  if ($('captureDialog').open) $('captureDialog').close();
  if ($('tableauDialog').open) $('tableauDialog').close();
  if ($('stackDialog').open) $('stackDialog').close();
  $('shuffleOverlay').classList.add('hidden');
  state.dealing = false;
  state.animating = false;
  state.draggingCardId = null;
  state.nativeDrag = null;
  state.visualAnimation = null;
  document.body.classList.remove('dragging-card','player-turn','opponent-turn','game-ended');
  $('tableZone')?.classList.remove('drop-target-ready','drop-target-active');
  state.turn = 'menu';
  state.message = '';
  showScreen('menuScreen');
  renderResumeBar();
}

function recordAbandonedMatch(snapshot, reason = 'timeout') {
  if (!snapshot || snapshot.abandonRecorded) return;
  const entry = {
    id: Date.now(),
    timestamp: Date.now(),
    mode: 'bot',
    difficulty: snapshot.difficulty,
    playerScore: snapshot.score,
    botScore: snapshot.opponentScore,
    opponentName: 'Bot',
    result: 'loss',
    winner: 'bot',
    abandoned: true,
    abandonReason: reason,
    events: Array.isArray(snapshot.matchEvents) ? snapshot.matchEvents.slice(-80) : [],
    date: new Date().toLocaleDateString(settings.language === 'en' ? 'en-GB' : 'ro-RO', { day:'2-digit', month:'2-digit' }),
  };
  battleHistory = [entry, ...battleHistory].slice(0, 8);
  saveBattleHistory();
  snapshot.abandonRecorded = true;
}

function abandonPausedMatch(reason = 'manual') {
  const snapshot = pausedMatch;
  if (!snapshot) return;
  recordAbandonedMatch(snapshot, reason);
  clearPausedMatch();
  renderProfile();
  renderBattleLog();
  if (reason === 'timeout') playTone('gameover'); else playTone('button');
}

function renderResumeBar() {
  const bar = $('resumeMatchBar');
  if (!bar) return;
  if (!pausedMatch) { bar.classList.add('hidden'); if (resumeTimer) { clearInterval(resumeTimer); resumeTimer = null; } return; }
  const update = () => {
    if (!pausedMatch) return;
    const remaining = Math.max(0, Number(pausedMatch.expiresAt) - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    if (remaining <= 0) {
      clearInterval(resumeTimer); resumeTimer = null;
      abandonPausedMatch('timeout');
      bar.classList.add('hidden');
      return;
    }
    $('resumeCountdown').textContent = String(seconds);
    bar.classList.toggle('expiring', seconds <= 3);
    bar.classList.remove('hidden');
  };
  update();
  if (resumeTimer) clearInterval(resumeTimer);
  resumeTimer = setInterval(update, 100);
}

function restoreMatchFromPause() {
  const snapshot = pausedMatch;
  if (!snapshot) return;
  if (Number(snapshot.expiresAt) <= Date.now()) { abandonPausedMatch('timeout'); return; }
  clearPausedMatch();
  state.matchToken += 1;
  state.difficulty = snapshot.difficulty || 'easy';
  state.deck = snapshot.deck || [];
  state.tableStacks = snapshot.tableStacks || [];
  state.hand = snapshot.hand || [];
  state.opponentHand = snapshot.opponentHand || [];
  state.score = Number(snapshot.score || 0);
  state.opponentScore = Number(snapshot.opponentScore || 0);
  state.captured = snapshot.captured || { player: [], opponent: [] };
  state.played = snapshot.played || { player: [], opponent: [] };
  state.tableauMarkers = snapshot.tableauMarkers || { player: [], opponent: [] };
  state.lastTaker = snapshot.lastTaker || null;
  state.message = snapshot.message || '';
  state.round = Number(snapshot.round || 1);
  state.lastDeal = Boolean(snapshot.lastDeal);
  state.nextStackId = Number(snapshot.nextStackId || 1);
  state.matchEvents = Array.isArray(snapshot.matchEvents) ? snapshot.matchEvents : [];
  state.turn = snapshot.turn === 'opponent' ? 'opponent' : 'player';
  state.waitingForTableau = Boolean(snapshot.waitingForTableau);
  state.pendingTableauCards = Array.isArray(snapshot.pendingTableauCards) ? snapshot.pendingTableauCards : [];
  state.pendingPlay = null;
  state.pendingCaptureGroups = [];
  state.pendingSelection = [];
  state.pendingStackCard = null;
  state.pendingPlaySourceRect = null;
  state.pendingDealSourceRect = null;
  state.visualAnimation = null;
  state.animating = false;
  state.dealing = false;
  state.selectedMode = snapshot.selectedMode || 'bot';
  state.message = state.message || (settings.language === 'en' ? 'Match resumed.' : 'Partida reluată.');
  addMatchEvent('system', settings.language === 'en' ? 'Match resumed.' : 'Partida reluată.', 'resume');
  showScreen('gameScreen');
  renderGame();
  if (state.waitingForTableau && state.pendingTableauCards.length) {
    window.setTimeout(() => openTableauChooser(state.pendingTableauCards), 70);
  } else if (state.turn === 'opponent') {
    window.setTimeout(() => opponentMove(state.matchToken), 260);
  }
}

function goToMenu() {
  state.matchToken += 1;
  if ($('captureDialog').open) $('captureDialog').close();
  if ($('tableauDialog').open) $('tableauDialog').close();
  if ($('stackDialog').open) $('stackDialog').close();
  if ($('gameOverDialog').open) $('gameOverDialog').close();
  $('shuffleOverlay').classList.add('hidden');
  state.dealing = false;
  state.animating = false;
  state.turn = 'menu';
  state.message = '';
  state.draggingCardId = null;
  state.nativeDrag = null;
  state.visualAnimation = null;
  document.body.classList.remove('dragging-card','player-turn','opponent-turn','game-ended');
  $('tableZone')?.classList.remove('drop-target-ready','drop-target-active');
  renderBattleLog();
  showScreen('menuScreen');
}

function updateSettingsUI() {
  document.documentElement.dataset.animations = settings.animations ? 'on' : 'off';
  const soundRow = $('soundToggle')?.closest('.setting-row');
  const soundLabel = soundRow?.querySelector('strong'); if(soundLabel) soundLabel.textContent = t('soundLabel');
  const soundCopy = soundRow?.querySelector('small'); if(soundCopy) soundCopy.textContent = `${t('soundCopy')} · ${t('volumeLabel')}`;
  $('soundToggle').textContent = settings.sound ? 'ON' : 'OFF';
  $('soundToggle').setAttribute('aria-pressed', String(settings.sound));
  const volumePct = Math.round((settings.volume ?? 0.85) * 100);
  $('soundVolume').value = String(volumePct);
  $('soundVolume').style.setProperty('--volume-pct', `${volumePct}%`);
  $('soundVolume').setAttribute('aria-valuetext', `${volumePct}%`);
  $('soundVolumeValue').textContent = `${volumePct}%`;
  $('animationToggle').textContent = settings.animations ? 'ON' : 'OFF';
  $('animationToggle').setAttribute('aria-pressed', String(settings.animations));
  const lang = $('languageSelect'); if (lang) lang.value = settings.language;
}
function openSettings() { updateSettingsUI(); $('settingsDialog').showModal(); }

function bootLoading() {
  const texts = [t('loading1'), t('loading2'), t('loading3')];
  const duration = 1400;
  const started = performance.now();
  const tick = now => {
    const pct = Math.min(100, ((now - started) / duration) * 100);
    $('loadingBarFill').style.width = `${pct}%`;
    $('loadingText').textContent = texts[Math.min(texts.length - 1, Math.floor(pct / 34))];
    if (pct < 100) requestAnimationFrame(tick);
    else setTimeout(() => showScreen('menuScreen'), 220);
  };
  requestAnimationFrame(tick);
}

$('menuPlayBtn').addEventListener('click', () => { playTone('button'); showScreen('modeScreen'); });
$('botModeBtn').addEventListener('click', () => { playTone('button'); showScreen('difficultyScreen'); });
$('modeBackBtn').addEventListener('click', () => { playTone('button'); showScreen('menuScreen'); });
$('difficultyBackBtn').addEventListener('click', () => { playTone('button'); showScreen('modeScreen'); });
document.querySelectorAll('.difficulty-card').forEach(btn => btn.addEventListener('click', () => { playTone('button'); void startMatch(btn.dataset.difficulty); }));
$('settingsBtn').addEventListener('click', () => { playTone('button'); openSettings(); });
$('gameSettingsBtn').addEventListener('click', () => { playTone('button'); openSettings(); });
$('closeSettingsBtn').addEventListener('click', () => { playTone('button'); $('settingsDialog').close(); });
$('soundToggle').addEventListener('click', () => { settings.sound = !settings.sound; saveSettings(); updateSettingsUI(); if (settings.sound) playTone('success'); else playTone('button'); });
$('soundVolume').addEventListener('input', event => { settings.volume = Math.min(1, Math.max(0, Number(event.target.value) / 100)); event.target.style.setProperty('--volume-pct', `${Math.round(settings.volume * 100)}%`); saveSettings(); $('soundVolumeValue').textContent = `${Math.round(settings.volume * 100)}%`; $('soundVolume').setAttribute('aria-valuetext', `${Math.round(settings.volume * 100)}%`); });
$('soundVolume').addEventListener('change', () => playTone('success'));
$('animationToggle').addEventListener('click', () => { settings.animations = !settings.animations; if (!settings.animations) { state.animating = false; } saveSettings(); updateSettingsUI(); playTone('button'); });
$('profileMenuBtn').addEventListener('click', () => { playTone('button'); openProfile(); });
$('closeProfileBtn').addEventListener('click', () => { playTone('button'); $('profileDialog').close(); });
$('saveProfileBtn').addEventListener('click', () => {
  profile.name = currentProfileName();
  saveProfile();
  renderProfile();
  $('profileDialog').close();
  playTone('success');
});
$('copyProfileIdBtn').addEventListener('click', async () => {
  try { await navigator.clipboard?.writeText(profile.id); } catch {}
  $('copyProfileIdBtn').textContent = t('copiedId');
  playTone('success');
  window.setTimeout(() => { if ($('copyProfileIdBtn')) $('copyProfileIdBtn').textContent = t('copyId'); }, 1200);
});
$('profileImageInput').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result || '');
    if (dataUrl.length > 900000) return;
    profile.avatar = { kind:'custom', dataUrl };
    saveProfile();
    renderProfile();
    playTone('success');
  };
  reader.readAsDataURL(file);
});
$('rulesMenuBtn').addEventListener('click', () => { playTone('button'); $('rulesDialog').showModal(); });
$('closeRulesBtn').addEventListener('click', () => { playTone('button'); $('rulesDialog').close(); });
$('gameMenuBtn').addEventListener('click', () => { playTone('button'); pauseCurrentMatch(); });
$('restartMatchBtn').addEventListener('click', () => { playTone('button'); void startMatch(state.difficulty); });
$('rejoinMatchBtn').addEventListener('click', () => { playTone('button'); restoreMatchFromPause(); });
$('abandonMatchBtn').addEventListener('click', () => { playTone('button'); abandonPausedMatch('manual'); });
$('gameOverMenuBtn').addEventListener('click', () => { playTone('button'); goToMenu(); });
$('gameOverRematchBtn').addEventListener('click', () => { playTone('button'); $('gameOverDialog').close(); void startMatch(state.difficulty); });
$('cancelCaptureBtn').addEventListener('click', () => { playTone('button'); closeCaptureChooser(); });
$('captureConfirmBtn').addEventListener('click', () => { playTone('button'); confirmCapture(); });
$('cancelStackBtn').addEventListener('click', () => { playTone('button'); state.pendingStackCard = null; $('stackDialog').close(); });
$('tableauDialog').addEventListener('cancel', event => event.preventDefault());

$('openHistoryBtn').addEventListener('click', () => { playTone('button'); renderHistoryEntries(); $('historyDialog').showModal(); });
$('closeHistoryBtn').addEventListener('click', () => { playTone('button'); $('historyDialog').close(); });
$('languageSelect').addEventListener('change', event => { settings.language = event.target.value === 'en' ? 'en' : 'ro'; saveSettings(); applyLanguage(); playTone('success'); });

$('tableZone').addEventListener('dragover', event => {
  if (!state.nativeDrag?.card || state.turn !== 'player') return;
  event.preventDefault();
  $('tableZone').classList.add('drop-target-active');
  try { event.dataTransfer.dropEffect = 'move'; } catch {}
});
$('tableZone').addEventListener('dragleave', () => $('tableZone').classList.remove('drop-target-active'));
$('tableZone').addEventListener('drop', event => {
  event.preventDefault();
  $('tableZone').classList.remove('drop-target-ready','drop-target-active');
  const drag = state.nativeDrag;
  if (!drag?.card) return;
  const source = drag.fromRect;
  state.nativeDrag = null;
  state.draggingCardId = null;
  document.body.classList.remove('dragging-card');
  forcePlaceCard(drag.card, source);
});

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredPrompt = event;
  $('menuInstallBtn').hidden = false;
});
$('menuInstallBtn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('menuInstallBtn').hidden = true;
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

applyLanguage();
dialogElements().forEach(dialog => {
  dialog.addEventListener('close', syncModalScrollLock);
});
if (document.body) {
  modalScrollObserver.observe(document.body, { subtree:true, attributes:true, attributeFilter:['open'] });
  document.addEventListener('wheel', preventBackgroundScroll, { passive:false });
  document.addEventListener('touchmove', preventBackgroundScroll, { passive:false });
  document.addEventListener('wheel', preventMainMenuScroll, { passive:false });
  document.addEventListener('touchmove', preventMainMenuScroll, { passive:false });
  syncModalScrollLock();
}

renderBattleLog();
renderHistoryEntries();
renderProfile();
renderResumeBar();
bootLoading();
