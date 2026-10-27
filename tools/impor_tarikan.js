// Merangkum file tarikan harian di luar Apps Script dengan prosesSatuTarikan() yang sama persis (Kode.gs),
// untuk diimpor sekaligus lewat imporTarikan() (lihat Kode.gs) daripada menunggu pemicu 15 menit per file.
// Pemakaian: node impor_tarikan.js <Kode.gs> <daftar.tsv> <keluaran.json>
//   daftar.tsv: area <TAB> nama file <TAB> File ID Drive <TAB> modifiedTime Drive (ISO) <TAB> file JSON dari impor_baca.py
const fs = require('fs');
const [kodePath, daftarPath, outPath] = process.argv.slice(2);
const out = { Event: [], AMT: [], 'Event Jam': [], 'AMT Jam': [], Log: [] };
let cur = null;
const sheetMock = (rows) => ({
  getLastRow: () => rows.length, getLastColumn: () => rows[0].length,
  getRange: (r, c, nr, nc) => ({ getValues: () => rows.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)) }),
});
const sheetTulis = (nama) => ({
  getRange: () => ({ setNumberFormat() { return this; } }),
  getDataRange: () => ({ getValues: () => [[...Array(nama === 'AMT Jam' ? 8 : nama === 'AMT' || nama === 'Event' ? 6 : 7).keys()]] }),
  getLastRow: () => 1, nama,
});
global.MimeType = { MICROSOFT_EXCEL: 'x', GOOGLE_SHEETS: 'g' };
global.SpreadsheetApp = { openById: () => ({ getSheets: () => [sheetMock(cur)] }) };
global.DriveApp = { getFileById: () => ({ setTrashed() {} }) };
global.Logger = { log() {} };
const K = new Function(fs.readFileSync(kodePath, 'utf8') +
  ';bukaAtauBuat = () => ({ getSheetByName: n => sheetTulis(n) }); sheetAtauBuat = (ss, n) => sheetTulis(n);' +
  'gantiBaris = (sh, sumber, baru) => tulis(sh.nama, baru);' +
  'return { prosesSatuTarikan, tanggalNama_ };').call(null);
function tulis(n, baru) { baru.forEach(r => out[n].push(r)); }
global.sheetTulis = sheetTulis; global.tulis = tulis;
for (const baris of fs.readFileSync(daftarPath, 'utf8').split('\n').filter(s => s.trim())) {
  const [area, nama, id, diubah, json] = baris.split('\t');
  cur = JSON.parse(fs.readFileSync(json, 'utf8'), (k, v) => v && typeof v === 'object' && v.$d ? (([d, t]) => { const a = d.split('-').map(Number), b = t.split(':').map(Number); return new Date(a[0], a[1] - 1, a[2], b[0], b[1], b[2]); })(v.$d.split('T')) : v);
  const o = { id, nama, area: area.toUpperCase(), tgl: K.tanggalNama_(nama), mime: 'g' };
  const n = K.prosesSatuTarikan({}, o, Date.now() + 1e9);
  out.Log.push([id, nama, o.area, o.tgl, new Date(diubah).getTime(), n]);
  console.log(o.area, o.tgl, nama, n, 'event');
}
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(Object.keys(out).map(k => k + ' ' + out[k].length).join(', '));
