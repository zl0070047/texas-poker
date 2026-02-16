/**
 * 德州扑克春节版 - 服务端
 * 功能：房间管理、4-10人局、大小盲设定、每局记录、Socket 实时通信与聊天
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- 牌面与牌力 ----------
const SUITS = ['s', 'h', 'd', 'c']; // 黑桃 红心 方片 梅花
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

function createDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
  return shuffle(deck);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 从 7 张牌中选 5 张得到最大牌型与关键值（用于比牌）
function evaluateHand(cards) {
  if (cards.length < 5) return { rank: 0, values: [] };
  const all = combinations(cards, 5);
  let best = { rank: 0, values: [] };
  for (const five of all) {
    const e = evaluateFive(five);
    if (compareHands(e, best) > 0) best = e;
  }
  return best;
}

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map(c => [first, ...c]);
  const without = combinations(rest, k);
  return [...withFirst, ...without];
}

// 牌型等级：0 高牌, 1 一对, 2 两对, 3 三条, 4 顺子, 5 同花, 6 葫芦, 7 四条, 8 同花顺, 9 皇家同花顺
function evaluateFive(five) {
  const values = five.map(c => RANK_VALUES[c.rank]).sort((a, b) => b - a);
  const suits = five.map(c => c.suit);
  const countRank = (v) => values.filter(x => x === v).length;
  const isFlush = suits.every(s => s === suits[0]);
  const sorted = [...new Set(values)].sort((a, b) => b - a);
  const isStraight = (() => {
    const s = [...values].sort((a, b) => b - a);
    for (let i = 0; i < s.length - 1; i++) if (s[i] - s[i + 1] !== 1) return false;
    return true;
  })();
  const isAceLow = values.includes(14) && values.includes(5) && values.includes(4) && values.includes(3) && values.includes(2);
  const straightValue = isAceLow ? 5 : sorted[0];

  if (isFlush && isStraight) return { rank: straightValue === 14 ? 9 : 8, values: [straightValue] };
  if (isFlush) return { rank: 5, values: sorted };
  if (isStraight || isAceLow) return { rank: 4, values: [straightValue] };

  const counts = {};
  values.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  const byCount = Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const quads = byCount.find(([, c]) => c === 4);
  const trips = byCount.find(([, c]) => c === 3);
  const pairs = byCount.filter(([, c]) => c === 2);

  if (quads) return { rank: 7, values: [Number(quads[0]), ...sorted.filter(x => x !== Number(quads[0]))] };
  if (trips && pairs.length) return { rank: 6, values: [Number(trips[0]), Number(pairs[0][0])] };
  if (trips) return { rank: 3, values: [Number(trips[0]), ...sorted.filter(x => x !== Number(trips[0]))] };
  if (pairs.length >= 2) {
    const pv = pairs.map(p => Number(p[0])).sort((a, b) => b - a);
    return { rank: 2, values: [...pv, ...sorted.filter(x => !pv.includes(x))] };
  }
  if (pairs.length === 1) return { rank: 1, values: [Number(pairs[0][0]), ...sorted.filter(x => x !== Number(pairs[0][0]))] };
  return { rank: 0, values: sorted };
}

function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.values.length, b.values.length); i++) {
    const va = a.values[i] || 0, vb = b.values[i] || 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

// ---------- 房间与对局状态 ----------
const rooms = new Map(); // roomId -> Room
const PLAYER_ACTIONS = { FOLD: 'fold', CHECK: 'check', CALL: 'call', BET: 'bet', RAISE: 'raise', ALL_IN: 'allIn' };

function generateRoomId() {
  let id;
  do { id = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(id));
  return id;
}

function createRoom(options) {
  const roomId = generateRoomId();
  const room = {
    id: roomId,
    maxPlayers: Math.min(10, Math.max(4, options.maxPlayers || 6)),
    smallBlind: Math.max(1, options.smallBlind || 10),
    bigBlind: Math.max(1, options.bigBlind || 20),
    players: [],
    hostSocketId: null,
    gameState: 'lobby', // lobby | playing | betweenHands
    handNumber: 0,
    deck: [],
    communityCards: [],
    pot: 0,
    currentBet: 0,
    dealerIndex: -1,
    smallBlindIndex: -1,
    bigBlindIndex: -1,
    currentPlayerIndex: -1,
    handHistory: [],
    chatMessages: []
  };
  rooms.set(roomId, room);
  return room;
}

function addPlayerToRoom(roomId, socketId, name) {
  const room = rooms.get(roomId);
  if (!room || room.players.length >= room.maxPlayers || room.gameState !== 'lobby') return null;
  const p = {
    id: socketId,
    name: name || `玩家${room.players.length + 1}`,
    chips: 1000,
    cards: [],
    folded: false,
    allIn: false,
    betThisRound: 0,
    totalBetThisHand: 0,
    sitIndex: room.players.length
  };
  room.players.push(p);
  if (room.players.length === 1) room.hostSocketId = socketId;
  return p;
}

function removePlayerFromRoom(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const i = room.players.findIndex(p => p.id === socketId);
  if (i === -1) return;
  room.players.splice(i, 1);
  if (room.players.length === 0) { rooms.delete(roomId); return; }
  if (room.hostSocketId === socketId) room.hostSocketId = room.players[0].id;
  if (room.gameState === 'playing') {
    // 若正在游戏中，该玩家视为弃牌/离座，不重排座位，仅标记离开
    const p = room.players.find(pp => pp.id === socketId);
    if (p) p.folded = true;
  }
}

function startGame(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.gameState !== 'lobby' || room.players.length < 2) return false;
  room.gameState = 'playing';
  room.handNumber++;
  room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
  room.smallBlindIndex = (room.dealerIndex + 1) % room.players.length;
  room.bigBlindIndex = (room.dealerIndex + 2) % room.players.length;
  room.deck = createDeck();
  room.communityCards = [];
  room.pot = 0;
  room.currentBet = room.bigBlind;
  room.players.forEach(p => {
    p.cards = [];
    p.folded = false;
    p.allIn = false;
    p.betThisRound = 0;
    p.totalBetThisHand = 0;
  });
  // 发牌
  for (let i = 0; i < 2; i++)
    room.players.forEach(p => { p.cards.push(room.deck.pop()); });
  // 下盲注
  const sb = room.players[room.smallBlindIndex];
  const bb = room.players[room.bigBlindIndex];
  const sbAmount = Math.min(room.smallBlind, sb.chips);
  const bbAmount = Math.min(room.bigBlind, bb.chips);
  sb.chips -= sbAmount; sb.betThisRound = sbAmount; sb.totalBetThisHand = sbAmount;
  bb.chips -= bbAmount; bb.betThisRound = bbAmount; bb.totalBetThisHand = bbAmount;
  room.pot = sbAmount + bbAmount;
  if (sb.chips <= 0) sb.allIn = true;
  if (bb.chips <= 0) bb.allIn = true;
  room.currentPlayerIndex = (room.bigBlindIndex + 1) % room.players.length;
  return true;
}

/** 推进到下一街：发牌、重置本圈下注、设置当前行动玩家 */
function advanceStreet(room) {
  const n = room.communityCards.length;
  if (n === 0) {
    room.deck.pop();
    room.communityCards.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
  } else if (n === 3) {
    room.deck.pop();
    room.communityCards.push(room.deck.pop());
  } else if (n === 4) {
    room.deck.pop();
    room.communityCards.push(room.deck.pop());
  }
  room.players.forEach(p => { p.betThisRound = 0; });
  room.currentBet = 0;
  let idx = (room.dealerIndex + 1) % room.players.length;
  while (room.players[idx].folded) idx = (idx + 1) % room.players.length;
  room.currentPlayerIndex = idx;
}

