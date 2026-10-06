/**
 * DASHBOARD MONITORING DRIVING BEHAVIOUR, DRIVER DISCIPLINE & FATIGUE
 * Versi SUMMARY (Google Apps Script)
 *
 * Sumber data: satu spreadsheet ringkasan (CFG.SUMBER_ID), mis. "Summary_Dashboard_Format_Referensi".
 * Sheet yang dibaca (nama sheet dicocokkan tanpa memperhatikan huruf besar/kecil):
 *   - Parameter_Bulanan   : parameter per kategori x bulan (+ blok PARAMETER LAIN)
 *   - Rekap_Regional      : (1) regional x kategori untuk satu bulan vs bulan sebelumnya,
 *                           (2) total 3 kategori per regional per bulan
 *   - Rekap_Lokasi_<Bln>  : lokasi x kategori untuk bulan tsb (mis. Rekap_Lokasi_Agu), boleh lebih dari satu
 *   - Rekap_Lokasi_YTD    : lokasi x kategori untuk seluruh periode
 *   - Top_AMT  (opsional) : pelanggaran per AMT, untuk panel TOP 10 Pelanggaran AMT
 *   - Harian   (opsional) : event per tanggal per regional, untuk grafik per hari
 *   - Catatan  (opsional) : catatan data, ditampilkan di dashboard
 *
 * Format sheet Top_AMT (baris judul boleh di mana saja; kolom dicari dari namanya):
 *   Bulan | Nama AMT | Regional | Lokasi | Driving Behaviour | Driver Discipline | Fatigue Management | Total | Pelanggaran Terbanyak
 *   Bulan berisi nama bulan (Januari..Desember, boleh disingkat). Satu baris = satu AMT pada satu bulan.
 *   Baris dengan Bulan = YTD dipakai untuk peringkat seluruh periode (kalau tidak ada, dijumlah dari baris bulanan).
 * Format sheet Harian: Tanggal | Regional | Driving Behaviour | Driver Discipline | Fatigue Management | Total
 *
 *  - doGet()            : web app.
 *  - getDashboardData() : dipanggil dashboard; membaca spreadsheet sumber langsung (hasil di-cache 10 menit).
 *
 * Pemasangan: tempel Kode.gs + Index.html, isi CFG.SUMBER_ID, lalu Deploy > Web app.
 * Setelah isi spreadsheet sumber diubah, data baru tampil maksimal 10 menit kemudian
 * (atau jalankan menu Dashboard > Hapus cache dashboard).
 */

/* ============================== PENGATURAN ============================== */
const CFG = {
  SUMBER_ID: '1eyKwUV9co0L4-39bWqEdpdg8XB7QZ6CAGrMqlguS5Rw',   // spreadsheet Summary_Dashboard_2026_Jan-Agu
  TAHUN: 2026,
  CACHE_DETIK: 600,
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
  Logger.log('Top AMT: ' + (d.topAMT ? d.topAMT.length + ' baris' : 'sheet Top_AMT belum ada'));
  Logger.log('Harian: ' + (d.harian ? d.harian.length + ' baris' : 'sheet Harian belum ada'));
  if (d.peringatan.length) Logger.log('Peringatan: ' + d.peringatan.join(' | '));
}

/* ============================== WEB APP ============================== */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Monitoring Driving Behaviour, Driver Discipline & Fatigue')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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
  try {
    const parts = {}, size = 90000;
    for (let i = 0; i * size < json.length; i++) parts['DASHB2_' + i] = json.substr(i * size, size);
    parts.DASHB2_N = String(Object.keys(parts).length);
    cache.putAll(parts, CFG.CACHE_DETIK);
  } catch (e) { /* tanpa cache */ }
  return json;
}

