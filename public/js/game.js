/**
 * 德州扑克春节版 - 前端逻辑
 * 负责：首页创建/加入、大厅、游戏界面、聊天、局记录展示
 * 支持断线重连与国内网络环境
 */

const socket = io({
  reconnection: true,
  reconnectionAttempts: 15,
  reconnectionDelay: 1500,
  reconnectionDelayMax: 8000,
  timeout: 20000,
  transports: ['websocket', 'polling']
});

// ---------- 状态 ----------
let currentRoomId = null;
let currentRoom = null;
let mySocketId = null;
let isHost = false;

// 进入房间时存一份房间号，断线后可提示玩家
function saveRoomForRejoin() {
  if (currentRoomId) try { sessionStorage.setItem('poker_roomId', currentRoomId); } catch (e) {}
}
function getSavedRoomId() {
  try { return sessionStorage.getItem('poker_roomId'); } catch (e) { return null; }
}
function clearSavedRoom() {
  try { sessionStorage.removeItem('poker_roomId'); } catch (e) {}
}

// ---------- 连接状态提示（方便中国玩家在弱网下知道是否断线） ----------
let hasEverDisconnected = false;
function showConnectionStatus(type, roomHint) {
  const id = 'connection-status-bar';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'connection-status-bar';
    document.body.appendChild(el);
  }
  el.className = 'connection-status-bar connection-status-' + type;
  if (type === 'disconnected') {
    hasEverDisconnected = true;
    el.innerHTML = '网络已断开。请刷新页面并重新加入房间' + (roomHint ? '（房间号：' + roomHint + '）' : '') + '。';
  } else if (type === 'reconnecting') {
    hasEverDisconnected = true;
    el.textContent = '正在重新连接…';
  } else if (type === 'connected') {
    if (!hasEverDisconnected) { el.style.display = 'none'; return; }
    el.textContent = '连接已恢复';
    setTimeout(function () { el.style.display = 'none'; }, 2000);
    return;
  }
  el.style.display = 'block';
}

// ---------- DOM ----------
const screens = {
  home: document.getElementById('screen-home'),
  lobby: document.getElementById('screen-lobby'),
  game: document.getElementById('screen-game')
};

function showScreen(name) {
  Object.keys(screens).forEach(k => { screens[k].classList.remove('active'); });
  if (screens[name]) screens[name].classList.add('active');
}

// ---------- 牌面显示 ----------
function cardToChar(card) {
  if (!card) return '';
  const suitChar = { s: '♠', h: '♥', d: '♦', c: '♣' }[card.suit] || '';
  const red = card.suit === 'h' || card.suit === 'd';
  return { rank: card.rank, suit: suitChar, red };
}

function renderCardEl(card, faceDown) {
  const div = document.createElement('div');
  div.className = 'card-face' + (card && (card.suit === 'h' || card.suit === 'd') ? ' red' : '');
  if (faceDown || !card) {
    div.classList.add('back');
    div.textContent = '?';
  } else {
    const c = cardToChar(card);
    div.textContent = c.rank + c.suit;
    if (c.red) div.classList.add('red');
  }
  return div;
}

// ---------- 首页 ----------
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    const panel = document.getElementById('panel-' + tab);
    if (panel) panel.classList.add('active');
  });
});

document.getElementById('btn-create').addEventListener('click', () => {
  const maxPlayers = Math.min(10, Math.max(4, parseInt(document.getElementById('input-maxPlayers').value, 10) || 6));
  const smallBlind = Math.max(1, parseInt(document.getElementById('input-smallBlind').value, 10) || 10);
  const bigBlind = Math.max(1, parseInt(document.getElementById('input-bigBlind').value, 10) || 20);
  const playerName = (document.getElementById('input-create-name').value || '房主').trim().slice(0, 20);
  socket.emit('createRoom', { maxPlayers, smallBlind, bigBlind, playerName }, (res) => {
    if (!res.ok) {
      alert(res.message || '创建失败');
      return;
    }
    currentRoomId = res.roomId;
    currentRoom = res.room;
    mySocketId = socket.id;
    isHost = true;
    saveRoomForRejoin();
    renderLobby();
    showScreen('lobby');
  });
});

