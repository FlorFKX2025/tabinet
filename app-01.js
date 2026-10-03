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
  const value = ($('profileNameInput')?.value || '').trim().replace(/s+/g,' ');
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