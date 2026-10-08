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
  pvpMatchId: null,
  pvpMatchVersion: 0,
  pvpOpponent: null,
  pvpTerminalHandled: false,
  pvpAbandonExpiresAt: null,
  pvpAbandonBy: null,
  pvpLeavingMatchId: null,
  pvpRematchPending: false,
};

const $ = (id) => document.getElementById(id);
const rules = window.TabinetRules;
let deferredPrompt = null;
let audioContext = null;

const USER_DATA_KEY = 'tabinet-user-data-v1';
const STABLE_PLAYER_ID_KEY = 'tabinet-player-id-v1';
const STABLE_DEVICE_TOKEN_KEY = 'tabinet-device-token-v1';

function loadUserDataSnapshot() {
  try {
    const raw = localStorage.getItem(USER_DATA_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

function saveUserDataSnapshot(patch = {}) {
  try {
    const current = loadUserDataSnapshot();
    const next = { version: 1, ...current, ...patch };
    localStorage.setItem(USER_DATA_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

const TABINET_SUPABASE_URL = 'https://jiducklriavzbiiwffjc.supabase.co';
const TABINET_SUPABASE_KEY = 'sb_publishable_tU3A1oB0B0G-CjC1SBRUQg_oiI-GoSA';
const tabinetSupabase = window.supabase && window.supabase.createClient ? window.supabase.createClient(TABINET_SUPABASE_URL, TABINET_SUPABASE_KEY) : null;
let friendsRefreshTimer = null;
let friendsHeartbeatTimer = null;
let friendsBackgroundRefreshTimer = null;
let pvpDashboardTimer = null;
let pvpAbandonTimer = null;
let pvpActionBusy = false;
window.__tabinetPvpDashboard = { incoming_invites: [], outgoing_invites: [], queue_waiting: false, active_match: null };

function getFriendsDeviceToken() {
  try {
    const stable = localStorage.getItem(STABLE_DEVICE_TOKEN_KEY);
    if (stable) return stable;
  } catch {}
  const stored = loadUserDataSnapshot().friendsDeviceToken;
  if (stored) {
    try { localStorage.setItem(STABLE_DEVICE_TOKEN_KEY, stored); } catch {}
    return stored;
  }
  const token = (crypto && crypto.randomUUID ? crypto.randomUUID() : 'device-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  try { localStorage.setItem(STABLE_DEVICE_TOKEN_KEY, token); } catch {}
  saveUserDataSnapshot({ friendsDeviceToken: token });
  return token;
}

async function tabinetRpc(fn, args) {
  if (!tabinetSupabase) throw new Error('backend_unavailable');
  const result = await tabinetSupabase.rpc(fn, args || {});
  if (result.error) throw result.error;
  return result.data;
}

function friendAvatarMarkup(avatar) {
  if (avatar && avatar.kind === 'custom' && avatar.dataUrl) {
    return '<span class="friend-avatar"><img src="' + escapeHtml(avatar.dataUrl) + '" alt=""></span>';
  }
  const glyphs = { '01':'♟','02':'♣','03':'♟','04':'◈','05':'✦','06':'♟' };
  return '<span class="friend-avatar">' + (glyphs[String(avatar && avatar.id || '01')] || '♟') + '</span>';
}

function friendLastSeenText(lastSeen, isOnline) {
  if (isOnline) return t('friendOnline');
  const time = lastSeen ? new Date(lastSeen) : null;
  if (!time || Number.isNaN(time.getTime())) return t('friendOffline');
  const mins = Math.max(0, Math.floor((Date.now() - time.getTime()) / 60000));
  if (mins < 1) return t('friendLastSeenNow');
  if (mins < 60) return t('friendLastSeenMinutes').replace('{n}', String(mins));
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('friendLastSeenHours').replace('{n}', String(hours));
  return t('friendLastSeenDays').replace('{n}', String(Math.floor(hours / 24)));
}

function renderFriendRequests(requests) {
  const list=$('friendRequestsList'), count=$('friendsRequestsCount'), badge=$('friendsPendingBadge');
  const rows=Array.isArray(requests)?requests:[];
  if(count) count.textContent=String(rows.length);
  if(badge){badge.textContent=String(rows.length);badge.classList.toggle('hidden',rows.length===0);}
  if(!list)return;
  list.innerHTML='';
  if(!rows.length){list.innerHTML='<div class="friends-empty">'+escapeHtml(t('friendNoRequests'))+'</div>';renderFriendRequestNotification([]);return;}
  rows.forEach(req=>{
    const row=document.createElement('article');row.className='friend-request-row';
    row.innerHTML='<div class="friend-user">'+friendAvatarMarkup(req.avatar)+'<div class="friend-user-copy"><strong>'+escapeHtml(req.name||'Jucător')+'</strong><small>'+escapeHtml(req.player_id||'')+'</small></div></div><div class="friend-request-actions"><button class="primary small-btn friend-accept" type="button" data-request-id="'+escapeHtml(req.id)+'">'+escapeHtml(t('friendAccept'))+'</button><button class="secondary small-btn friend-reject" type="button" data-request-id="'+escapeHtml(req.id)+'">'+escapeHtml(t('friendReject'))+'</button></div>';
    list.appendChild(row);
  });
  renderFriendRequestNotification(rows);
}

function renderFriendsList(friends) {
  const list=$('friendsList'), count=$('friendsListCount'), rows=Array.isArray(friends)?friends:[];
  window.__tabinetFriends=rows;
  if(count) count.textContent=String(rows.length);
  const onlineCount = rows.filter(item => Boolean(item.online)).length;
  const onlineEl = $('friendsOnlineCount');
  if (onlineEl) onlineEl.textContent = String(onlineCount);
  if(!list)return;
  list.innerHTML='';
  if(!rows.length){list.innerHTML='<div class="friends-empty">'+escapeHtml(t('friendNoFriends'))+'</div>';return;}
  rows.forEach(friend=>{
    const online=Boolean(friend.online), row=document.createElement('article');
    row.className='friend-row';row.dataset.playerId=friend.player_id||'';
    row.innerHTML='<div class="friend-user">'+friendAvatarMarkup(friend.avatar)+'<div class="friend-user-copy"><strong>'+escapeHtml(friend.name||'Jucător')+'</strong><small>'+escapeHtml(friend.player_id||'')+'</small></div></div><div class="friend-row-actions"><span class="friend-status '+(online?'online':'offline')+'"><i></i>'+escapeHtml(friendLastSeenText(friend.last_seen,online))+'</span><button class="secondary small-btn friend-view" type="button" data-player-id="'+escapeHtml(friend.player_id||'')+'">'+escapeHtml(t('friendViewProfile'))+'</button><button class="danger small-btn friend-delete" type="button" data-player-id="'+escapeHtml(friend.player_id||'')+'">'+escapeHtml(t('friendDelete'))+'</button></div>';
    list.appendChild(row);
  });
}

function renderFriendRequestNotification(requests) {
  const box=$('friendRequestNotification'); if(!box)return;
  const rows=Array.isArray(requests)?requests:[];
  if(!rows.length){box.classList.add('hidden');box.innerHTML='';return;}
  const req=rows[0];
  box.classList.remove('hidden');
  box.innerHTML='<div class="friend-notification-copy"><span class="friend-notification-kicker">'+escapeHtml(t('friendNotificationKicker'))+'</span><strong>'+escapeHtml(req.name||'Jucător')+'</strong><small>'+escapeHtml(t('friendNotificationCopy'))+'</small></div><div class="friend-notification-actions"><button class="primary small-btn friend-notify-accept" type="button" data-request-id="'+escapeHtml(req.id)+'">'+escapeHtml(t('friendAccept'))+'</button><button class="secondary small-btn friend-notify-reject" type="button" data-request-id="'+escapeHtml(req.id)+'">'+escapeHtml(t('friendReject'))+'</button></div>';
}

function renderFriendProfileEmpty(messageKey) {
  const recent = $('friendProfileRecentMatches');
  if (recent) recent.innerHTML = '<div class="profile-empty">' + escapeHtml(t(messageKey)) + '</div>';
  if ($('friendProfileWinRate')) $('friendProfileWinRate').textContent = '0%';
  if ($('friendProfile12h')) $('friendProfile12h').textContent = '0';
  if ($('friendProfileTotal')) $('friendProfileTotal').textContent = '0';
}

function renderFriendAvatar(el, avatar) {
  if (!el) return;
  el.innerHTML = friendAvatarMarkup(avatar);
}

function renderFriendProfileData(data) {
  const p = data?.profile || {};
  const stats = data?.stats || {};
  const recentMatches = Array.isArray(data?.recent_matches) ? data.recent_matches : [];
  renderFriendAvatar($('friendProfileAvatar'), p.avatar);
  $('friendProfileName').textContent = p.name || 'Jucător';
  $('friendProfileId').textContent = p.player_id || '';
  const online = Boolean(p.online ?? (p.last_seen && Date.now() - new Date(p.last_seen).getTime() < 75000));
  if ($('friendProfileStatus')) {
    $('friendProfileStatus').textContent = friendLastSeenText(p.last_seen, online);
    $('friendProfileStatus').className = 'friend-status ' + (online ? 'online' : 'offline');
  }
  if ($('friendProfileWinRate')) $('friendProfileWinRate').textContent = String(stats.win_rate ?? 0) + '%';
  if ($('friendProfile12h')) $('friendProfile12h').textContent = String(stats.last_12h ?? 0);
  if ($('friendProfileTotal')) $('friendProfileTotal').textContent = String(stats.matches ?? 0);
  const recent = $('friendProfileRecentMatches');
  if (!recent) return;
  recent.innerHTML = '';
  if (!recentMatches.length) {
    recent.innerHTML = '<div class="profile-empty">' + escapeHtml(t('friendProfileNoMatches')) + '</div>';
    return;
  }
  recentMatches.slice(0,3).forEach(match => {
    const item = document.createElement('div');
    item.className = 'profile-recent-row';
    const outcome = match.result === 'draw' ? 'draw' : match.result === 'win' ? 'win' : 'loss';
    const result = outcome === 'draw' ? t('draw') : outcome === 'win' ? t('profileWin') : t('profileLoss');
    const difficulty = match.difficulty ? difficultyLabel(match.difficulty) : '';
    const when = match.played_at ? new Date(match.played_at).toLocaleDateString(settings.language === 'en' ? 'en-GB' : 'ro-RO', {day:'2-digit',month:'2-digit'}) : t('dateNow');
    item.innerHTML = '<div><span class="battle-mode bot-mode">' + escapeHtml(t('botMode')) + '</span><strong>' + escapeHtml(difficulty) + '</strong></div>' +
      '<div class="profile-recent-right"><strong>' + escapeHtml(String(match.player_score ?? 0) + ' — ' + String(match.bot_score ?? 0)) + '</strong><small>' + escapeHtml(when + ' · ' + result) + '</small></div>';
    recent.appendChild(item);
  });
}

async function openFriendProfile(playerId) {
  const friend=(window.__tabinetFriends||[]).find(item=>String(item.player_id).toUpperCase()===String(playerId).toUpperCase());
  if(!friend)return;
  const dialog=$('friendProfileDialog');if(!dialog)return;

  window.__reopenFriendsAfterProfile = Boolean($('friendsDialog')?.open);
  closeFriendsTimers();
  if ($('friendsDialog')?.open) $('friendsDialog').close();

  dialog.showModal();
  renderFriendProfileData({profile:friend,stats:{},recent_matches:[]});
  renderFriendProfileEmpty('friendProfileLoading');
  requestAnimationFrame(()=>{
    dialog.querySelector('.dialog-focus-sentinel')?.focus({preventScroll:true});
  });

  try {
    const result=await tabinetRpc('tabinet_get_friend_profile',{
      p_viewer_player_id:profile.id,
      p_device_token:getFriendsDeviceToken(),
      p_target_player_id:friend.player_id
    });
    if (dialog.open && result?.ok) renderFriendProfileData(result);
    else if (dialog.open) renderFriendProfileEmpty('friendProfileError');
  } catch {
    if (dialog.open) renderFriendProfileEmpty('friendProfileError');
  }
}

function openDeleteFriendWarning(playerId){
  const friend=(window.__tabinetFriends||[]).find(item=>String(item.player_id).toUpperCase()===String(playerId).toUpperCase());
  if(!friend)return;
  const dialog=$('deleteFriendDialog');if(!dialog)return;
  $('deleteFriendName').textContent=friend.name||'Jucător';
  $('deleteFriendStatus').textContent='';
  dialog.dataset.playerId=friend.player_id||'';
  dialog.showModal();
  requestAnimationFrame(()=>dialog.querySelector('.dialog-focus-sentinel')?.focus({preventScroll:true}));
}

async function deleteFriend(playerId){
  try{
    const result=await tabinetRpc('tabinet_delete_friend',{p_player_id:profile.id,p_friend_player_id:playerId,p_device_token:getFriendsDeviceToken()});
    if(result&&result.ok){$('deleteFriendDialog')?.close();syncModalScrollLock();await refreshFriendsData();}
  }catch{
    const status=$('deleteFriendStatus');if(status)status.textContent=t('friendBackendError');
  }
}

async function syncProfileOnline() {
  if (!tabinetSupabase) return;
  try {
    await tabinetRpc('tabinet_upsert_profile', {
      p_player_id: profile.id,
      p_name: profile.name,
      p_avatar: profile.avatar || {kind:'template',id:'01'},
      p_device_token: getFriendsDeviceToken()
    });
  } catch {}
}

async function refreshFriendsData(){
  if(!tabinetSupabase)return;
  try{
    await tabinetRpc('tabinet_heartbeat',{p_player_id:profile.id,p_device_token:getFriendsDeviceToken()});
    const results=await Promise.all([
      tabinetRpc('tabinet_list_friends',{p_player_id:profile.id,p_device_token:getFriendsDeviceToken()}),
      tabinetRpc('tabinet_list_requests',{p_player_id:profile.id,p_device_token:getFriendsDeviceToken()})
    ]);
    const friends=results[0]?.friends||[], requests=results[1]?.requests||[];
    window.__tabinetFriends=Array.isArray(friends)?friends:[];
    window.__tabinetFriendRequests=Array.isArray(requests)?requests:[];
    renderFriendsList(window.__tabinetFriends);
    renderFriendRequests(window.__tabinetFriendRequests);
    refreshFriendSearchResult();
  }catch{}
}

function openFriends() {
  const dialog = $('friendsDialog');
  if (!dialog) return;
  dialog.showModal();
  requestAnimationFrame(() => dialog.querySelector('.dialog-focus-sentinel')?.focus({preventScroll:true}));
  void refreshFriendsData();
  if (friendsRefreshTimer) clearInterval(friendsRefreshTimer);
  friendsRefreshTimer = setInterval(() => { if (dialog.open) void refreshFriendsData(); }, 1500);
}

function closeFriendsTimers() {
  if (friendsRefreshTimer) { clearInterval(friendsRefreshTimer); friendsRefreshTimer = null; }
}

function openFriendSearch() {
  const dialog = $('friendSearchDialog'), input = $('friendSearchInput');
  if (!dialog || !input) return;
  $('friendSearchStatus').textContent = '';
  $('friendSearchResult').innerHTML = '';
  $('friendSearchResult').classList.add('hidden');
  input.value = '';
  dialog.showModal();
  requestAnimationFrame(() => input.focus({preventScroll:true}));
}

function friendSearchRelationshipStatus(targetPlayerId) {
  const target = String(targetPlayerId || '').toUpperCase();
  if (!target) return 'none';
  if (target === String(profile.id).toUpperCase()) return 'self';
  if ((window.__tabinetFriends || []).some(item => String(item.player_id).toUpperCase() === target)) return 'friends';
  if ((window.__tabinetFriendRequests || []).some(item => String(item.player_id).toUpperCase() === target)) return 'incoming_pending';
  return 'none';
}

async function renderFriendSearchCard(p) {
  const box = $('friendSearchResult');
  if (!box) return;
  const online = Boolean(p.last_seen && Date.now() - new Date(p.last_seen).getTime() < 75000);
  let relation = friendSearchRelationshipStatus(p.player_id);
  try {
    const live = await tabinetRpc('tabinet_get_friend_status', {
      p_viewer_player_id: profile.id,
      p_device_token: getFriendsDeviceToken(),
      p_target_player_id: p.player_id
    });
    if (live?.ok) relation = live.status || relation;
  } catch {}
  const actionLabel = relation === 'friends'
    ? t('friendAccepted')
    : relation === 'incoming_pending'
      ? t('friendIncoming')
      : relation === 'outgoing_pending'
        ? t('friendSent')
        : relation === 'self'
          ? t('friendThisIsYou')
          : t('friendAdd');
  const disabled = relation !== 'none';
  box.classList.remove('hidden');
  box.innerHTML =
    '<div class="friend-search-profile">' + friendAvatarMarkup(p.avatar) +
    '<div><strong>' + escapeHtml(p.name || 'Jucător') + '</strong><small>' + escapeHtml(p.player_id || '') + '</small>' +
    '<div class="friend-row-meta"><span class="friend-status ' + (online ? 'online' : 'offline') + '"><i></i>' + escapeHtml(friendLastSeenText(p.last_seen, online)) + '</span></div></div></div>' +
    '<div class="friend-search-actions">' +
    '<button class="secondary small-btn friend-search-close-result" type="button">' + escapeHtml(t('friendsCloseSearch')) + '</button>' +
    '<button class="primary small-btn friend-search-add-result" type="button" data-player-id="' + escapeHtml(p.player_id || '') + '" ' + (disabled ? 'disabled' : '') + '>' + escapeHtml(actionLabel) + '</button></div>';
}

function refreshFriendSearchResult() {
  const input = $('friendSearchInput');
  const box = $('friendSearchResult');
  const target = input?.value?.trim().toUpperCase();
  const cached = window.__tabinetFriendSearchProfile;
  if (!box || box.classList.contains('hidden') || !cached || !target) return;
  if (String(cached.player_id).toUpperCase() !== target) return;
  void renderFriendSearchCard(cached);
}

function searchFriendById() {
  const raw = String($('friendSearchInput').value || '').trim().toUpperCase();
  if (!raw) { $('friendSearchStatus').textContent = t('friendEnterId'); return; }
  $('friendSearchStatus').textContent = t('friendSearching');
  void tabinetRpc('tabinet_search_player', {p_player_id:raw})
    .then(async result => {
      $('friendSearchStatus').textContent = '';
      const box = $('friendSearchResult');
      if (!result || !result.found) {
        window.__tabinetFriendSearchProfile = null;
        box.classList.remove('hidden');
        box.innerHTML = '<div class="friends-empty">' + escapeHtml(t('friendNotFound')) + '</div>';
        return;
      }
      const p = result.profile || {};
      window.__tabinetFriendSearchProfile = p;
      await renderFriendSearchCard(p);
    })
    .catch(() => { $('friendSearchStatus').textContent = t('friendBackendError'); });
}

function respondToFriendRequest(requestId, accept) {
  return tabinetRpc('tabinet_respond_friend_request', {
    p_request_id:requestId, p_accept:Boolean(accept), p_player_id:profile.id, p_device_token:getFriendsDeviceToken()
  }).then(result => { if (result && result.ok) return refreshFriendsData(); });
}


function isPvpMode() { return state.selectedMode === 'pvp'; }
function pvpOpponentName() { return state.pvpOpponent?.name || (settings.language === 'en' ? 'Player' : 'Jucător'); }
function pvpOpponentId() { return state.pvpOpponent?.player_id || ''; }
function pvpClone(value) { try { return JSON.parse(JSON.stringify(value)); } catch { return value; } }

function serializePvpState() {
  return {
    version:1, owner_player_id:profile.id, deck:pvpClone(state.deck), tableStacks:pvpClone(state.tableStacks),
    hand:pvpClone(state.hand), opponentHand:pvpClone(state.opponentHand), score:Number(state.score||0),
    opponentScore:Number(state.opponentScore||0), captured:pvpClone(state.captured), played:pvpClone(state.played),
    tableauMarkers:pvpClone(state.tableauMarkers), lastTaker:state.lastTaker, message:state.message||'',
    round:Number(state.round||1), lastDeal:Boolean(state.lastDeal), nextStackId:Number(state.nextStackId||1),
    matchEvents:pvpClone(Array.isArray(state.matchEvents)?state.matchEvents.slice(-80):[])
  };
}

function applyPvpMatchState(match) {
  if (!match?.state) return false;
  const wasRemoteApply = state.pvpMatchVersion > 0 && Number(match.version || 0) > Number(state.pvpMatchVersion || 0);
  const payload=match.state;
  const ownerIsMe=String(payload.owner_player_id||'').toUpperCase()===String(profile.id||'').toUpperCase();
  state.deck=pvpClone(payload.deck||[]);
  state.tableStacks=pvpClone(payload.tableStacks||[]);
  state.hand=pvpClone(ownerIsMe?(payload.hand||[]):(payload.opponentHand||[]));
  state.opponentHand=pvpClone(ownerIsMe?(payload.opponentHand||[]):(payload.hand||[]));
  state.score=Number(ownerIsMe?payload.score:payload.opponentScore)||0;
  state.opponentScore=Number(ownerIsMe?payload.opponentScore:payload.score)||0;
  const captured=payload.captured||{player:[],opponent:[]}, played=payload.played||{player:[],opponent:[]}, markers=payload.tableauMarkers||{player:[],opponent:[]};
  state.captured=ownerIsMe?pvpClone(captured):{player:pvpClone(captured.opponent||[]),opponent:pvpClone(captured.player||[])};
  state.played=ownerIsMe?pvpClone(played):{player:pvpClone(played.opponent||[]),opponent:pvpClone(played.player||[])};
  state.tableauMarkers=ownerIsMe?pvpClone(markers):{player:pvpClone(markers.opponent||[]),opponent:pvpClone(markers.player||[])};
  state.lastTaker=ownerIsMe?payload.lastTaker:payload.lastTaker==='player'?'opponent':payload.lastTaker==='opponent'?'player':payload.lastTaker;
  state.message=String(payload.message||''); state.round=Number(payload.round||1); state.lastDeal=Boolean(payload.lastDeal);
  state.nextStackId=Number(payload.nextStackId||1); state.matchEvents=Array.isArray(payload.matchEvents)?pvpClone(payload.matchEvents):[];
  state.pendingPlay=null; state.pendingCaptureGroups=[]; state.pendingSelection=[]; state.pendingStackCard=null; state.pendingPlaySourceRect=null;
  state.pendingTableauCards=[]; state.waitingForTableau=false; state.dealing=false; state.animating=false;
  state.pvpMatchVersion=Number(match.version||0);
  state.pvpAbandonExpiresAt=match.status==='abandon_pending' ? (match.abandon_expires_at || null) : null;
  state.pvpAbandonBy=match.status==='abandon_pending' ? (match.abandoned_by || null) : null;
  const turnId=String(match.turn_player_id||'').toUpperCase();
  state.turn=turnId===String(profile.id||'').toUpperCase()?'player':'opponent';
  if(match.status!=='active') state.turn='done';
  ['captureDialog','tableauDialog','stackDialog'].forEach(id=>{if($(id)?.open)$(id).close();});
  renderGame();
  if (wasRemoteApply) {
    const zone=$('tableZone');
    if (zone) { zone.classList.remove('pvp-remote-update'); void zone.offsetWidth; zone.classList.add('pvp-remote-update'); window.setTimeout(()=>zone.classList.remove('pvp-remote-update'),520); }
  }
  return true;
}

async function fetchPvpMatch(matchId){
  if(!matchId)return null;
  const result=await tabinetRpc('tabinet_get_pvp_match',{p_match_id:matchId,p_player_id:profile.id,p_device_token:getFriendsDeviceToken()});
  return result?.ok?result.match:null;
}
function pvpTurnPlayerId(){return state.turn==='player'?profile.id:pvpOpponentId();}
function pvpWinnerFromLocalState(){return state.score===state.opponentScore?null:state.score>state.opponentScore?profile.id:pvpOpponentId();}

async function syncPvpInitialize(){
  if(!isPvpMode()||!state.pvpMatchId)return;
  try{
    const result=await tabinetRpc('tabinet_initialize_pvp_match',{p_match_id:state.pvpMatchId,p_player_id:profile.id,p_device_token:getFriendsDeviceToken(),p_state:serializePvpState(),p_turn_player_id:pvpTurnPlayerId()});
    if(result?.ok)state.pvpMatchVersion=Number(result.version||1);
    else {const latest=await fetchPvpMatch(state.pvpMatchId);if(latest?.state)applyPvpMatchState(latest);}
  }catch{}
}

async function syncPvpState(status='active',winnerId=null){
  if(!isPvpMode()||!state.pvpMatchId)return;
  try{
    const result=await tabinetRpc('tabinet_update_pvp_match',{
      p_match_id:state.pvpMatchId,p_player_id:profile.id,p_device_token:getFriendsDeviceToken(),p_state:serializePvpState(),
      p_turn_player_id:status==='active'?pvpTurnPlayerId():null,p_status:status,p_winner_player_id:winnerId,p_expected_version:Number(state.pvpMatchVersion||0)
    });
    if(result?.ok)state.pvpMatchVersion=Number(result.version||state.pvpMatchVersion);
    else if(result?.error==='version_conflict'||result?.error==='not_your_turn'){const latest=await fetchPvpMatch(state.pvpMatchId);if(latest?.state)applyPvpMatchState(latest);}
  }catch{}
}

function recordPvpBattleResult(abandoned=false,winnerId=null){
  if(state.pvpTerminalHandled)return;
  const winner=winnerId||pvpWinnerFromLocalState();
  const result=winner===null?'draw':winner===profile.id?'win':'loss';
  battleHistory=[{
    id:Date.now(),timestamp:Date.now(),mode:'player',difficulty:null,playerScore:Number(state.score||0),botScore:Number(state.opponentScore||0),
    opponentName:pvpOpponentName(),result,winner:result==='draw'?'draw':winner===profile.id?'player':'opponent',abandoned:Boolean(abandoned),
    events:Array.isArray(state.matchEvents)?state.matchEvents.slice(-80):[],
    date:new Date().toLocaleDateString(settings.language==='en'?'en-GB':'ro-RO',{day:'2-digit',month:'2-digit'})
  },...battleHistory].slice(0,8);
  saveBattleHistory(); state.pvpTerminalHandled=true; renderBattleLog(); renderHistoryEntries(); renderProfile();
}

async function showPvpTerminal(match,suppressDialog=false){
  if(!match||match.id!==state.pvpMatchId||state.pvpTerminalHandled)return;
  if(match.state)applyPvpMatchState(match);
  state.pvpAbandonExpiresAt=null;state.pvpAbandonBy=null;state.pvpLeavingMatchId=null;
  state.turn='done';state.dealing=false;state.animating=false;
  const winner=String(match.winner_player_id||'').toUpperCase(),mine=String(profile.id||'').toUpperCase();
  const isDraw=!winner,iWon=!isDraw&&winner===mine,abandoned=match.status==='abandoned';
  const resultKind=isDraw?'draw':iWon?'victory':'defeat';
  state.message=abandoned?(iWon?t('pvpWonAbandoned'):t('pvpLostAbandoned')):(isDraw?t('gameOverDraw'):iWon?t('pvpWon'):t('pvpLost'));
  renderGame();
  recordPvpBattleResult(abandoned,match.winner_player_id||pvpWinnerFromLocalState());
  if(suppressDialog)return;
  $('finalPlayerScore').textContent=state.score;$('finalBotScore').textContent=state.opponentScore;
  $('finalBotLabel').textContent=pvpOpponentName();
  $('gameOverTitle').textContent=abandoned?(iWon?t('pvpWonAbandoned'):t('pvpLostAbandoned')):(isDraw?t('gameOverDraw'):iWon?t('gameOverWin'):t('pvpLost'));
  $('gameOverCopy').textContent=abandoned?t('pvpAbandonedCopy'):t('pvpFinishedCopy');
  $('gameOverRematchBtn').disabled=false;$('gameOverRematchBtn').textContent=t('pvpRematch');state.pvpRematchPending=false;
  if(!$('gameOverDialog').open)$('gameOverDialog').showModal();
  playTone(resultKind);
}
async function enterPvpMatch(matchId){
  if(!matchId||pvpActionBusy)return;
  clearPausedMatch();pvpActionBusy=true;
  try{
    const match=await fetchPvpMatch(matchId);if(!match)return;
    state.selectedMode='pvp';state.pvpMatchId=match.id;state.pvpMatchVersion=Number(match.version||0);
    state.pvpOpponent=match.opponent||null;state.pvpTerminalHandled=false;state.pvpLeavingMatchId=null;state.pvpRematchPending=false;
    $('gameOverDialog')?.close();
    if(match.status==='abandoned'||match.status==='completed'){await showPvpTerminal(match);return;}
    if(match.status==='abandon_pending'){
      if(match.state)applyPvpMatchState(match);
      state.pvpAbandonExpiresAt=match.abandon_expires_at||null;state.pvpAbandonBy=match.abandoned_by||null;state.turn='done';
      showScreen('gameScreen');renderGame();return;
    }
    if(match.state){applyPvpMatchState(match);showScreen('gameScreen');return;}
    const token=++state.matchToken;
    state.turn='menu';state.dealing=true;state.animating=false;state.deck=[];state.hand=[];state.opponentHand=[];state.tableStacks=[];
    showScreen('gameScreen');renderGame();await runShuffleAnimation(token);if(token!==state.matchToken)return;
    const latest=await fetchPvpMatch(matchId);if(!latest)return;state.pvpOpponent=latest.opponent||state.pvpOpponent;
    if(latest.status==='abandoned'||latest.status==='completed'){await showPvpTerminal(latest);return;}
    if(latest.status==='abandon_pending'){
      if(latest.state)applyPvpMatchState(latest);
      state.pvpAbandonExpiresAt=latest.abandon_expires_at||null;state.pvpAbandonBy=latest.abandoned_by||null;state.turn='done';renderGame();return;
    }
    if(latest.state){applyPvpMatchState(latest);showScreen('gameScreen');}else initializeMatch();
  }finally{pvpActionBusy=false;}
}
function renderPvpInviteNotification(requests){
  const box=$('pvpInviteNotification');if(!box)return;const rows=Array.isArray(requests)?requests:[];
  if(!rows.length||state.screen==='game'){box.classList.add('hidden');box.innerHTML='';return;}
  box.classList.remove('hidden');
  box.innerHTML=rows.slice(0,3).map(req=>'<article class="pvp-invite-item"><div class="pvp-invite-copy"><span class="pvp-invite-kicker">'+escapeHtml(t('pvpInviteKicker'))+'</span><strong>'+escapeHtml(req.name||'Jucător')+'</strong><small>'+escapeHtml(t('pvpInviteCopy'))+'</small></div><div class="pvp-invite-actions"><button class="primary small-btn pvp-invite-accept" type="button" data-invite-id="'+escapeHtml(req.id||'')+'">'+escapeHtml(t('pvpAccept'))+'</button><button class="secondary small-btn pvp-invite-reject" type="button" data-invite-id="'+escapeHtml(req.id||'')+'">'+escapeHtml(t('pvpReject'))+'</button></div></article>').join('');
}
function renderPvpRematchNotification(requests){
  const box=$('pvpRematchNotification');if(!box)return;const rows=Array.isArray(requests)?requests:[];
  if(!rows.length||state.screen==='game'){box.classList.add('hidden');box.innerHTML='';return;}
  box.classList.remove('hidden');
  box.innerHTML=rows.slice(0,3).map(req=>'<article class="pvp-invite-item rematch-invite-item"><div class="pvp-invite-copy"><span class="pvp-invite-kicker">'+escapeHtml(t('pvpRematchKicker'))+'</span><strong>'+escapeHtml(req.name||'Jucător')+'</strong><small>'+escapeHtml(t('pvpRematchCopy'))+'</small></div><div class="pvp-invite-actions"><button class="primary small-btn pvp-rematch-accept" type="button" data-rematch-id="'+escapeHtml(req.id||'')+'">'+escapeHtml(t('pvpAccept'))+'</button><button class="secondary small-btn pvp-rematch-reject" type="button" data-rematch-id="'+escapeHtml(req.id||'')+'">'+escapeHtml(t('pvpReject'))+'</button></div></article>').join('');
}
function pvpOutgoingSet(){return new Set((window.__tabinetPvpDashboard?.outgoing_invites||[]).map(item=>String(item.player_id||'').toUpperCase()));}
function renderPvpFriends(){
  const list=$('pvpFriendsList');if(!list)return;const friends=Array.isArray(window.__tabinetFriends)?window.__tabinetFriends:[],outgoing=pvpOutgoingSet();list.innerHTML='';
  if($('pvpFriendsCount'))$('pvpFriendsCount').textContent=String(friends.length);
  if($('pvpFriendsOnlineCount'))$('pvpFriendsOnlineCount').textContent=String(friends.filter(friend=>friend.online).length);
  if(!friends.length){list.innerHTML='<div class="friends-empty">'+escapeHtml(t('pvpNoFriends'))+'</div>';return;}
  friends.forEach(friend=>{
    const key=String(friend.player_id||'').toUpperCase(),pending=outgoing.has(key),invite=(window.__tabinetPvpDashboard?.outgoing_invites||[]).find(x=>String(x.player_id||'').toUpperCase()===key);
    const action=pending
      ? '<button class="secondary small-btn pvp-cancel-invite" type="button" data-player-id="'+escapeHtml(friend.player_id||'')+'" data-invite-id="'+escapeHtml(invite?.id||'')+'">'+escapeHtml(t('pvpCancelInvite'))+'</button>'
      : '<button class="primary small-btn pvp-invite-friend" type="button" data-player-id="'+escapeHtml(friend.player_id||'')+'">'+escapeHtml(t('pvpInviteFriend'))+'</button>';
    const row=document.createElement('article');row.className='pvp-friend-row';
    row.innerHTML='<div class="friend-user">'+friendAvatarMarkup(friend.avatar)+'<div class="friend-user-copy"><strong>'+escapeHtml(friend.name||'Jucător')+'</strong><small>'+escapeHtml(friend.player_id||'')+'</small></div></div><div class="pvp-friend-actions"><span class="friend-status '+(friend.online?'online':'offline')+'"><i></i>'+escapeHtml(friendLastSeenText(friend.last_seen,Boolean(friend.online)))+'</span>'+action+'</div>';
    list.appendChild(row);
  });
}

async function refreshPvpDashboard(){
  if(!tabinetSupabase||!profile?.id||document.visibilityState==='hidden')return;
  try{
    const result=await tabinetRpc('tabinet_get_pvp_dashboard',{p_player_id:profile.id,p_device_token:getFriendsDeviceToken()});if(!result?.ok)return;
    window.__tabinetPvpDashboard=result;renderPvpInviteNotification(result.incoming_invites||[]);renderPvpRematchNotification(result.incoming_rematches||[]);renderPvpFriends();
    const active=result.active_match,leavingId=String(state.pvpLeavingMatchId||'');
    if(active&&leavingId&&String(active.id)===leavingId){if(active.status==='abandon_pending')return;state.pvpLeavingMatchId=null;}
    if(state.pvpMatchId&&(!active||String(active.id)!==String(state.pvpMatchId))){
      const previous=await fetchPvpMatch(state.pvpMatchId);
      if(previous&&previous.status!=='active'&&previous.status!=='abandon_pending'){
        const hasNew=Boolean(active);if(!state.pvpTerminalHandled)await showPvpTerminal(previous);if(!hasNew)return;
        state.pvpMatchId=null;state.pvpMatchVersion=0;state.pvpOpponent=null;state.pvpTerminalHandled=false;
      }
    }
    if(active){
      if(String(state.pvpMatchId||'')!==String(active.id||'')){
        if(active.status==='abandon_pending'){if(!leavingId)void enterPvpMatch(active.id);}else void enterPvpMatch(active.id);
      }else if(Number(active.version||0)>Number(state.pvpMatchVersion||0)){
        const current=await fetchPvpMatch(active.id);
        if(current?.status==='abandon_pending'){
          if(current.state)applyPvpMatchState(current);
          state.pvpAbandonExpiresAt=current.abandon_expires_at||null;state.pvpAbandonBy=current.abandoned_by||null;state.turn='done';renderGame();
        }else if(current?.status==='abandoned'||current?.status==='completed')await showPvpTerminal(current);
        else if(current?.state)applyPvpMatchState(current);
      }else if(active.status==='abandon_pending'){
        state.pvpAbandonExpiresAt=active.abandon_expires_at||state.pvpAbandonExpiresAt;
        state.pvpAbandonBy=active.abandoned_by||state.pvpAbandonBy;
        state.turn='done';renderGame();
      }
    }
  }catch{}
}
function startPvpPolling(){if(pvpDashboardTimer)clearInterval(pvpDashboardTimer);void refreshPvpDashboard();pvpDashboardTimer=setInterval(()=>{if(document.visibilityState==='visible')void refreshPvpDashboard();},850);}
function openPvpMode(){renderPvpFriends();showScreen('pvpModeScreen');}
function openPvpFriends(){renderPvpFriends();showScreen('pvpFriendsScreen');void refreshFriendsData();}
async function sendPvpInvite(playerId){
  if(pvpActionBusy)return;pvpActionBusy=true;
  const button=Array.from(document.querySelectorAll('.pvp-invite-friend')).find(btn=>String(btn.dataset.playerId||'')===String(playerId||''));if(button)button.disabled=true;
  try{const result=await tabinetRpc('tabinet_send_pvp_invite',{p_from_player_id:profile.id,p_to_player_id:playerId,p_device_token:getFriendsDeviceToken()});if(result?.ok)await refreshPvpDashboard();else{if(button)button.disabled=false;alert(t('pvpInviteError'));}}
  catch{if(button)button.disabled=false;alert(t('pvpBackendError'));}finally{pvpActionBusy=false;}
}
async function respondToPvpInvite(inviteId,accept){
  if(pvpActionBusy)return;pvpActionBusy=true;
  try{const result=await tabinetRpc('tabinet_respond_pvp_invite',{p_invite_id:inviteId,p_accept:Boolean(accept),p_player_id:profile.id,p_device_token:getFriendsDeviceToken()});if(result?.ok&&result.status==='accepted'&&result.match_id)await enterPvpMatch(result.match_id);else await refreshPvpDashboard();}
  catch{alert(t('pvpBackendError'));}finally{pvpActionBusy=false;}
}
async function startPvpMatchmaking(){
  if(pvpActionBusy)return;pvpActionBusy=true;state.selectedMode='pvp';showScreen('pvpMatchmakingScreen');if($('pvpMatchmakingStatus'))$('pvpMatchmakingStatus').textContent=t('pvpSearching');
  try{const result=await tabinetRpc('tabinet_join_pvp_matchmaking',{p_player_id:profile.id,p_device_token:getFriendsDeviceToken()});if(result?.ok&&result.status==='matched'&&result.match_id){if($('pvpMatchmakingStatus'))$('pvpMatchmakingStatus').textContent=t('pvpMatched');await enterPvpMatch(result.match_id);}else if(result?.ok&&result.status==='waiting'){if($('pvpMatchmakingStatus'))$('pvpMatchmakingStatus').textContent=t('pvpSearching');}else if($('pvpMatchmakingStatus'))$('pvpMatchmakingStatus').textContent=t('pvpMatchError');}
  catch{if($('pvpMatchmakingStatus'))$('pvpMatchmakingStatus').textContent=t('pvpBackendError');}finally{pvpActionBusy=false;}
}
async function cancelPvpMatchmaking(){
  try{await tabinetRpc('tabinet_leave_pvp_matchmaking',{p_player_id:profile.id,p_device_token:getFriendsDeviceToken()});}catch{}
  state.selectedMode='bot';showScreen('pvpModeScreen');
}
async function abandonPvpMatch(){
  const matchId=state.pvpMatchId;if(!matchId){goToMenu();return;}
  const previousOpponentId=pvpOpponentId();
  try{
    const result=await tabinetRpc('tabinet_abandon_pvp_match',{p_match_id:matchId,p_player_id:profile.id,p_device_token:getFriendsDeviceToken()});
    if(result?.ok&&result.status==='abandon_pending'){
      state.pvpLeavingMatchId=matchId;state.pvpAbandonExpiresAt=result.abandon_expires_at||null;state.pvpAbandonBy=profile.id;
      state.pvpMatchId=null;state.pvpMatchVersion=0;state.pvpOpponent=null;state.pvpTerminalHandled=false;state.selectedMode='bot';state.turn='menu';state.message='';
      showScreen('menuScreen');return;
    }
    if(result?.ok&&result.status==='abandoned')recordPvpBattleResult(true,result.winner_player_id||previousOpponentId);
  }catch{}
  state.matchToken+=1;state.pvpMatchId=null;state.pvpMatchVersion=0;state.pvpOpponent=null;state.pvpAbandonExpiresAt=null;state.pvpAbandonBy=null;state.pvpLeavingMatchId=null;state.pvpTerminalHandled=false;state.selectedMode='bot';state.turn='menu';state.message='';
  $('gameOverDialog')?.close();showScreen('menuScreen');
}
function renderPvpAbandonOverlay(){
  const overlay=$('pvpAbandonOverlay');if(!overlay)return;
  const active=isPvpMode()&&state.pvpAbandonExpiresAt&&!state.pvpTerminalHandled;
  if(!active){
    overlay.classList.add('hidden');
    if(pvpAbandonTimer){clearInterval(pvpAbandonTimer);pvpAbandonTimer=null;}
    return;
  }
  const update=()=>{
    if(!state.pvpAbandonExpiresAt||state.pvpTerminalHandled||!isPvpMode()){
      if(pvpAbandonTimer){clearInterval(pvpAbandonTimer);pvpAbandonTimer=null;}
      overlay.classList.add('hidden');
      return;
    }
    const remaining=Math.max(0,new Date(state.pvpAbandonExpiresAt).getTime()-Date.now());
    const seconds=Math.max(0,Math.ceil(remaining/1000));
    $('pvpAbandonCountdown').textContent=String(seconds);
    $('pvpAbandonCopy').textContent=t('pvpAbandonWaiting').replace('{name}',pvpOpponentName());
    overlay.classList.remove('hidden');
    overlay.classList.toggle('expiring',seconds<=3);
    if(remaining<=0){
      if(pvpAbandonTimer){clearInterval(pvpAbandonTimer);pvpAbandonTimer=null;}
      void refreshPvpDashboard();
    }
  };
  update();
  if(!pvpAbandonTimer)pvpAbandonTimer=setInterval(update,100);
}

async function cancelPvpInvite(inviteId){
  if(!inviteId)return;
  try{
    const result=await tabinetRpc('tabinet_cancel_pvp_invite',{p_invite_id:inviteId,p_player_id:profile.id,p_device_token:getFriendsDeviceToken()});
    if(result?.ok)await refreshPvpDashboard();
  }catch{}
}

async function requestPvpRematch(){
  if(!isPvpMode()||!state.pvpMatchId||state.pvpRematchPending)return;
  state.pvpRematchPending=true;
  const btn=$('gameOverRematchBtn');
  if(btn){btn.disabled=true;btn.textContent=t('pvpRematchSent');}
  try{
    const result=await tabinetRpc('tabinet_request_pvp_rematch',{p_original_match_id:state.pvpMatchId,p_player_id:profile.id,p_device_token:getFriendsDeviceToken()});
    if(!result?.ok){
      state.pvpRematchPending=false;
      if(btn){btn.disabled=false;btn.textContent=t('pvpRematch');}
    }else await refreshPvpDashboard();
  }catch{
    state.pvpRematchPending=false;
    if(btn){btn.disabled=false;btn.textContent=t('pvpRematch');}
  }
}

async function respondToPvpRematch(requestId,accept){
  if(pvpActionBusy)return;
  pvpActionBusy=true;
  try{
    const result=await tabinetRpc('tabinet_respond_pvp_rematch',{p_request_id:requestId,p_accept:Boolean(accept),p_player_id:profile.id,p_device_token:getFriendsDeviceToken()});
    if(result?.ok&&result.status==='accepted'&&result.match_id)await enterPvpMatch(result.match_id);
    else await refreshPvpDashboard();
  }catch{alert(t('pvpBackendError'));}finally{pvpActionBusy=false;}
}

function startFriendsHeartbeat() {
  if (!tabinetSupabase) return;
  void syncProfileOnline();
  if (friendsHeartbeatTimer) clearInterval(friendsHeartbeatTimer);
  if (friendsBackgroundRefreshTimer) clearInterval(friendsBackgroundRefreshTimer);
  friendsHeartbeatTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      void tabinetRpc('tabinet_heartbeat', {p_player_id:profile.id,p_device_token:getFriendsDeviceToken()});
    }
  }, 30000);
  friendsBackgroundRefreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible') { void refreshFriendsData(); void refreshPvpDashboard(); }
  }, 5000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void tabinetRpc('tabinet_heartbeat', {p_player_id:profile.id,p_device_token:getFriendsDeviceToken()});
      void refreshFriendsData();
      void refreshPvpDashboard();
    }
  }, {passive:true});
}