document.getElementById('btn-join').addEventListener('click', () => {
  const roomId = (document.getElementById('input-roomId').value || '').trim();
  const playerName = (document.getElementById('input-join-name').value || '玩家').trim().slice(0, 20);
  if (!roomId) {
    alert('请输入房间号');
    return;
  }
  socket.emit('joinRoom', { roomId, playerName }, (res) => {
    if (!res.ok) {
      alert(res.message || '加入失败');
      return;
    }
    currentRoomId = res.roomId;
    currentRoom = res.room;
    mySocketId = socket.id;
    isHost = false;
    saveRoomForRejoin();
    renderLobby();
    showScreen('lobby');
  });
});

// ---------- 大厅 ----------
function renderLobby() {
  if (!currentRoom) return;
  document.getElementById('lobby-roomId').textContent = currentRoom.id;
  document.getElementById('lobby-players-count').textContent = currentRoom.players.length;
  document.getElementById('lobby-max-players').textContent = currentRoom.maxPlayers;
  document.getElementById('lobby-sb').textContent = currentRoom.smallBlind;
  document.getElementById('lobby-bb').textContent = currentRoom.bigBlind;

  const list = document.getElementById('lobby-player-list');
  list.innerHTML = '';
  currentRoom.players.forEach(p => {
    const li = document.createElement('li');
    li.textContent = p.name + (p.id === currentRoom.hostSocketId ? ' (房主)' : '');
    list.appendChild(li);
  });

  const me = currentRoom.players.find(p => p.id === mySocketId);
  const nameInput = document.getElementById('lobby-my-name');
  if (me) nameInput.value = me.name;

  document.getElementById('btn-start-game').disabled = !isHost || currentRoom.players.length < 2;

  // 聊天记录
  const chatDiv = document.getElementById('chat-messages');
  chatDiv.innerHTML = '';
  (currentRoom.chatMessages || []).forEach(m => appendChatMessage(chatDiv, m));

  // 对局记录
  const historyDiv = document.getElementById('lobby-hand-history');
  historyDiv.innerHTML = '';
  (currentRoom.handHistory || []).forEach(h => {
    const item = document.createElement('div');
    item.className = 'hand-item';
    item.textContent = `第${h.handNumber}局 赢家: ${h.winnerNames.join(', ')} 底池: ${h.pot}`;
    historyDiv.appendChild(item);
  });
}

document.getElementById('btn-copy-room').addEventListener('click', () => {
  if (!currentRoomId) return;
  navigator.clipboard.writeText(currentRoomId).then(() => alert('房间号已复制到剪贴板')).catch(() => alert('房间号: ' + currentRoomId));
});

document.getElementById('btn-leave-lobby').addEventListener('click', () => {
  currentRoomId = null;
  currentRoom = null;
  clearSavedRoom();
  showScreen('home');
});

document.getElementById('btn-set-name').addEventListener('click', () => {
  const name = (document.getElementById('lobby-my-name').value || '').trim().slice(0, 20);
  if (!name || !currentRoomId) return;
  socket.emit('setPlayerName', { roomId: currentRoomId, name }, () => renderLobby());
});

document.getElementById('btn-start-game').addEventListener('click', () => {
  if (!currentRoomId || !isHost) return;
  const btn = document.getElementById('btn-start-game');
  btn.disabled = true;
  socket.emit('startGame', currentRoomId, (res) => {
    if (res.ok) {
      // 成功由 gameStarted 事件切换界面，这里不需要再操作
    } else {
      btn.disabled = false;
      // 若是「游戏已在进行」，直接同步到游戏界面
      if (res.room && res.message === '当前状态无法开始') {
        currentRoom = res.room;
        showScreen('game');
        renderGame();
        return;
      }
      alert(res.message || '无法开始');
    }
  });
});

// 聊天
function appendChatMessage(container, msg) {
  const p = document.createElement('p');
  p.className = 'chat-msg';
  p.innerHTML = '<span class="name">' + escapeHtml(msg.name) + '</span>: ' + escapeHtml(msg.text);
  container.appendChild(p);
  container.scrollTop = container.scrollHeight;
}
function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

