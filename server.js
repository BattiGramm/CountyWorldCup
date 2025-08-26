// server.js - starten
const WebSocket = require('ws');
const { WebcastPushConnection } = require('tiktok-live-connector');

const tiktokUsername = 'worldbattletv'; // ohne @

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

// 🌐 WebSocket-Server (Browser <-> Node)
const wss = new WebSocket.Server({ port: 8080 });
console.log('🌐 WebSocket-Server läuft auf ws://localhost:8080');

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
    const payload = {
        type: 'chat',
        user: data.uniqueId,                  // eindeutiger Nutzername (ID)
        nickname: data.nickname || data.uniqueId, // Anzeigename
        avatar: data.profilePictureUrl || '', // Profilbild-URL
        comment: data.comment
    };
    const json = JSON.stringify(payload);
    wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(json));
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
                const payload = {
                    type: 'gift',
                    user,
                    nickname: data.nickname || user,
                    avatar: data.profilePictureUrl || '',
                    coins: totalCoins
                };
                const json = JSON.stringify(payload);
                wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(json));
            }
        }
    } else {
        const totalCoins = (base || 0) * (data.repeatCount || 1);
        if (totalCoins > 0) {
            const payload = {
                type: 'gift',
                user,
                nickname: data.nickname || user,
                avatar: data.profilePictureUrl || '',
                coins: totalCoins
            };
            const json = JSON.stringify(payload);
            wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(json));
        }
    }
});

// 👍 Like Event
tiktok.on('like', data => {
    const payload = {
        type: 'like',
        user: data.uniqueId,
        nickname: data.nickname || data.uniqueId,
        avatar: data.profilePictureUrl || ''
    };
    const json = JSON.stringify(payload);
    wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(json));
});

tiktok.on('follow', data => {
    const payload = {
        type: 'follow',
        user: data.uniqueId,
        nickname: data.nickname || data.uniqueId,
        avatar: data.profilePictureUrl || ''
    };
    const json = JSON.stringify(payload);
    wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(json));
});

