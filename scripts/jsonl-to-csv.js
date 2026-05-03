/**
 * JSONL → CSV converter.
 *
 * Reads data/results.jsonl line-by-line and writes data/results.csv with:
 *   • UTF-8 BOM so Excel renders non-ASCII characters correctly
 *   • RFC 4180 escaping (commas, quotes, newlines)
 *   • CRLF line endings (Excel-friendly on Windows)
 *
 * Run as a script:    node scripts/jsonl-to-csv.js
 *           or:       npm run csv
 *
 * Or programmatically: require('./scripts/jsonl-to-csv').convert(in, out)
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Stable column order — most useful first for sorting/filtering in Excel.
const PREFERRED_COLUMNS = [
    'matchNum',
    'matchId',
    'timestamp',
    'playerSlot',
    'name',
    'zone',
    'channel',
    'position',
    'finishTimeSec',
    'score',
    'winner'
];

function escapeCsvField(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (/[",\r\n]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

function convert(jsonlPath, csvPath) {
    const BOM = '﻿';
    if (!fs.existsSync(jsonlPath)) {
        // No data yet — write a header-only CSV so Excel still opens cleanly.
        const empty = BOM + PREFERRED_COLUMNS.join(',') + '\r\n';
        fs.writeFileSync(csvPath, empty, 'utf8');
        return { rows: 0, columns: PREFERRED_COLUMNS.slice() };
    }

    const raw = fs.readFileSync(jsonlPath, 'utf8');
    const records = [];
    const seenKeys = new Set(PREFERRED_COLUMNS);
    const extraKeys = [];
    let badLines = 0;

    raw.split(/\r?\n/).forEach((line, i) => {
        if (!line.trim()) return;
        try {
            const obj = JSON.parse(line);
            records.push(obj);
            for (const k of Object.keys(obj)) {
                if (!seenKeys.has(k)) {
                    seenKeys.add(k);
                    extraKeys.push(k);
                }
            }
        } catch (err) {
            badLines++;
            console.warn(`[jsonl-to-csv] Skipping malformed line ${i + 1}: ${err.message}`);
        }
    });

    const columns = PREFERRED_COLUMNS.concat(extraKeys);
    const lines = [columns.join(',')];
    for (const rec of records) {
        lines.push(columns.map(c => escapeCsvField(rec[c])).join(','));
    }

    const csv = BOM + lines.join('\r\n') + '\r\n';
    fs.writeFileSync(csvPath, csv, 'utf8');

    return { rows: records.length, columns, badLines };
}

if (require.main === module) {
    const root = path.join(__dirname, '..');
    const jsonlPath = path.join(root, 'data', 'results.jsonl');
    const csvPath = path.join(root, 'data', 'results.csv');
    const result = convert(jsonlPath, csvPath);
    console.log(`✔ Wrote ${result.rows} rows → ${csvPath}`);
    if (result.badLines) console.log(`  (skipped ${result.badLines} malformed line(s))`);
    console.log(`  Columns: ${result.columns.join(', ')}`);
}

module.exports = { convert, escapeCsvField, PREFERRED_COLUMNS };
