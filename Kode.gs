/**
 * DASHBOARD MONITORING DRIVING BEHAVIOUR, DRIVER DISCIPLINE & FATIGUE (Google Apps Script)
 *
 * Sumber data: satu folder Google Drive (CFG.FOLDER_ID), isinya:
 *   - "Pengaturan Dashboard" (Google Sheet): sheet Pemetaan (Case -> Parameter -> Kategori, Area -> Regional,
 *     Lokasi -> Regional) dan Catatan (opsional, tampil di dashboard).
 *   - "Data 01 Januari 2026", "Data 02 Februari 2026", ... (Google Sheet, satu file per bulan):
 *       sheet Event : Tanggal (yyyy-mm-dd) | Area | Lokasi | Case | Jumlah
 *       sheet AMT   : Area | Lokasi | Nama AMT | Case | Jumlah
 *     Bulan file diambil dari namanya ("Data 11 November 2026"). Tambah bulan baru = tambah file baru.
 *     File .xlsx yang diunggah tanpa konversi diubah otomatis ke Google Sheet bila layanan lanjutan Drive aktif.
 * Semua rekap (parameter, regional, lokasi, TOP 10 AMT, event per hari) dihitung di sini, tanpa rumus spreadsheet.
 *
 *  - doGet()            : web app.
 *  - getDashboardData() : dipanggil dashboard; hasil di-cache 6 jam (jalankan hapusCache setelah data diubah).
 *  - pasangPemicu()     : jalankan sekali; membangun ulang cache tiap jam supaya dashboard langsung terbuka.
 */

/* ============================== PENGATURAN ============================== */
const CFG = {
  FOLDER_ID: '1nUJtRTcKwJua4Am9EdiFXoQxcTALgt9e',   // folder Drive "3. Data Dashboard"
  TAHUN: 2026,
  CACHE_DETIK: 21600,   // 6 jam (batas maksimum CacheService)
};
const REGIONS = ['SUMBAGUT', 'SUMBAGSEL', 'JABALINUS', 'KALIMANTAN', 'SULAWESI', 'MALUPA'];
const BULAN = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];
const KATEGORI = { 'DRIVING BEHAVIOUR': 'DB', 'DRIVER DISCIPLINE': 'DD', 'FATIGUE MANAGEMENT': 'FM' };
/** Parameter yang dipindah kategorinya di dashboard (nama parameter huruf besar -> kode kategori). */
const PINDAH_KATEGORI = { 'DRIVING > 4 HOURS': 'DB' };
/** Tipe alat per parameter (untuk keterangan). */
const TIPE = {
  'OVER SPEED': 'GPS', 'HARSH TURN / CORNERING': 'GPS', 'HARSH BRAKING': 'GPS', 'HARSH ACCELERATION': 'GPS',
  'BLACK ZONE': 'GPS', 'IDLING': 'GPS', 'DRIVING > 4 HOURS': 'GPS',
  'MENGGUNAKAN TELEPON': 'CCTV', 'MEROKOK / VAPE': 'CCTV', 'MICROSLEEP': 'CCTV', 'MENGUAP': 'CCTV',
};

/* ============================== MENU ============================== */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Dashboard')
      .addItem('Hapus cache dashboard', 'hapusCache')
      .addItem('Uji baca sumber', 'UJI_BACA_SUMBER')
      .addItem('Pasang pemanas cache (tiap jam)', 'pasangPemicu')
      .addToUi();
  } catch (e) { /* dijalankan dari luar spreadsheet */ }
}

function hapusCache() {
  CacheService.getScriptCache().remove('DASHB2_N');
  CacheService.getScriptCache().remove('DASHB2');
  try { SpreadsheetApp.getActiveSpreadsheet().toast('Cache dihapus. Muat ulang dashboard.', 'Dashboard', 5); } catch (e) { Logger.log('Cache dihapus.'); }
}