function getWinners(room) {
  const active = room.players.filter(p => !p.folded);
  const board = room.communityCards;
  const evaluations = active.map(p => ({
    player: p,
    hand: evaluateHand([...p.cards, ...board])
  }));
  evaluations.sort((a, b) => compareHands(b.hand, a.hand));
  const best = evaluations[0].hand;
  const winners = evaluations.filter(e => compareHands(e.hand, best) === 0).map(e => e.player);
  return winners;
}

function recordHandResult(room, winners, pot) {
  const entry = {
    handNumber: room.handNumber,
    winnerNames: winners.map(w => w.name),
    winnerIds: winners.map(w => w.id),
    pot,
    playerResults: room.players.map(p => ({
      name: p.name,
      id: p.id,
      chipsChange: p === winners[0] ? pot - p.totalBetThisHand : -p.totalBetThisHand,
      folded: p.folded,
      totalBetThisHand: p.totalBetThisHand
    })),
    board: room.communityCards.map(c => `${c.rank}${c.suit}`)
  };
  room.handHistory.push(entry);
}

function endHand(room) {
  const active = room.players.filter(p => !p.folded);
  if (active.length === 1) {
    const winner = active[0];
    winner.chips += room.pot;
    recordHandResult(room, [winner], room.pot);
  } else {
    const winners = getWinners(room);
    const share = Math.floor(room.pot / winners.length);
    const remainder = room.pot % winners.length;
    winners.forEach((w, i) => { w.chips += share + (i < remainder ? 1 : 0); });
    recordHandResult(room, winners, room.pot);
  }
  room.gameState = 'betweenHands';
}