function startFriendsRealtime(){
  if(!tabinetSupabase||!profile?.id)return;
  try{
    if(window.__tabinetFriendsChannel) tabinetSupabase.removeChannel(window.__tabinetFriendsChannel);
    window.__tabinetFriendsChannel=tabinetSupabase.channel('tabinet-friends-'+profile.id)
      .on('postgres_changes',{event:'*',schema:'public',table:'tabinet_friend_requests'},()=>void refreshFriendsData())
      .on('postgres_changes',{event:'*',schema:'public',table:'tabinet_friendships'},()=>void refreshFriendsData())
      .on('postgres_changes',{event:'*',schema:'public',table:'tabinet_pvp_invites'},()=>void refreshPvpDashboard())
      .on('postgres_changes',{event:'*',schema:'public',table:'tabinet_pvp_matches'},()=>void refreshPvpDashboard())
      .subscribe();
  }catch{}
}

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
  // Keep the page behind a modal locked, but let any open dialog receive its
  // own wheel/touch gesture so mobile dialogs can scroll to their actions.
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('dialog[open]')) return;
  event.preventDefault();
}

function preventMainMenuScroll(event) {
  if (!document.body.classList.contains('menu-screen-locked')) return;
  event.preventDefault();
}

function forceModalCleanup() {
  document.querySelectorAll('dialog').forEach(dialog => {
    if (dialog.open) dialog.close();
  });
  const html = document.documentElement;
  const body = document.body;
  if (!body) return;
  html.classList.remove('modal-scroll-locked');
  body.classList.remove('modal-scroll-locked');
  // Restore the normal page positioning that was used while a modal was open.
  body.style.position = '';
  body.style.top = '';
  body.style.left = '';
  body.style.right = '';
  body.style.width = '';
  modalScrollWasLocked = false;
  window.requestAnimationFrame(() => {
    html.classList.remove('modal-scroll-locked');
    body.classList.remove('modal-scroll-locked');
  });
}

