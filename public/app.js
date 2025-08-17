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
const globalScores = new Map(); // key = userId (lowercase) -> { name, avatar, points }

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

let pointsActive = false;
let currentLeftTeam = '';
let currentRightTeam = '';
function updatePodium() {
    // Top 3 berechnen
    const top3 = Array.from(globalScores.values())
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
        bumpCountryPoints(currentLeftTeam, 1);   // ⬅️ NEW
    } else if (teamName.toLowerCase() === currentRightTeam.toLowerCase()) {
        const scoreEl = document.getElementById('score-right');
        scoreEl.textContent = parseInt(scoreEl.textContent, 10) + 1;
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

        // 1 Punkt für den Chat selbst
        addPointToTeam(chosen);

        // ➕ Gesamtwertung
        const existing = globalScores.get(key) || {
            name: userName || userId,
            avatar: avatarUrl || '',
            points: 0
        };
        existing.name = existing.name || userName || userId;   // ggf. Name nachtragen
        existing.avatar = existing.avatar || avatarUrl || '';  // ggf. Avatar nachtragen
        existing.points += 1;
        globalScores.set(key, existing);

        updatePodium();
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
        bumpCountryPoints(currentLeftTeam, score);  // ⬅️ NEW
    } else if (normTeam(sup.team) === normTeam(currentRightTeam)) {
        const el = document.getElementById('score-right');
        el.textContent = String(parseInt(el.textContent, 10) + score);
        bumpCountryPoints(currentRightTeam, score); // ⬅️ NEW
    }


    sup.points = (sup.points || 0) + score;
    supporters.set(key, sup);

    const existing = globalScores.get(key) || {
        name: userName || userId,
        avatar: avatarUrl || '',
        points: 0
    };
    existing.name = existing.name || userName || userId;
    existing.avatar = existing.avatar || avatarUrl || '';
    existing.points += score;
    globalScores.set(key, existing);

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
        bumpCountryPoints(currentLeftTeam, score);
    } else if (normTeam(sup.team) === normTeam(currentRightTeam)) {
        const el = document.getElementById('score-right');
        el.textContent = String(parseInt(el.textContent, 10) + score);
        bumpCountryPoints(currentRightTeam, score);
    }

    sup.points = (sup.points || 0) + score;
    supporters.set(key, sup);

    const existing = globalScores.get(key) || {
        name: userName || userId,
        avatar: avatarUrl || '',
        points: 0
    };
    existing.name = existing.name || userName || userId;
    existing.avatar = existing.avatar || avatarUrl || '';
    existing.points += score;
    globalScores.set(key, existing);

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
        bumpCountryPoints(currentLeftTeam, score);
    } else if (normTeam(sup.team) === normTeam(currentRightTeam)) {
        const el = document.getElementById('score-right');
        el.textContent = String(parseInt(el.textContent, 10) + score);
        bumpCountryPoints(currentRightTeam, score);
    } else {
        return;
    }

    // pro Match
    sup.points = (sup.points || 0) + score;
    supporters.set(key, sup);

    // ➕ Gesamtwertung
    const existing = globalScores.get(key) || {
        name: userName || userId,
        avatar: avatarUrl || '',
        points: 0
    };
    existing.name = existing.name || userName || userId;
    existing.avatar = existing.avatar || avatarUrl || '';
    existing.points += score;
    globalScores.set(key, existing);

    updatePodium();
}



function startMatch(round, matchIndex) {
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

    setArena(teamA, teamB, 0, 0);

    const textEl = document.getElementById('timer-text');

    function setPhase(text, duration, nextPhase) {
        textEl.textContent = text;
        textEl.classList.add("phase-text");
        setTimeout(nextPhase, duration * 1000);
    }

    setPhase("NÄCHSTE RUNDE", 10, () => {
        setPhase("AUF DIE PLÄTZE!", 1, () => {
            setPhase("FERTIG!", 1, () => {
                setPhase("LOS!", 1, () => {
                    pointsActive = true;
                    textEl.classList.remove("phase-text");
                    window.matchTimer.reset(ROUND_DURATION);
                    window.matchTimer.start();
                });
            });
        });
    });
}