/** DIAGNOSA: jalankan dari editor, lihat hasilnya di View > Logs. */
function UJI_BACA_SUMBER() {
  const d = bangunData();
  Logger.log('Bulan berisi data: ' + d.bulanAda.map(m => BULAN[m]).join(', '));
  Logger.log('Parameter: ' + d.params.map(p => p.label + ' (' + p.kat + ')').join('; '));
  Logger.log('Regional: ' + Object.keys(d.regional).join(', '));
  Logger.log('Rekap lokasi per bulan: ' + Object.keys(d.lokasiBulan).map(m => BULAN[m]).join(', ') + ' | YTD: ' + d.lokasiYTD.length + ' lokasi');
  Logger.log('Top AMT: ' + (d.topAMT ? d.topAMT.length + ' baris' : 'data AMT belum ada'));
  Logger.log('Harian: ' + (d.harian ? d.harian.length + ' baris' : 'data harian belum ada'));
  if (d.peringatan.length) Logger.log('Peringatan: ' + d.peringatan.join(' | '));
}

/* ============================== WEB APP ============================== */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Monitoring Driving Behaviour, Driver Discipline & Fatigue')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Dijalankan pemicu waktu: membangun ulang cache supaya pengunjung tidak menunggu spreadsheet dihitung. */
function panaskanCache() { simpanCache(JSON.stringify(bangunData())); }

/** Jalankan sekali dari editor: memasang pemicu panaskanCache tiap jam. */
function pasangPemicu() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'panaskanCache').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('panaskanCache').timeBased().everyHours(1).create();
  panaskanCache();
  Logger.log('Pemicu panaskanCache terpasang (tiap jam) dan cache sudah diisi.');
}

function simpanCache(json) {
  try {
    const parts = {}, size = 90000;
    for (let i = 0; i * size < json.length; i++) parts['DASHB2_' + i] = json.substr(i * size, size);
    parts.DASHB2_N = String(Object.keys(parts).length);
    CacheService.getScriptCache().putAll(parts, CFG.CACHE_DETIK);
  } catch (e) { /* tanpa cache */ }
}

function getDashboardData() {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('DASHB2_N') || 0);
  if (n) {
    const keys = []; for (let i = 0; i < n; i++) keys.push('DASHB2_' + i);
    const got = cache.getAll(keys);
    if (keys.every(k => got[k] !== undefined && got[k] !== null)) return keys.map(k => got[k]).join('');
  }
  const json = JSON.stringify(bangunData());
  simpanCache(json);
  return json;
}

/* ============================== BACA SUMBER ============================== */
function bangunData() {
  const folder = DriveApp.getFolderById(CFG.FOLDER_ID);
  const peringatan = [];
  konversiXlsx(folder, peringatan);
  let atur = null; const dataBulan = [];
  const it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) {
    const f = it.next(), n = teks(f.getName());
    if (/^PENGATURAN/i.test(n)) { atur = f; continue; }
    const t = n.match(/^DATA\s+(\d{1,2})\b/i);
    if (t && +t[1] >= 1 && +t[1] <= 12) dataBulan.push({ m: +t[1] - 1, f: f });
  }
  if (!atur) { peringatan.push('File "Pengaturan Dashboard" tidak ditemukan di folder data.'); return kosong(peringatan); }
  const ssA = SpreadsheetApp.open(atur);
  const peta = bacaPemetaan(nilaiSheet(ssA, 'Pemetaan') || []);
  const catatan = (nilaiSheet(ssA, 'Catatan') || []).map(r => teks(r[0])).filter(s => s);

  const EV = [], AM = [];   // EV: [bulan, tanggal, regional, lokasi, parameter, kategori, jumlah]; AM: [bulan, regional, lokasi, nama, parameter, kategori, jumlah]
  const belum = {};
  dataBulan.sort((a, b) => a.m - b.m).forEach(o => {
    const ss = SpreadsheetApp.open(o.f);
    (nilaiSheet(ss, 'Event') || []).slice(1).forEach(r => {
      const c = peta.kasus[teks(r[3]).toUpperCase()], n = angka(r[4]) || 0;
      if (!teks(r[3]) || !n) return;
      if (!c) { belum[teks(r[3]).toUpperCase()] = 1; return; }
      const tg = tanggalTeks(r[0]);
      if (!tg || tg.m !== o.m) return;
      const lok = teks(r[2]).toUpperCase();
      EV.push([o.m, tg.d, regionalDari(peta, r[1], lok), lok, c.p, c.k, n]);
    });
    (nilaiSheet(ss, 'AMT') || []).slice(1).forEach(r => {
      const c = peta.kasus[teks(r[3]).toUpperCase()], n = angka(r[4]) || 0, nama = teks(r[2]).toUpperCase();
      if (!c || !n || !nama) return;
      const lok = teks(r[1]).toUpperCase();
      AM.push([o.m, regionalDari(peta, r[0], lok), lok, nama, c.p, c.k, n]);
    });
  });
  if (Object.keys(belum).length) peringatan.push('Case belum ada di Pemetaan (tidak dihitung): ' + Object.keys(belum).slice(0, 15).join(', '));
  if (!dataBulan.length) peringatan.push('Belum ada file "Data <nomor bulan> ..." (Google Sheet) di folder data.');
  return hitung(EV, AM, peta, catatan, peringatan);
}