const modalScrollObserver = new MutationObserver(syncModalScrollLock);

function loadSettings() {
  const stored = loadUserDataSnapshot().settings;
  try {
    const storedVolume = Number(stored?.volume ?? localStorage.getItem('tabinet-volume'));
    const volume = Number.isFinite(storedVolume) ? Math.min(1, Math.max(0, storedVolume)) : 0.95;
    return {
      sound: typeof stored?.sound === 'boolean' ? stored.sound : localStorage.getItem('tabinet-sound') !== 'off',
      volume,
      animations: typeof stored?.animations === 'boolean' ? stored.animations : localStorage.getItem('tabinet-animations') !== 'off',
      language: stored?.language === 'en' ? 'en' : (localStorage.getItem('tabinet-language') || 'ro'),
    };
  } catch {
    return { sound: true, volume: 0.95, animations: true, language: 'ro' };
  }
}

function loadBattleHistory() {
  try {
    const stored = loadUserDataSnapshot().battleHistory;
    if (Array.isArray(stored)) return stored.slice(0, 8);
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

  saveUserDataSnapshot({
    settings: {
      sound: Boolean(settings.sound),
      volume: Number(settings.volume),
      animations: Boolean(settings.animations),
      language: settings.language === 'en' ? 'en' : 'ro'
    }
  });
}

function saveBattleHistory() {
  try {
    localStorage.setItem('tabinet-battle-log', JSON.stringify(battleHistory));
  } catch { /* storage is optional */ }
  saveUserDataSnapshot({ battleHistory: Array.isArray(battleHistory) ? battleHistory.slice(0, 8) : [] });
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
    let stableId = null;
    try { stableId = localStorage.getItem(STABLE_PLAYER_ID_KEY); } catch {}
    const stored = loadUserDataSnapshot().profile;
    const legacyRaw = localStorage.getItem('tabinet-profile');
    const legacy = legacyRaw ? JSON.parse(legacyRaw) : null;
    const parsed = (stored && typeof stored === 'object') ? stored : legacy;
    const id = String(stableId || parsed?.id || makeDefaultProfileId());
    try { localStorage.setItem(STABLE_PLAYER_ID_KEY, id); } catch {}
    const result = {name:String(parsed?.name || 'Jucător').slice(0,18),id,avatar:parsed?.avatar || {kind:'template',id:'01'}};
    saveUserDataSnapshot({profile:result});
    return result;
  } catch {
    let id = null;
    try { id = localStorage.getItem(STABLE_PLAYER_ID_KEY); } catch {}
    id = id || makeDefaultProfileId();
    try { localStorage.setItem(STABLE_PLAYER_ID_KEY,id); } catch {}
    return {name:'Jucător',id,avatar:{kind:'template',id:'01'}};
  }
}

