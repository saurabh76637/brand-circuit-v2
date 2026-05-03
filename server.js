const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '64kb' }));

const DATA_DIR = path.join(__dirname, 'data');
const JSONL_PATH = path.join(DATA_DIR, 'results.jsonl');
const CSV_PATH = path.join(DATA_DIR, 'results.csv');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Determine the next match number from existing JSONL (so it survives restarts).
let nextMatchNum = 1;
if (fs.existsSync(JSONL_PATH)) {
    try {
        const lines = fs.readFileSync(JSONL_PATH, 'utf8').split(/\r?\n/);
        let max = 0;
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const obj = JSON.parse(line);
                if (typeof obj.matchNum === 'number' && obj.matchNum > max) max = obj.matchNum;
            } catch (_) { /* skip malformed */ }
        }
        nextMatchNum = max + 1;
    } catch (err) {
        console.warn('[server] Could not read existing JSONL:', err.message);
    }
}
console.log(`[server] Next match number: ${nextMatchNum}`);

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/results', (req, res) => {
    const body = req.body || {};
    const { matchId, timestamp, winner, rows } = body;

    if (!matchId || !timestamp || !Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ ok: false, error: 'matchId, timestamp, and non-empty rows[] required' });
    }

    const matchNum = nextMatchNum++;
    const lines = rows.map(r => JSON.stringify({
        matchNum,
        matchId,
        timestamp,
        playerSlot: r.playerSlot || '',
        name: r.name || '',
        zone: r.zone || '',
        channel: r.channel || '',
        position: r.position ?? null,
        finishTimeSec: r.finishTimeSec ?? null,
        score: r.score ?? null,
        winner: winner || ''
    })).join('\n') + '\n';

    try {
        fs.appendFileSync(JSONL_PATH, lines);
        console.log(`[server] Saved match #${matchNum} (${rows.length} rows) — ${matchId}`);
        return res.json({ ok: true, matchNum, saved: rows.length });
    } catch (err) {
        nextMatchNum--;
        console.error('[server] Save failed:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// On-demand CSV download — runs the converter and streams the file.
app.get('/api/results.csv', (req, res) => {
    try {
        require('./scripts/jsonl-to-csv.js').convert(JSONL_PATH, CSV_PATH);
        res.download(CSV_PATH, 'results.csv');
    } catch (err) {
        console.error('[server] CSV conversion failed:', err);
        res.status(500).send('CSV conversion failed: ' + err.message);
    }
});

const PORT = process.env.PORT || 3011;

app.listen(PORT, '0.0.0.0', () => {
    console.log('\x1b[32m%s\x1b[0m', '🚀 Brand Circuit V2 Server is running!');
    console.log('\n----------------------------------------');
    console.log(`🏠 Local:    http://localhost:${PORT}/game/`);
    console.log(`🌐 Live:     https://brandcircuitv2.2209.in/game/`);
    console.log(`📊 CSV:      https://brandcircuitv2.2209.in/api/results.csv`);
    console.log('----------------------------------------\n');
});
