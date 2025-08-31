// ======================= TIMER-MODUL =======================
(function () {
    const timerEl = document.getElementById('timer');
    const textEl = document.getElementById('timer-text');
    if (!timerEl || !textEl) return;

    let total = 10;      // Gesamtdauer (Sekunden) – Testwert
    let remaining = 10;  // verbleibend
    let running = false;
    let lastTs = null;

    const clamp0 = v => (v < 0 ? 0 : v);
    const fmt = s => {
        const m = Math.floor(s / 60);
        const ss = Math.floor(s % 60);
        return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    };

    // ====== PERFORMANCE-PUFFER ======
    const incomingQueue = [];
    let pendingLeft = 0, pendingRight = 0;
    let podiumDirty = false;
    let countriesDelta = new Map(); // countryName -> +points

    function enqueueEvent(e) { incomingQueue.push(e); }
    window.enqueueEvent = enqueueEvent;
    // Punkt dem aktuellen Team direkt (gepuffert) gutschreiben
    function addBufferedPointsForTeamName(teamName, delta, userId = null, userName = '', avatarUrl = '') {
        if (!pointsActive || !delta) return;
        const isLeft = normTeam(teamName) === normTeam(currentLeftTeam);
        const isRight = normTeam(teamName) === normTeam(currentRightTeam);
        if (!isLeft && !isRight) return;

        if (isLeft) pendingLeft += delta;
        else if (isRight) pendingRight += delta;

        // Runde & Overall in Memory erhöhen
        if (userId) {
            const key = String(userId).toLowerCase();
            const base = { name: userName || userId, avatar: avatarUrl || '', points: 0 };

            const r = perRoundScores.get(key) || { ...base };
            r.points += delta; r.name ||= base.name; r.avatar ||= base.avatar;
            perRoundScores.set(key, r);

            const o = overallScores.get(key) || { ...base };
            o.points += delta; o.name ||= base.name; o.avatar ||= base.avatar;
            overallScores.set(key, o);

            podiumDirty = true;
        }

        // Alltime-Länder gepuffert sammeln
        const t = isLeft ? currentLeftTeam : currentRightTeam;
        countriesDelta.set(t, (countriesDelta.get(t) || 0) + delta);
    }

    // Punkt für bereits gebundenen User (Like/Follow/Gift)
    function addBufferedPointsForBoundUser(userId, delta, userName = '', avatarUrl = '') {
        if (!pointsActive || !delta) return;
        const sup = supporters.get(String(userId).toLowerCase());
        if (!sup) return; // noch kein Team gewählt
        addBufferedPointsForTeamName(sup.team, delta, userId, userName, avatarUrl);
    }

    // Pro Frame DOM aktualisieren
    function applyPending() {
        if (pendingLeft) {
            const el = document.getElementById('score-left');
            el.textContent = String((parseInt(el.textContent, 10) || 0) + pendingLeft);
            adjustScoreFont(el);
            pendingLeft = 0;
        }
        if (pendingRight) {
            const el = document.getElementById('score-right');
            el.textContent = String((parseInt(el.textContent, 10) || 0) + pendingRight);
            adjustScoreFont(el);
            pendingRight = 0;
        }
        if (podiumDirty) {
            updatePodium();
            podiumDirty = false;
        }
    }

    // Main-Loop: Events abarbeiten + DOM einmal/Frame anfassen
    function rafLoop() {
        while (incomingQueue.length) {
            const e = incomingQueue.shift();
            if (e.type === 'chat') {
                // Nutzer an Team binden + 1 Punkt (gepuffert)
                pledgeUserToTeam(e.user, e.comment, e.nickname || e.user, e.avatar || '');
                // Punkte für den Chat NICHT mehr in pledgeUserToTeam vergeben,
                // sondern hier gepuffert:
                const picked = e.comment.trim().toLowerCase();
                if (picked === normTeam(currentLeftTeam)) addBufferedPointsForTeamName(currentLeftTeam, 1, e.user, e.nickname, e.avatar);
                if (picked === normTeam(currentRightTeam)) addBufferedPointsForTeamName(currentRightTeam, 1, e.user, e.nickname, e.avatar);
            } else if (e.type === 'like') {
                addBufferedPointsForBoundUser(e.user, 1, e.nickname, e.avatar);
            } else if (e.type === 'follow') {
                addBufferedPointsForBoundUser(e.user, 5, e.nickname, e.avatar);
            } else if (e.type === 'gift') {
                addBufferedPointsForBoundUser(e.user, (e.coins || 0) * 10, e.nickname, e.avatar);
            }
        }
        applyPending();
        requestAnimationFrame(rafLoop);
    }
    requestAnimationFrame(rafLoop);

    // Alle 2s: Alltime-Store + Top10 schreiben (einmal!)
    setInterval(() => {
        if (!countriesDelta.size) return;
        const store = ensureAllCountriesInStore(loadAlltime());
        for (const [name, delta] of countriesDelta) {
            const key = String(name).trim().toUpperCase();
            store[key] = (store[key] || 0) + delta;
        }
        countriesDelta.clear();
        saveAlltime(store);
        renderTop10Countries(store);
    }, 2000);


    function render() {
        textEl.textContent = remaining <= 0 ? 'ENDE' : fmt(remaining);
    }

    function tick(ts) {
        if (lastTs == null) lastTs = ts;
        const dt = Math.min(1, (ts - lastTs) / 1000);
        lastTs = ts;

        if (running) {
            const wasPositive = remaining > 0;
            remaining = clamp0(remaining - dt);
            render();

            if (wasPositive && remaining <= 0) {
                running = false;
                window.dispatchEvent(new CustomEvent('match:end', { detail: { reason: 'timeup' } }));
            }
        }
        requestAnimationFrame(tick);
    }

    function start() {
        if (remaining <= 0) return;
        running = true;
    }

    function reset(seconds) {
        if (typeof seconds === 'number' && isFinite(seconds) && seconds >= 0) {
            total = Math.floor(seconds);
        }
        remaining = total;
        running = false;
        lastTs = null;
        render();
    }

    reset(10);
    requestAnimationFrame(tick);

    window.matchTimer = { start, reset, get remaining() { return remaining; } };
})();
function updateStageHeader(round) {
    const map = { qf: 'hdr-qf', sf: 'hdr-sf', final: 'hdr-final' };
    ['hdr-qf', 'hdr-sf', 'hdr-final'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('stage-active', id === map[round]);
    });
}