function saveProfile() {
  let saved = false;
  const payload = {
    version: 1,
    name: String(profile.name || 'Jucător').slice(0,18),
    id: String(profile.id || makeDefaultProfileId()),
    avatar: profile.avatar || { kind:'template', id:'01' }
  };
  try {
    localStorage.setItem('tabinet-profile', JSON.stringify(payload));
    saved = true;
  } catch {}

  try { localStorage.setItem(STABLE_PLAYER_ID_KEY, payload.id); } catch {}
  saveUserDataSnapshot({ profile: payload });
  void syncProfileOnline();
  return saved;
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

function openProfile() {
  renderProfile();
  const dialog = $('profileDialog');
  const input = $('profileNameInput');
  const scroll = dialog.querySelector('.profile-dialog-scroll');
  const sentinel = dialog.querySelector('.dialog-focus-sentinel');
  if (input) {
    input.readOnly = true;
    input.tabIndex = -1;
    input.setAttribute('aria-readonly', 'true');
  }
  dialog.showModal();
  const resetDialogPosition = () => {
    dialog.scrollTop = 0;
    if (scroll) scroll.scrollTop = 0;
    sentinel?.focus({ preventScroll: true });
  };
  resetDialogPosition();
  requestAnimationFrame(() => {
    resetDialogPosition();
    requestAnimationFrame(() => { dialog.scrollTop = 0; });
  });
}

function openRules() {
  const dialog = $('rulesDialog');
  const sentinel = dialog.querySelector('.dialog-focus-sentinel');
  dialog.showModal();
  const resetDialogPosition = () => {
    dialog.scrollTop = 0;
    sentinel?.focus({ preventScroll: true });
  };
  resetDialogPosition();
  requestAnimationFrame(() => {
    resetDialogPosition();
    requestAnimationFrame(() => { dialog.scrollTop = 0; });
  });
}

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
      victory: [
        {f:523.25, to:523.25, d:0, l:.13, w:'sine', a:.9},
        {f:659.25, to:659.25, d:.12, l:.13, w:'sine', a:1},
        {f:783.99, to:783.99, d:.24, l:.15, w:'sine', a:1.08},
        {f:1046.5, to:1046.5, d:.40, l:.22, w:'triangle', a:1.12},
        {f:1318.5, to:1318.5, d:.56, l:.30, w:'sine', a:1.0},
      ],
      defeat: [
        {f:392.0, to:360.0, d:0, l:.18, w:'sine', a:.85},
        {f:329.63, to:300.0, d:.17, l:.19, w:'triangle', a:.8},
        {f:261.63, to:235.0, d:.35, l:.22, w:'sine', a:.78},
        {f:196.0, to:174.0, d:.56, l:.32, w:'sine', a:.72},
      ],
      draw: [
        {f:440.0, to:440.0, d:0, l:.18, w:'sine', a:.75},
        {f:554.37, to:554.37, d:.18, l:.18, w:'sine', a:.8},
        {f:493.88, to:493.88, d:.36, l:.24, w:'triangle', a:.7},
      ],
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
    menuTitle: 'Joacă simplu. Ia tot.', menuSubtitle: 'Intră într-o partidă în câteva secunde.', menuPill: 'MVP • BOT DISPONIBIL', menuHeroTitle: 'O partidă relaxată, direct în browser.', menuHeroCopy: 'Nu ai nevoie de instalări. Alegi adversarul, dificultatea și intri la masă.', menuVersion: 'v0.8.0 • PvP + matchmaking + invitații',
    settings: 'Setări', settingsCopy: 'Sunete, animații și limbă', friendsMenu: 'Prieteni', friendsMenuCopy: 'Adaugă și gestionează prietenii', rules: 'Reguli', rulesCopy: 'Vezi cum se joacă', play: 'Joacă', back: 'Înapoi',
    step1: 'PASUL 1', modeTitle: 'Cum vrei să joci?', modeCopy: 'Alege un adversar. Multiplayer-ul cu alt jucător vine în curând.', bot: 'Cu bot', botCopy: 'Joacă acum împotriva unui adversar controlat de joc.', choose: 'Alege →', realPlayer:'Cu player real', realCopy:'Joacă online cu un prieten sau caută un adversar.',
    pvpStep:'PASUL 2', pvpModeTitle:'Cum vrei să alegi adversarul?', pvpModeCopy:'Provoacă direct un prieten sau lasă jocul să găsească un jucător disponibil.', pvpFriendTitle:'Contra unui prieten', pvpFriendCopy:'Alege unul dintre prietenii tăi și trimite-i invitația.', pvpMatchmakingChoiceTitle:'Matchmaking', pvpMatchmakingChoiceCopy:'Intră în coadă și te potrivim automat cu un jucător.', pvpFriendsTitle:'Alege un prieten', pvpFriendsCopy:'Invitația apare în meniul principal al prietenului și poate fi acceptată sau refuzată.', pvpMatchmakingTitle:'Căutăm un adversar', pvpSearchCopy:'Te conectăm cu primul jucător disponibil.', pvpSearching:'Se caută un adversar…', pvpMatched:'Adversar găsit! Se pregătește masa…', pvpMatchError:'Nu am putut intra în matchmaking.', pvpNoFriends:'Nu ai încă prieteni pe care îi poți provoca.', pvpInviteFriend:'Provoacă', pvpInviteSent:'Invitație trimisă', pvpInviteKicker:'INVITAȚIE LA MECI', pvpInviteCopy:'vrea să joace Tabinet cu tine.', pvpAccept:'Acceptă', pvpReject:'Refuză', pvpInviteError:'Nu s-a putut trimite invitația.', pvpBackendError:'Serviciul online nu este disponibil momentan.', pvpPlayerLabel:'PLAYER', pvpWaitingOpponent:'Așteaptă mutarea adversarului…', pvpOpponentThinking:'Adversarul se gândește…', pvpWaitHint:'Așteaptă mutarea adversarului.', pvpOpponentStarts:'Adversarul începe această mână.', matchPlayer:'Meci PvP', pvpWon:'Ai câștigat.', pvpLost:'Ai pierdut.', pvpWonAbandoned:'Ai câștigat prin abandon.', pvpLostAbandoned:'Ai pierdut prin abandon.', pvpAbandonedCopy:'Meciul s-a încheiat deoarece unul dintre jucători a abandonat.', pvpAbandonWaiting:'Așteaptă-l pe {name}…', pvpRematch:'Răzbunare', pvpRematchSent:'Cerere trimisă', pvpRematchKicker:'CERERE DE RĂZBUNARE', pvpRematchCopy:'vrea revanșă.', pvpCancelInvite:'Anulează invitația', pvpFinishedCopy:'Meciul PvP s-a încheiat.', historyKicker: 'ISTORIC', historyTitle: 'Log-uri meciuri', historyCopyMode: 'Vezi cu cine ai jucat, scorurile și cum a decurs partida.', viewLogs: 'Vezi log-urile',
    step2: 'PASUL 2', difficultyTitle: 'Cât de greu vrei să fie?', difficultyCopy: 'Alege ritmul și nivelul botului.', easy: 'Ușor', easyCopy: 'Bot relaxat, potrivit pentru primele partide.', medium: 'Mediu', mediumCopy: 'Bot echilibrat, caută capturi și puncte.', hard: 'Mare', hardCopy: 'Bot competitiv, analizează mai multe mutări.',
    matchBot: 'Meci cu bot', deck: 'în pachet', table: 'MASĂ', opponent: 'ADVERSAR', yourHand: 'MÂNA TA', you:'TU', botLabel:'BOT', pile: 'teanc de puncte', playerTableauLabel:'TABLELE', opponentTableauLabel:'TABLELE', playerTableauActive:'active', opponentTableauActive:'active', newGame: 'Joc nou', round: 'MÂNA', lastHand: 'ULTIMA MÂNĂ', yourTurn: 'Este rândul tău', botThinking: 'Botul se gândește…', gameEnded: 'Partida s-a încheiat', chooseCard: 'Alege o carte.', waitBot: 'Așteaptă mutarea botului.', tapHint: 'Click = joacă · Ține apăsat = stivă · Trage pe masă = pune fără captură.', waitHint: 'Așteaptă mutarea botului.', deckRemaining:'în pachet', battleLogTitle:'BATTLE LOG', recentMatches:'ultimele meciuri', playerStarts:'Începi tu.', botStarts:'Botul începe această mână.',
    captureKicker:'CAPTURĂ', captureTitle:'Ai mai multe variante', cancel:'Anulează', takeCards:'Ia cărțile', selected:'Ai selectat', cardsWord:'cărți', cardWord:'carte', selectCapture:'Selectează cel puțin o captură.', optionTarget:'Cu {card} ai {count} variante. Selectează una sau mai multe variante care nu folosesc aceleași cărți.',
    tableauKicker:'TABLĂ!', tableauTitle:'Alege cartea pentru tablă', tableauCopy:'Ai golit masa. Alege una dintre cărțile capturate de pe masă ca marcaj pentru această tablă.', tableauBonus:'+{bonus} bonus', tableauNoBonus:'fără bonus suplimentar', tableMarker:'Cartea devine marcajul acestei table',
    stackKicker:'STIVĂ', stackTitle:'Pune cartea peste aceeași valoare', stackCancel:'Anulează', stackTarget:'Ai ținut apăsat pe {card}. Alege stiva de {rank} peste care vrei să o așezi.', stackTop:'deasupra',
    rulesKicker:'REGULI', rulesTitle:'Cum se joacă Tabinet', ruleCaptureTitle:'1. Captură', ruleCaptureCopy:'Joci o carte și iei combinațiile de pe masă care au aceeași valoare totală. Poți selecta mai multe combinații compatibile.', ruleAceTitle:'2. Asul', ruleAceCopy:'Asul poate fi folosit ca 1 sau 11. J = 12, Q = 13, K = 14.', ruleStackTitle:'3. Stivă', ruleStackCopy:'Ține apăsat pe o carte și pune-o peste aceeași valoare. Orice stivă de 2 sau mai multe cărți se ia doar cu aceeași valoare și nu intră în sume cu alte cărți.', rulePointsTitle:'4. Puncte', rulePointsCopy:'La o captură, cartea jucată A, 10, J, Q, K sau 2♣ își păstrează și ea punctul, iar cărțile luate de pe masă își păstrează punctele lor. 10♦ este un 10 normal. Pentru tablă, 2–9 dau punctul tablei, A/10/J/Q/K nu primesc un bonus suplimentar de marcaj, iar 2♣ primește +1.', ruleTableauTitle:'5. Tablă', ruleTableauCopy:'Când golești masa, alegi cartea care marchează tabla. Când adversarul ia o tablă, una dintre tablele tale este anulată.', ruleLastHandTitle:'6. Ultima mână', ruleLastHandCopy:'Cine face ultima captură ia automat și toate cărțile rămase pe masă și punctele speciale ale lor.', understood:'Am înțeles',
    friendsKicker:'PRIETENI', friendsTitle:'Prieteni', friendsCopy:'Conectează-te cu jucători, vezi cine este online și gestionează cererile.', friendsRequestsTitle:'Cereri primite', friendsListTitle:'Lista mea', friendsSummaryCountLabel:'Prieteni', friendsRequestsCountLabel:'Cereri', friendsOnlineLabel:'online', friendAdd:'Adaugă', friendOnline:'Online', friendOffline:'Offline', friendLastSeenNow:'acum', friendLastSeenMinutes:'acum {n} min', friendLastSeenHours:'acum {n} h', friendLastSeenDays:'acum {n} zile', friendNotificationKicker:'CERERE DE PRIETENIE', friendNotificationCopy:'vrea să fie prietenul tău.', friendViewProfile:'Vezi profilul', friendAccepted:'Prieteni', friendIncoming:'Cerere primită', friendDelete:'Șterge', friendDeleteTitle:'Ștergi prietenul?', friendDeleteCopy:'Ești sigur că vrei să îl ștergi pe', friendDeleteConfirm:'Da, șterge', friendDeleteCancel:'Nu, păstrează', friendProfileTitle:'Profilul prietenului', friendNoRequests:'Nu ai cereri de prietenie.', friendNoFriends:'Nu ai încă prieteni adăugați.', friendAccept:'Acceptă', friendReject:'Refuză', friendSearchKicker:'ADĂUGĂ PRIETEN', friendSearchTitle:'Caută după ID', friendSearchCopy:'Introdu ID-ul exact al jucătorului pe care vrei să-l adaugi.', friendEnterId:'Introdu un ID.', friendSearching:'Se caută…', friendNotFound:'Nu am găsit niciun jucător cu acest ID.', friendRequestSent:'Cererea a fost trimisă.', friendSent:'Trimisă', friendThisIsYou:'Ești tu', friendProfileKicker:'PRIETEN', friendProfileCopy:'Profilul online al prietenului.', friendProfileStatsTitle:'Statistici', friendProfileStatsCopy:'Rezumatul meciurilor cu botul.', friendProfileRecentTitle:'Ultimele 3 meciuri', friendProfileRecentCopy:'Momentan sunt afișate doar meciurile cu botul.', friendProfileNameLabel:'Nume', friendProfileIdLabel:'ID jucător', friendProfileNoMatches:'Nu există meciuri cu botul încă.', friendProfileLoading:'Se încarcă profilul…', friendProfileError:'Profilul nu a putut fi încărcat.', friendThisIsYou:'Ești tu', friendBackendError:'Serviciul online nu este disponibil momentan.', friendErr_already_friends:'Sunteți deja prieteni.', friendErr_request_pending:'Cererea este deja trimisă.', friendErr_incoming_pending:'Acest jucător ți-a trimis deja o cerere.', friendErr_cannot_add_self:'Nu te poți adăuga pe tine.', friendErr_sender_not_found:'Profilul tău online nu este sincronizat.', friendErr_generic:'Nu s-a putut trimite cererea.', search:'Caută', friendsClose:'Închide', friendsCloseSearch:'Închide', deleteAccountKicker:'CONT', deleteAccountTitle:'Șterge contul', deleteAccountCopy:'Ștergerea este definitivă: vei pierde ID-ul, numele, progresul, istoricul local și toate datele de prieteni.', deleteAccountBtn:'Șterge definitiv contul', deleteAccountCancel:'Nu, păstrează contul', deleteAccountDeleting:'Se șterg datele…', deleteAccountError:'Contul nu a putut fi șters. Nu s-a pierdut nimic local.', deleteAccountBackendError:'Serviciul online nu este disponibil momentan.', deleteAccountConfirmTitle:'Ești sigur că vrei să continui?', deleteAccountConfirmCopy:'Această acțiune nu poate fi anulată. După ștergere vei primi automat un ID nou.', deleteAccountCopyPreview:'ID-ul, numele, progresul, istoricul local și prietenii vor fi șterse.', settingsKicker:'SETĂRI', settingsTitle:'Preferințe', soundLabel:'Sunete', soundCopy:'Feedback audio pentru acțiuni.', volumeLabel:'Volum', animationsLabel:'Animații', animationsCopy:'Animații complete; OFF păstrează doar tranziții discrete.', languageLabel:'Limbă', languageCopy:'Alege limba interfeței.', done:'Gata',
    profileKicker:'PROFIL', profileTitle:'Profilul meu', profileCopy:'Numele și ID-ul tău sunt salvate local pe acest dispozitiv.', profileNameLabel:'Nume', profileIdLabel:'ID jucător', copyId:'Copiază', copiedId:'Copiat', avatarSectionTitle:'Imagine de profil', avatarSectionCopy:'Alege un avatar.', avatarUploadTitle:'Imagine proprie', avatarUploadCopy:'Alege o imagine de pe dispozitiv.', profileStatsTitle:'Statistici', profileStatsCopy:'Rezumatul meciurilor disponibile.', profileWinRateLabel:'Win rate', profile12hLabel:'Meciuri în ultimele 12h', profileTotalLabel:'Meciuri înregistrate', profileRecentTitle:'Ultimele 3 meciuri', profileRecentCopy:'Momentan sunt afișate meciurile cu botul.', profileNoMatches:'Nu există meciuri disponibile încă.', profileWin:'Victorie', profileLoss:'Înfrângere', avatarTemplate:'Avatar', saveProfile:'Salvează', closeProfile:'Închide', profileMenu:'Profil',
    historyKicker:'ISTORIC MECIURI', historyTitleFull:'Log-uri de meciuri', historyCopy:'Vezi rezultatele și rezumatul fiecărei partide.', close:'Închide', emptyHistory:'Niciun meci terminat încă.', botMode:'BOT', playerMode:'PLAYER', watch:'Watch', soon:'În curând', opponentBot:'Bot', resultYou:'Tu', resultBot:'Botul', draw:'Egalitate', dateNow:'acum', details:'Vezi desfășurarea',
    gameOverKicker:'PARTIDĂ TERMINATĂ', gameOverDraw:'Egalitate', gameOverWin:'Ai câștigat partida', gameOverLoss:'Botul a câștigat partida', gameOverCopy:'Punctajul final include cărțile capturate și tablele active.', menu:'Meniu', rematch:'Mai joci o dată', you:'Tu', abandoned:'Abandonat', pauseKicker:'PARTIDĂ PUSĂ PE PAUZĂ', pauseTitle:'Poți reveni în această partidă.', pauseCopy:'Botul așteaptă. Dacă nu revii la timp, partida va fi declarată pierdută.', rejoin:'Reintră în meci', abandon:'Abandonează', seconds:'sec', pauseExpired:'Timpul a expirat. Partida a fost declarată pierdută.', pauseAbandoned:'Ai abandonat partida. Victoria a fost acordată adversarului.', pauseSaved:'Partida a fost pusă pe pauză.', leaveMatch:'Ieși din meci',
    loading1:'Se pregătește masa…', loading2:'Se încarcă pachetul…', loading3:'Gata de joc.', shuffleKicker:'PREGĂTEȘTE-TE', shuffleTitle:'Se amestecă pachetul', shuffleCopy:'Se distribuie cărțile și începe partida.',
    noMatchRank:'{card} nu are aceeași valoare ca nicio carte de pe masă.', placedStack:'Ai pus {card} peste {rank}. Acum stiva are {count} cărți.', placedTable:'Ai pus {card} pe masă. Ține apăsat pe o carte pentru a o pune peste aceeași valoare.', forcedPlace:'Ai pus {card} direct pe masă, fără captură.', captureMessage:'Ai jucat {played} și ai luat {count} {word} · +{gain} {points}.', captureBotMessage:'Botul a jucat {played} și a capturat {count} {word} · +{gain} {points}.', tableauPrompt:'Ai golit masa — alege cartea care marchează tabla.', tableExclamation:'Tablă!', tableauChosen:'Ai ales {card} ca marcaj pentru tablă.', botTableau:' Tablă! Marcaj: {card}.', lastDealMessage:'Ultima mână a fost împărțită. Cine face ultima captură ia și toate cărțile rămase pe masă.', dealMessage:'Mâna {round} a fost împărțită.', botPlaced:'Botul a pus {card} pe masă.', lastCapture:' Ultima captură: {who} a luat automat toate cele {count} cărți rămase · +{gain} {points}.', lastCaptureNoPoints:' Ultima captură: {who} a luat automat toate cele {count} cărți rămase.'
  },
  en: {
    menuTitle: 'Play simple. Take it all.', menuSubtitle: 'Get into a match in a few seconds.', menuPill: 'MVP • BOT AVAILABLE', menuHeroTitle: 'A relaxed match, right in your browser.', menuHeroCopy: 'No installs needed. Choose your opponent, difficulty and sit at the table.', menuVersion: 'v0.8.0 • PvP + matchmaking + invites',
    settings: 'Settings', settingsCopy: 'Sounds, animations and language', friendsMenu: 'Friends', friendsMenuCopy: 'Add and manage friends', rules: 'Rules', rulesCopy: 'See how to play', play: 'Play', back: 'Back',
    step1: 'STEP 1', modeTitle: 'How do you want to play?', modeCopy: 'Choose an opponent. Online multiplayer is coming soon.', bot: 'Play vs bot', botCopy: 'Play now against a game-controlled opponent.', choose: 'Choose →', realPlayer:'Real player', realCopy:'Play online with a friend or find an opponent.',
    pvpStep:'STEP 2', pvpModeTitle:'How do you want to choose an opponent?', pvpModeCopy:'Challenge a friend directly or let matchmaking find an available player.', pvpFriendTitle:'Play a friend', pvpFriendCopy:'Choose one of your friends and send an invite.', pvpMatchmakingChoiceTitle:'Matchmaking', pvpMatchmakingChoiceCopy:'Join the queue and we will pair you with a player automatically.', pvpFriendsTitle:'Choose a friend', pvpFriendsCopy:'The invite appears in your friend’s main menu and can be accepted or declined.', pvpMatchmakingTitle:'Finding an opponent', pvpSearchCopy:'We are connecting you with the first available player.', pvpSearching:'Looking for an opponent…', pvpMatched:'Opponent found! Setting up the table…', pvpMatchError:'We could not join matchmaking.', pvpNoFriends:'You have no friends you can challenge yet.', pvpInviteFriend:'Challenge', pvpInviteSent:'Invite sent', pvpInviteKicker:'MATCH INVITE', pvpInviteCopy:'wants to play Tabinet with you.', pvpAccept:'Accept', pvpReject:'Decline', pvpInviteError:'The invite could not be sent.', pvpBackendError:'The online service is unavailable right now.', pvpPlayerLabel:'PLAYER', pvpWaitingOpponent:'Waiting for your opponent…', pvpOpponentThinking:'Your opponent is thinking…', pvpWaitHint:'Wait for your opponent’s move.', pvpOpponentStarts:'Your opponent starts this hand.', matchPlayer:'PvP match', pvpWon:'You won.', pvpLost:'You lost.', pvpWonAbandoned:'You won by abandonment.', pvpLostAbandoned:'You lost by abandonment.', pvpAbandonedCopy:'The match ended because one player abandoned it.', pvpAbandonWaiting:'Wait for {name}…', pvpRematch:'Fight again', pvpRematchSent:'Request sent', pvpRematchKicker:'REVENGE REQUEST', pvpRematchCopy:'wants a rematch.', pvpCancelInvite:'Cancel invite', pvpFinishedCopy:'The PvP match has ended.', historyKicker: 'HISTORY', historyTitle: 'Match logs', historyCopyMode: 'See who you played, the scores and how the match went.', viewLogs: 'View logs',
    step2: 'STEP 2', difficultyTitle: 'How hard should it be?', difficultyCopy: 'Choose the bot pace and level.', easy: 'Easy', easyCopy: 'Relaxed bot, good for first matches.', medium: 'Medium', mediumCopy: 'Balanced bot, looks for captures and points.', hard: 'Hard', hardCopy: 'Competitive bot, analyzes more moves.',
    matchBot: 'Match vs bot', deck: 'in deck', table: 'TABLE', opponent: 'OPPONENT', yourHand: 'YOUR HAND', you:'YOU', botLabel:'BOT', pile: 'point pile', playerTableauLabel:'TABLES', opponentTableauLabel:'TABLES', playerTableauActive:'active', opponentTableauActive:'active', newGame: 'New game', round: 'HAND', lastHand: 'LAST HAND', yourTurn: 'Your turn', botThinking: 'The bot is thinking…', gameEnded: 'Match ended', chooseCard: 'Choose a card.', waitBot: 'Wait for the bot move.', tapHint: 'Click = play · Hold = stack · Drag onto the table = place without capturing.', waitHint: 'Wait for the bot move.', deckRemaining:'in deck', battleLogTitle:'BATTLE LOG', recentMatches:'recent matches', playerStarts:'You start.', botStarts:'The bot starts this hand.',
    captureKicker:'CAPTURE', captureTitle:'You have multiple options', cancel:'Cancel', takeCards:'Take cards', selected:'You selected', cardsWord:'cards', cardWord:'card', selectCapture:'Select at least one capture.', optionTarget:'With {card} you have {count} options. Select one or more options that do not reuse the same cards.',
    tableauKicker:'TABLE!', tableauTitle:'Choose the card for the table', tableauCopy:'You cleared the table. Choose one captured card to mark this table.', tableauBonus:'+{bonus} bonus', tableauNoBonus:'no extra bonus', tableMarker:'This card becomes the marker for this table',
    stackKicker:'STACK', stackTitle:'Place the card over the same value', stackCancel:'Cancel', stackTarget:'You held {card}. Choose the {rank} stack to place it on.', stackTop:'on top',
    rulesKicker:'RULES', rulesTitle:'How to play Tabinet', ruleCaptureTitle:'1. Capture', ruleCaptureCopy:'Play a card and take table combinations whose total value matches it. You can select multiple compatible combinations.', ruleAceTitle:'2. Ace', ruleAceCopy:'An Ace can count as 1 or 11. J = 12, Q = 13, K = 14.', ruleStackTitle:'3. Stack', ruleStackCopy:'Hold a card and place it over the same value. Any stack of 2 or more cards can only be taken by the same value and never participates in sums with other cards.', rulePointsTitle:'4. Points', rulePointsCopy:'A, 10, J, Q, K and 2♣ are worth 1 point when captured. 10♦ is a normal 10. For a table marker, 2–9 provide the table point, A/10/J/Q/K add nothing extra, and 2♣ gets +1.', ruleTableauTitle:'5. Table', ruleTableauCopy:'When you clear the table, choose the card that marks it. When the opponent takes a table, one of your table markers is cancelled.', ruleLastHandTitle:'6. Last hand', ruleLastHandCopy:'Whoever makes the final capture also takes all cards left on the table and their special points.', understood:'Got it',
    friendsKicker:'FRIENDS', friendsTitle:'Friends', friendsCopy:'Connect with players, see who is online and manage requests.', friendsRequestsTitle:'Incoming requests', friendsListTitle:'My list', friendsSummaryCountLabel:'Friends', friendsRequestsCountLabel:'Requests', friendsOnlineLabel:'online', friendAdd:'Add', friendOnline:'Online', friendOffline:'Offline', friendLastSeenNow:'now', friendLastSeenMinutes:'{n} min ago', friendLastSeenHours:'{n} h ago', friendLastSeenDays:'{n} days ago', friendNotificationKicker:'FRIEND REQUEST', friendNotificationCopy:'wants to be your friend.', friendViewProfile:'View profile', friendAccepted:'Friends', friendIncoming:'Incoming request', friendDelete:'Remove', friendDeleteTitle:'Remove friend?', friendDeleteCopy:'Are you sure you want to remove', friendDeleteConfirm:'Yes, remove', friendDeleteCancel:'Keep friend', friendProfileTitle:'Friend profile', friendNoRequests:'You have no friend requests.', friendNoFriends:'You have no friends yet.', friendAccept:'Accept', friendReject:'Decline', friendSearchKicker:'ADD FRIEND', friendSearchTitle:'Find by ID', friendSearchCopy:'Enter the exact player ID you want to add.', friendEnterId:'Enter an ID.', friendSearching:'Searching…', friendNotFound:'No player was found with this ID.', friendRequestSent:'Friend request sent.', friendSent:'Sent', friendThisIsYou:'It’s you', friendProfileKicker:'FRIEND', friendProfileCopy:'Online profile of this friend.', friendProfileStatsTitle:'Statistics', friendProfileStatsCopy:'Summary of bot matches.', friendProfileRecentTitle:'Last 3 matches', friendProfileRecentCopy:'Only bot matches are shown for now.', friendProfileNameLabel:'Name', friendProfileIdLabel:'Player ID', friendProfileNoMatches:'No bot matches yet.', friendProfileLoading:'Loading profile…', friendProfileError:'The profile could not be loaded.', friendThisIsYou:'It’s you', friendBackendError:'The online service is unavailable right now.', friendErr_already_friends:'You are already friends.', friendErr_request_pending:'That request was already sent.', friendErr_incoming_pending:'That player already sent you a request.', friendErr_cannot_add_self:'You cannot add yourself.', friendErr_sender_not_found:'Your online profile is not synchronized.', friendErr_generic:'The request could not be sent.', search:'Search', friendsClose:'Close', friendsCloseSearch:'Close', deleteAccountKicker:'ACCOUNT', deleteAccountTitle:'Delete account', deleteAccountCopy:'This is permanent: you will lose your ID, name, progress, local history and all friend data.', deleteAccountBtn:'Delete account permanently', deleteAccountCancel:'Keep my account', deleteAccountDeleting:'Deleting your data…', deleteAccountError:'The account could not be deleted. Nothing local was lost.', deleteAccountBackendError:'The online service is unavailable right now.', deleteAccountConfirmTitle:'Are you sure you want to continue?', deleteAccountConfirmCopy:'This cannot be undone. After deletion, a new player ID will be generated automatically.', deleteAccountCopyPreview:'Your ID, name, progress, local history and friends will be deleted.', settingsKicker:'SETTINGS', settingsTitle:'Preferences', soundLabel:'Sounds', soundCopy:'Audio feedback for actions.', volumeLabel:'Volume', animationsLabel:'Animations', animationsCopy:'Full animations; OFF keeps only subtle transitions.', languageLabel:'Language', languageCopy:'Choose interface language.', done:'Done',
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
    friendsKicker:'friendsKicker', friendsTitle:'friendsTitle', friendsCopy:'friendsCopy', friendProfileKicker:'friendProfileKicker', friendProfileTitle:'friendProfileTitle', friendProfileCopy:'friendProfileCopy', friendProfileNameLabel:'friendProfileNameLabel', friendProfileIdLabel:'friendProfileIdLabel', friendProfileStatsTitle:'friendProfileStatsTitle', friendProfileStatsCopy:'friendProfileStatsCopy', friendProfileWinRateLabel:'profileWinRateLabel', friendProfile12hLabel:'profile12hLabel', friendProfileTotalLabel:'profileTotalLabel', friendProfileRecentTitle:'friendProfileRecentTitle', friendProfileRecentCopy:'friendProfileRecentCopy', closeFriendProfileBtn:'friendsClose', friendDeleteTitle:'friendDeleteTitle', friendDeleteCopy:'friendDeleteCopy', friendDeleteConfirm:'friendDeleteConfirm', friendDeleteCancel:'friendDeleteCancel', closeDeleteFriendBtn:'friendDeleteCancel', friendsRequestsTitle:'friendsRequestsTitle', friendsListTitle:'friendsListTitle', friendsSummaryCountLabel:'friendsSummaryCountLabel', friendsRequestsCountLabel:'friendsRequestsCountLabel', friendsOnlineLabel:'friendsOnlineLabel', addFriendBtn:'friendAdd', closeFriendsBtn:'friendsClose', friendSearchKicker:'friendSearchKicker', friendSearchTitle:'friendSearchTitle', friendSearchCopy:'friendSearchCopy', friendSearchBtn:'search', closeFriendSearchBtn:'friendsCloseSearch',
    rulesKicker:'rulesKicker', rulesTitle:'rulesTitle', ruleCaptureTitle:'ruleCaptureTitle', ruleCaptureCopy:'ruleCaptureCopy', ruleAceTitle:'ruleAceTitle', ruleAceCopy:'ruleAceCopy', ruleStackTitle:'ruleStackTitle', ruleStackCopy:'ruleStackCopy', rulePointsTitle:'rulePointsTitle', rulePointsCopy:'rulePointsCopy', ruleTableauTitle:'ruleTableauTitle', ruleTableauCopy:'ruleTableauCopy', ruleLastHandTitle:'ruleLastHandTitle', ruleLastHandCopy:'ruleLastHandCopy', closeRulesBtn:'understood',
    captureKicker:'captureKicker', captureTitle:'captureTitle', cancelCaptureBtn:'cancel', captureConfirmBtn:'takeCards', tableauKicker:'tableauKicker', tableauTitle:'tableauTitle', stackKicker:'stackKicker', stackTitle:'stackTitle', cancelStackBtn:'stackCancel', settingsKicker:'settingsKicker', settingsTitle:'settingsTitle', settingsLanguageLabel:'languageLabel', settingsLanguageCopy:'languageCopy', settingsAnimationsLabel:'animationsLabel', settingsAnimationsCopy:'animationsCopy', deleteAccountKicker:'deleteAccountKicker', deleteAccountTitle:'deleteAccountTitle', deleteAccountCopy:'deleteAccountCopy', deleteAccountBtn:'deleteAccountBtn', cancelDeleteAccountBtn:'deleteAccountCancel', deleteAccountConfirmTitle:'deleteAccountConfirmTitle', deleteAccountConfirmCopy:'deleteAccountConfirmCopy', deleteAccountCopyPreview:'deleteAccountCopyPreview', confirmDeleteAccountBtn:'deleteAccountBtn', closeSettingsBtn:'done',
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
    ['settingsBtn','settings','settingsCopy'], ['friendsBtn','friendsMenu','friendsMenuCopy'], ['rulesMenuBtn','rules','rulesCopy'],
    ['menuPlayBtn','play'], ['modeBackBtn','back'], ['difficultyBackBtn','back'], ['botModeBtn','bot','botCopy','choose'],
  ];
  const setNested = (id, titleKey, copyKey, ctaKey) => {
    const el = $(id); if (!el) return;
    const strong = el.querySelector('strong'); if (strong && titleKey) strong.textContent = t(titleKey);
    const small = el.querySelector('small'); if (small && copyKey) small.textContent = t(copyKey);
    const cta = el.querySelector('.choice-cta'); if (cta && ctaKey) cta.textContent = t(ctaKey);
  };
  setNested('settingsBtn','settings','settingsCopy');
  setNested('friendsBtn','friendsMenu','friendsMenuCopy');
  if(window.__tabinetFriendRequests) renderFriendRequestNotification(window.__tabinetFriendRequests);
  setNested('rulesMenuBtn','rules','rulesCopy');
  $('menuPlayBtn').textContent = t('play');
  $('modeBackBtn').textContent = `← ${t('back')}`;
  $('difficultyBackBtn').textContent = `← ${t('back')}`;
  setNested('botModeBtn','bot','botCopy','choose');
  const real = $('realPlayerBtn');
  if (real) { const title=real.querySelector('.big-choice-title'),copy=real.querySelector('.big-choice-copy'),cta=real.querySelector('.choice-cta'); if(title)title.textContent=t('realPlayer'); if(copy)copy.textContent=t('realCopy'); if(cta)cta.textContent=t('choose'); real.disabled=false; }
  renderPvpRematchNotification(window.__tabinetPvpDashboard?.incoming_rematches||[]);
  set('pvpModeKicker','pvpStep'); set('pvpModeTitle','pvpModeTitle'); set('pvpModeCopy','pvpModeCopy'); set('pvpFriendTitle','pvpFriendTitle'); set('pvpFriendCopy','pvpFriendCopy'); set('pvpMatchmakingChoiceTitle','pvpMatchmakingChoiceTitle'); set('pvpMatchmakingChoiceCopy','pvpMatchmakingChoiceCopy'); set('pvpFriendsTitle','pvpFriendsTitle'); set('pvpFriendsCopy','pvpFriendsCopy'); set('pvpMatchmakingTitle','pvpMatchmakingTitle'); set('pvpSearchingHint','pvpSearchCopy'); set('pvpBackBtn','back'); set('pvpFriendsBackBtn','back'); set('pvpMatchmakingCancelBtn','back'); renderPvpInviteNotification(window.__tabinetPvpDashboard?.incoming_invites||[]); renderPvpFriends();
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
  set('gameTitle',state.selectedMode==='pvp'?'matchPlayer':'matchBot');
  set('playerRailLabel','you'); if($('opponentRailLabel'))$('opponentRailLabel').textContent=state.selectedMode==='pvp'?pvpOpponentName():t('botLabel'); if($('opponentChipName'))$('opponentChipName').textContent=state.selectedMode==='pvp'?pvpOpponentName():t('botLabel'); if($('botMeta'))$('botMeta').textContent=state.selectedMode==='pvp'?t('pvpPlayerLabel'):difficultyLabel(state.difficulty); set('deckCaption','deckRemaining');
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
  const gameCopy = $('gameOverCopy'); if(gameCopy) gameCopy.textContent=state.selectedMode==='pvp'?t('pvpFinishedCopy'):t('gameOverCopy');
  const gameOverTitle = $('gameOverTitle');
  if (gameOverTitle && state.turn === 'done') gameOverTitle.textContent = state.score === state.opponentScore ? t('gameOverDraw') : state.score > state.opponentScore ? t('gameOverWin') : state.selectedMode === 'pvp' ? t('pvpLost') : t('gameOverLoss');
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
  const gameIsPvp=state.selectedMode==='pvp';
  if ($('restartMatchBtn')) $('restartMatchBtn').textContent = gameIsPvp ? t('abandon') : t('newGame');
  if ($('gameOverRematchBtn')) $('gameOverRematchBtn').textContent = gameIsPvp ? t(state.pvpRematchPending ? 'pvpRematchSent' : 'pvpRematch') : t('rematch');
  $('botMeta').textContent=gameIsPvp?t('pvpPlayerLabel'):difficultyLabel(state.difficulty);
  const opponentAvatar=$('opponentAvatar');
  if(opponentAvatar){
    opponentAvatar.classList.toggle('bot-avatar', !gameIsPvp);
    if(gameIsPvp&&state.pvpOpponent?.avatar)renderAvatar(opponentAvatar,state.pvpOpponent.avatar);
    else opponentAvatar.innerHTML='BOT';
  }
  if($('opponentChipName'))$('opponentChipName').textContent=gameIsPvp?pvpOpponentName():t('botLabel');
  if($('opponentRailLabel'))$('opponentRailLabel').textContent=gameIsPvp?pvpOpponentName():t('botLabel');
  $('playerTurnMeta').textContent=state.turn==='player'?t('yourTurn'):gameIsPvp?t('pvpWaitingOpponent'):t('waitBot');
  $('turnBanner').textContent=state.turn==='player'?t('yourTurn'):state.turn==='opponent'?(gameIsPvp?t('pvpOpponentThinking'):t('botThinking')):t('gameEnded');
  $('handHint').textContent=state.turn==='player'?t('tapHint'):gameIsPvp?t('pvpWaitHint'):t('waitHint');
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
  renderPvpAbandonOverlay();
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
        if (isPvpMode()) void syncPvpState('active');
        else if (state.turn === 'opponent') void opponentMove(state.matchToken);
        return;
      }
    }
    endGame();
    return;
  }

  state.turn = state.turn === 'player' ? 'opponent' : 'player';
  renderGame();
  if (isPvpMode()) void syncPvpState('active');
  else if (state.turn === 'opponent') void opponentMove(state.matchToken);
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
  void tabinetRpc('tabinet_record_bot_match', {
    p_player_id: profile.id,
    p_device_token: getFriendsDeviceToken(),
    p_difficulty: state.difficulty,
    p_player_score: state.score,
    p_bot_score: state.opponentScore,
    p_result: entry.result
  }).catch(() => {});
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
  const wasPvp=isPvpMode();
  state.turn = 'done';
  addMatchEvent(state.lastTaker || 'system', state.message, 'end');
  renderGame();
  const winnerId=pvpWinnerFromLocalState();
  if(wasPvp){recordPvpBattleResult(false,winnerId);void syncPvpState('completed',winnerId);}else{recordBattleResult();renderBattleLog();}
  $('finalPlayerScore').textContent = state.score;
  $('finalBotScore').textContent = state.opponentScore;
  $('finalBotLabel').textContent = wasPvp ? pvpOpponentName() : t('opponentBot');
  $('gameOverTitle').textContent = state.score === state.opponentScore ? t('gameOverDraw') : state.score > state.opponentScore ? t('gameOverWin') : wasPvp ? t('pvpLost') : t('gameOverLoss');
  $('gameOverCopy').textContent = wasPvp ? t('pvpFinishedCopy') : t('gameOverCopy');
  $('gameOverDialog').showModal();
  const result = state.score === state.opponentScore ? 'draw' : state.score > state.opponentScore ? 'victory' : 'defeat';
  playTone(result);
}