window.addEventListener('match:end', () => {
    const leftScore = parseInt(document.getElementById('score-left')?.textContent ?? '0', 10) || 0;
    const rightScore = parseInt(document.getElementById('score-right')?.textContent ?? '0', 10) || 0;

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

    // 2️⃣ Falls immer noch unentschieden nach Overtime → Random Winner
    if (leftScore === rightScore && window.overtimePlayed) {
        const randomWinner = Math.random() < 0.5 ? currentLeftTeam : currentRightTeam;
        if (randomWinner.toLowerCase() === currentLeftTeam.toLowerCase()) {
            document.getElementById('score-left').textContent = leftScore + 1;
            bumpCountryPoints(currentLeftTeam, 1);
        } else {
            document.getElementById('score-right').textContent = rightScore + 1;
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
            // Turnier Ende → Modal anzeigen (bleibt stehen bis du neu startest)
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
});


// ====== Länderliste (Name + Flag-Pfad) ======
const allCountries = [
    { name: "GERMANY", flag: "flags/de.png" },
    { name: "BELGIUM", flag: "flags/be.png" },
    { name: "FRANCE", flag: "flags/fr.png" },
    { name: "SPAIN", flag: "flags/es.png" },
    { name: "ITALY", flag: "flags/it.png" },
    { name: "NETHERLANDS", flag: "flags/nl.png" },
    { name: "ENGLAND", flag: "flags/gb.png" },
    { name: "PORTUGAL", flag: "flags/pt.png" },
    // -> bei Bedarf hier erweitern
];

// Hilfsfunktion
function shuffleArray(arr) { return arr.map(v => ({ v, r: Math.random() })).sort((a, b) => a.r - b.r).map(x => x.v); }

// Füllt die 8 VF-Slots
function setQfTeams(teams) {
    teams.forEach((t, idx) => setTeamInCol('qf', idx, t));
}

// Control Panel initialisieren
function setupControlPanel() {
    const selects = document.querySelectorAll('.country-input');
    const shuffleCB = document.getElementById('shuffle');
    const startBtn = document.getElementById('start-tournament');

    if (!selects.length || !startBtn) return;

    // Dropdowns füllen
    selects.forEach(sel => {
        allCountries.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.name;
            opt.textContent = c.name;
            sel.appendChild(opt);
        });
    });

    startBtn.addEventListener('click', () => {
        // 🎯 Neue Zeiten aus Inputs holen
        const roundTimeInput = document.getElementById('round-time');
        const overtimeTimeInput = document.getElementById('overtime-time');

        ROUND_DURATION = parseInt(roundTimeInput?.value, 10) || 60;
        OVERTIME_DURATION = parseInt(overtimeTimeInput?.value, 10) || 30;

        console.log("Neue Zeiten gesetzt:", ROUND_DURATION, OVERTIME_DURATION);

        // 8 Länder einsammeln
        let chosen = [];
        selects.forEach(sel => {
            const c = allCountries.find(x => x.name === sel.value);
            if (c) chosen.push(c);
        });

        if (chosen.length !== 8) {
            alert('Bitte 8 Länder auswählen!');
            return;
        }

        // doppelte vermeiden
        const set = new Set(chosen.map(c => c.name));
        if (set.size !== 8) {
            alert('Bitte 8 unterschiedliche Länder wählen!');
            return;
        }

        if (shuffleCB?.checked) chosen = shuffleArray(chosen);

        // VF setzen
        setQfTeams(chosen);

        // SF/Finale leeren
        ['sf', 'final'].forEach(col => {
            const el = getCol(col);
            if (!el) return;
            [...el.children].forEach(box => box.innerHTML = `<span>—</span>`);
        });

        // Gewinner-Markierungen im Bracket entfernen
        document.querySelectorAll('.team-box.winner').forEach(n => n.classList.remove('winner'));

        // Modal schließen
        hideTournamentModal();

        // ⏱ Start Match 1
        startMatch('qf', 0);
    });

}

let _winnerModalTimer = null;
// Kurzsound für Platz-Anzeige
const rankSound = new Audio('assets/startsound2.mp3');
rankSound.preload = 'auto';
rankSound.volume = 6; // nach Geschmack
document.addEventListener('DOMContentLoaded', () => {
    // „anwärmen“, damit es später sofort spielt
    try { rankSound.load(); } catch (e) { }
});

function showTournamentModal(winnerTeamObj) {
    const modal = document.getElementById('tournament-modal');
    if (!modal) return;

    // Gewinner setzen
    const flagEl = document.getElementById('modal-winner-flag');
    const nameEl = document.getElementById('modal-winner-name');
    if (flagEl) flagEl.src = winnerTeamObj.flag || '';
    if (nameEl) nameEl.textContent = winnerTeamObj.name || '—';

    // Top 3 (aus globalScores)
    const top3 = Array.from(globalScores.entries())
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
                pts.textContent = `${u.points} P`;

                li.appendChild(img);
                li.appendChild(name);
                li.appendChild(pts);
                list.appendChild(li);
            });
        }
    }

    // anzeigen + Auto-Close
    modal.classList.remove('hidden');
    try {
        rankSound.currentTime = 0; // immer von vorn
        rankSound.play().catch(() => { });
    } catch (e) { }
    if (_winnerModalTimer) clearTimeout(_winnerModalTimer);
    _winnerModalTimer = setTimeout(hideTournamentModal, 10000); // 10s
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
const ws = new WebSocket('ws://localhost:8080');

ws.addEventListener('message', (event) => {
    try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'chat') {
            if (!pointsActive) return;
            pledgeUserToTeam(msg.user, msg.comment, msg.nickname || msg.user, msg.avatar || '');

        } else if (msg.type === 'gift') {
            applyGiftFromUser(msg.user, Number(msg.coins) || 0, msg.nickname || msg.user, msg.avatar || '');

        } else if (msg.type === 'like') {
            applyLikeFromUser(msg.user, msg.nickname || msg.user, msg.avatar || '');

        } else if (msg.type === 'follow') {
            applyFollowFromUser(msg.user, msg.nickname || msg.user, msg.avatar || '');
        }

    } catch (e) {
        console.warn('WS parse error:', e);
    }
});