// === Streak-Persistenz ===
const STREAK_CURR_KEY = 'cw_current_streak_v1';   // { team: 'DEUTSCHLAND', count: 2 }
const STREAK_BEST_KEY = 'cw_best_streak_v1';      // { team: 'DEUTSCHLAND', count: 5 }

function getCurrentStreak() {
    try { return JSON.parse(localStorage.getItem(STREAK_CURR_KEY)) || { team: null, count: 0 }; }
    catch { return { team: null, count: 0 }; }
}

function setCurrentStreak(obj) {
    try { localStorage.setItem(STREAK_CURR_KEY, JSON.stringify(obj)); } catch { }
}

function getBestStreak() {
    try { return JSON.parse(localStorage.getItem(STREAK_BEST_KEY)) || { team: null, count: 0 }; }
    catch { return { team: null, count: 0 }; }
}

function maybeUpdateBestStreak(cur) {
    const best = getBestStreak();
    if (!cur || !cur.team || !cur.count) return;
    if (cur.count > (best.count || 0)) {
        try { localStorage.setItem(STREAK_BEST_KEY, JSON.stringify(cur)); } catch { }
    }
}

function applyStreakBadges() {
    const cur = getCurrentStreak();
    const teamUpper = (cur.team || '').toUpperCase();
    const count = cur.count || 0;

    // Alle Team-Boxen abräumen
    document.querySelectorAll('.team-box').forEach(box => {
        box.querySelectorAll('.streak-badge').forEach(b => b.remove());
        if (!teamUpper || count < 1) return;

        const name = box.querySelector('span')?.textContent?.trim().toUpperCase();
        if (name === teamUpper) {
            const badge = document.createElement('div');
            badge.className = 'streak-badge';
            badge.innerHTML = `<span class="icon">🔥</span><span class="num">×${count}</span>`;
            box.appendChild(badge);
        }
    });
}


// ===== Persistent Stats (localStorage) =====
const META_KEY = 'cw_meta_v1';