function kosong(peringatan) {
  const regional = {}; REGIONS.forEach(r => { regional[r] = { total: kosong12(), kat: {}, lokasi: null }; });
  return { tahun: CFG.TAHUN, regions: REGIONS, bulanAda: [], params: [], nilai: {}, lain: {}, regional: regional, lokasiBulan: {}, lokasiYTD: [], topAMT: null, harian: null, catatan: [], peringatan: peringatan, updated: new Date().toISOString() };
}

function nilaiSheet(ss, nama) {
  const sh = ss.getSheets().filter(s => teks(s.getName()).toUpperCase() === nama.toUpperCase())[0];
  return sh ? sh.getDataRange().getValues() : null;
}

/** .xlsx di folder -> Google Sheet (butuh layanan lanjutan Drive). Berkas asli dipindah ke subfolder "xlsx asli". */
function konversiXlsx(folder, peringatan) {
  const it = folder.getFilesByType(MimeType.MICROSOFT_EXCEL), xs = [];
  while (it.hasNext()) xs.push(it.next());
  if (!xs.length) return;
  if (typeof Drive === 'undefined') { peringatan.push(xs.length + ' file .xlsx belum dikonversi ke Google Sheet: ' + xs.map(f => f.getName()).join(', ') + '. Buka file lalu File > Simpan sebagai Google Spreadsheet, atau aktifkan layanan Drive API di Apps Script.'); return; }
  const arsip = folder.getFoldersByName('xlsx asli').hasNext() ? folder.getFoldersByName('xlsx asli').next() : folder.createFolder('xlsx asli');
  xs.forEach(f => {
    const nama = f.getName().replace(/\.xlsx$/i, '');
    try {
      if (Drive.Files.create) Drive.Files.create({ name: nama, mimeType: MimeType.GOOGLE_SHEETS, parents: [folder.getId()] }, f.getBlob());
      else Drive.Files.insert({ title: nama, mimeType: MimeType.GOOGLE_SHEETS, parents: [{ id: folder.getId() }] }, f.getBlob(), { convert: true });
      f.moveTo(arsip);
    } catch (e) { peringatan.push('Gagal mengonversi ' + f.getName() + ': ' + e.message); }
  });
}