document.getElementById('btn-chat-send').addEventListener('click', sendLobbyChat);
document.getElementById('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendLobbyChat(); });
function sendLobbyChat() {
  const input = document.getElementById('chat-input');
  const text = (input.value || '').trim();
  if (!text || !currentRoomId) return;
  socket.emit('chat', { roomId: currentRoomId, text });
  input.value = '';
}

// ---------- Socket 事件（含断线重连提示，确保中国玩家可知连接状态） ----------
socket.on('connect', () => {
  mySocketId = socket.id;
  showConnectionStatus('connected');
});

socket.on('disconnect', (reason) => {
  const roomHint = currentRoomId || getSavedRoomId();
  if (reason === 'io server disconnect') {
    showConnectionStatus('disconnected', roomHint);
  } else {
    showConnectionStatus('reconnecting');
  }
});

socket.on('reconnect', () => {
  showConnectionStatus('connected');
  // 重连后 socket.id 已变，若还在房间内需由服务端 roomUpdate 更新状态
});

socket.on('reconnect_failed', () => {
  showConnectionStatus('disconnected', currentRoomId || getSavedRoomId());
});

socket.on('roomUpdate', (room) => {
  currentRoom = room;
  if (room.gameState === 'lobby') {
    if (screens.lobby.classList.contains('active')) renderLobby();
  } else {
    // 游戏中或局间：若当前还在大厅则自动切到游戏界面，避免「当前状态无法开始」
    if (screens.lobby.classList.contains('active')) {
      showScreen('game');
    }
    if (screens.game.classList.contains('active')) renderGame();
  }
});

socket.on('gameStarted', (room) => {
  currentRoom = room;
  showScreen('game');
  renderGame();
});

socket.on('yourTurn', (data) => {
  if (data.roomId !== currentRoomId) return;
  currentRoom = currentRoom || {};
  currentRoom.currentPlayerIndex = data.currentPlayerIndex;
  renderGame();
});

socket.on('chatMessage', (msg) => {
  const lobbyChat = document.getElementById('chat-messages');
  const gameChat = document.getElementById('game-chat-messages');
  if (lobbyChat && lobbyChat.parentElement && !lobbyChat.parentElement.classList.contains('hidden')) appendChatMessage(lobbyChat, msg);
  if (gameChat) appendChatMessage(gameChat, msg);
});

socket.on('handEnd', (data) => {
  const modal = document.getElementById('hand-result-modal');
  const body = document.getElementById('hand-result-body');
  if (!body) return;
  const r = data.handResult;
  let html = '<p>赢家: <strong>' + (r.winnerNames && r.winnerNames.join(', ')) + '</strong></p>';
  html += '<p>底池: ' + (r.pot || 0) + '</p>';
  if (r.playerResults && r.playerResults.length) {
    html += '<ul style="margin-top:0.5rem; padding-left:1.2rem;">';
    r.playerResults.forEach(pr => {
      const change = pr.chipsChange > 0 ? '+' + pr.chipsChange : pr.chipsChange;
      html += '<li>' + escapeHtml(pr.name) + ': ' + change + '</li>';
    });
    html += '</ul>';
  }
  body.innerHTML = html;
  modal.classList.remove('hidden');
});

document.getElementById('btn-close-hand-result').addEventListener('click', () => {
  document.getElementById('hand-result-modal').classList.add('hidden');
  if (currentRoom) renderGame();
});

// ---------- 游戏界面 ----------
function renderGame() {
  if (!currentRoom) return;
  const betweenPanel = document.getElementById('between-hands-panel');
  const actionsPanel = document.getElementById('game-actions');
  if (currentRoom.gameState === 'betweenHands') {
    if (betweenPanel) betweenPanel.classList.remove('hidden');
    if (actionsPanel) actionsPanel.classList.add('hidden');
    document.getElementById('game-roomId').textContent = currentRoom.id;
    document.getElementById('game-pot').textContent = currentRoom.pot || 0;
    document.getElementById('btn-next-hand').disabled = !isHost;
    renderGamePlayersOnly();
    return;
  }
  if (currentRoom.gameState !== 'playing') return;
  if (betweenPanel) betweenPanel.classList.add('hidden');
  if (actionsPanel) actionsPanel.classList.remove('hidden');
  document.getElementById('game-roomId').textContent = currentRoom.id;
  document.getElementById('game-pot').textContent = currentRoom.pot || 0;

  const communityEl = document.getElementById('game-community-cards');
  communityEl.innerHTML = '';
  (currentRoom.communityCards || []).forEach(c => communityEl.appendChild(renderCardEl(c, false)));

  const playersEl = document.getElementById('game-players');
  playersEl.innerHTML = '';
  const me = currentRoom.players.find(p => p.id === mySocketId);
  const myIndex = me ? currentRoom.players.indexOf(me) : -1;
  currentRoom.players.forEach((p, i) => {
    const seat = document.createElement('div');
    seat.className = 'player-seat';
    if (i === currentRoom.dealerIndex) seat.classList.add('is-dealer');
    if (i === currentRoom.currentPlayerIndex) seat.classList.add('is-turn');
    if (p.folded) seat.classList.add('folded');
    seat.innerHTML = '<div class="name">' + escapeHtml(p.name) + '</div><div class="chips">' + (p.chips || 0) + '</div>';
    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'cards';
    const showCards = p.id === mySocketId || p.folded;
    (p.cards || []).forEach(c => cardsDiv.appendChild(renderCardEl(c, !showCards)));
    seat.appendChild(cardsDiv);
    playersEl.appendChild(seat);
  });

  const historyList = document.getElementById('game-hand-history-list');
  if (historyList) {
    historyList.innerHTML = '';
    (currentRoom.handHistory || []).slice(-20).reverse().forEach(h => {
      const item = document.createElement('div');
      item.className = 'hand-item';
      item.textContent = `第${h.handNumber}局 赢家: ${(h.winnerNames || []).join(', ')} 底池: ${h.pot || 0}`;
      historyList.appendChild(item);
    });
  }

  const isMyTurn = currentRoom.currentPlayerIndex >= 0 && currentRoom.players[currentRoom.currentPlayerIndex] && currentRoom.players[currentRoom.currentPlayerIndex].id === mySocketId;
  const actionHint = document.getElementById('action-hint');
  const actionBtns = document.querySelectorAll('.action-btn');
  const toCall = (currentRoom.currentBet || 0) - (me ? (me.betThisRound || 0) : 0);

  if (isMyTurn && me && !me.folded && !me.allIn) {
    actionHint.textContent = '轮到你行动。当前跟注额: ' + toCall + '，底池: ' + (currentRoom.pot || 0);
    actionBtns.forEach(btn => {
      btn.disabled = false;
      const act = btn.dataset.action;
      if (act === 'check' && toCall > 0) btn.disabled = true;
      if (act === 'call') btn.textContent = toCall > 0 ? '跟注 ' + Math.min(toCall, me.chips) : '过牌';
    });
  } else {
    actionHint.textContent = isMyTurn ? '请等待...' : (currentRoom.players[currentRoom.currentPlayerIndex] ? currentRoom.players[currentRoom.currentPlayerIndex].name + ' 行动中' : '');
    actionBtns.forEach(btn => { btn.disabled = true; });
  }
}

document.querySelectorAll('.action-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    if (!currentRoomId || !action) return;
    const me = currentRoom && currentRoom.players.find(p => p.id === mySocketId);
    if (!me || me.folded || me.allIn) return;
    const amount = parseInt(document.getElementById('input-bet-amount').value, 10) || 0;
    socket.emit('playerAction', { roomId: currentRoomId, action, amount }, (res) => {
      if (!res.ok) alert(res.message || '操作失败');
      else if (currentRoom) renderGame();
    });
  });
});

