'use strict';
const express = require('express');
const crypto = require('crypto');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
app.use(express.json({ limit: '30kb' }));
app.use(express.static(path.join(__dirname, 'public')));
const PORT = process.env.PORT || 10000;
const TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = (process.env.WEBAPP_URL || '').replace(/\/$/, '');
const ALLOW_DEV_AUTH = process.env.ALLOW_DEV_AUTH === 'true';
const rooms = new Map();
const profiles = new Map();
const COLORS = ['red', 'green', 'yellow', 'blue'];
const STARTS = [0, 13, 26, 39];
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const TRACK = makeTrack();
let bot = null;

function makeTrack() {
  const p = [];
  // 52 cells around a 15x15 board, clockwise; start cells at red, green, yellow, blue.
  const segments = [
    ...Array.from({length:6},(_,i)=>[1,6-i]), // replaced below with explicit perimeter route
  ];
  const route = [
    [6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],
    [1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],[8,14],
    [8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],[14,6],
    [13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0],[6,0]
  ];
  // The standard perimeter has 52 cells. Normalize route order with start cells separated by 13.
  return route.slice(0,52);
}
function profile(id, firstName='Player', username='') {
  const key = String(id);
  if (!profiles.has(key)) profiles.set(key, {id:key, name:String(firstName||'Player').slice(0,32), username:String(username||'').slice(0,32), games:0, wins:0, points:0});
  else { const p=profiles.get(key); p.name=String(firstName||p.name).slice(0,32); p.username=String(username||p.username).slice(0,32); }
  return profiles.get(key);
}
function verifyInitData(initData) {
  if (!TOKEN) return { ok: false, error: 'Bot token সেট করা হয়নি। Render Environment-এ BOT_TOKEN দিন।' };
  if (!initData) {
    if (ALLOW_DEV_AUTH) return {ok:true, user:{id:999001, first_name:'Test Player', username:'testplayer'}};
    return {ok:false,error:'Telegram Mini App থেকে খুলুন।'};
  }
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash'); if (!hash) return {ok:false,error:'Telegram authentication hash পাওয়া যায়নি।'};
    params.delete('hash');
    const pairs = [...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`);
    const secret = crypto.createHmac('sha256','WebAppData').update(TOKEN).digest();
    const calculated = crypto.createHmac('sha256',secret).update(pairs.join('\n')).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hash,'hex'), Buffer.from(calculated,'hex'))) return {ok:false,error:'Telegram authentication যাচাই করা যায়নি।'};
    const authDate = Number(params.get('auth_date')||0);
    if (!authDate || Date.now()/1000-authDate > 86400) return {ok:false,error:'Login session মেয়াদ শেষ। Mini App আবার খুলুন।'};
    const user = JSON.parse(params.get('user')||'{}');
    if (!user.id) return {ok:false,error:'Telegram user পাওয়া যায়নি।'};
    return {ok:true,user};
  } catch(e) { return {ok:false,error:'Login data পড়া যায়নি।'}; }
}
function auth(req,res,next) {
  const result = verifyInitData(req.headers['x-telegram-init-data'] || '');
  if (!result.ok) return res.status(401).json({error:result.error});
  req.player = profile(result.user.id,result.user.first_name,result.user.username); next();
}
function makeRoom(host, maxPlayers=4) {
  let code; do { code = Math.random().toString(36).slice(2,7).toUpperCase(); } while(rooms.has(code));
  const room = {code, maxPlayers, status:'waiting', players:[{id:host.id,name:host.name,color:COLORS[0],tokens:[-1,-1,-1,-1],finished:false}], turn:0, dice:null, rolled:false, message:`${host.name} রুম তৈরি করেছে`, createdAt:Date.now(), lastActive:Date.now()};
  rooms.set(code,room); return room;
}
function publicRoom(r) { return {code:r.code,status:r.status,maxPlayers:r.maxPlayers,players:r.players.map(p=>({id:p.id,name:p.name,color:p.color,tokens:p.tokens,finished:p.finished})),turn:r.turn,dice:r.dice,rolled:r.rolled,message:r.message}; }
function current(room) { return room.players[room.turn]; }
function nextTurn(room) { room.turn=(room.turn+1)%room.players.length; room.dice=null; room.rolled=false; }
function rollDice(room, player) {
  if(room.status!=='playing') throw Error('ম্যাচ শুরু হয়নি।');
  if(current(room).id!==player.id) throw Error('এখন আপনার চাল নয়।');
  if(room.rolled) throw Error('আগের Dice-এর চাল দিন।');
  room.dice=1+Math.floor(Math.random()*6); room.rolled=true;
  const canMove=current(room).tokens.some(pos=>pos===-1 ? room.dice===6 : pos<57 && pos+room.dice<=57);
  room.message=`${current(room).name} ${room.dice} পেয়েছে`;
  if(!canMove) { room.message+=' — চাল নেই'; if(room.dice!==6) nextTurn(room); else {room.rolled=false;room.dice=null;} }
  return room;
}
function moveToken(room, player, tokenIndex) {
  if(room.status!=='playing') throw Error('ম্যাচ শুরু হয়নি।');
  if(current(room).id!==player.id) throw Error('এখন আপনার চাল নয়।');
  if(!room.rolled || !room.dice) throw Error('আগে Dice চালুন।');
  const p=current(room); const pos=p.tokens[tokenIndex]; const roll=room.dice;
  if(pos===-1 && roll!==6) throw Error('গুটি বের করতে ৬ লাগবে।');
  if(pos>=57) throw Error('এই গুটি Home-এ পৌঁছে গেছে।');
  const nextPos=pos===-1?0:pos+roll;
  if(nextPos>57) throw Error('Home-এ যেতে সঠিক সংখ্যা লাগবে।');
  p.tokens[tokenIndex]=nextPos;
  let captured=false;
  if(nextPos<52) {
    const absolute=(STARTS[room.turn]+nextPos)%52;
    if(!SAFE.has(absolute)) {
      for(let pi=0;pi<room.players.length;pi++) if(pi!==room.turn) {
        const other=room.players[pi];
        other.tokens=other.tokens.map(op=>{
          if(op>=0&&op<52&&(STARTS[pi]+op)%52===absolute) {captured=true;return -1;} return op;
        });
      }
    }
  }
  if(p.tokens.every(v=>v===57)) {p.finished=true;room.status='finished';room.message=`🏆 ${p.name} জিতেছে!`; const prof=profiles.get(String(p.id)); if(prof){prof.wins++;prof.points+=100;} room.players.forEach(x=>{const pr=profiles.get(String(x.id));if(pr)pr.games++;}); return room;}
  room.message=`${p.name} গুটি চালিয়েছে${captured?' এবং প্রতিপক্ষের গুটি কেটেছে':''}`;
  const bonus=roll===6||captured||nextPos===57;
  if(bonus) {room.dice=null;room.rolled=false;room.message+=' — আবার চাল দিন';} else nextTurn(room);
  room.lastActive=Date.now(); return room;
}
function runAiTurn(room) {
  if (!room || room.status !== 'playing' || !String(current(room).id).startsWith('AI_')) return;
  const ai = current(room);
  setTimeout(() => {
    if (room.status !== 'playing' || current(room).id !== ai.id) return;
    try {
      rollDice(room, ai);
      if (room.status !== 'playing' || current(room).id !== ai.id || !room.rolled) { runAiTurn(room); return; }
      const valid = ai.tokens.map((pos,i)=>({pos,i})).filter(x=>x.pos===-1 ? room.dice===6 : x.pos<57 && x.pos+room.dice<=57);
      if (valid.length) {
        // Prefer a capture, then bringing a token out, then the token closest to home.
        let chosen = valid[0];
        for (const v of valid) {
          if (v.pos === -1 && chosen.pos !== -1) chosen = v;
          else if (v.pos >= 0 && v.pos > chosen.pos) chosen = v;
        }
        moveToken(room, ai, chosen.i);
      }
      if (room.status === 'playing' && String(current(room).id).startsWith('AI_')) runAiTurn(room);
    } catch(e) { console.error('AI turn error',e.message); }
  }, 800);
}
function joinRoom(code, player) {
  const r=rooms.get(String(code||'').toUpperCase()); if(!r) throw Error('এই Room Code পাওয়া যায়নি।');
  if(r.status!=='waiting') throw Error('এই ম্যাচ শুরু হয়ে গেছে।');
  if(r.players.some(p=>p.id===player.id)) return r;
  if(r.players.length>=r.maxPlayers) throw Error('রুম পূর্ণ।');
  r.players.push({id:player.id,name:player.name,color:COLORS[r.players.length],tokens:[-1,-1,-1,-1],finished:false}); r.message=`${player.name} রুমে যোগ দিয়েছে`; r.lastActive=Date.now(); return r;
}
function startRoom(r, player) {
  if(r.players[0].id!==player.id) throw Error('শুধু Room Host ম্যাচ শুরু করতে পারবে।');
  if(r.status!=='waiting') throw Error('ম্যাচ ইতিমধ্যে শুরু হয়েছে।');
  if(r.players.length<2) throw Error('ম্যাচ শুরু করতে কমপক্ষে ২ জন লাগবে।');
  r.status='playing';r.message='ম্যাচ শুরু! ৬ পেলে গুটি বের হবে।';r.lastActive=Date.now();return r;
}

app.get('/health',(_,res)=>res.json({ok:true,service:'EXTRA LUDO'}));
app.get('/api/me',auth,(req,res)=>res.json({profile:req.player}));
app.get('/api/leaderboard',auth,(_,res)=>res.json({players:[...profiles.values()].sort((a,b)=>b.wins-a.wins||b.points-a.points).slice(0,20)}));
app.post('/api/rooms',auth,(req,res)=>{try{const r=makeRoom(req.player,Math.max(2,Math.min(4,Number(req.body.maxPlayers)||4)));res.json({room:publicRoom(r)});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/ai-room',auth,(req,res)=>{try{const r=makeRoom(req.player,2);r.players.push({id:'AI_'+r.code,name:'Ludo AI',color:COLORS[1],tokens:[-1,-1,-1,-1],finished:false});r.status='playing';r.message='AI ম্যাচ শুরু!';res.json({room:publicRoom(r)});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/rooms/:code/join',auth,(req,res)=>{try{res.json({room:publicRoom(joinRoom(req.params.code,req.player))});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/rooms/:code/start',auth,(req,res)=>{try{const r=rooms.get(req.params.code.toUpperCase());if(!r)throw Error('রুম পাওয়া যায়নি।');res.json({room:publicRoom(startRoom(r,req.player))});}catch(e){res.status(400).json({error:e.message});}});
app.get('/api/rooms/:code',auth,(req,res)=>{const r=rooms.get(req.params.code.toUpperCase());if(!r)return res.status(404).json({error:'রুম পাওয়া যায়নি।'});r.lastActive=Date.now();res.json({room:publicRoom(r)});});
app.post('/api/rooms/:code/roll',auth,(req,res)=>{try{const r=rooms.get(req.params.code.toUpperCase());if(!r)throw Error('রুম পাওয়া যায়নি।');const out=rollDice(r,req.player); if(r.status==='playing' && String(current(r).id).startsWith('AI_')) runAiTurn(r); res.json({room:publicRoom(out)});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/rooms/:code/move',auth,(req,res)=>{try{const r=rooms.get(req.params.code.toUpperCase());if(!r)throw Error('রুম পাওয়া যায়নি।');const out=moveToken(r,req.player,Number(req.body.token)); if(r.status==='playing' && String(current(r).id).startsWith('AI_')) runAiTurn(r); res.json({room:publicRoom(out)});}catch(e){res.status(400).json({error:e.message});}});
app.get('/api/rooms',auth,(req,res)=>res.json({rooms:[...rooms.values()].filter(r=>r.status==='waiting').map(r=>({code:r.code,players:r.players.length,maxPlayers:r.maxPlayers,host:r.players[0].name}))}));

if(TOKEN) {
  bot = new TelegramBot(TOKEN,{polling:true});
  bot.onText(/\/start(?:\s+(.+))?/, async (msg,match)=>{
    const chatId=msg.chat.id; const user=profile(msg.from.id,msg.from.first_name,msg.from.username);
    const keyboard=[];
    if(WEBAPP_URL) keyboard.push([{text:'🎲 Play EXTRA LUDO',web_app:{url:WEBAPP_URL}}]);
    keyboard.push([{text:'➕ Create Room',callback_data:'create'},{text:'🏆 Leaderboard',callback_data:'leaderboard'}]);
    const text=`🎮 স্বাগতম ${user.name}!\n\nEXTRA LUDO-তে খেলো, গুটি চালাও এবং বন্ধুদের সঙ্গে প্রতিযোগিতা করো।\n\nRoom তৈরি: /newgame\nRoom-এ যোগ: /join CODE`;
    bot.sendMessage(chatId,text,{reply_markup:{inline_keyboard:keyboard}}).catch(()=>{});
  });
  bot.onText(/\/newgame/, msg=>{try{const u=profile(msg.from.id,msg.from.first_name,msg.from.username);const r=makeRoom(u,4);bot.sendMessage(msg.chat.id,`🎲 Room তৈরি হয়েছে!\nCode: ${r.code}\nবন্ধুদের বলো /join ${r.code} লিখতে।\nসবাই যোগ দিলে Mini App খুলে Start Match চাপো।`,{reply_markup:{inline_keyboard:WEBAPP_URL?[[{text:'Open Ludo',web_app:{url:WEBAPP_URL}}]]:[]}});}catch(e){bot.sendMessage(msg.chat.id,e.message);}});
  bot.onText(/\/join\s+([A-Za-z0-9]+)/, (msg,m)=>{try{const u=profile(msg.from.id,msg.from.first_name,msg.from.username);const r=joinRoom(m[1],u);bot.sendMessage(msg.chat.id,`✅ Room ${r.code}-এ যোগ দিয়েছ। Players: ${r.players.length}/${r.maxPlayers}`,{reply_markup:{inline_keyboard:WEBAPP_URL?[[{text:'Open Ludo',web_app:{url:WEBAPP_URL}}]]:[]}});}catch(e){bot.sendMessage(msg.chat.id,`❌ ${e.message}`);}});
  bot.on('callback_query',async q=>{try{if(q.data==='create'){const u=profile(q.from.id,q.from.first_name,q.from.username);const r=makeRoom(u,4);await bot.answerCallbackQuery(q.id,{text:`Room: ${r.code}`});await bot.sendMessage(q.message.chat.id,`🎲 Room Code: ${r.code}\nবন্ধুরা যোগ দেবে: /join ${r.code}`);}else if(q.data==='leaderboard'){const top=[...profiles.values()].sort((a,b)=>b.wins-a.wins).slice(0,10);await bot.answerCallbackQuery(q.id);await bot.sendMessage(q.message.chat.id,'🏆 Leaderboard\n'+(top.length?top.map((p,i)=>`${i+1}. ${p.name} — ${p.wins} জয়`).join('\n'):'এখনও কোনো ফলাফল নেই।'));}}catch(e){bot.answerCallbackQuery(q.id,{text:e.message}).catch(()=>{});}});
  bot.on('polling_error',e=>console.error('Telegram polling error:',e.message));
} else console.warn('BOT_TOKEN missing; website can start, Telegram bot disabled.');
// Remove abandoned in-memory rooms after 6 hours. Free instances can sleep/restart, so state is not durable.
setInterval(()=>{const cutoff=Date.now()-6*60*60*1000;for(const [code,r] of rooms)if(r.lastActive<cutoff)rooms.delete(code);},30*60*1000).unref();
app.listen(PORT,()=>console.log(`EXTRA LUDO listening on ${PORT}`));