function bacaPemetaan(v) {
  const kasus = {}, area = {}, lokasi = {}, urut = [];
  v.slice(1).forEach(r => {
    const c = teks(r[0]).toUpperCase(), p = teks(r[1]), k = teks(r[2]).toUpperCase();
    if (c && (p || k)) { kasus[c] = { p: p || '(tidak dihitung)', k: KATEGORI[k] || 'LAIN' }; if (p && !urut.some(x => x.p === p)) urut.push({ p: p, k: KATEGORI[k] || 'LAIN' }); }   // tanpa parameter = sengaja tidak dihitung
    const a = teks(r[4]).toUpperCase(), ar = namaRegional(r[5]); if (a && ar) area[a] = ar;
    const l = teks(r[7]).toUpperCase(), lr = namaRegional(r[8]); if (l && lr) lokasi[l] = lr;
  });
  return { kasus: kasus, area: area, lokasi: lokasi, urut: urut };
}
function regionalDari(peta, area, lok) { const a = teks(area).toUpperCase(); return peta.area[a] || peta.lokasi[lok] || namaRegional(a) || null; }
function tanggalTeks(x) {
  if (x instanceof Date) return { m: x.getMonth(), d: x.getDate() };
  const t = teks(x).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return t ? { m: +t[2] - 1, d: +t[3] } : null;
}

/* ============================== HITUNG ============================== */
function hitung(EV, AM, peta, catatan, peringatan) {
  const ada = {}; EV.forEach(e => { ada[e[0]] = 1; });
  const bulanAda = Object.keys(ada).map(Number).sort((a, b) => a - b);

  // parameter per bulan (3 kategori; parameter lain tidak ditampilkan)
  const params = [], nilai = {};
  peta.urut.filter(o => o.k !== 'LAIN').forEach(o => {
    const P = o.p.toUpperCase();
    params.push({ key: o.p, label: o.p, kat: PINDAH_KATEGORI[P] || o.k, katAsal: o.k, tipe: TIPE[P] || '-' });
    nilai[o.p] = BULAN.map((_, m) => ada[m] ? 0 : null);
  });
  // regional, lokasi, harian
  const regional = {}; REGIONS.forEach(r => { regional[r] = { total: BULAN.map((_, m) => ada[m] ? 0 : null), kat: {}, lokasi: 0 }; });
  const lok = {}, har = {};
  EV.forEach(e => {
    const m = e[0], r = e[2], k = e[5], n = e[6];
    if (k === 'LAIN') return;
    if (nilai[e[4]]) nilai[e[4]][m] += n;
    if (!r) return;
    const o = regional[r]; o.total[m] += n;
    const km = o.kat[m] || (o.kat[m] = { DB: 0, DD: 0, FM: 0 }); km[k] += n;
    if (e[3]) {
      const L = lok[r + '|' + e[3]] || (lok[r + '|' + e[3]] = { l: e[3], r: r, m: {} });
      const x = L.m[m] || (L.m[m] = { DB: 0, DD: 0, FM: 0, t: 0 }); x[k] += n; x.t += n;
    }
    const hk = m + '|' + e[1] + '|' + r;
    const h = har[hk] || (har[hk] = [m, e[1], r, 0, 0, 0]); h[{ DB: 3, DD: 4, FM: 5 }[k]] += n;
  });
  const L = Object.keys(lok).map(k => lok[k]);
  L.forEach(o => { if (Object.keys(o.m).some(m => o.m[m].t > 0)) regional[o.r].lokasi++; });
  const lokasiBulan = {};
  bulanAda.forEach((m, i) => {
    const pm = m > 0 && ada[m - 1] ? m - 1 : null;
    lokasiBulan[m] = L.map(o => {
      const x = o.m[m] || { DB: 0, DD: 0, FM: 0, t: 0 }, p = pm === null ? null : (o.m[pm] ? o.m[pm].t : 0);
      return { l: o.l, r: o.r, DB: x.DB, DD: x.DD, FM: x.FM, t: x.t, p: p, pm: pm, n: null, avg: null };
    }).filter(o => o.t || o.p).sort((a, b) => b.t - a.t);
  });
  const lokasiYTD = L.map(o => {
    const s = { DB: 0, DD: 0, FM: 0, t: 0 }; let n = 0;
    Object.keys(o.m).forEach(m => { const x = o.m[m]; s.DB += x.DB; s.DD += x.DD; s.FM += x.FM; s.t += x.t; if (x.t > 0) n++; });
    return { l: o.l, r: o.r, DB: s.DB, DD: s.DD, FM: s.FM, t: s.t, p: null, pm: null, n: n, avg: n ? s.t / n : null };
  }).filter(o => o.t).sort((a, b) => b.t - a.t);

  // TOP 10 AMT per regional per bulan (+ YTD)
  const amt = {};
  AM.forEach(a => {
    const [m, r, l, nama, p, k, n] = a;
    if (k === 'LAIN' || !r) return;
    [m, -2].forEach(b => {
      const key = b + '|' + r + '|' + nama;
      const o = amt[key] || (amt[key] = { b: b, amt: nama, r: r, DB: 0, DD: 0, FM: 0, t: 0, lok: {}, par: {} });
      o[k] += n; o.t += n; o.lok[l] = (o.lok[l] || 0) + n; o.par[p] = (o.par[p] || 0) + n;
    });
  });
  const grup = {};
  Object.keys(amt).forEach(key => { const o = amt[key], g = o.b + '|' + o.r; (grup[g] = grup[g] || []).push(o); });
  const terbesar = obj => Object.keys(obj).sort((a, b) => obj[b] - obj[a])[0] || '';
  const topAMT = [];
  Object.keys(grup).forEach(g => grup[g].sort((a, b) => b.t - a.t).slice(0, 10).forEach(o => {
    topAMT.push({ b: o.b, amt: o.amt, r: o.r, l: terbesar(o.lok), DB: o.DB, DD: o.DD, FM: o.FM, t: o.t, top: terbesar(o.par) });
  }));

  return {
    tahun: CFG.TAHUN, regions: REGIONS, bulanAda: bulanAda,
    params: params, nilai: nilai, lain: {},
    regional: regional, lokasiBulan: lokasiBulan, lokasiYTD: lokasiYTD,
    topAMT: AM.length ? topAMT : null,
    harian: Object.keys(har).map(k => har[k]),
    catatan: catatan, peringatan: peringatan,
    updated: new Date().toISOString(),
  };
}