/* ============================== BACA SUMBER ============================== */
function bangunData() {
  const ss = SpreadsheetApp.openById(CFG.SUMBER_ID);
  const peringatan = [];
  const ambil = (awalan, wajib) => {
    const a = awalan.toUpperCase();
    const sh = ss.getSheets().filter(s => s.getName().trim().toUpperCase().indexOf(a) === 0)[0];
    if (!sh) { if (wajib) peringatan.push('Sheet "' + awalan + '" tidak ditemukan di spreadsheet sumber.'); return null; }
    return sh.getDataRange().getValues();
  };

  const par = bacaParameter(ambil('Parameter_Bulanan', true) || []);
  const reg = bacaRegional(ambil('Rekap_Regional', true) || []);
  const lokasiBulan = {};
  ss.getSheets().forEach(s => {
    const n = s.getName().trim().toUpperCase();
    if (n.indexOf('REKAP_LOKASI_') !== 0 || /YTD/.test(n)) return;
    const m = idxBulan(n.replace('REKAP_LOKASI_', ''));
    if (m < 0) return;
    lokasiBulan[m] = bacaLokasi(s.getDataRange().getValues(), m);
  });
  const lokasiYTD = bacaLokasi(ambil('Rekap_Lokasi_YTD', true) || [], -1);
  const top = ambil('Top_AMT', false);
  const harian = ambil('Harian', false);
  const catatan = (ambil('Catatan', false) || []).map(r => String(r[0] || '').trim()).filter(s => s);

  const bulanAda = [];
  for (let m = 0; m < 12; m++) {
    const ada = Object.keys(par.nilai).some(k => par.nilai[k][m] !== null) || Object.keys(reg).some(r => reg[r].total[m] !== null);
    if (ada) bulanAda.push(m);
  }
  return {
    tahun: CFG.TAHUN, regions: REGIONS, bulanAda: bulanAda,
    params: par.params, nilai: par.nilai, lain: par.lain,
    regional: reg, lokasiBulan: lokasiBulan, lokasiYTD: lokasiYTD,
    topAMT: top ? bacaTopAMT(top) : null,
    harian: harian ? bacaHarian(harian) : null,
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

/* ---- Parameter_Bulanan ---- */
function bacaParameter(v) {
  const params = [], nilai = {}, lain = {};
  let kat = null, kol = {};
  v.forEach(r => {
    const a = teks(r[0]), A = a.toUpperCase();
    if (!a) return;
    if (A === 'PARAMETER') { kol = kolomBulan(r); return; }
    if (KATEGORI[A]) { kat = KATEGORI[A]; return; }
    if (A.indexOf('PARAMETER LAIN') === 0) { kat = 'LAIN'; return; }
    if (A.indexOf('TOTAL') === 0) return;
    if (!kat || !Object.keys(kol).length) return;
    const vals = kosong12();
    Object.keys(kol).forEach(m => { vals[m] = angka(r[kol[m]]); });
    if (kat === 'LAIN') { lain[a] = vals; return; }
    const k = PINDAH_KATEGORI[A] || kat;
    params.push({ key: a, label: a, kat: k, katAsal: kat, tipe: TIPE[A] || '-' });
    nilai[a] = vals;
  });
  return { params: params, nilai: nilai, lain: lain };
}

/* ---- Rekap_Regional ---- */
function bacaRegional(v) {
  const out = {};
  REGIONS.forEach(r => { out[r] = { total: kosong12(), kat: {}, lokasi: null }; });
  let judul = '';
  for (let i = 0; i < v.length; i++) {
    const a = teks(v[i][0]).toUpperCase();
    if (a && a !== 'REGIONAL' && !namaRegional(a)) { judul = a; continue; }
    if (a !== 'REGIONAL') continue;
    const k = petaKolom(v[i]);
    const totals = Object.keys(k).filter(h => /^TOTAL\s/.test(h) && idxBulan(h) >= 0).sort((x, y) => k[x] - k[y]);
    if (k['DRIVING BEHAVIOUR'] !== undefined) {
      // tabel regional x kategori untuk satu bulan
      let m = totals.length ? idxBulan(totals[0]) : -1;
      if (m < 0) { const t = judul.match(/[–-]\s*([A-Z]+)/); m = t ? idxBulan(t[1]) : -1; }
      const mp = totals.length > 1 ? idxBulan(totals[1]) : -1;
      for (let j = i + 1; j < v.length; j++) {
        const r = namaRegional(v[j][0]);
        if (!r) break;
        const o = out[r];
        if (m >= 0) o.kat[m] = { DB: angka(v[j][k['DRIVING BEHAVIOUR']]) || 0, DD: angka(v[j][k['DRIVER DISCIPLINE']]) || 0, FM: angka(v[j][k['FATIGUE MANAGEMENT']]) || 0 };
        if (m >= 0 && totals.length) o.total[m] = angka(v[j][k[totals[0]]]);
        if (mp >= 0 && o.total[mp] === null) o.total[mp] = angka(v[j][k[totals[1]]]);
        if (k['JUMLAH LOKASI'] !== undefined) o.lokasi = angka(v[j][k['JUMLAH LOKASI']]);
      }
    } else {
      // tabel total 3 kategori per regional per bulan
      const kb = kolomBulan(v[i]);
      for (let j = i + 1; j < v.length; j++) {
        const r = namaRegional(v[j][0]);
        if (!r) break;
        Object.keys(kb).forEach(m => { out[r].total[m] = angka(v[j][kb[m]]); });
      }
    }
  }
  return out;
}

/* ---- Rekap_Lokasi_<Bln> / Rekap_Lokasi_YTD ---- */
function bacaLokasi(v, m) {
  const rows = [];
  for (let i = 0; i < v.length; i++) {
    if (teks(v[i][0]).toUpperCase() !== 'LOKASI') continue;
    const k = petaKolom(v[i]);
    const prevH = Object.keys(k).filter(h => /^TOTAL\s/.test(h) && idxBulan(h) >= 0)[0];
    const kBulan = Object.keys(k).filter(h => /BULAN TERDATA/.test(h))[0];
    const kRata = Object.keys(k).filter(h => /RATA/.test(h))[0];
    for (let j = i + 1; j < v.length; j++) {
      const l = teks(v[j][0]);
      if (!l) break;
      const tt = angka(v[j][k['TOTAL']]) || 0, pp = prevH ? angka(v[j][k[prevH]]) : null;
      if (!tt && !pp) continue;   // lokasi tanpa event di bulan ini maupun bulan pembanding
      rows.push({
        l: l.toUpperCase(), r: namaRegional(v[j][k['REGIONAL']]),
        DB: angka(v[j][k['DRIVING BEHAVIOUR']]) || 0, DD: angka(v[j][k['DRIVER DISCIPLINE']]) || 0, FM: angka(v[j][k['FATIGUE MANAGEMENT']]) || 0,
        t: angka(v[j][k['TOTAL']]) || 0,
        p: prevH ? angka(v[j][k[prevH]]) : null, pm: prevH ? idxBulan(prevH) : null,
        n: kBulan ? angka(v[j][k[kBulan]]) : null, avg: kRata ? angka(v[j][k[kRata]]) : null,
      });
    }
    break;
  }
  return rows;
}

/* ---- Top_AMT ---- */
function bacaTopAMT(v) {
  const rows = [];
  for (let i = 0; i < v.length; i++) {
    const k = petaKolom(v[i]);
    const kAmt = Object.keys(k).filter(h => /AMT/.test(h))[0];
    if (!kAmt || k['TOTAL'] === undefined) continue;
    const kTop = Object.keys(k).filter(h => /TERBANYAK|DOMINAN/.test(h))[0];
    for (let j = i + 1; j < v.length; j++) {
      const amt = teks(v[j][k[kAmt]]);
      if (!amt) continue;
      const col = h => k[h] === undefined ? null : v[j][k[h]];
      const bl = col('BULAN');
      rows.push({
        b: bl === null ? -1 : /^\s*YTD/i.test(String(bl)) ? -2 : bl instanceof Date ? bl.getMonth() : /^\s*(1[0-2]|[1-9])\s*$/.test(String(bl)) ? Number(bl) - 1 : idxBulan(bl),
        amt: amt.toUpperCase(), r: namaRegional(col('REGIONAL')), l: teks(col('LOKASI')).toUpperCase(),
        DB: angka(col('DRIVING BEHAVIOUR')) || 0, DD: angka(col('DRIVER DISCIPLINE')) || 0, FM: angka(col('FATIGUE MANAGEMENT')) || 0,
        t: angka(col('TOTAL')) || 0, top: kTop ? teks(v[j][k[kTop]]) : '',
      });
    }
    break;
  }
  return rows;
}

/* ---- Harian (opsional) ---- */
// Tanggal | Regional | Driving Behaviour | Driver Discipline | Fatigue Management | Total
// Hasil: [[bulan(0-11), tanggal, kode regional, DB, DD, FM], ...]
function bacaHarian(v) {
  const rows = [];
  for (let i = 0; i < v.length; i++) {
    if (teks(v[i][0]).toUpperCase() !== 'TANGGAL') continue;
    const k = petaKolom(v[i]);
    for (let j = i + 1; j < v.length; j++) {
      let d = v[j][0];
      if (typeof d === 'number' && d > 30000) d = new Date(Math.round((d - 25569) * 86400000) + new Date().getTimezoneOffset() * 60000);   // nomor seri tanggal
      if (!(d instanceof Date)) { const t = teks(d).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (!t) continue; d = new Date(+t[1], +t[2] - 1, +t[3]); }
      const r = namaRegional(v[j][k['REGIONAL']]);
      if (!r) continue;
      rows.push([d.getMonth(), d.getDate(), r, angka(v[j][k['DRIVING BEHAVIOUR']]) || 0, angka(v[j][k['DRIVER DISCIPLINE']]) || 0, angka(v[j][k['FATIGUE MANAGEMENT']]) || 0]);
    }
    break;
  }
  return rows;
}