document.getElementById('btn-leave-game').addEventListener('click', () => {
  currentRoomId = null;
  currentRoom = null;
  clearSavedRoom();
  showScreen('home');
});

document.getElementById('btn-toggle-chat').addEventListener('click', () => {
  const panel = document.getElementById('game-chat-panel');
  panel.classList.toggle('hidden');
});
document.getElementById('btn-game-chat-send').addEventListener('click', () => {
  const input = document.getElementById('game-chat-input');
  const text = (input.value || '').trim();
  if (!text || !currentRoomId) return;
  socket.emit('chat', { roomId: currentRoomId, text });
  input.value = '';
});
document.getElementById('game-chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-game-chat-send').click();
});

document.getElementById('btn-next-hand').addEventListener('click', () => {
  if (!currentRoomId || !isHost) return;
  socket.emit('startGame', currentRoomId, (res) => {
    if (!res.ok) alert(res.message || '无法开始下一局');
    else if (currentRoom) renderGame();
  });
});

function renderGamePlayersOnly() {
  const playersEl = document.getElementById('game-players');
  const communityEl = document.getElementById('game-community-cards');
  if (!playersEl || !currentRoom) return;
  communityEl.innerHTML = '';
  (currentRoom.communityCards || []).forEach(c => communityEl.appendChild(renderCardEl(c, false)));
  playersEl.innerHTML = '';
  currentRoom.players.forEach((p, i) => {
    const seat = document.createElement('div');
    seat.className = 'player-seat' + (p.folded ? ' folded' : '');
    seat.innerHTML = '<div class="name">' + escapeHtml(p.name) + '</div><div class="chips">' + (p.chips || 0) + '</div>';
    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'cards';
    (p.cards || []).forEach(c => cardsDiv.appendChild(renderCardEl(c, false)));
    seat.appendChild(cardsDiv);
    playersEl.appendChild(seat);
  });
}