// 序列化给前端的房间状态（隐藏他人手牌）
function getRoomStateFor(room, socketId) {
  const players = room.players.map(p => ({
    ...p,
    cards: p.id === socketId ? p.cards : (p.folded ? p.cards : []),
    chips: p.chips,
    name: p.name,
    folded: p.folded,
    allIn: p.allIn,
    betThisRound: p.betThisRound,
    totalBetThisHand: p.totalBetThisHand
  }));
  return {
    ...room,
    players,
    communityCards: room.communityCards,
    pot: room.pot,
    currentBet: room.currentBet,
    currentPlayerIndex: room.currentPlayerIndex,
    dealerIndex: room.dealerIndex,
    smallBlindIndex: room.smallBlindIndex,
    bigBlindIndex: room.bigBlindIndex,
    handHistory: room.handHistory,
    chatMessages: room.chatMessages.slice(-100)
  };
}

/** 向房间内每个玩家广播其视角的房间状态 */
function broadcastRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const roomSockets = io.sockets.adapter.rooms.get(roomId);
  if (!roomSockets) return;
  for (const sid of roomSockets) {
    const s = io.sockets.sockets.get(sid);
    if (s) s.emit('roomUpdate', getRoomStateFor(room, sid));
  }
}

// ---------- Socket 事件 ----------
io.on('connection', (socket) => {
  socket.on('createRoom', (options, cb) => {
    try {
      const room = createRoom(options || {});
      socket.join(room.id);
      addPlayerToRoom(room.id, socket.id, options?.playerName || '房主');
      cb({ ok: true, roomId: room.id, room: getRoomStateFor(room, socket.id) });
    } catch (e) {
      console.error('createRoom error', e);
      cb({ ok: false, message: e.message });
    }
  });

  socket.on('joinRoom', (data, cb) => {
    try {
      const room = rooms.get(data.roomId);
      if (!room) return cb({ ok: false, message: '房间不存在' });
      if (room.gameState !== 'lobby') return cb({ ok: false, message: '游戏已开始，无法加入' });
      if (room.players.length >= room.maxPlayers) return cb({ ok: false, message: '房间已满' });
      socket.join(room.id);
      addPlayerToRoom(room.id, socket.id, data.playerName || `玩家${room.players.length + 1}`);
      broadcastRoomState(room.id);
      cb({ ok: true, room: getRoomStateFor(room, socket.id) });
    } catch (e) {
      console.error('joinRoom error', e);
      cb({ ok: false, message: e.message });
    }
  });

  socket.on('setPlayerName', (data) => {
    const room = rooms.get(data.roomId);
    if (!room) return;
    const p = room.players.find(pp => pp.id === socket.id);
    if (p) p.name = (data.name || p.name).slice(0, 20);
    broadcastRoomState(room.id);
  });

  socket.on('startGame', (roomId, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.hostSocketId !== socket.id) return cb({ ok: false, message: '仅房主可开始' });
    if (room.players.length < 2) return cb({ ok: false, message: '至少需要2名玩家' });
    if (room.gameState !== 'lobby' && room.gameState !== 'betweenHands') {
      // 游戏已在进行中，把当前房间状态返回给前端，方便同步到游戏界面
      return cb({ ok: false, message: '当前状态无法开始', room: getRoomStateFor(room, socket.id) });
    }
    if (!startGame(roomId)) return cb({ ok: false, message: '无法开始' });
    broadcastRoomState(roomId);
    io.to(roomId).emit('yourTurn', { roomId, currentPlayerIndex: room.currentPlayerIndex });
    cb({ ok: true });
  });

  socket.on('playerAction', (data, cb) => {
    const room = rooms.get(data.roomId);
    if (!room || room.gameState !== 'playing') return cb({ ok: false });
    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx !== room.currentPlayerIndex) return cb({ ok: false, message: '未轮到你' });
    const p = room.players[idx];
    if (p.folded || p.allIn) return cb({ ok: false });

    const action = data.action;
    const amount = Math.max(0, Number(data.amount) || 0);
    const toCall = room.currentBet - p.betThisRound;

    if (action === 'fold') {
      p.folded = true;
    } else if (action === 'check') {
      if (toCall !== 0) return cb({ ok: false, message: '不能 check，需跟注' });
    } else if (action === 'call') {
      const pay = Math.min(toCall, p.chips);
      p.chips -= pay;
      p.betThisRound += pay;
      p.totalBetThisHand += pay;
      room.pot += pay;
      if (p.chips <= 0) p.allIn = true;
    } else if (action === 'bet' || action === 'raise') {
      const minRaise = room.bigBlind;
      const totalBet = room.currentBet + (amount >= minRaise ? amount : minRaise);
      const pay = Math.min(totalBet - p.betThisRound, p.chips);
      if (pay < 0) return cb({ ok: false });
      p.chips -= pay;
      p.betThisRound += pay;
      p.totalBetThisHand += pay;
      room.pot += pay;
      room.currentBet = p.betThisRound;
      if (p.chips <= 0) p.allIn = true;
    } else if (action === 'allIn') {
      const pay = p.chips;
      p.chips = 0;
      p.betThisRound += pay;
      p.totalBetThisHand += pay;
      room.pot += pay;
      p.allIn = true;
      if (p.betThisRound > room.currentBet) room.currentBet = p.betThisRound;
    }

    const active = room.players.filter(pp => !pp.folded && !pp.allIn);
    const allMatched = room.players.filter(pp => !pp.folded).every(pp => pp.betThisRound === room.currentBet || pp.allIn);
    if (active.length <= 1) {
      endHand(room);
      io.to(room.id).emit('handEnd', { handResult: room.handHistory[room.handHistory.length - 1] });
      broadcastRoomState(room.id);
      return cb({ ok: true });
    }
    if (allMatched) {
      if (room.communityCards.length >= 5) {
        endHand(room);
        io.to(room.id).emit('handEnd', { handResult: room.handHistory[room.handHistory.length - 1] });
        broadcastRoomState(room.id);
        return cb({ ok: true });
      }
      advanceStreet(room);
    } else {
      room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
      while (room.players[room.currentPlayerIndex].folded || room.players[room.currentPlayerIndex].allIn)
        room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    }

    broadcastRoomState(room.id);
    io.to(room.id).emit('yourTurn', { roomId: room.id, currentPlayerIndex: room.currentPlayerIndex });
    cb({ ok: true });
  });

  socket.on('chat', (data) => {
    const room = rooms.get(data.roomId);
    if (!room) return;
    const p = room.players.find(pp => pp.id === socket.id);
    const name = p ? p.name : '游客';
    const msg = { id: Date.now(), name, text: String(data.text || '').slice(0, 200) };
    room.chatMessages.push(msg);
    io.to(room.id).emit('chatMessage', msg);
  });

  socket.on('disconnect', () => {
    for (const [rid, room] of rooms.entries()) {
      if (room.players.some(p => p.id === socket.id)) {
        removePlayerFromRoom(rid, socket.id);
        broadcastRoomState(rid);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`德州扑克春节版 运行在 http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