async function startMatch(difficulty = state.difficulty) {
  state.selectedMode='bot'; state.pvpMatchId=null; state.pvpMatchVersion=0; state.pvpOpponent=null; state.pvpTerminalHandled=false;
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
  state.message = state.turn === 'player' ? t('playerStarts') : state.selectedMode === 'pvp' ? t('pvpOpponentStarts') : t('botStarts');
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
  if (state.selectedMode === 'pvp') void syncPvpInitialize();
  else if (state.turn === 'opponent') window.setTimeout(() => opponentMove(state.matchToken), motionDelay('deal') + 70);
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
async function deleteAccount() {
  const dialog = $('deleteAccountDialog');
  const status = $('deleteAccountStatus');
  const confirmBtn = $('confirmDeleteAccountBtn');
  if (!dialog || !confirmBtn) return;
  if (!tabinetSupabase) {
    if (status) status.textContent = t('deleteAccountBackendError');
    return;
  }
  confirmBtn.disabled = true;
  if (status) status.textContent = t('deleteAccountDeleting');
  try {
    const result = await tabinetRpc('tabinet_delete_account', {
      p_player_id: profile.id,
      p_device_token: getFriendsDeviceToken()
    });
    if (!result || !result.ok) {
      if (status) status.textContent = t('deleteAccountError');
      confirmBtn.disabled = false;
      return;
    }
    if (window.__tabinetFriendsChannel) {
      try { await tabinetSupabase.removeChannel(window.__tabinetFriendsChannel); } catch {}
      window.__tabinetFriendsChannel = null;
    }
    closeFriendsTimers();
    if (friendsHeartbeatTimer) { clearInterval(friendsHeartbeatTimer); friendsHeartbeatTimer = null; }
    if (friendsBackgroundRefreshTimer) { clearInterval(friendsBackgroundRefreshTimer); friendsBackgroundRefreshTimer = null; }
    try { document.querySelectorAll('dialog').forEach(item => { if (item.open) item.close(); }); } catch {}
    try { Object.keys(localStorage).forEach(key => { if (key.startsWith('tabinet-')) localStorage.removeItem(key); }); } catch {}
    try { Object.keys(sessionStorage).forEach(key => { if (key.startsWith('tabinet-')) sessionStorage.removeItem(key); }); } catch {}
    window.location.replace('./?account-reset=' + Date.now());
  } catch {
    if (status) status.textContent = t('deleteAccountError');
    confirmBtn.disabled = false;
  }
}

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
$('realPlayerBtn').addEventListener('click', () => { playTone('button'); openPvpMode(); });
$('pvpBackBtn').addEventListener('click', () => { playTone('button'); showScreen('modeScreen'); });
$('pvpFriendsBtn').addEventListener('click', () => { playTone('button'); openPvpFriends(); });
$('pvpMatchmakingBtn').addEventListener('click', () => { playTone('button'); void startPvpMatchmaking(); });
$('pvpFriendsBackBtn').addEventListener('click', () => { playTone('button'); showScreen('pvpModeScreen'); });
$('pvpMatchmakingCancelBtn').addEventListener('click', () => { playTone('button'); void cancelPvpMatchmaking(); });
$('pvpFriendsList').addEventListener('click', event => {
  const btn=event.target.closest('.pvp-invite-friend'),cancel=event.target.closest('.pvp-cancel-invite');
  if(btn){playTone('button');void sendPvpInvite(btn.dataset.playerId);}
  if(cancel){playTone('button');void cancelPvpInvite(cancel.dataset.inviteId);}
});

$('pvpRematchNotification').addEventListener('click', event => {
  const accept=event.target.closest('.pvp-rematch-accept'),reject=event.target.closest('.pvp-rematch-reject');
  if(accept){playTone('button');void respondToPvpRematch(accept.dataset.rematchId,true);}
  if(reject){playTone('button');void respondToPvpRematch(reject.dataset.rematchId,false);}
});
$('pvpInviteNotification').addEventListener('click', event => { const accept=event.target.closest('.pvp-invite-accept'),reject=event.target.closest('.pvp-invite-reject'); if(accept){playTone('button');void respondToPvpInvite(accept.dataset.inviteId,true);} if(reject){playTone('button');void respondToPvpInvite(reject.dataset.inviteId,false);} });
$('modeBackBtn').addEventListener('click', () => { playTone('button'); showScreen('menuScreen'); });
$('difficultyBackBtn').addEventListener('click', () => { playTone('button'); showScreen('modeScreen'); });
document.querySelectorAll('.difficulty-card').forEach(btn => btn.addEventListener('click', () => { playTone('button'); void startMatch(btn.dataset.difficulty); }));
$('settingsBtn').addEventListener('click', () => { playTone('button'); openSettings(); });
$('gameSettingsBtn').addEventListener('click', () => { playTone('button'); openSettings(); });
$('closeSettingsBtn').addEventListener('click', () => { playTone('button'); $('settingsDialog').close(); });
$('deleteAccountBtn').addEventListener('click', () => {
  playTone('button');
  $('deleteAccountStatus').textContent = '';
  $('confirmDeleteAccountBtn').disabled = false;
  $('deleteAccountDialog').showModal();
});
$('cancelDeleteAccountBtn').addEventListener('click', () => {
  playTone('button');
  $('deleteAccountDialog').close();
});
$('confirmDeleteAccountBtn').addEventListener('click', () => {
  playTone('button');
  void deleteAccount();
});
$('soundToggle').addEventListener('click', () => { settings.sound = !settings.sound; saveSettings(); updateSettingsUI(); if (settings.sound) playTone('success'); else playTone('button'); });
$('soundVolume').addEventListener('input', event => { settings.volume = Math.min(1, Math.max(0, Number(event.target.value) / 100)); event.target.style.setProperty('--volume-pct', `${Math.round(settings.volume * 100)}%`); saveSettings(); $('soundVolumeValue').textContent = `${Math.round(settings.volume * 100)}%`; $('soundVolume').setAttribute('aria-valuetext', `${Math.round(settings.volume * 100)}%`); });
$('soundVolume').addEventListener('change', () => playTone('success'));
$('animationToggle').addEventListener('click', () => { settings.animations = !settings.animations; if (!settings.animations) { state.animating = false; } saveSettings(); updateSettingsUI(); playTone('button'); });
$('profileMenuBtn').addEventListener('click', () => { playTone('button'); openProfile(); });
$('closeProfileBtn').addEventListener('click', () => {
  playTone('button');
  $('profileDialog').close();
  forceModalCleanup();
});
$('profileNameInput').addEventListener('pointerdown', event => {
  const input = $('profileNameInput');
  if (!input || !input.readOnly) return;
  event.preventDefault();
  input.readOnly = false;
  input.tabIndex = 0;
  input.setAttribute('aria-readonly', 'false');
  input.focus({ preventScroll: true });
});
$('profileNameInput').addEventListener('blur', () => {
  const input = $('profileNameInput');
  if (!input) return;
  input.readOnly = true;
  input.tabIndex = -1;
  input.setAttribute('aria-readonly', 'true');
});
$('profileNameInput').addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  $('profileNameInput').blur();
});
$('saveProfileBtn').addEventListener('click', () => {
  profile.name = currentProfileName();
  const saved = saveProfile();
  renderProfile();
  if (saved) {
    $('profileDialog').close();
    playTone('success');
  } else {
    playTone('click');
  }
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
$('friendsBtn').addEventListener('click', () => { playTone('button'); openFriends(); });
$('closeFriendsBtn').addEventListener('click', () => { playTone('button'); closeFriendsTimers(); $('friendsDialog').close(); forceModalCleanup(); });
$('addFriendBtn').addEventListener('click', () => { playTone('button'); openFriendSearch(); });
$('closeFriendSearchBtn').addEventListener('click', () => { playTone('button'); $('friendSearchDialog').close(); forceModalCleanup(); });
$('friendSearchBtn').addEventListener('click', () => { playTone('button'); searchFriendById(); });
$('friendSearchInput').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchFriendById(); } });
$('friendSearchResult').addEventListener('click', event => {
  const closeBtn = event.target.closest('.friend-search-close-result');
  const addBtn = event.target.closest('.friend-search-add-result');
  const box = $('friendSearchResult');
  if (closeBtn) { box.innerHTML=''; box.classList.add('hidden'); return; }
  if (addBtn && !addBtn.disabled) {
    addBtn.disabled = true;
    void tabinetRpc('tabinet_send_friend_request', {
      p_from_player_id:profile.id,
      p_to_player_id:addBtn.dataset.playerId,
      p_device_token:getFriendsDeviceToken()
    }).then(send => {
      if (send && send.ok) {
        $('friendSearchStatus').textContent = t('friendRequestSent');
        if (window.__tabinetFriendSearchProfile) void renderFriendSearchCard(window.__tabinetFriendSearchProfile);
      } else {
        $('friendSearchStatus').textContent = t('friendErr_' + (send && send.error || 'generic'));
        addBtn.disabled = false;
      }
    }).catch(() => {
      $('friendSearchStatus').textContent=t('friendBackendError');
      addBtn.disabled=false;
    });
  }
});
$('friendRequestsList').addEventListener('click', event => {
  const accept=event.target.closest('.friend-accept'), reject=event.target.closest('.friend-reject');
  if(accept){playTone('button');void respondToFriendRequest(accept.dataset.requestId,true);}
  if(reject){playTone('button');void respondToFriendRequest(reject.dataset.requestId,false);}
});
$('friendsList').addEventListener('click', event => {
  const view=event.target.closest('.friend-view'), del=event.target.closest('.friend-delete');
  if(view){playTone('button');openFriendProfile(view.dataset.playerId);}
  if(del){playTone('button');openDeleteFriendWarning(del.dataset.playerId);}
});
$('friendRequestNotification').addEventListener('click', event => {
  const accept=event.target.closest('.friend-notify-accept'), reject=event.target.closest('.friend-notify-reject');
  if(accept){playTone('button');void respondToFriendRequest(accept.dataset.requestId,true);}
  if(reject){playTone('button');void respondToFriendRequest(reject.dataset.requestId,false);}
});
$('closeFriendProfileBtn').addEventListener('click',()=>{
  playTone('button');
  const dialog=$('friendProfileDialog');
  if(dialog?.open) dialog.close();
  syncModalScrollLock();
  if (window.__reopenFriendsAfterProfile) {
    window.__reopenFriendsAfterProfile=false;
    requestAnimationFrame(()=>openFriends());
  }
});
$('closeDeleteFriendBtn').addEventListener('click',()=>{$('deleteFriendDialog').close();syncModalScrollLock();});
$('cancelDeleteFriendBtn').addEventListener('click',()=>{$('deleteFriendDialog').close();syncModalScrollLock();});
$('confirmDeleteFriendBtn').addEventListener('click',()=>{playTone('button');void deleteFriend($('deleteFriendDialog').dataset.playerId);});
$('rulesMenuBtn').addEventListener('click', () => { playTone('button'); openRules(); });
$('closeRulesBtn').addEventListener('click', () => {
  playTone('button');
  $('rulesDialog').close();
  forceModalCleanup();
});
$('gameMenuBtn').addEventListener('click', () => { playTone('button'); if(isPvpMode()) void abandonPvpMatch(); else pauseCurrentMatch(); });
$('restartMatchBtn').addEventListener('click', () => { playTone('button'); if (isPvpMode()) void abandonPvpMatch(); else void startMatch(state.difficulty); });
$('rejoinMatchBtn').addEventListener('click', () => { playTone('button'); restoreMatchFromPause(); });
$('abandonMatchBtn').addEventListener('click', () => { playTone('button'); abandonPausedMatch('manual'); });
$('gameOverMenuBtn').addEventListener('click', () => { playTone('button'); goToMenu(); });
$('gameOverRematchBtn').addEventListener('click', () => {
  playTone('button');
  if(isPvpMode())void requestPvpRematch();
  else{$('gameOverDialog').close();void startMatch(state.difficulty);}
});
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
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=083-pvp-features').catch(() => {});

applyLanguage();
dialogElements().forEach(dialog => {
  dialog.addEventListener('close', () => {
    syncModalScrollLock();
    if (!dialogElements().some(item => item.open)) forceModalCleanup();
  });
});
if (document.body) {
  modalScrollObserver.observe(document.body, { subtree:true, attributes:true, attributeFilter:['open'] });
  document.addEventListener('wheel', preventBackgroundScroll, { passive:false });
  document.addEventListener('touchmove', preventBackgroundScroll, { passive:false });
  // Do not cancel touch gestures on the main menu.
  // Mobile browsers need the natural touch stream so taps still synthesize
  // click events and short screens can scroll the menu when necessary.
  syncModalScrollLock();
}

// Start the UI loading sequence before optional profile/friends/network work.
bootLoading();

try { renderBattleLog(); } catch {}
try { renderHistoryEntries(); } catch {}
try { renderProfile(); } catch {}
try { renderResumeBar(); } catch {}
try { startFriendsHeartbeat(); } catch {}
try { startFriendsRealtime(); } catch {}
try { startPvpPolling(); } catch {}

// Safety net: a backend/browser API issue must never leave the app on the loading screen.
window.setTimeout(() => {
  if (state.screen === 'loading') showScreen('menuScreen');
}, 3500);