/* ---- util ---- */
function teks(x) { return String(x == null ? '' : x).replace(/\s+/g, ' ').trim(); }
function angka(x) {
  if (typeof x === 'number') return isFinite(x) ? x : null;
  const s = teks(x).replace(/\./g, '').replace(',', '.');
  if (s === '' || /^(N\/?A|-|NA)$/i.test(s)) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}
/** "Agustus*", "AGU", "Total Agu", "Jul" -> indeks bulan 0..11, atau -1. */
function idxBulan(s) {
  s = teks(s).toUpperCase().replace(/\*|\(.*?\)/g, '').replace(/^TOTAL\s+/, '').replace(/\s*20\d\d$/, '').trim();
  let m = BULAN.indexOf(s);
  if (m < 0 && s.length >= 3) m = BULAN.findIndex(b => b.slice(0, 3) === s.slice(0, 3) && (s.length === 3 || b.indexOf(s) === 0));
  if (m < 0 && s === 'AUG') m = 7;
  return m;
}
function namaRegional(s) {
  const u = teks(s).toUpperCase();
  return REGIONS.filter(r => u.indexOf(r) === 0)[0] || null;
}
function petaKolom(baris) {
  const k = {};
  baris.forEach((h, j) => { const s = teks(h).toUpperCase(); if (s && k[s] === undefined) k[s] = j; });
  return k;
}
function kolomBulan(baris) {
  const k = {};
  baris.forEach((h, j) => { const s = teks(h).toUpperCase(); if (/TOTAL|KENAIKAN|RATA/.test(s)) return; const m = idxBulan(s); if (m >= 0 && k[m] === undefined) k[m] = j; });
  return k;
}
const kosong12 = () => BULAN.map(() => null);


