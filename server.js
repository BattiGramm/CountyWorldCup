// server.js - starten mit node server.js
const WebSocket = require('ws');
const { WebcastPushConnection } = require('tiktok-live-connector');

const tiktokUsername = 'worldbattle.tv'; // ohne @
//const tiktokUsername = 'gioooo2702';
// ⛳ Verbindung zu TikTok
const tiktok = new WebcastPushConnection(tiktokUsername, {
    // Falls Extended Gift Info bei dir Probleme machte, kannst du das auf false stellen.
    enableExtendedGiftInfo: true,
    fetchRoomInfoOnConnect: true
});

tiktok.connect().then(state => {
    console.log(`✅ Verbunden mit TikTok Raum ${state.roomId}`);
}).catch(err => {
    console.error('❌ Verbindungsfehler:', err);
});

// --- NEU: Batching + komprimierte WS-Nachrichten ---
const BATCH_MS = 50;
let batch = []; // sammelt Events

const wss = new WebSocket.Server({
    port: 8080,
    perMessageDeflate: { threshold: 1024 } // optional, spart Bandbreite
});
console.log('🌐 WebSocket-Server läuft auf ws://localhost:8080');

// an alle Clients senden
function broadcast(obj) {
    const json = JSON.stringify(obj);
    wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(json));
}

// Event nur vormerken, nicht sofort senden
function queue(ev) {
    batch.push(ev);
}

// Alle 50ms alles auf einmal schicken
setInterval(() => {
    if (!batch.length) return;
    const toSend = batch;
    batch = [];
    broadcast({ type: 'batch', events: toSend });
}, BATCH_MS);


// Helper: Coins aus Gift-Event robust herausziehen
function extractGiftCoins(ev) {
    // mögliche Felder in verschiedenen Versionen:
    return (
        ev.diamondCount ??
        ev.diamond_count ??
        ev.gift?.diamondCount ??
        ev.gift?.diamond_count ??
        ev.extendedGiftInfo?.diamond_count ??
        0
    );
}

// Für Streak-Geschenke: erst am Ende (repeatEnd) werten
const streakBuffer = new Map(); // key = `${user}-${giftId}` -> {count, baseCoins}
tiktok.on('chat', data => {
    queue({
        type: 'chat',
        user: data.uniqueId,
        nickname: data.nickname || data.uniqueId,
        avatar: data.profilePictureUrl || '',
        comment: data.comment
    });

});

tiktok.on('gift', data => {
    const user = data.uniqueId;
    const giftId = data.giftId;
    const base = extractGiftCoins(data);

    const isStreakGift = data.giftType === 1;
    const key = `${user}-${giftId}`;

    if (isStreakGift) {
        const buf = streakBuffer.get(key) || { count: 0, baseCoins: base || 0 };
        buf.count = data.repeatCount || buf.count || 1;
        if (base) buf.baseCoins = base;
        streakBuffer.set(key, buf);

        if (data.repeatEnd) {
            const totalCoins = (buf.baseCoins || 0) * (buf.count || 1);
            streakBuffer.delete(key);
            if (totalCoins > 0) {
                queue({
                    type: 'gift',
                    user,
                    nickname: data.nickname || user,
                    avatar: data.profilePictureUrl || '',
                    coins: totalCoins
                });
            }
        }

    } else {
        const totalCoins = (base || 0) * (data.repeatCount || 1);
        if (totalCoins > 0) {
            queue({
                type: 'gift',
                user,
                nickname: data.nickname || user,
                avatar: data.profilePictureUrl || '',
                coins: totalCoins
            });

        }
    }
});

tiktok.on('like', d => {
    queue({
        type: 'like',
        user: d.uniqueId,
        nickname: d.nickname || d.uniqueId,
        avatar: d.profilePictureUrl || ''
    });
});

tiktok.on('follow', d => {
    queue({
        type: 'follow',
        user: d.uniqueId,
        nickname: d.nickname || d.uniqueId,
        avatar: d.profilePictureUrl || ''
    });
});