function loadMeta() {
    try {
        const raw = localStorage.getItem(META_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function saveMeta(meta) {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { }
}

/* Meta-Struktur (fallbacks):
{
  lastWinner: { name: "DEUTSCHLAND" },
  roundRecord: { team: "TÜRKEI", points: 100000 },
  currentStreak: { team: "DEUTSCHLAND", count: 2 },
  longestStreak: { team: "DEUTSCHLAND", count: 2 }
}
*/
function ensureMetaDefaults(m) {
    if (!m.lastWinner) m.lastWinner = { name: "-" };
    if (!m.roundRecord) m.roundRecord = { team: "-", points: 0 };
    if (!m.currentStreak) m.currentStreak = { team: "-", count: 0 };
    if (!m.longestStreak) m.longestStreak = { team: "-", count: 0 };
    return m;
}

/* UI rendern */
function renderStatsBar() {
    const track = document.getElementById('stats-track');
    if (!track) return;

    const m = ensureMetaDefaults(loadMeta());
    const htmlOnce = `
    <div class="stat-box">
      <div class="stat-icon">🏆</div>
      <div class="stat-text">Letzter Sieger: <span class="val">${m.lastWinner.name}</span></div>
    </div>

    <div class="stat-box">
      <div class="stat-icon">📈</div>
      <div class="stat-text">Punkte-Rekord: <span class="val">${m.roundRecord.team}</span> — <span class="val-num">${(m.roundRecord.points || 0).toLocaleString('de-DE')}</span></div>
    </div>

    <div class="stat-box">
      <div class="stat-icon">🔥</div>
      <div class="stat-text">Längste Streak: <span class="val">${m.longestStreak.team}</span> — <span class="val-num">×${m.longestStreak.count || 0}</span></div>
    </div>
  `;

    // Verdoppeln für nahtlose Schleife
    track.innerHTML = htmlOnce + htmlOnce;
}

/* Nach Match-Ende: Rekord prüfen/setzen */
function maybeUpdateRoundRecord() {
    const leftScore = parseInt(document.getElementById('score-left')?.textContent ?? '0', 10) || 0;
    const rightScore = parseInt(document.getElementById('score-right')?.textContent ?? '0', 10) || 0;
    const leftTeam = document.getElementById('name-left')?.textContent?.trim() || '-';
    const rightTeam = document.getElementById('name-right')?.textContent?.trim() || '-';

    const maxPts = Math.max(leftScore, rightScore);
    const maxTeam = (leftScore >= rightScore) ? leftTeam : rightTeam;

    const meta = ensureMetaDefaults(loadMeta());
    if (maxPts > (meta.roundRecord.points || 0)) {
        meta.roundRecord = { team: maxTeam, points: maxPts };
        saveMeta(meta);
        renderStatsBar();
    }
}

/* Nach Turnierende: Sieger + Streaks aktualisieren */
function updateWinnerAndStreaks(winnerName) {
    const meta = ensureMetaDefaults(loadMeta());
    const w = (winnerName || '-').trim();

    // Letzter Sieger
    meta.lastWinner = { name: w };

    // Streak fortführen oder neu beginnen
    if (meta.currentStreak.team === w) {
        meta.currentStreak.count = (meta.currentStreak.count || 0) + 1;
    } else {
        meta.currentStreak = { team: w, count: 1 };
    }

    // Längste Streak ggf. updaten
    if ((meta.currentStreak.count || 0) > (meta.longestStreak.count || 0)) {
        meta.longestStreak = { ...meta.currentStreak };
    }

    saveMeta(meta);
    renderStatsBar();
}


// ======================= BRACKET-LOGIK =======================
const bracketMap = {
    qf: [
        { players: [0, 1], target: { col: 'sf', index: 0 } },
        { players: [2, 3], target: { col: 'sf', index: 1 } },
        { players: [4, 5], target: { col: 'sf', index: 2 } },
        { players: [6, 7], target: { col: 'sf', index: 3 } },
    ],
    sf: [
        { players: [0, 1], target: { col: 'final', index: 0 } },
        { players: [2, 3], target: { col: 'final', index: 1 } },
    ],
    final: [
        { players: [0, 1], target: null }
    ]
};

let currentRound = 'qf';
let currentMatchIndex = 0;
// --- Supporter & Scoring (pro Match/ Runde) ---
const supporters = new Map();
// key = userId (lowercase), value = { team: 'GERMANY' | 'BELGIUM' | ..., points: number }
// 🔝 Gesamt-Leaderboard (bleibt rundenübergreifend)
// 🔢 Punktetöpfe
const perRoundScores = new Map();  // nur aktuelle Runde (Podium unten)
const overallScores = new Map();  // gesamtes Turnier (Winner-Modal)
// key = userId (lowercase) -> { name, avatar, points }

// 👤 Platzhalter-Avatar als Data-URI (Person-Icon)
const AVATAR_PLACEHOLDER =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <circle cx="64" cy="64" r="64" fill="#1f2a44"/>
  <circle cx="64" cy="46" r="22" fill="#a7b6d0"/>
  <rect x="24" y="72" width="80" height="40" rx="20" fill="#a7b6d0"/>
</svg>`);

let ROUND_DURATION = 60; // Default 60 Sekunden
let OVERTIME_DURATION = 30; // Default 30 Sekunden
const FINAL_EXTRA_SECONDS = 30; // Finale hat +30s gegenüber der normalen Rundenzeit

const startCue = new Audio('assets/startsound2.mp3');
startCue.preload = 'auto';
startCue.volume = 0.7;

const finalSound = new Audio('assets/FinalSound.mp3');
finalSound.preload = 'auto';
finalSound.volume = 1;

// Sound bei Rundenende (wenn "ENDE" angezeigt wird)
const endCue = new Audio('assets/roundwinner.mp3'); // Datei ins public/assets legen
endCue.preload = 'auto';
endCue.volume = 1.0; // nach Geschmack


let pointsActive = false;
let currentLeftTeam = '';
let currentRightTeam = '';
function updatePodium() {
    // ⬇️ Top 3 nur aus der aktuellen Runde
    const top3 = Array.from(perRoundScores.values())
        .sort((a, b) => b.points - a.points)
        .slice(0, 3);

    const slots = [
        document.querySelector('.slot.first'),
        document.querySelector('.slot.second'),
        document.querySelector('.slot.third')
    ];

    slots.forEach((slot, i) => {
        const data = top3[i];
        const img = slot.querySelector('img');
        const nameSpan = slot.querySelector('.name');

        if (!img || !nameSpan) return;

        if (data) {
            img.src = data.avatar || AVATAR_PLACEHOLDER;
            img.alt = data.name || '-';
            nameSpan.textContent = data.name || '-';
        } else {
            img.src = AVATAR_PLACEHOLDER;
            img.alt = '-';
            nameSpan.textContent = '-';
        }
    });
}

function awardPoints(userId, delta, userName = '', avatarUrl = '') {
    const key = String(userId || '').toLowerCase();
    const base = {
        name: userName || userId,
        avatar: avatarUrl || '',
        points: 0
    };

    // Aktuelle Runde
    const r = perRoundScores.get(key) || { ...base };
    r.name = r.name || base.name;
    r.avatar = r.avatar || base.avatar;
    r.points += delta;
    perRoundScores.set(key, r);

    // Gesamtturnier
    const o = overallScores.get(key) || { ...base };
    o.name = o.name || base.name;
    o.avatar = o.avatar || base.avatar;
    o.points += delta;
    overallScores.set(key, o);

    updatePodium();
}

function resetPerRoundLeaderboard() {
    perRoundScores.clear();
    updatePodium();
}


function getCol(colClass) {
    return document.querySelector(`.bracket-body .col.${colClass}`);
}

function getTeamFromCol(colClass, index) {
    const col = getCol(colClass);
    if (!col) return null;
    const box = col.children[index];
    if (!box) return null;

    const img = box.querySelector('img');
    const name = box.querySelector('span')?.textContent?.trim() ?? '';
    const flag = img?.getAttribute('src') ?? '';
    const alt = img?.getAttribute('alt') ?? name;

    return { name, flag, alt };
}

function setTeamInCol(colClass, index, team) {
    const col = getCol(colClass);
    if (!col) return;
    const box = col.children[index];
    if (!box) return;
    box.innerHTML = `<img src="${team.flag}" alt="${team.alt}"><span>${team.name}</span>`;
    applyStreakBadges();
}

function setArena(leftTeam, rightTeam, leftScore, rightScore) {
    document.getElementById('flag-left')?.setAttribute('src', leftTeam.flag);
    document.getElementById('flag-left')?.setAttribute('alt', leftTeam.alt || leftTeam.name);
    document.getElementById('flag-right')?.setAttribute('src', rightTeam.flag);
    document.getElementById('flag-right')?.setAttribute('alt', rightTeam.alt || rightTeam.name);

    document.getElementById('name-left').textContent = leftTeam.name;
    document.getElementById('name-right').textContent = rightTeam.name;

    document.getElementById('score-left').textContent = String(leftScore);
    document.getElementById('score-right').textContent = String(rightScore);
    adjustScoreFont(document.getElementById('score-left'));
    adjustScoreFont(document.getElementById('score-right'));

}

function getWinnerFromArena() {
    const leftScore = parseInt(document.getElementById('score-left')?.textContent ?? '0', 10) || 0;
    const rightScore = parseInt(document.getElementById('score-right')?.textContent ?? '0', 10) || 0;

    const leftTeam = {
        name: document.getElementById('name-left')?.textContent?.trim() ?? '',
        flag: document.getElementById('flag-left')?.getAttribute('src') ?? '',
        alt: document.getElementById('flag-left')?.getAttribute('alt') ?? ''
    };
    const rightTeam = {
        name: document.getElementById('name-right')?.textContent?.trim() ?? '',
        flag: document.getElementById('flag-right')?.getAttribute('src') ?? '',
        alt: document.getElementById('flag-right')?.getAttribute('alt') ?? ''
    };

    if (leftScore === rightScore) {
        return leftTeam;
    }
    return leftScore > rightScore ? leftTeam : rightTeam;
}

function addPointToTeam(teamName) {
    if (!pointsActive) return;
    if (teamName.toLowerCase() === currentLeftTeam.toLowerCase()) {
        const scoreEl = document.getElementById('score-left');
        scoreEl.textContent = parseInt(scoreEl.textContent, 10) + 1;
        adjustScoreFont(scoreEl);
        bumpCountryPoints(currentLeftTeam, 1);   // ⬅️ NEW
    } else if (teamName.toLowerCase() === currentRightTeam.toLowerCase()) {
        const scoreEl = document.getElementById('score-right');
        scoreEl.textContent = parseInt(scoreEl.textContent, 10) + 1;
        adjustScoreFont(scoreEl);
        bumpCountryPoints(currentRightTeam, 1);  // ⬅️ NEW
    }
}

function normTeam(s) {
    return (s || '').trim().toLowerCase();
}

// Setzt/ändert die Team-Bindung eines Users aufgrund Chat
function pledgeUserToTeam(userId, rawText, userName = '', avatarUrl = '') {
    const t = rawText.trim().toLowerCase();

    // nur wenn es eines der beiden aktiven Teams ist
    if (t === normTeam(currentLeftTeam) || t === normTeam(currentRightTeam)) {
        const chosen = (t === normTeam(currentLeftTeam)) ? currentLeftTeam : currentRightTeam;

        // pro Match merken
        const key = userId.toLowerCase();
        supporters.set(key, {
            team: chosen,
            points: (supporters.get(key)?.points || 0)
        });
    }
}

function applyLikeFromUser(userId, userName = '', avatarUrl = '') {
    if (!pointsActive) return;
    const key = userId.toLowerCase();
    const sup = supporters.get(key);
    if (!sup) return; // erst Land wählen

    const score = 1; // Like = 1
    if (normTeam(sup.team) === normTeam(currentLeftTeam)) {
        const el = document.getElementById('score-left');
        el.textContent = String(parseInt(el.textContent, 10) + score);
        adjustScoreFont(el);
        bumpCountryPoints(currentLeftTeam, score);  // ⬅️ NEW
    } else if (normTeam(sup.team) === normTeam(currentRightTeam)) {
        const el = document.getElementById('score-right');
        el.textContent = String(parseInt(el.textContent, 10) + score);
        adjustScoreFont(el);
        bumpCountryPoints(currentRightTeam, score); // ⬅️ NEW
    }


    sup.points = (sup.points || 0) + score;
    supporters.set(key, sup);

    awardPoints(userId, score, userName, avatarUrl);


    updatePodium();
}

function applyFollowFromUser(userId, userName = '', avatarUrl = '') {
    if (!pointsActive) return;
    const key = userId.toLowerCase();
    const sup = supporters.get(key);
    if (!sup) return;

    const score = 5; // 5 Punkte pro Follow

    if (normTeam(sup.team) === normTeam(currentLeftTeam)) {
        const el = document.getElementById('score-left');
        el.textContent = String(parseInt(el.textContent, 10) + score);
        adjustScoreFont(el);
        bumpCountryPoints(currentLeftTeam, score);
    } else if (normTeam(sup.team) === normTeam(currentRightTeam)) {
        const el = document.getElementById('score-right');
        el.textContent = String(parseInt(el.textContent, 10) + score);
        adjustScoreFont(el);
        bumpCountryPoints(currentRightTeam, score);
    }

    sup.points = (sup.points || 0) + score;
    supporters.set(key, sup);

    awardPoints(userId, score, userName, avatarUrl);


    updatePodium();
}

// Gift eines Users verrechnen (nur wenn er gebunden ist & Match offen)
function applyGiftFromUser(userId, coins, userName = '', avatarUrl = '') {
    if (!pointsActive) return;
    const key = userId.toLowerCase();
    const sup = supporters.get(key);
    if (!sup) return; // erst Land nennen, dann zählen

    const score = coins * 10;

    if (normTeam(sup.team) === normTeam(currentLeftTeam)) {
        const el = document.getElementById('score-left');
        el.textContent = String(parseInt(el.textContent, 10) + score);
        adjustScoreFont(el);
        bumpCountryPoints(currentLeftTeam, score);
    } else if (normTeam(sup.team) === normTeam(currentRightTeam)) {
        const el = document.getElementById('score-right');
        el.textContent = String(parseInt(el.textContent, 10) + score);
        adjustScoreFont(el);
        bumpCountryPoints(currentRightTeam, score);
    } else {
        return;
    }

    // pro Match
    sup.points = (sup.points || 0) + score;
    supporters.set(key, sup);

    awardPoints(userId, score, userName, avatarUrl);


    updatePodium();
}



function startMatch(round, matchIndex) {
    updateStageHeader(round);

    currentRound = round;
    currentMatchIndex = matchIndex;

    const def = bracketMap[round][matchIndex];
    if (!def) return;

    const [iA, iB] = def.players;
    const teamA = getTeamFromCol(round, iA);
    const teamB = getTeamFromCol(round, iB);
    if (!teamA || !teamB) return;

    currentLeftTeam = teamA.name;
    currentRightTeam = teamB.name;
    pointsActive = false;
    // Neue Runde → Supporter der vorherigen Runde löschen
    supporters.clear();
    // 🔁 neue Runde = neue Podium-Liste
    resetPerRoundLeaderboard();

    setArena(teamA, teamB, 0, 0);

    const textEl = document.getElementById('timer-text');

    function setPhase(text, duration, nextPhase) {
        textEl.textContent = text;
        textEl.classList.add("phase-text");
        setTimeout(nextPhase, duration * 1000);
    }

    setPhase("NÄCHSTE RUNDE", 10, () => {
        // Sound starten – läuft von allein durch
        try {
            startCue.currentTime = 0; // von vorn
            startCue.play().catch(() => { });
        } catch (e) { }
        setPhase("AUF DIE PLÄTZE!", 1, () => {

            setPhase("FERTIG!", 1, () => {
                setPhase("LOS!", 1, () => {
                    pointsActive = true;
                    textEl.classList.remove("phase-text");
                    const extra = (round === 'final') ? FINAL_EXTRA_SECONDS : 0;
                    window.matchTimer.reset(ROUND_DURATION + extra);

                    window.matchTimer.start();
                });
            });
        });
    });
}

window.addEventListener('match:end', (ev) => {

    const leftScore = parseInt(document.getElementById('score-left')?.textContent ?? '0', 10) || 0;
    const rightScore = parseInt(document.getElementById('score-right')?.textContent ?? '0', 10) || 0;

    maybeUpdateRoundRecord();
    // 1️⃣ Overtime prüfen (nur wenn noch nicht gespielt)
    if (leftScore === rightScore && !window.overtimePlayed) {
        window.overtimePlayed = true; // merken, dass Overtime gespielt wird
        const textEl = document.getElementById('timer-text');

        // Overtime-Text anzeigen
        textEl.textContent = "Overtime!";
        textEl.classList.add("phase-text");

        // Punkte bleiben aktiv
        pointsActive = true;

        // Nach 2 Sekunden Overtime-Timer starten
        setTimeout(() => {
            textEl.classList.remove("phase-text");
            window.matchTimer.reset(OVERTIME_DURATION); // 30 Sek Overtime
            window.matchTimer.start();
        }, 2000);

        return; // normalen Ablauf abbrechen
    }
    if (!ev || !ev.detail || ev.detail.reason === 'timeup') {
        try {
            endCue.currentTime = 0;
            endCue.play().catch(() => { });
        } catch (e) { }
    }
    // 2️⃣ Falls immer noch unentschieden nach Overtime → Random Winner
    if (leftScore === rightScore && window.overtimePlayed) {
        const randomWinner = Math.random() < 0.5 ? currentLeftTeam : currentRightTeam;
        if (randomWinner.toLowerCase() === currentLeftTeam.toLowerCase()) {
            const el = document.getElementById('score-left');
            el.textContent = leftScore + 1;
            adjustScoreFont(el); // <-- FIX
            bumpCountryPoints(currentLeftTeam, 1);
        } else {
            const el = document.getElementById('score-right');
            el.textContent = rightScore + 1;
            adjustScoreFont(el); // <-- FIX
            bumpCountryPoints(currentRightTeam, 1);
        }
    }


    // 3️⃣ Ab hier normaler Match-Ende Ablauf
    pointsActive = false;

    const def = bracketMap[currentRound][currentMatchIndex];
    if (!def) return;

    const winner = getWinnerFromArena();

    // Sieger ins nächste Feld eintragen
    if (def.target) {
        setTeamInCol(def.target.col, def.target.index, winner);
    }

    // Gewinner-Box im Bracket grün markieren
    const [iA, iB] = def.players;
    const colEl = getCol(currentRound);
    if (colEl) {
        const boxA = colEl.children[iA];
        const boxB = colEl.children[iB];
        if (boxA && boxA.querySelector('span')?.textContent.trim() === winner.name) {
            boxA.classList.add('winner');
        } else if (boxB && boxB.querySelector('span')?.textContent.trim() === winner.name) {
            boxB.classList.add('winner');
        }
    }

    // 🟩 Gewinner-Karte in der Arena markieren
    if (winner.name.toLowerCase() === currentLeftTeam.toLowerCase()) {
        document.getElementById('card-left').classList.add('card-winner');
        document.getElementById('card-right').classList.add('card-loser');
    } else if (winner.name.toLowerCase() === currentRightTeam.toLowerCase()) {
        document.getElementById('card-right').classList.add('card-winner');
        document.getElementById('card-left').classList.add('card-loser');
    }

    // Nach 5 Sekunden wieder entfernen
    setTimeout(() => {
        document.getElementById('card-left').classList.remove('card-winner', 'card-loser');
        document.getElementById('card-right').classList.remove('card-winner', 'card-loser');
    }, 7500);

    // 4️⃣ Nächstes Match starten ODER Turnier-Zusammenfassung zeigen
    setTimeout(() => {
        if (currentRound === 'qf') {
            if (currentMatchIndex < bracketMap.qf.length - 1) {
                startMatch('qf', currentMatchIndex + 1);
            } else {
                startMatch('sf', 0);
            }
        } else if (currentRound === 'sf') {
            if (currentMatchIndex < bracketMap.sf.length - 1) {
                startMatch('sf', currentMatchIndex + 1);
            } else {
                startMatch('final', 0);
            }
        } else if (currentRound === 'final') {
            // Gewinner bestimmen (du hast 'winner' oben schon)
            const winnerNow = getWinnerFromArena(); // { name, flag, ... }

            // 1) aktuelle Streak updaten
            const cur = getCurrentStreak();
            let nextCur;
            if (cur.team && cur.team.toUpperCase() === (winnerNow.name || '').toUpperCase()) {
                nextCur = { team: cur.team, count: (cur.count || 0) + 1 };
            } else {
                nextCur = { team: winnerNow.name, count: 1 };
            }
            setCurrentStreak(nextCur);

            // 2) Best-Streak ggf. anheben
            maybeUpdateBestStreak(nextCur);
            updateWinnerAndStreaks(winnerNow.name);

            // 3) Badges im Bracket aktualisieren
            applyStreakBadges();

            // Dann dein bestehendes Modal zeigen
            showTournamentModal(getWinnerFromArena());
        }


    }, 7500);


    // Reset für das nächste Match
    window.overtimePlayed = false;
});

// ===== Alltime-Punkte (persistant via localStorage) =====
const STORAGE_KEY = 'cw_alltime_countries_v1';

function loadAlltime() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function saveAlltime(map) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { }
}

function ensureAllCountriesInStore(store) {
    // bekannte Länder initial mit 0
    allCountries.forEach(c => {
        if (store[c.name] == null) store[c.name] = 0;
    });
    return store;
}

// +delta auf Land buchen (>=0), Flag optional für neue Länder
function bumpCountryPoints(countryName, delta) {
    if (!countryName || !Number.isFinite(delta) || delta === 0) return;

    const name = String(countryName).trim().toUpperCase();
    const store = ensureAllCountriesInStore(loadAlltime());
    if (store[name] == null) store[name] = 0; // falls neues Land
    store[name] += delta;
    saveAlltime(store);
    renderTop10Countries(store);
}

function renderTop10Countries(store = null) {
    const list = document.getElementById('top10-list');
    if (!list) return;
    const data = store ? store : ensureAllCountriesInStore(loadAlltime());

    // Map -> Array mit Flag-Lookup
    const withMeta = Object.entries(data).map(([name, pts]) => {
        const meta = allCountries.find(x => x.name === name) || { flag: '', name };
        return { name, flag: meta.flag || '', pts: Number(pts) || 0 };
    });

    withMeta.sort((a, b) => b.pts - a.pts);
    const top10 = withMeta.slice(0, 10);

    list.innerHTML = '';
    top10.forEach(row => {
        const li = document.createElement('li');
        const img = document.createElement('img');
        img.src = row.flag || '';
        img.alt = row.name;
        const name = document.createElement('span');
        name.textContent = row.name; // nur Flagge + Name (wie gewünscht)

        li.appendChild(img);
        li.appendChild(name);
        list.appendChild(li);
    });
}

// Beim Start einmal rendern (auch wenn noch alles 0 ist)
document.addEventListener('DOMContentLoaded', () => {
    // initiale Länderliste sicherstellen
    saveAlltime(ensureAllCountriesInStore(loadAlltime()));
    renderTop10Countries();
    renderStatsBar();
    applyStreakBadges();
});
// <- Deine Standard-Auswahl (in genau den Namen wie in allCountries)
const DEFAULT_TEAMS = [
    "DEUTSCHLAND",
    "RUSSLAND",
    "POLEN",
    "TÜRKEI",
    "SCHWEIZ",
    "ÖSTERREICH",
    "ALBANIEN",
    "KOSOVO"
];

// Option im <select> sicherstellen und setzen
function prefillSelect(selectEl, countryName) {
    const found = allCountries.find(c => c.name === countryName);
    if (!found) return;
    let opt = [...selectEl.options].find(o => o.value === found.name);
    if (!opt) {
        opt = document.createElement('option');
        opt.value = found.name;
        opt.textContent = found.name;
        selectEl.appendChild(opt);
    }
    selectEl.value = found.name;
}


// ====== Länderliste (Name + Flag-Pfad) ======
const allCountries = [
    { name: "ANDORRA", flag: "flags/ad.png" },
    { name: "VEREINIGTE ARABISCHE EMIRATE", flag: "flags/ae.png" },
    { name: "AFGHANISTAN", flag: "flags/af.png" },
    { name: "ANTIGUA UND BARBUDA", flag: "flags/ag.png" },
    { name: "ANGUILLA", flag: "flags/ai.png" },
    { name: "ALBANIEN", flag: "flags/al.png" },
    { name: "ARMENIEN", flag: "flags/am.png" },
    { name: "ANGOLA", flag: "flags/ao.png" },
    { name: "ANTARKTIS", flag: "flags/aq.png" },
    { name: "ARGENTINIEN", flag: "flags/ar.png" },
    { name: "AMERIKANISCH-SAMOA", flag: "flags/as.png" },
    { name: "ÖSTERREICH", flag: "flags/at.png" },
    { name: "AUSTRALIEN", flag: "flags/au.png" },
    { name: "ARUBA", flag: "flags/aw.png" },
    { name: "ÅLAND-INSELN", flag: "flags/ax.png" },
    { name: "ASERBAIDSCHAN", flag: "flags/az.png" },
    { name: "BOSNIEN UND HERZEGOWINA", flag: "flags/ba.png" },
    { name: "LIBANON", flag: "flags/lb.png" },
    { name: "BARBADOS", flag: "flags/bb.png" },
    { name: "BANGLADESCH", flag: "flags/bd.png" },
    { name: "BELGIEN", flag: "flags/be.png" },
    { name: "BURKINA FASO", flag: "flags/bf.png" },
    { name: "TUNESIEN", flag: "flags/tn.png" },
    { name: "KURDISTAN", flag: "flags/kr.png" },
    { name: "BULGARIEN", flag: "flags/bg.png" },
    { name: "DUBAI", flag: "flags/ae.png" },
    { name: "BAHRAIN", flag: "flags/bh.png" },
    { name: "BURUNDI", flag: "flags/bi.png" },
    { name: "BENIN", flag: "flags/bj.png" },
    { name: "SAINT BARTHÉLEMY", flag: "flags/bl.png" },
    { name: "BERMUDA", flag: "flags/bm.png" },
    { name: "BRUNEI DARUSSALAM", flag: "flags/bn.png" },
    { name: "BOLIVIEN", flag: "flags/bo.png" },
    { name: "BONAIRE", flag: "flags/bq.png" },
    { name: "BRASILIEN", flag: "flags/br.png" },
    { name: "BHUTAN", flag: "flags/bt.png" },
    { name: "NORWEGEN", flag: "flags/no.png" },
    { name: "BELARUS", flag: "flags/by.png" },
    { name: "BELIZE", flag: "flags/bz.png" },
    { name: "KANADA", flag: "flags/ca.png" },
    { name: "KOKOSINSELN", flag: "flags/cc.png" },
    { name: "KONGO", flag: "flags/cg.png" },
    { name: "SCHWEIZ", flag: "flags/ch.png" },
    { name: "CHILE", flag: "flags/cl.png" },
    { name: "CHINA", flag: "flags/cn.png" },
    { name: "KOLUMBIEN", flag: "flags/co.png" },
    { name: "KUBA", flag: "flags/cu.png" },
    { name: "ZYPERN", flag: "flags/cy.png" },
    { name: "TSCHECHIEN", flag: "flags/cz.png" },
    { name: "DEUTSCHLAND", flag: "flags/de.png" },
    { name: "DÄNEMARK", flag: "flags/dk.png" },
    { name: "DOMINIKA", flag: "flags/dm.png" },
    { name: "DOMINIKANISCHE REPUBLIK", flag: "flags/do.png" },
    { name: "ALGERIEN", flag: "flags/dz.png" },
    { name: "ECUADOR", flag: "flags/ec.png" },
    { name: "ESTLAND", flag: "flags/ee.png" },
    { name: "ÄGYPTEN", flag: "flags/eg.png" },
    { name: "WESTSAHARA", flag: "flags/eh.png" },
    { name: "SPANIEN", flag: "flags/es.png" },
    { name: "FINNLAND", flag: "flags/fi.png" },
    { name: "FRANKREICH", flag: "flags/fr.png" },
    { name: "GROSSBRITANNIEN", flag: "flags/gb.png" },
    { name: "GRIECHENLAND", flag: "flags/gr.png" },
    { name: "KROATIEN", flag: "flags/hr.png" },
    { name: "UNGARN", flag: "flags/hu.png" },
    { name: "INDIEN", flag: "flags/in.png" },
    { name: "IRLAND", flag: "flags/ie.png" },
    { name: "ISRAEL", flag: "flags/il.png" },
    { name: "ITALIEN", flag: "flags/it.png" },
    { name: "JAPAN", flag: "flags/jp.png" },
    { name: "KASACHSTAN", flag: "flags/kz.png" },
    { name: "LETTLAND", flag: "flags/lv.png" },
    { name: "LITAUEN", flag: "flags/lt.png" },
    { name: "LUXEMBURG", flag: "flags/lu.png" },
    { name: "MALTA", flag: "flags/mt.png" },
    { name: "NORDMAZEDONIEN", flag: "flags/mk.png" },
    { name: "MEXIKO", flag: "flags/mx.png" },
    { name: "MONACO", flag: "flags/mc.png" },
    { name: "MOLDAVIEN", flag: "flags/md.png" },
    { name: "MONTENEGRO", flag: "flags/me.png" },
    { name: "MAROKKO", flag: "flags/ma.png" },
    { name: "NEUSEELAND", flag: "flags/nz.png" },
    { name: "PAKISTAN", flag: "flags/pk.png" },
    { name: "NIEDERLANDE", flag: "flags/nl.png" },
    { name: "NORWEGEN", flag: "flags/no.png" },
    { name: "POLEN", flag: "flags/pl.png" },
    { name: "SOMALIA", flag: "flags/so.png" },
    { name: "PORTUGAL", flag: "flags/pt.png" },
    { name: "RUMÄNIEN", flag: "flags/ro.png" },
    { name: "RUSSLAND", flag: "flags/ru.png" },
    { name: "SERBIEN", flag: "flags/rs.png" },
    { name: "SCHWEDEN", flag: "flags/se.png" },
    { name: "SLOWENIEN", flag: "flags/si.png" },
    { name: "SCHWEIZ", flag: "flags/ch.png" },
    { name: "TÜRKEI", flag: "flags/tr.png" },
    { name: "UKRAINE", flag: "flags/ua.png" },
    { name: "VEREINIGTE STAATEN", flag: "flags/us.png" },
    { name: "VATIKANSTADT", flag: "flags/va.png" },
    { name: "KOSOVO", flag: "flags/xk.png" },
    { name: "IRAN", flag: "flags/ir.png" },
    { name: "IRAK", flag: "flags/iq.png" },
    { name: "SYRIEN", flag: "flags/sy.png" },
    { name: "SÜDAFRIKA", flag: "flags/za.png" },
    { name: "SIMBABWE", flag: "flags/zw.png" },
];


// Hilfsfunktion
function shuffleArray(arr) { return arr.map(v => ({ v, r: Math.random() })).sort((a, b) => a.r - b.r).map(x => x.v); }

// Füllt die 8 VF-Slots
function setQfTeams(teams) {
    teams.forEach((t, idx) => setTeamInCol('qf', idx, t));
}
// ===== Kleine Util für Suche (diakritik-freundlich, case-insensitive)
const _norm = s => (s || "")
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

/**
 * Ersetzt ein <select> durch ein Such-Combo-UI, hält aber das <select> im DOM
 * und setzt dessen value weiter – dein Start-Button-Code bleibt unverändert.
 */
function makeSearchableSelect(selectEl, data /* array {name, flag} */) {
    // verstecken, aber im DOM lassen
    selectEl.style.display = 'none';

    // Wrapper + Anzeige-Pill
    const wrap = document.createElement('div');
    wrap.className = 'country-combo';

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'cc-pill';
    pill.innerHTML = '<span>Land wählen…</span>';

    const panel = document.createElement('div');
    panel.className = 'panel';

    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Suche Land…';
    search.className = 'search';

    const list = document.createElement('div');
    list.className = 'list';

    panel.appendChild(search);
    panel.appendChild(list);
    wrap.appendChild(pill);
    wrap.appendChild(panel);
    selectEl.parentNode.insertBefore(wrap, selectEl.nextSibling);

    // Rendering der Treffer
    let items = [];
    let activeIndex = -1;

    function render(q = '') {
        const nq = _norm(q);
        const results = !nq
            ? data
            : data.filter(c => _norm(c.name).includes(nq));
        list.innerHTML = '';
        items = results.slice(0, 200).map(c => {
            const it = document.createElement('div');
            it.className = 'item';
            it.innerHTML = `<img src="${c.flag}" alt=""><span>${c.name}</span>`;
            it.addEventListener('click', () => choose(c));
            list.appendChild(it);
            return it;
        });
        activeIndex = items.length ? 0 : -1;
        updateActive();
    }

    function updateActive() {
        items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
        if (activeIndex >= 0) items[activeIndex].scrollIntoView({ block: 'nearest' });
    }

    function open() {
        wrap.classList.add('open');
        render('');
        search.value = '';
        setTimeout(() => search.focus(), 0);
        document.addEventListener('click', onDocClick, { capture: true });
    }

    function close() {
        wrap.classList.remove('open');
        document.removeEventListener('click', onDocClick, { capture: true });
    }

    function onDocClick(e) {
        if (!wrap.contains(e.target)) close();
    }

    function choose(country) {
        // UI-Pill aktualisieren
        pill.innerHTML = `<img src="${country.flag}" alt=""><span>${country.name}</span>`;
        // <select> synchronisieren (damit dein Start-Button weiter funktioniert)
        // 1) Option sicherstellen
        let opt = [...selectEl.options].find(o => o.value === country.name);
        if (!opt) {
            opt = document.createElement('option');
            opt.value = country.name;
            opt.textContent = country.name;
            selectEl.appendChild(opt);
        }
        selectEl.value = country.name;
        close();
    }

    // Events
    pill.addEventListener('click', () => {
        if (wrap.classList.contains('open')) close(); else open();
    });
    search.addEventListener('input', () => render(search.value));
    search.addEventListener('keydown', (e) => {
        if (!items.length) return;
        if (e.key === 'ArrowDown') { activeIndex = Math.min(activeIndex + 1, items.length - 1); updateActive(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { activeIndex = Math.max(activeIndex - 1, 0); updateActive(); e.preventDefault(); }
        else if (e.key === 'Enter') { items[activeIndex]?.click(); e.preventDefault(); }
        else if (e.key === 'Escape') { close(); }
    });

    // Falls das <select> schon einen Wert gesetzt hat, gleich anzeigen
    if (selectEl.value) {
        const found = data.find(c => c.name === selectEl.value);
        if (found) pill.innerHTML = `<img src="${found.flag}" alt=""><span>${found.name}</span>`;
    }
}
function startTournamentFromPanel() {
    const roundTimeInput = document.getElementById('round-time');
    const overtimeTimeInput = document.getElementById('overtime-time');

    ROUND_DURATION = parseInt(roundTimeInput?.value, 10) || 60;
    OVERTIME_DURATION = parseInt(overtimeTimeInput?.value, 10) || 30;

    const selects = document.querySelectorAll('.country-input');
    let chosen = [];
    selects.forEach(sel => {
        const c = allCountries.find(x => x.name === sel.value);
        if (c) chosen.push(c);
    });

    if (chosen.length !== 8) { alert('Bitte 8 Länder auswählen!'); return; }

    const set = new Set(chosen.map(c => c.name));
    if (set.size !== 8) { alert('Bitte 8 unterschiedliche Länder wählen!'); return; }

    // ggf. mischen
    const shuffleCB = document.getElementById('shuffle');
    if (shuffleCB?.checked) chosen = shuffleArray(chosen);

    // Bracket neu aufbauen
    setQfTeams(chosen);
    ['sf', 'final'].forEach(col => {
        const el = getCol(col); if (!el) return;
        [...el.children].forEach(box => box.innerHTML = `<span>—</span>`);
    });
    applyStreakBadges();

    // Reset
    document.querySelectorAll('.team-box.winner').forEach(n => n.classList.remove('winner'));
    hideTournamentModal();
    overallScores.clear();

    // Start bei VF Match 0
    startMatch('qf', 0);
}

// Control Panel initialisieren
function setupControlPanel() {
    const selects = document.querySelectorAll('.country-input');
    const shuffleCB = document.getElementById('shuffle');
    const startBtn = document.getElementById('start-tournament');
    if (!selects.length || !startBtn) return;

    // 1) Default-Teams in die 8 Selects schreiben
    selects.forEach((sel, idx) => {
        const defName = DEFAULT_TEAMS[idx];
        if (defName) prefillSelect(sel, defName);
    });

    // 2) Danach die Such-Combos erzeugen (die Pill zeigt dann direkt die Defaults)
    selects.forEach(sel => {
        makeSearchableSelect(sel, allCountries);
    });

    // 3) Dein bestehender Start-Button-Code bleibt wie er ist …
    startBtn.addEventListener('click', () => {
        // ... unverändert
        const roundTimeInput = document.getElementById('round-time');
        const overtimeTimeInput = document.getElementById('overtime-time');

        ROUND_DURATION = parseInt(roundTimeInput?.value, 10) || 60;
        OVERTIME_DURATION = parseInt(overtimeTimeInput?.value, 10) || 30;

        let chosen = [];
        selects.forEach(sel => {
            const c = allCountries.find(x => x.name === sel.value);
            if (c) chosen.push(c);
        });

        if (chosen.length !== 8) { alert('Bitte 8 Länder auswählen!'); return; }

        const set = new Set(chosen.map(c => c.name));
        if (set.size !== 8) { alert('Bitte 8 unterschiedliche Länder wählen!'); return; }

        if (shuffleCB?.checked) chosen = shuffleArray(chosen);

        setQfTeams(chosen);
        ['sf', 'final'].forEach(col => {
            const el = getCol(col); if (!el) return;
            [...el.children].forEach(box => box.innerHTML = `<span>—</span>`);
        });
        applyStreakBadges();

        document.querySelectorAll('.team-box.winner').forEach(n => n.classList.remove('winner'));
        hideTournamentModal();
        overallScores.clear();
        startMatch('qf', 0);
    });
}



let _winnerModalTimer = null;
function adjustScoreFont(el) {
    if (!el) return;
    const val = parseInt(el.textContent, 10) || 0;
    el.classList.remove('small', 'tiny');
    if (val >= 1000000) {
        el.classList.add('tiny');   // ab 100k
    } else if (val >= 10000) {
        el.classList.add('small');  // ab 10k
    }
}



function showTournamentModal(winnerTeamObj) {
    const modal = document.getElementById('tournament-modal');
    if (!modal) return;

    // Gewinner setzen
    const flagEl = document.getElementById('modal-winner-flag');
    const nameEl = document.getElementById('modal-winner-name');
    if (flagEl) flagEl.src = winnerTeamObj.flag || '';
    if (nameEl) nameEl.textContent = winnerTeamObj.name || '—';

    try {
        finalSound.currentTime = 0;
        finalSound.play().catch(() => { });
    } catch (e) { }

    // Top 3 (aus globalScores)
    // Top 3 (OVERALL)
    const top3 = Array.from(overallScores.entries())
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.points - a.points)
        .slice(0, 3);


    const list = document.getElementById('modal-top3');
    if (list) {
        list.innerHTML = '';
        if (!top3.length) {
            const li = document.createElement('li');
            li.innerHTML = `<span class="name">Keine Supporter</span>`;
            list.appendChild(li);
        } else {
            top3.forEach(u => {
                const li = document.createElement('li');
                const img = document.createElement('img');
                img.src = u.avatar || AVATAR_PLACEHOLDER;
                img.alt = u.name || u.id;

                const name = document.createElement('span');
                name.className = 'name';
                name.textContent = u.name || u.id;

                const pts = document.createElement('span');
                pts.className = 'points';
                pts.textContent = `${u.points} Punkte`;

                li.appendChild(img);
                li.appendChild(name);
                li.appendChild(pts);
                list.appendChild(li);
            });
        }
    }

    // anzeigen + Auto-Close
    modal.classList.remove('hidden');

    if (_winnerModalTimer) clearTimeout(_winnerModalTimer);
    _winnerModalTimer = setTimeout(() => {
        // Modal schließen
        hideTournamentModal();

        // ⬇️ Autorun: wenn Checkbox aktiv, direkt neues Turnier starten
        const autorun = document.getElementById('autorun');
        if (autorun?.checked) {
            setTimeout(() => {
                startTournamentFromPanel();
            }, 200); // mini-Pause nach dem Ausblenden
        }
    }, 10000); // 10s Anzeige

}

function hideTournamentModal() {
    const modal = document.getElementById('tournament-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    if (_winnerModalTimer) {
        clearTimeout(_winnerModalTimer);
        _winnerModalTimer = null;
    }
}

updatePodium();
setupControlPanel();
// ======================= VERBINDUNG ZUM WEBSOCKET SERVER =======================
// ======================= VERBINDUNG ZUM WEBSOCKET SERVER =======================
const ws = new WebSocket('ws://localhost:8080');

ws.addEventListener('message', (event) => {
    try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'batch' && Array.isArray(msg.events)) {
            msg.events.forEach(enqueueEvent);
        } else {
            window.enqueueEvent(msg);
        }
    } catch (e) {
        console.warn('WS parse error:', e);
    }
});


document.addEventListener('DOMContentLoaded', () => {
    updateStageHeader('qf'); // optional, nur für initiale Markierung
});
