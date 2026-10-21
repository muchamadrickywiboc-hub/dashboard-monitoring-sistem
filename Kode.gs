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
 *   - "Tarikan 10 Oktober 2026", ... : dibuat otomatis oleh prosesTarikan() dari file harian
 *     "Tarikan_<REGIONAL>_GPS_CCTV_<yyyy-mm-dd>.xlsx" di folder-folder yang terdaftar di spreadsheet CFG.TARIKAN_ID.
 *     Format sama dengan file Data (+ kolom Sumber). Mulai CFG.BULAN_TARIKAN hanya file Tarikan yang dipakai; bulan sebelumnya memakai file Data.
 *     prosesTarikan butuh layanan lanjutan "Drive API" (Apps Script > Layanan > Drive API) untuk membaca .xlsx.
 * Semua rekap (parameter, regional, lokasi, TOP 10 AMT, event per hari) dihitung di sini, tanpa rumus spreadsheet.
 *
 *  - doGet()            : web app (?laporan=harian = Laporan GPS & Dashcam Daily/Monthly, LaporanHarian.gs).
 *  - getDashboardData() : dipanggil dashboard; hasil di-cache 6 jam + salinan di file Drive (menu "Perbarui data dashboard sekarang" setelah data diubah).
 *  - pasangPemicu()     : jalankan sekali; membangun ulang cache tiap jam supaya dashboard langsung terbuka.
 */

/* ============================== PENGATURAN ============================== */
const CFG = {
  FOLDER_ID: '1nUJtRTcKwJua4Am9EdiFXoQxcTALgt9e',   // folder Drive "3. Data Dashboard"
  TARIKAN_ID: '11akfRibrQLixrBicdNXazEWX-TGmgfYu4zdYYNaOEy8',   // spreadsheet "Tarikan Sistem": kolom Area | linkgdrive (folder tarikan harian per regional)
  BULAN_TARIKAN: 10,       // mulai bulan ini (10 = Oktober) data HANYA dari tarikan (link Tarikan Sistem); bulan sebelumnya dari file "Data <nn> ..." (summary)
  TAHUN: 2026,
  CACHE_DETIK: 21600,   // 6 jam (batas maksimum CacheService)
};
const REGIONS = ['SUMBAGUT', 'SUMBAGSEL', 'JABALINUS', 'KALIMANTAN', 'SULAWESI', 'MALUPA'];
/** Area = satuan filter dashboard (kolom Area di data). */
const AREAS = ['SUMBAGUT', 'SUMBAGSEL', 'JABALINUS', 'KALIMANTAN', 'SULAWESI', 'MALUPA'];   // Sumbagut I & II digabung
const BULAN = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];
const KATEGORI = { 'DRIVING BEHAVIOUR': 'DB', 'DRIVER DISCIPLINE': 'DD', 'FATIGUE MANAGEMENT': 'FM' };
/** Parameter yang dipindah kategorinya di dashboard (nama parameter huruf besar -> kode kategori). */
const PINDAH_KATEGORI = { 'DRIVING > 4 HOURS': 'DB' };
/** Tipe alat per parameter (untuk keterangan). */
const TIPE = {
  'OVER SPEED': 'GPS', 'HARSH TURN / CORNERING': 'GPS', 'HARSH BRAKING': 'GPS', 'HARSH ACCELERATION': 'GPS',
  'BLACK ZONE': 'GPS', 'IDLING': 'GPS', 'DRIVING > 4 HOURS': 'GPS',
  'MENGGUNAKAN TELEPON': 'CCTV', 'MEROKOK / VAPE': 'CCTV', 'MICROSLEEP': 'CCTV', 'MENGUAP': 'CCTV',
  'DISTRACTION MENGEMUDI': 'CCTV', 'SEAT BELT': 'CCTV',
};
/** Nama event yang tampil di dashboard dan export (nama parameter huruf besar -> label). Kunci parameter tetap mengikuti sheet Pemetaan. */
const LABEL_EVENT = {
  'OVER SPEED': 'Overspeed', 'HARSH BRAKING': 'Harsh Brake', 'HARSH ACCELERATION': 'Harsh Acceleration', 'HARSH TURN / CORNERING': 'Harsh Cornering',
  'IDLING': 'Idle', 'DRIVING > 4 HOURS': 'Drive > 4 Hr', 'BLACK ZONE': 'Blackzone',
  'MICROSLEEP': 'Fatigue', 'MENGUAP': 'Menguap', 'MEROKOK / VAPE': 'Merokok', 'MENGGUNAKAN TELEPON': 'Menggunakan Telepon',
  'DISTRACTION MENGEMUDI': 'Distraction Mengemudi', 'SEAT BELT': 'Seat Belt Detection',
};

/* ============================== MENU ============================== */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Dashboard')
      .addItem('Perbarui data dashboard sekarang', 'hapusCache')
      .addItem('Uji baca sumber', 'UJI_BACA_SUMBER')
      .addItem('Uji kecepatan dashboard', 'UJI_KECEPATAN')
      .addItem('Pasang pemicu otomatis', 'pasangPemicu')
      .addItem('Proses file tarikan sekarang', 'prosesTarikan')
      .addItem('Proses ulang semua file tarikan', 'prosesUlangSemuaTarikan')
      .addItem('Baca ulang tarikan (area / bulan)…', 'menuBacaUlangArea')
      .addSeparator()
      .addItem('Buat / lengkapi akun (Pusat, Area, Lokasi)', 'buatSheetAkun')
      .addItem('Amankan password akun', 'amankanPasswordAkun')
      .addItem('Buat ulang semua password (format pendek)', 'buatUlangPasswordAkun')
      .addItem('Keluarkan semua sesi login', 'keluarkanSemuaSesi')
      .addSeparator()
      .addItem('Perbarui sheet Data Kosong', 'buatSheetDataKosong')
      .addToUi();
  } catch (e) { /* dijalankan dari luar spreadsheet */ }
}

/** Menu: membangun ulang data dashboard di sini (bukan menghapus cache), jadi pengunjung tidak ikut menunggu. */
function hapusCache() {
  CacheService.getScriptCache().removeAll(['LGLIST', 'DASHB4_N']);   // DASHB4 = cache JSON lama (tidak dipakai lagi)
  panaskanCache();
  try { SpreadsheetApp.getActiveSpreadsheet().toast('Data dashboard sudah diperbarui. Muat ulang dashboard.', 'Dashboard', 5); } catch (e) { Logger.log('Data dashboard diperbarui.'); }
}

/** DIAGNOSA: jalankan dari editor, lihat hasilnya di View > Logs. */
function UJI_BACA_SUMBER() {
  const d = bangunData_();
  Logger.log('Bulan berisi data: ' + d.bulanAda.map(m => BULAN[m]).join(', '));
  Logger.log('Parameter: ' + d.params.map(p => p.label + ' (' + p.kat + ')').join('; '));
  Logger.log('Lokasi: ' + d.lok.length + ' | baris fakta: ' + d.fakta.length + ' | baris harian: ' + d.harian.length);
  Logger.log('Top Driver: ' + (d.driver ? d.driver.all.length + ' / ' + d.driver.area.length + ' / ' + d.driver.lok.length + ' baris (semua / area / lokasi), ' + d.driver.nama.length + ' nama' : 'data AMT belum ada'));
  if (d.peringatan.length) Logger.log('Peringatan: ' + d.peringatan.join(' | '));
}

/* ============================== WEB APP ============================== */
function doGet(e) {
  if (e && e.parameter && /^harian$/i.test(e.parameter.laporan || '')) return halamanLaporanHarian_();   // Lampiran 3A, lihat LaporanHarian.gs
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Monitoring Driving Behaviour, Driver Discipline & Fatigue Management')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Dijalankan pemicu waktu: membangun ulang cache supaya pengunjung tidak menunggu spreadsheet dihitung. */
function panaskanCache() { simpanUtama_(JSON.stringify(bangunData_())); }
/* Data utama hanya disimpan dalam bentuk gzip+base64 (sekitar 10x lebih kecil dari JSON):
   - di CacheService (kunci DASHB4Z). JSON mentah bisa melewati batas cache sehingga gagal tersimpan diam-diam,
     lalu setiap pengunjung menghitung ulang semua spreadsheet (inilah yang membuat dashboard lama terbuka);
   - di file Drive (salinan), dipakai bila cache kosong.
   Akun Pusat menerima bentuk terkompresi apa adanya; akun Area/Lokasi dibuka dulu lalu dipotong. */
function simpanUtama_(json) { const z = zip_(json); const ok = simpanCache_(z, 'DASHB4Z'); simpanSnapshot_(z); if (!ok) Logger.log('Cache dashboard gagal disimpan (' + Math.round(z.length / 1024) + ' KB).'); return z; }
function zip_(s) { return Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(s, 'application/json')).getBytes()); }
function unzip_(z) { return Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(z), 'application/x-gzip')).getDataAsString(); }

const SNAP_NAMA = '_Cache Dashboard (otomatis, jangan dihapus).txt';
const SNAP_MAKS_JAM = 3;   // salinan lebih tua dari ini dianggap basi -> dibangun ulang
function fileSnapshot_() { const it = DriveApp.getFolderById(CFG.FOLDER_ID).getFilesByName(SNAP_NAMA); return it.hasNext() ? it.next() : null; }
function simpanSnapshot_(z) {
  try { const f = fileSnapshot_(); if (f) f.setContent(z); else DriveApp.getFolderById(CFG.FOLDER_ID).createFile(SNAP_NAMA, z, MimeType.PLAIN_TEXT); }
  catch (e) { Logger.log('Salinan data tidak tersimpan: ' + e.message); }
}
function bacaSnapshot_() {
  try { const f = fileSnapshot_(); if (!f || Date.now() - f.getLastUpdated().getTime() > SNAP_MAKS_JAM * 3600000) return null; return f.getBlob().getDataAsString(); }
  catch (e) { return null; }
}
/** Data utama (gzip+base64): cache -> salinan Drive -> hitung ulang (hanya satu pengunjung, yang lain menunggu). */
function dataUtamaZ_() {
  const ada = ambilCache_('DASHB4Z');
  if (ada) return ada;
  const kunci = LockService.getScriptLock(); kunci.tryLock(120000);
  try {
    const lagi = ambilCache_('DASHB4Z');
    if (lagi) return lagi;
    const snap = bacaSnapshot_();
    if (snap) { simpanCache_(snap, 'DASHB4Z'); return snap; }
    return simpanUtama_(JSON.stringify(bangunData_()));
  } finally { try { kunci.releaseLock(); } catch (e) { /* tidak memegang kunci */ } }
}
/** Data utama sebagai teks JSON. */
function dataUtama_() { return unzip_(dataUtamaZ_()); }

/** Jalankan sekali dari editor: memasang pemicu panaskanCache tiap jam. */
function pasangPemicu() {
  ScriptApp.getProjectTriggers().filter(t => ['panaskanCache', 'prosesTarikan', 'buatSheetDataKosong'].indexOf(t.getHandlerFunction()) >= 0).forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('buatSheetDataKosong').timeBased().everyDays(1).atHour(6).create();   // sheet Data Kosong diperbarui tiap pagi
  ScriptApp.newTrigger('panaskanCache').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('prosesTarikan').timeBased().everyMinutes(15).create();   // file harian baru terbaca maksimal 15 menit setelah diunggah
  panaskanCache();
  Logger.log('Pemicu panaskanCache (tiap jam) dan prosesTarikan (tiap 15 menit) terpasang dan cache sudah diisi. Jalankan prosesTarikan sekali untuk mulai membaca file tarikan.');
}

function simpanCache_(json, kunci, detik) {
  kunci = kunci || 'DASHB4';
  try {
    const parts = {}, size = 90000;
    for (let i = 0; i * size < json.length; i++) parts[kunci + '_' + i] = json.substr(i * size, size);
    parts[kunci + '_N'] = String(Object.keys(parts).length);
    CacheService.getScriptCache().putAll(parts, detik || CFG.CACHE_DETIK);
    return true;
  } catch (e) { Logger.log('Cache ' + kunci + ' gagal disimpan: ' + e.message); return false; }
}
function ambilCache_(kunci) {
  const cache = CacheService.getScriptCache(), n = Number(cache.get(kunci + '_N') || 0);
  if (!n) return null;
  const keys = []; for (let i = 0; i < n; i++) keys.push(kunci + '_' + i);
  const got = cache.getAll(keys);
  return keys.every(k => got[k] !== undefined && got[k] !== null) ? keys.map(k => got[k]).join('') : null;
}

/** Dipanggil dashboard setelah login: data sesuai cakupan akun (Pusat = semua, Area = satu area, Lokasi = satu lokasi). */
// Dikirim terkompresi: 'Z' + info akun (JSON, kosong untuk Area/Lokasi) + '\n' + gzip base64. Dibuka di browser (bukaData).
function getDashboardData(token) {
  const ses = sesi_(token);
  if (ses.peran === 'PUSAT') {
    return 'Z' + JSON.stringify({ nama: ses.nama, peran: ses.peran, area: ses.area || '', lok: ses.lok || '' }) + '\n' + dataUtamaZ_();
  }
  const kunci = 'SZ_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, ses.peran + '|' + (ses.area || '') + '|' + (ses.lok || ''))).slice(0, 16);
  let z = ambilCache_(kunci);
  if (!z) { z = zip_(potongJson_(dataUtama_(), ses, 'SC_')); simpanCache_(z, kunci, 900); }
  return 'Z\n' + z;
}
/** DIAGNOSA kecepatan: jalankan dari editor, lihat View > Logs. */
function UJI_KECEPATAN() {
  let t = Date.now(); const c = ambilCache_('DASHB4Z'); Logger.log('Baca cache: ' + (Date.now() - t) + ' ms, ' + (c ? Math.round(c.length / 1024) + ' KB' : 'KOSONG'));
  t = Date.now(); const s = bacaSnapshot_(); Logger.log('Baca salinan Drive: ' + (Date.now() - t) + ' ms, ' + (s ? Math.round(s.length / 1024) + ' KB' : 'tidak ada / basi'));
  t = Date.now(); const d = bangunData_(); const json = JSON.stringify(d); Logger.log('Hitung ulang semua data: ' + (Date.now() - t) + ' ms, JSON ' + Math.round(json.length / 1024) + ' KB');
  Logger.log('Ukuran per bagian (KB): ' + Object.keys(d).map(k => k + ' ' + Math.round(JSON.stringify(d[k]).length / 1024)).join(', '));
  t = Date.now(); const z = simpanUtama_(json); Logger.log('Kompres & simpan: ' + (Date.now() - t) + ' ms, ' + Math.round(z.length / 1024) + ' KB dikirim');
  t = Date.now(); const ok = ambilCache_('DASHB4Z'); Logger.log('Cek cache setelah disimpan: ' + (ok ? 'OK (' + (Date.now() - t) + ' ms)' : 'GAGAL'));
}

/* ============================== AKUN & LOGIN ============================== */
/**
 * Sheet "Akun" di file Pengaturan Dashboard (dibuat lewat menu Dashboard > Buat sheet Akun):
 *   Username | Password | Nama | Peran (PUSAT / AREA / LOKASI) | Area | Lokasi | Aktif (YA / TIDAK)
 * Password boleh diketik biasa, lalu jalankan menu "Amankan password akun" supaya disimpan sebagai sidik SHA-256.
 * Data dipotong di server sesuai cakupan akun, jadi akun Area / Lokasi tidak menerima data area / lokasi lain.
 */
const AKUN_HDR = ['Username', 'Password', 'Nama', 'Peran', 'Area', 'Lokasi', 'Aktif'];
// Sesi login tanpa batas waktu (dashboard juga dipakai di layar monitor besar).
// Token = data akun + tanda tangan HMAC dengan kunci rahasia di Script Properties, jadi tidak perlu disimpan di cache.
// Sesi berhenti bila akun dinonaktifkan atau password diganti di sheet Akun (dicek ulang paling lama tiap 10 menit),
// atau bila kunci dihapus lewat menu "Keluarkan semua sesi login".
const CEK_AKUN_DETIK = 600;
function kunciSesi_() {
  const pr = PropertiesService.getScriptProperties();
  let k = pr.getProperty('SESI_KUNCI');
  if (!k) { k = Utilities.getUuid() + Utilities.getUuid(); pr.setProperty('SESI_KUNCI', k); }
  return k;
}
const b64_ = b => Utilities.base64EncodeWebSafe(b).replace(/=+$/, '');
const tandaSesi_ = s => b64_(Utilities.computeHmacSha256Signature(s, kunciSesi_()));
const capPw_ = pw => sidikPw_('sesi', pw).slice(7, 23);   // berubah bila password di sheet diganti
/** Menu: semua perangkat harus login ulang (mis. bila password bocor). */
function keluarkanSemuaSesi() {
  PropertiesService.getScriptProperties().deleteProperty('SESI_KUNCI');
  try { SpreadsheetApp.getUi().alert('Semua sesi login dihentikan. Setiap perangkat perlu login ulang.'); } catch (e) { /* dijalankan dari editor */ }
}

function fileAtur_() {
  const it = DriveApp.getFolderById(CFG.FOLDER_ID).getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) { const f = it.next(); if (/^PENGATURAN/i.test(teks(f.getName()))) return f; }
  throw new Error('File "Pengaturan Dashboard" tidak ditemukan di folder data.');
}
function sheetAkun_() { return SpreadsheetApp.open(fileAtur_()).getSheetByName('Akun'); }
function sidikPw_(u, p) {
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'dashboard|' + u + '|' + p, Utilities.Charset.UTF_8);
  return 'sha256:' + b.map(x => ('0' + (x & 255).toString(16)).slice(-2)).join('');
}
function cakupanAkun_(r) {
  const u = teks(r[0]).toLowerCase(), nama = teks(r[2]) || u, peran = teks(r[3]).toUpperCase(), area = areaNorm(r[4]), lok = teks(r[5]).toUpperCase();
  if (peran === 'PUSAT') return { u: u, nama: nama, peran: peran };
  if (peran === 'AREA' && area) return { u: u, nama: nama, peran: peran, area: area };
  if (peran === 'LOKASI' && lok) return { u: u, nama: nama, peran: peran, area: area, lok: ALIAS_LOKASI[lok] || lok };
  return null;
}

/** Dipanggil halaman masuk. Mengembalikan token sesi + cakupan akun. */
function login(username, password) {
  const u = teks(username).toLowerCase(), p = String(password || ''), cache = CacheService.getScriptCache(), kg = 'GAGAL_' + u;
  if (!u || !p) throw new Error('Isi username dan password.');
  const gagal = +(cache.get(kg) || 0);
  if (gagal >= 5) throw new Error('Terlalu banyak percobaan salah. Coba lagi 15 menit lagi.');
  const sh = sheetAkun_(), v = sh ? sh.getDataRange().getValues() : [];
  const r = v.slice(1).filter(x => teks(x[0]).toLowerCase() === u)[0];
  const pw = r ? teks(r[1]) : '';
  const cocok = r && !/^(TIDAK|NO|FALSE|0|NONAKTIF)$/i.test(teks(r[6])) && pw && (pw.indexOf('sha256:') === 0 ? pw === sidikPw_(u, p) : pw === p);
  if (!cocok) { cache.put(kg, String(gagal + 1), 900); Utilities.sleep(600); throw new Error('Username atau password salah.'); }
  const ses = cakupanAkun_(r);
  if (!ses) throw new Error('Akun belum lengkap: isi Peran (PUSAT / AREA / LOKASI) beserta Area atau Lokasinya di sheet Akun.');
  const isi = b64_(Utilities.newBlob(JSON.stringify({ u: u, c: capPw_(pw), t: Date.now() })).getBytes()), token = isi + '.' + tandaSesi_(isi);
  cache.put('AK_' + u + '_' + capPw_(pw), JSON.stringify(ses), CEK_AKUN_DETIK);
  cache.remove(kg);
  return JSON.stringify(Object.assign({ token: token }, ses));
}
/**
 * Dipanggil halaman masuk (tanpa login): daftar akun aktif untuk pilihan Pusat / Area / Lokasi.
 * Hanya username, nama, area, lokasi yang dikirim; password tidak pernah keluar dari server.
 */
function daftarLogin() {
  const cache = CacheService.getScriptCache(), ada = cache.get('LGLIST');
  if (ada) return ada;
  const sh = sheetAkun_(), v = sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, AKUN_HDR.length).getValues() : [];
  const out = { pusat: [], area: [], lokasi: [] };
  v.forEach(r => {
    const u = teks(r[0]).toLowerCase();
    if (!u || u === 'contoh.lokasi' || !teks(r[1]) || /^(TIDAK|NO|FALSE|0|NONAKTIF)$/i.test(teks(r[6]))) return;
    const c = cakupanAkun_(r); if (!c) return;
    if (c.peran === 'PUSAT') out.pusat.push({ u: u, nama: c.nama });
    else if (c.peran === 'AREA') out.area.push({ u: u, nama: c.nama, area: c.area });
    else out.lokasi.push({ u: u, lok: c.lok, area: c.area || '' });
  });
  out.area.sort((a, b) => AREAS.indexOf(a.area) - AREAS.indexOf(b.area));
  out.lokasi.sort((a, b) => a.lok < b.lok ? -1 : a.lok > b.lok ? 1 : 0);
  const json = JSON.stringify(out);
  cache.put('LGLIST', json, 600);
  return json;
}
function logout(token) { /* token tidak disimpan di server; halaman menghapus token dari perangkat */ }
function sesi_(token) {
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(token || ''));
  if (!m || tandaSesi_(m[1]) !== m[2]) throw new Error('LOGIN');
  let o; try { o = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(m[1])).getDataAsString()); } catch (e) { throw new Error('LOGIN'); }
  const cache = CacheService.getScriptCache(), kunci = 'AK_' + o.u + '_' + o.c, ada = cache.get(kunci);
  if (ada) return JSON.parse(ada);
  // cek ulang akun: masih ada, aktif, dan password belum diganti
  const sh = sheetAkun_(), v = sh ? sh.getDataRange().getValues() : [];
  const r = v.slice(1).filter(x => teks(x[0]).toLowerCase() === o.u)[0];
  const ses = r && !/^(TIDAK|NO|FALSE|0|NONAKTIF)$/i.test(teks(r[6])) && teks(r[1]) && capPw_(teks(r[1])) === o.c ? cakupanAkun_(r) : null;
  if (!ses) throw new Error('LOGIN');
  cache.put(kunci, JSON.stringify(ses), CEK_AKUN_DETIK);
  return ses;
}

/** Memotong data (bentuk hitung_) sesuai cakupan akun; nama lokasi & Driver di luar cakupan dihapus. */
function potongCakupan_(d, ses) {
  d.akun = { nama: ses.nama, peran: ses.peran, area: ses.area || '', lok: ses.lok || '' };
  if (ses.peran === 'PUSAT') return d;
  const ai = AREAS.indexOf(ses.area || ''), kl = ses.lok ? kunciLok(ses.lok) : '';
  const L = d.lok.map(x => ses.peran === 'AREA' ? x[1] === ai : kunciLok(x[0]) === kl && (ai < 0 || x[1] === ai));
  d.lok = d.lok.map((x, i) => L[i] ? x : ['', x[1]]);
  d.fakta = d.fakta.filter(f => L[f[2]]);
  d.harian = d.harian.filter(h => L[h[3]]);
  if (d.driver) {
    const nama = [], idx = {}, X = d.driver;
    const ulang = rows => rows.map(r => { const n = X.nama[r[4]]; if (idx[n] === undefined) { idx[n] = nama.length; nama.push(n); } return [r[0], r[1], r[2], r[3], idx[n], r[5]]; });
    const lok = X.lok.filter(r => L[r[2]]), atas = ses.peran === 'AREA' ? X.area.filter(r => r[1] === ai) : lok;
    d.driver = { all: ulang(atas), area: ulang(atas), lok: ulang(lok), nama: nama };
  }
  if (ses.peran === 'LOKASI' && !L.some(x => x)) d.peringatan = (d.peringatan || []).concat('Lokasi akun ini (' + ses.lok + ') tidak ditemukan di data. Periksa ejaan Lokasi di sheet Akun.');
  return d;
}
function potongJson_(json, ses, awalan) {
  // Pusat: data utuh + info akun, tanpa parse/stringify ulang data yang besar
  if (ses.peran === 'PUSAT') return json.replace(/\}\s*$/, ',"akun":' + JSON.stringify({ nama: ses.nama, peran: ses.peran, area: ses.area || '', lok: ses.lok || '' }) + '}');
  const kunci = awalan + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, ses.peran + '|' + (ses.area || '') + '|' + (ses.lok || ''))).slice(0, 16);
  const ada = ambilCache_(kunci);
  if (ada) return ada;
  const out = JSON.stringify(potongCakupan_(JSON.parse(json), ses));
  simpanCache_(out, kunci, 900);
  return out;
}

/**
 * Menu: membuat / melengkapi sheet Akun. Akun yang belum ada ditambahkan dengan password pendek (username + 2 angka):
 * 1 akun Pusat, 1 akun per Area, dan 1 akun per Lokasi yang ada di data dashboard. Baris yang sudah ada tidak diubah,
 * jadi menu ini aman dijalankan lagi saat ada lokasi baru.
 */
function buatSheetAkun() {
  const ss = SpreadsheetApp.open(fileAtur_());
  let sh = ss.getSheetByName('Akun');
  if (!sh) { sh = ss.insertSheet('Akun'); sh.getRange(1, 1, 1, AKUN_HDR.length).setValues([AKUN_HDR]).setFontWeight('bold'); sh.setFrozenRows(1); }
  const lama = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, AKUN_HDR.length).getValues() : [];
  const adaU = {}, adaK = {};
  lama.forEach(r => { adaU[teks(r[0]).toLowerCase()] = 1; const c = teks(r[0]).toLowerCase() === 'contoh.lokasi' ? null : cakupanAkun_(r); if (c) adaK[c.peran + '|' + (c.peran === 'LOKASI' ? kunciLok(c.lok) : c.area || '')] = 1; });
  const slug = x => teks(x).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
  const unik = u => { let v = u, i = 2; while (adaU[v]) v = u + i++; adaU[v] = 1; return v; };
  const judul = x => teks(x).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
  const baru = [];
  const tambah = (k, u, nama, peran, area, lok) => { if (adaK[k]) return; adaK[k] = 1; const v = unik(u); baru.push([v, pwPendek_(v), nama, peran, area, lok, 'YA']); };
  tambah('PUSAT|', 'pusat', 'RTC', 'PUSAT', '', '');
  AREAS.forEach(a => tambah('AREA|' + a, slug(a), 'Command Center ' + judul(a), 'AREA', a, ''));
  const d = JSON.parse(dataUtama_()), lokSudah = {};
  d.lok.map(x => ({ nama: x[0], area: AREAS[x[1]] || '' })).filter(o => o.nama && !/^\(TANPA/.test(o.nama))
    .sort((a, b) => AREAS.indexOf(a.area) - AREAS.indexOf(b.area) || (a.nama < b.nama ? -1 : 1))
    .forEach(o => { const k = kunciLok(o.nama); if (lokSudah[k]) return; lokSudah[k] = 1; tambah('LOKASI|' + k, slug(o.nama), 'Control Room ' + o.nama, 'LOKASI', o.area, o.nama); });
  if (baru.length) sh.getRange(sh.getLastRow() + 1, 1, baru.length, AKUN_HDR.length).setValues(baru);
  CacheService.getScriptCache().remove('LGLIST');
  sh.autoResizeColumns(1, AKUN_HDR.length);
  const pesan = baru.length ? baru.length + ' akun baru ditambahkan dengan password acak. Catat/bagikan password-nya, lalu jalankan menu "Amankan password akun".' : 'Semua akun sudah ada, tidak ada yang ditambahkan.';
  try { SpreadsheetApp.getUi().alert(pesan); } catch (e) { Logger.log(pesan); }
}
/** Password pendek yang mudah diingat: username tanpa titik + 2 angka acak, mis. ft.jambi -> ftjambi48. */
function pwPendek_(u) {
  return teks(u).toLowerCase().replace(/[^a-z0-9]/g, '') + String(10 + Math.floor(Math.random() * 90));
}
/** Menu: mengganti password SEMUA akun dengan format pendek (teks biasa) supaya bisa dicatat & dibagikan, lalu amankan lagi. */
function buatUlangPasswordAkun() {
  const sh = sheetAkun_(); if (!sh || sh.getLastRow() < 2) return;
  try {
    const ui = SpreadsheetApp.getUi();
    if (ui.alert('Password semua akun akan diganti dengan format pendek (username + 2 angka). Password lama tidak berlaku lagi. Lanjutkan?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  } catch (e) {}
  const rg = sh.getRange(2, 1, sh.getLastRow() - 1, 2), v = rg.getValues();
  let n = 0;
  v.forEach(r => { const u = teks(r[0]).toLowerCase(); if (u && u !== 'contoh.lokasi') { r[1] = pwPendek_(u); n++; } });
  rg.setValues(v);
  const pesan = n + ' password diganti. Catat/bagikan password-nya, lalu jalankan menu "Amankan password akun".';
  try { SpreadsheetApp.getUi().alert(pesan); } catch (e) { Logger.log(pesan); }
}
/** Menu: mengubah password yang masih teks biasa menjadi sidik SHA-256 (tidak bisa dibaca lagi). */
function amankanPasswordAkun() {
  const sh = sheetAkun_(); if (!sh || sh.getLastRow() < 2) return;
  const rg = sh.getRange(2, 1, sh.getLastRow() - 1, 2), v = rg.getValues();
  let n = 0;
  v.forEach(r => { const u = teks(r[0]).toLowerCase(), p = teks(r[1]); if (u && p && p.indexOf('sha256:') !== 0) { r[1] = sidikPw_(u, p); n++; } });
  rg.setValues(v);
  try { SpreadsheetApp.getActiveSpreadsheet().toast(n + ' password diamankan.', 'Dashboard', 5); } catch (e) { Logger.log(n + ' password diamankan.'); }
}

/* ============================== FILTER WAKTU ============================== */
const SHIFT = [null, [7, 15], [15, 23], [23, 7]];   // Shift 1 07.00-15.00, Shift 2 15.00-23.00, Shift 3 23.00-07.00 (ikut tanggal mulainya)
const diShift = (j, s) => SHIFT[s][0] < SHIFT[s][1] ? j >= SHIFT[s][0] && j < SHIFT[s][1] : j >= SHIFT[s][0] || j < SHIFT[s][1];

/**
 * Data satu jendela waktu di bulan m (0-11) untuk filter Tanggal / Shift / Jam, dibaca dari sheet "Event Jam" & "AMT Jam" file Tarikan.
 *   d = tanggal (0 = semua tanggal), s = shift (0 = semua, 1-3), h = jam (-1 = semua).
 * Bentuknya sama dengan hitung_(): "bulan" 0 = jendela terpilih, 1 = pembanding (tanggal sebelumnya, shift/jam yang sama);
 * kolom "tanggal" di harian berisi jam + 1, jadi harian = event per jam.
 */
function getDataWaktu(token, m, d, s, h) {
  const ses = sesi_(token);
  return potongJson_(dataWaktu_(m, d, s, h), ses, 'SW_' + [m, d, s, h].join('_') + '_');
}
function dataWaktu_(m, d, s, h) {
  m = +m; d = +d || 0; s = +s || 0; h = (h === undefined || h === null || h === '') ? -1 : +h;
  const kunci = 'WKT1_' + [m, d, s, h].join('_');
  const ada = ambilCache_(kunci);
  if (ada) return ada;
  const folder = DriveApp.getFolderById(CFG.FOLDER_ID);
  let atur = null, file = null;
  const it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) {
    const f = it.next(), n = teks(f.getName()), t = n.match(/^TARIKAN\s+(\d{1,2})\b/i);
    if (/^PENGATURAN/i.test(n)) atur = f; else if (t && +t[1] === m + 1) file = f;
  }
  const kosongW = (pesan) => JSON.stringify(Object.assign(kosong([pesan]), { waktu: { m: m, d: d, s: s, h: h, adaPrev: false } }));
  const fJam = file ? null : fileJam_(folder, m);
  if (!atur || (!file && !fJam)) return kosongW('Data jam ' + BULAN[m] + ' belum ada.');
  const peta = bacaPemetaan(nilaiSheet(SpreadsheetApp.open(atur), 'Pemetaan') || []);
  const okJam = j => (h < 0 || j === h) && (!s || diShift(j, s));
  // shift yang melewati tengah malam (Shift 3) ikut tanggal mulainya: jam 00.00-07.00 dihitung ke tanggal sebelumnya
  const jendela = (tg, j) => { if (!tg || tg.m !== m || !okJam(j)) return -1; const t = s && SHIFT[s][0] > SHIFT[s][1] && j < SHIFT[s][1] ? tg.d - 1 : tg.d;
    if (!d) return t >= 1 ? 0 : -1; if (t === d) return 0; return t === d - 1 ? 1 : -1; };
  const EV = [], AM = [];
  if (fJam) {
    const hasilJ = hitungJam_(bacaJam_(fJam), m, d, s, h, jendela, peta);
    hasilJ.waktu = { m: m, d: d, s: s, h: h, adaPrev: d > 1 };
    const jsonJ = JSON.stringify(hasilJ);
    simpanCache_(jsonJ, kunci, 3600);   // file jam Januari-September tidak berubah
    return jsonJ;
  }
  const ss = SpreadsheetApp.open(file);
  (nilaiSheet(ss, 'Event Jam') || []).slice(1).forEach(r => {
    const j = +r[1], w = jendela(tanggalTeks(r[0]), j), c = peta.kasus[normKasus(r[4])], n = angka(r[5]) || 0;
    if (w < 0 || !c || !n) return;
    EV.push([w, j + 1, areaNorm(r[2]), teks(r[3]).toUpperCase(), c.p, c.k, n]);
  });
  (nilaiSheet(ss, 'AMT Jam') || []).slice(1).forEach(r => {
    const j = +r[1], w = jendela(tanggalTeks(r[0]), j), c = peta.kasus[normKasus(r[5])], n = angka(r[6]) || 0, nama = teks(r[4]).toUpperCase();
    if (w < 0 || !c || !n || !nama) return;
    AM.push([w, areaNorm(r[2]), teks(r[3]).toUpperCase(), nama, c.p, c.k, n]);
  });
  const hasil = hitung_(EV, AM, peta, [], []);
  hasil.waktu = { m: m, d: d, s: s, h: h, adaPrev: d > 1 };
  const json = JSON.stringify(hasil);
  simpanCache_(json, kunci, 900);   // 15 menit, mengikuti pemicu prosesTarikan
  return json;
}

/**
 * File jam Januari-September: "Jam <nn> <Bulan> 2026.json.gz" di folder data (dibuat dari file mentah, lihat tools/agregasi_jam.py).
 * Isi: daftar area / lok / kasus / nama, lalu baris per tanggal (d) dan gabungan sebulan (b):
 *   e = "jam,area,lok,kasus,jumlah;..."  a = "jam,area,lok,nama,kasus,jumlah;..."
 *   jam 99 = event tanpa jam (data GPS tanpa waktu); di b jam 24-30 = jam 00-06 tanggal 1 (Shift 3 milik bulan sebelumnya).
 */
function fileJam_(folder, m) {
  const it = folder.getFiles();
  while (it.hasNext()) { const f = it.next(), t = teks(f.getName()).match(/^JAM\s+(\d{1,2})\b/i); if (t && +t[1] === m + 1) return f; }
  return null;
}
function bacaJam_(f) {
  const b = f.getBlob().setContentType('application/x-gzip');
  return JSON.parse(Utilities.ungzip(b).getDataAsString('UTF-8'));
}
function hitungJam_(J, m, d, s, h, jendela, peta) {
  const EV = [], AM = [], tanpa = !s && h < 0;   // hanya filter tanggal: event tanpa jam tetap dihitung
  const kasus = J.kasus.map(k => peta.kasus[normKasus(k)] || null), area = J.area.map(areaNorm);
  // w: 0 = jendela terpilih, 1 = pembanding, 2 = event tanpa jam di tanggal terpilih (tidak bisa disaring per jam)
  const baris = (str, tg, fn) => { if (!str) return; str.split(';').forEach(x => { const v = x.split(','); fn(v, tg); }); };
  const pakai = (j, tg) => {
    if (j === 99) { if (!tg || tg.m !== m) return -1; const w = !d ? 0 : tg.d === d ? 0 : tg.d === d - 1 ? 1 : -1; return w < 0 ? -1 : tanpa ? w : (w === 0 ? 2 : -1); }
    return jendela(tg, j);
  };
  const ambil = (blok, tgOf) => {
    baris(blok.e, null, v => { const c = kasus[+v[3]], n = +v[4]; if (!c || !n) return; const jr = +v[0], tg = tgOf(jr), j = jr >= 24 && jr < 99 ? jr - 24 : jr, w = pakai(j, tg);
      if (w >= 0) EV.push([w, j === 99 ? 0 : j + 1, area[+v[1]], J.lok[+v[2]], c.p, c.k, n]); });
    baris(blok.a, null, v => { const c = kasus[+v[4]], n = +v[5]; if (!c || !n) return; const jr = +v[0], tg = tgOf(jr), j = jr >= 24 && jr < 99 ? jr - 24 : jr, w = pakai(j, tg);
      if (w >= 0) AM.push([w, area[+v[1]], J.lok[+v[2]], J.nama[+v[3]], c.p, c.k, n]); });
  };
  if (d) [d - 1, d, d + 1].forEach(t => { const blok = J.d[t]; if (blok) ambil(blok, () => ({ m: m, d: t })); });
  else ambil(J.b, jr => ({ m: m, d: jr >= 24 && jr < 99 ? 1 : 2 }));
  return hitung_(EV, AM, peta, [], []);
}

/* ============================== SHEET DATA KOSONG ============================== */
/** Menyamakan sheet Pemetaan dan Catatan dengan KASUS_WAJIB (Distraction Mengemudi dan Seat Belt kini dihitung). */
function sinkronPemetaan_(ss) {
  const sh = ss.getSheetByName('Pemetaan');
  if (sh && sh.getLastRow() > 1) {
    const v = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues(), ada = {};
    v.forEach((r, i) => { const c = normKasus(r[0]), w = KASUS_WAJIB[c]; if (!c) return; ada[c] = 1;
      if (w && (teks(r[1]) !== w[0] || teks(r[2]) !== w[1])) sh.getRange(i + 2, 2, 1, 2).setValues([w]); });
    const baru = Object.keys(KASUS_WAJIB).filter(c => !ada[c]);
    let akhir = v.length; while (akhir > 0 && !teks(v[akhir - 1][0])) akhir--;   // baris terakhir kolom Case (kolom Area/Lokasi bisa lebih panjang)
    if (baru.length) sh.getRange(akhir + 2, 1, baru.length, 3).setValues(baru.map(c => [c].concat(KASUS_WAJIB[c])));
  }
  const sc = ss.getSheetByName('Catatan');
  if (sc && sc.getLastRow()) {
    const v = sc.getRange(1, 1, sc.getLastRow(), 1).getValues();
    v.forEach((r, i) => {
      const x = teks(r[0]);
      if (/^Driver Discipline:/.test(x) && !/Distraction/.test(x)) sc.getRange(i + 1, 1).setValue('Driver Discipline: Blackzone=BLACKZONE, Idle=IDLE, Menggunakan Telepon=PHONE DETECTION, Merokok=SMOKING DETECTION, Distraction Mengemudi=DRIVER DISTRACTION, Seat Belt Detection=SEAT BELT DETECTION / DRIVER IS NOT USING SEAT-BELT.');
      else if (/^Fatigue Management:/.test(x) && /Microsleep/.test(x)) sc.getRange(i + 1, 1).setValue('Fatigue Management: Fatigue=DRIVER FATIGUE, Menguap=YAWNING DETECTION / DRIVER HAS BEEN YAWNING.');
      else if (/^Parameter lain:/.test(x)) sc.getRange(i + 1, 1).setValue('Tidak dihitung: CAMERA COVERING ALARM, ILLEGAL SHUTDOWN, REST AREA, VIDEO LOSS / HIGH SPEED / ABNORMAL STORAGE ALARM.');
    });
  }
}

/**
 * Menulis sheet "Data Kosong" di file Pengaturan Dashboard: per bulan x regional, tanggal yang tidak ada datanya,
 * hari dengan event sangat sedikit, dan berapa persen event yang tidak punya jam kejadian (tidak ikut filter shift/jam).
 * Dihitung dari data yang dibaca dashboard, jadi selalu sama dengan yang tampil. Diperbarui tiap pagi oleh pemicu
 * (pasangPemicu) atau lewat menu Dashboard > Perbarui sheet Data Kosong.
 */
function buatSheetDataKosong() {
  const folder = DriveApp.getFolderById(CFG.FOLDER_ID), ss = SpreadsheetApp.open(fileAtur_());
  try { sinkronPemetaan_(ss); } catch (e) { Logger.log('Sinkron pemetaan: ' + e.message); }
  const d = JSON.parse(dataUtama_()), peta = bacaPemetaan(nilaiSheet(ss, 'Pemetaan') || []);
  const NB = s0 => s0.charAt(0) + s0.slice(1).toLowerCase(), A = d.areas, tahun = d.tahun;
  const catatanSumber = (nilaiSheet(ss, 'Catatan') || []).map(r => teks(r[0])).filter(x => /terpotong|batas excel/i.test(x));
  // event per bulan x area x tanggal
  const H = {}, akhirBulan = {};
  d.harian.forEach(h => { const k = h[0] + '|' + h[2], t = (h[4] || 0) + (h[5] || 0) + (h[6] || 0); if (!t) return;
    (H[k] = H[k] || {})[h[1]] = (H[k][h[1]] || 0) + t; akhirBulan[h[0]] = Math.max(akhirBulan[h[0]] || 0, h[1]); });
  // jam kejadian dari file Jam (Januari-September); bulan tarikan memakai kolom Time
  const JAM = {};
  d.bulanAda.forEach(m => {
    if (m + 1 >= CFG.BULAN_TARIKAN) return;
    const f = fileJam_(folder, m); if (!f) return;
    const J = bacaJam_(f), kat = J.kasus.map(k => (peta.kasus[normKasus(k)] || {}).k), area = J.area.map(areaNorm);
    Object.keys(J.d).forEach(t => (J.d[t].e || '').split(';').forEach(x => { if (!x) return; const v = x.split(','), k = kat[+v[3]], n = +v[4];
      if (['DB', 'DD', 'FM'].indexOf(k) < 0 || !n) return;
      const o = JAM[m + '|' + A.indexOf(area[+v[1]])] = JAM[m + '|' + A.indexOf(area[+v[1]])] || { DB: [0, 0], DD: [0, 0], FM: [0, 0] };
      o[k][0] += n; if (+v[0] === 99) o[k][1] += n; }));
  });
  const rentang = arr => { const out = []; let i = 0; while (i < arr.length) { let j = i; while (j + 1 < arr.length && arr[j + 1] === arr[j] + 1) j++; out.push(j - i >= 2 ? arr[i] + '–' + arr[j] : arr.slice(i, j + 1).join(', ')); i = j + 1; } return out.join(', '); };
  const pct = o => !o || !o[0] ? '' : Math.round(o[1] / o[0] * 100) + '%';
  const rows = [], ringkas = [];
  d.bulanAda.forEach(m => {
    const nHari = new Date(tahun, m + 1, 0).getDate(), selesai = m < d.bulanAda[d.bulanAda.length - 1], batas = selesai ? nHari : (akhirBulan[m] || nHari);
    A.forEach((a, ai) => {
      const x = H[m + '|' + ai] || {}, hari = Object.keys(x).map(Number);
      const kosong = []; for (let t = 1; t <= batas; t++) if (!x[t]) kosong.push(t);
      const v = hari.map(t => x[t]).sort((p, q) => p - q), med = v.length ? v[Math.floor(v.length / 2)] : 0;
      const rendah = hari.filter(t => med && x[t] < 0.35 * med).sort((p, q) => p - q);
      const j = JAM[m + '|' + ai], tarikan = m + 1 >= CFG.BULAN_TARIKAN;
      const ket = [];
      if (!hari.length) ket.push('Tidak ada data sama sekali untuk regional ini di bulan ' + NB(BULAN[m]) + '.');
      else {
        if (kosong.length) ket.push('Tidak ada data tanggal ' + rentang(kosong) + '.');
        if (!selesai && batas < nHari) ket.push('Bulan berjalan: data baru sampai tanggal ' + batas + '.');
        catatanSumber.filter(c => c.toUpperCase().indexOf(BULAN[m]) >= 0 && c.toUpperCase().indexOf(a) >= 0).forEach(c => ket.push(c.replace(/^\d+\.\s*/, '').replace(/^[^:]+:\s*/, 'File sumber: ')));
        if (j) { const g = ['DB', 'DD', 'FM'].filter(k => j[k][0] && j[k][1] / j[k][0] > 0.5).map(k => ({ DB: 'Driving Behaviour', DD: 'Driver Discipline', FM: 'Fatigue Management' })[k]);
          if (g.length) ket.push('Sebagian besar event ' + g.join(', ').replace(/, ([^,]*)$/, ' dan $1') + ' tidak punya jam kejadian di file mentah, jadi tidak ikut filter shift/jam.'); }
      }
      rows.push([NB(BULAN[m]), NB(a), hari.length ? batas + ' ' + NB(BULAN[m]).slice(0, 3) : '–', rentang(kosong), rentang(rendah),
        tarikan ? 'lengkap' : pct(j && j.DB), tarikan ? 'lengkap' : pct(j && j.DD), tarikan ? 'lengkap' : pct(j && j.FM), ket.join(' ')]);
      if (!hari.length || kosong.length || catatanSumber.some(c => c.toUpperCase().indexOf(BULAN[m]) >= 0 && c.toUpperCase().indexOf(a) >= 0))
        ringkas.push(NB(BULAN[m]) + ' · ' + NB(a) + ': ' + ket.filter(k => !/jam kejadian/.test(k)).join(' '));
    });
  });
  let sh = ss.getSheetByName('Data Kosong');
  if (!sh) sh = ss.insertSheet('Data Kosong'); else sh.clear();
  const HDR = ['Bulan', 'Regional', 'Data s/d', 'Tanggal tanpa data', 'Hari dengan event sangat sedikit', 'Tanpa jam: Driving Behaviour', 'Tanpa jam: Driver Discipline', 'Tanpa jam: Fatigue Management', 'Penjelasan'];
  const atas = [
    ['Data Kosong dan Keterbatasan Data'],
    ['Diperbarui otomatis ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd MMM yyyy HH.mm') + ' dari data yang dibaca dashboard. Jangan diisi manual; tambahkan catatan lain di sheet Catatan.'],
    ['Tanggal tanpa data = tidak ada event sama sekali dari regional itu. Event sangat sedikit = di bawah 35% dari hari biasa regional itu (hari Minggu/libur bisa wajar). Tanpa jam = persentase event yang tidak punya jam kejadian di file mentah: tetap dihitung saat memilih tanggal, tetapi tidak ikut filter shift/jam.'],
    [''],
    ['RINGKASAN: bagian yang tidak ada datanya']
  ].concat(ringkas.length ? ringkas.map(r => [r]) : [['Tidak ada tanggal kosong.']]).concat([[''], ['RINCIAN PER BULAN DAN REGIONAL']]);
  sh.getRange(1, 1, atas.length, 1).setValues(atas);
  const r0 = atas.length + 1;
  sh.getRange(r0, 1, 1, HDR.length).setValues([HDR]).setFontWeight('bold').setBackground('#4a7a53').setFontColor('#ffffff').setWrap(true);
  if (rows.length) sh.getRange(r0 + 1, 1, rows.length, HDR.length).setValues(rows).setWrap(true).setVerticalAlignment('top');
  sh.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  sh.getRange(5, 1).setFontWeight('bold'); sh.getRange(r0 - 1, 1).setFontWeight('bold');
  [90, 100, 80, 160, 160, 110, 110, 110, 420].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.setFrozenRows(0);
  try { SpreadsheetApp.getActiveSpreadsheet().toast('Sheet Data Kosong diperbarui.', 'Dashboard', 5); } catch (e) { /* dari pemicu */ }
}

/* ============================== BACA SUMBER ============================== */
function bangunData_() {
  const folder = DriveApp.getFolderById(CFG.FOLDER_ID);
  const peringatan = [];
  konversiXlsx(folder, peringatan);
  let atur = null; const lama = {}, tarikan = {};
  const it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) {
    const f = it.next(), n = teks(f.getName());
    if (/^PENGATURAN/i.test(n)) { atur = f; continue; }
    const t = n.match(/^(DATA|TARIKAN)\s+(\d{1,2})\b/i);
    if (t && +t[2] >= 1 && +t[2] <= 12) (t[1].toUpperCase() === 'TARIKAN' ? tarikan : lama)[+t[2] - 1] = f;
  }
  // sebelum BULAN_TARIKAN: file Data (summary); mulai BULAN_TARIKAN: hanya file Tarikan dari link Tarikan Sistem
  const dataBulan = [];
  for (let m = 0; m < 12; m++) {
    const f = m + 1 >= CFG.BULAN_TARIKAN ? tarikan[m] : lama[m];
    if (f) dataBulan.push({ m: m, f: f });
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
      const kc = normKasus(r[3]), c = peta.kasus[kc], n = angka(r[4]) || 0;
      if (!kc || !n) return;
      if (!c) { belum[kc] = 1; return; }
      const tg = tanggalTeks(r[0]);
      if (!tg || tg.m !== o.m) return;
      const lok = teks(r[2]).toUpperCase();
      EV.push([o.m, tg.d, areaNorm(r[1]), lok, c.p, c.k, n]);
    });
    (nilaiSheet(ss, 'AMT') || []).slice(1).forEach(r => {
      const c = peta.kasus[normKasus(r[3])], n = angka(r[4]) || 0, nama = teks(r[2]).toUpperCase();
      if (!c || !n || !nama) return;
      const lok = teks(r[1]).toUpperCase();
      AM.push([o.m, areaNorm(r[0]), lok, nama, c.p, c.k, n]);
    });
  });
  if (Object.keys(belum).length) peringatan.push('Case belum ada di Pemetaan (tidak dihitung): ' + Object.keys(belum).slice(0, 15).join(', '));
  if (!dataBulan.length) peringatan.push('Belum ada file "Data <nomor bulan> ..." atau "Tarikan <nomor bulan> ..." (Google Sheet) di folder data.');
  else if (!tarikan[CFG.BULAN_TARIKAN - 1]) peringatan.push('Data ' + BULAN[CFG.BULAN_TARIKAN - 1].charAt(0) + BULAN[CFG.BULAN_TARIKAN - 1].slice(1).toLowerCase() + ' dan seterusnya menunggu file tarikan selesai diproses. Pastikan layanan Drive API sudah ditambahkan, lalu jalankan menu Dashboard > Proses file tarikan sekarang.');
  const log = bacaLogTarikan(folder);
  if (log.gagal.length) peringatan.push('File tarikan gagal dibaca: ' + log.gagal.slice(0, 5).join('; '));
  const hasil = hitung_(EV, AM, peta, catatan, peringatan);
  // bulan yang punya jam kejadian (sheet "Event Jam" di file Tarikan) -> filter Tanggal / Shift / Jam aktif
  hasil.jamAda = dataBulan.filter(o => o.f === tarikan[o.m]).filter(o => { const sh = SpreadsheetApp.open(o.f).getSheetByName('Event Jam'); return sh && sh.getLastRow() > 1; }).map(o => o.m);
  // Januari-September: file "Jam <nn> ..." dari file mentah
  const itJ = folder.getFiles();
  while (itJ.hasNext()) { const t = teks(itJ.next().getName()).match(/^JAM\s+(\d{1,2})\b/i); if (t && hasil.jamAda.indexOf(+t[1] - 1) < 0 && dataBulan.some(o => o.m === +t[1] - 1)) hasil.jamAda.push(+t[1] - 1); }
  hasil.jamAda.sort((a, b) => a - b);
  return hasil;
}

function kosong(peringatan) {
  return { tahun: CFG.TAHUN, areas: AREAS, bulanAda: [], params: [], lok: [], fakta: [], harian: [], driver: null, catatan: [], peringatan: peringatan, updated: new Date().toISOString() };
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

/** Pemetaan bawaan untuk teks "Alarm Status" di file tarikan; baris di sheet Pemetaan menimpa ini. */
const KASUS_TARIKAN = {
  'OVERSPEED INSTANT': ['Over Speed', 'Driving Behaviour'], 'OVER SPEED ALARM': ['Over Speed', 'Driving Behaviour'],
  'OVER DRIVING (4 HOURS)': ['Driving > 4 Hours', 'Driving Behaviour'],
  'BLACKZONE ALARM': ['Black Zone', 'Driver Discipline'], 'IDLE REPORT': ['Idling', 'Driver Discipline'],
  'DRIVER IS USING PHONE': ['Menggunakan Telepon', 'Driver Discipline'], 'DRIVER HAS BEEN SMOKING': ['Merokok / Vape', 'Driver Discipline'],
  'DRIVER HAS BEEN YAWNING': ['Menguap', 'Fatigue Management'],
};
/** Event yang selalu dihitung, menimpa baris lama di sheet Pemetaan ("Parameter lain" / "Tidak dihitung"). */
const KASUS_WAJIB = {
  'DRIVER DISTRACTION': ['Distraction Mengemudi', 'Driver Discipline'],
  'SEAT BELT DETECTION': ['Seat Belt', 'Driver Discipline'], 'SEATBELT DETECTION': ['Seat Belt', 'Driver Discipline'],
  'DRIVER IS NOT USING SEAT-BELT': ['Seat Belt', 'Driver Discipline'],
};
/** Menyeragamkan teks Case: huruf besar; "Blackzone Alarm - <nama zona>" -> "BLACKZONE ALARM"; "Over Speed Alarm (62 Km/H)" -> "OVER SPEED ALARM". */
function normKasus(x) {
  let s = teks(x).toUpperCase();
  if (/^BLACK ?ZONE ALARM/.test(s)) return 'BLACKZONE ALARM';
  s = s.replace(/\s*\(\d+\s*KM\/H\)\s*$/, '');
  return s;
}

function bacaPemetaan(v) {
  const kasus = {}, area = {}, lokasi = {}, urut = [];
  v.slice(1).forEach(r => {
    const c = normKasus(r[0]), p = teks(r[1]), k = teks(r[2]).toUpperCase();
    if (c && (p || k)) { kasus[c] = { p: p || '(tidak dihitung)', k: KATEGORI[k] || 'LAIN' }; if (p && !urut.some(x => x.p === p)) urut.push({ p: p, k: KATEGORI[k] || 'LAIN' }); }   // tanpa parameter = sengaja tidak dihitung
    const a = teks(r[4]).toUpperCase(), ar = namaRegional(r[5]); if (a && ar) area[a] = ar;
    const l = teks(r[7]).toUpperCase(), lr = namaRegional(r[8]); if (l && lr) lokasi[l] = lr;
  });
  Object.keys(KASUS_WAJIB).forEach(c => {
    const p = KASUS_WAJIB[c][0], k = KATEGORI[KASUS_WAJIB[c][1].toUpperCase()];
    kasus[c] = { p: p, k: k };
    if (!urut.some(x => x.p === p)) urut.push({ p: p, k: k });
  });
  Object.keys(KASUS_TARIKAN).forEach(c => {
    if (kasus[c]) return;
    const p = KASUS_TARIKAN[c][0], k = KATEGORI[KASUS_TARIKAN[c][1].toUpperCase()] || 'LAIN';
    kasus[c] = { p: p || '(tidak dihitung)', k: k };
    if (p && !urut.some(x => x.p === p)) urut.push({ p: p, k: k });
  });
  return { kasus: kasus, area: area, lokasi: lokasi, urut: urut };
}
/** Nama lokasi lama -> nama yang dipakai sekarang (di file tarikan). Tambahkan baris bila ada lokasi yang ganti nama. */
const ALIAS_LOKASI = {
  'FT SIMELUE': 'FT SIMEULUE', 'IT PANGKAL BALAM': 'FT PANGKALAN BALAM', 'FT WAYAME': 'IT WAYAME',
  'FT GORONTALO': 'IT GORONTALO', 'FT KENDARI': 'IT KENDARI',
};
function kunciLok(l) { const u = teks(l).toUpperCase(); return (ALIAS_LOKASI[u] || u).replace(/[^A-Z0-9]/g, ''); }
/** "Sumbagut 1" / "SUMBAGUT II" -> "SUMBAGUT"; nama area yang tidak dikenal -> '' (area diambil dari lokasinya). */
function areaNorm(x) {
  const s = teks(x).toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().replace(/^SUMBAGUT\s*(1|2|I|II)$/, 'SUMBAGUT');
  return AREAS.indexOf(s) >= 0 ? s : '';
}
function tanggalTeks(x) {
  if (x instanceof Date) return { m: x.getMonth(), d: x.getDate() };
  const t = teks(x).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return t ? { m: +t[2] - 1, d: +t[3] } : null;
}

/* ============================== TARIKAN HARIAN ============================== */
const BATAS_MS = 4.5 * 60 * 1000;   // batas kerja satu kali jalan (Apps Script berhenti di 6 menit)
const LOG_NAMA = 'Log Tarikan';
const LOG_HDR = ['File ID', 'Nama file', 'Area', 'Tanggal', 'Diubah', 'Baris event', 'Diproses', 'Status'];

/**
 * Membaca file tarikan harian baru/berubah dari folder-folder di spreadsheet "Tarikan Sistem",
 * merangkumnya per Tanggal x Area x Lokasi x Case, lalu menulisnya ke file "Tarikan <nn> <Bulan> <tahun>" di folder data.
 * Aman dijalankan berulang: file yang sudah diproses (dan tidak berubah) dilewati; sisa pekerjaan dilanjutkan di jalan berikutnya.
 */
function prosesTarikan() {
  const mulai = Date.now();
  const kunci = LockService.getScriptLock();
  if (!kunci.tryLock(1000)) return;
  try {
    const folder = DriveApp.getFolderById(CFG.FOLDER_ID);
    const logSs = bukaAtauBuat(folder, LOG_NAMA, [[LOG_NAMA, LOG_HDR]]);
    const logSh = logSs.getSheetByName(LOG_NAMA);
    const logV = logSh.getDataRange().getValues();
    const sudah = {};
    logV.slice(1).forEach((r, i) => { sudah[r[0]] = { baris: i + 2, diubah: Number(r[4]) || 0, status: teks(r[7]) }; });

    const antre = daftarTarikan_().filter(o => !sudah[o.id] || sudah[o.id].diubah !== o.diubah || /^GAGAL/.test(sudah[o.id].status));   // baru, berubah, atau gagal sebelumnya
    antre.sort((a, b) => a.tgl < b.tgl ? -1 : a.tgl > b.tgl ? 1 : 0);
    let n = 0;
    for (const o of antre) {
      if (Date.now() - mulai > BATAS_MS) break;
      let status = 'OK', baris = 0;
      try { baris = prosesSatuTarikan(folder, o); }
      catch (e) { status = 'GAGAL: ' + e.message; }
      const row = [o.id, o.nama, o.area, o.tgl, o.diubah, baris, new Date(), status];
      if (sudah[o.id]) logSh.getRange(sudah[o.id].baris, 1, 1, row.length).setValues([row]);
      else { logSh.appendRow(row); sudah[o.id] = { baris: logSh.getLastRow(), diubah: o.diubah, status: status }; }
      n++;
    }
    Logger.log('File tarikan diproses: ' + n + ' dari ' + antre.length + ' yang menunggu.');
    if (n) { try { panaskanCache(); } catch (e) { /* dicoba lagi oleh pemicu */ } }   // cache lama ditimpa, tidak dikosongkan dulu
  } finally { kunci.releaseLock(); }
}

/** Semua file "Tarikan_<REG>_..._<yyyy-mm-dd>" di folder yang terdaftar: [{id, nama, area, tgl, diubah, mime, file}]. */
function daftarTarikan_() {
  const v = SpreadsheetApp.openById(CFG.TARIKAN_ID).getSheets()[0].getDataRange().getValues();
  const out = [];
  v.forEach(r => {
    const area = teks(r[0]), link = teks(r[1]);
    const id = (link.match(/folders\/([-\w]{20,})/) || link.match(/[?&]id=([-\w]{20,})/) || [])[1];
    if (!area || !id || /^AREA$/i.test(area)) return;
    const it = DriveApp.getFolderById(id).getFiles();
    while (it.hasNext()) {
      const f = it.next(), nama = f.getName(), t = nama.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (!/TARIKAN/i.test(nama) || !t || +t[1] !== CFG.TAHUN || +t[2] < CFG.BULAN_TARIKAN) continue;
      const mime = f.getMimeType();
      if (mime !== MimeType.MICROSOFT_EXCEL && mime !== MimeType.GOOGLE_SHEETS) continue;
      out.push({ id: f.getId(), nama: nama, area: area.toUpperCase(), tgl: t[1] + '-' + t[2] + '-' + t[3], diubah: f.getLastUpdated().getTime(), mime: mime, file: f });
    }
  });
  return out;
}

/** Merangkum satu file tarikan dan menulis hasilnya (menggantikan hasil lama file yang sama). Mengembalikan jumlah baris event. */
function prosesSatuTarikan(folder, o) {
  let ssId = o.id, sementara = null;
  if (o.mime === MimeType.MICROSOFT_EXCEL) {
    if (typeof Drive === 'undefined') throw new Error('layanan Drive API belum diaktifkan di Apps Script');
    const blob = o.file.getBlob();
    sementara = Drive.Files.create ? Drive.Files.create({ name: '_tmp_' + o.nama, mimeType: MimeType.GOOGLE_SHEETS }, blob).id
                                   : Drive.Files.insert({ title: '_tmp_' + o.nama, mimeType: MimeType.GOOGLE_SHEETS }, blob, { convert: true }).id;
    ssId = sementara;
  }
  try {
    const sh = SpreadsheetApp.openById(ssId).getSheets()[0];
    const nr = sh.getLastRow() - 1, nc = sh.getLastColumn();
    if (nr < 1) return 0;
    const k = petaKolom(sh.getRange(1, 1, 1, nc).getValues()[0]);
    const kol = h => { if (k[h] === undefined) return null; return sh.getRange(2, k[h] + 1, nr, 1).getValues(); };
    const tb = kol('TBBM'), al = kol('ALARM STATUS'), am = kol('AMT 1'), gid = kol('ALERT GROUP ID'), wk = kol('TIME') || kol('START ALERT');
    if (!tb || !al) throw new Error('kolom TBBM / Alarm Status tidak ditemukan');
    const ev = {}, evj = {}, amt = {}, amj = {}, lihat = {};
    let n = 0;
    for (let i = 0; i < nr; i++) {
      const c = normKasus(al[i][0]); if (!c) continue;
      const g = gid ? teks(gid[i][0]) : '';
      if (g) { if (lihat[g]) continue; lihat[g] = 1; }   // baris dobel (Alert Group ID sama) dihitung sekali
      const lok = teks(tb[i][0]).toUpperCase();
      const ke = lok + '\u0001' + c; ev[ke] = (ev[ke] || 0) + 1; n++;
      const jam = wk ? jamDari(wk[i][0]) : null;
      if (jam !== null) { const kj = jam + '\u0001' + ke; evj[kj] = (evj[kj] || 0) + 1; }
      const nama = am ? namaAmt(am[i][0]) : '';
      if (nama) { const ka = lok + '\u0001' + nama + '\u0001' + c; amt[ka] = (amt[ka] || 0) + 1; if (jam !== null) { const kj = jam + '\u0001' + ka; amj[kj] = (amj[kj] || 0) + 1; } }
    }
    const m = +o.tgl.slice(5, 7);
    const ss = bukaAtauBuat(folder, 'Tarikan ' + ('0' + m).slice(-2) + ' ' + BULAN[m - 1].charAt(0) + BULAN[m - 1].slice(1).toLowerCase() + ' ' + CFG.TAHUN,
      [['Event', ['Tanggal', 'Area', 'Lokasi', 'Case', 'Jumlah', 'Sumber']], ['AMT', ['Area', 'Lokasi', 'Nama AMT', 'Case', 'Jumlah', 'Sumber']]]);
    ss.getSheetByName('Event').getRange('A:A').setNumberFormat('@');   // tanggal disimpan sebagai teks yyyy-mm-dd
    gantiBaris(ss.getSheetByName('Event'), o.id, Object.keys(ev).map(x => { const p = x.split('\u0001'); return [o.tgl, o.area, p[0], p[1], ev[x], o.id]; }));
    gantiBaris(sheetAtauBuat(ss, 'Event Jam', ['Tanggal', 'Jam', 'Area', 'Lokasi', 'Case', 'Jumlah', 'Sumber']), o.id,
      Object.keys(evj).map(x => { const p = x.split('\u0001'); return [o.tgl, +p[0], o.area, p[1], p[2], evj[x], o.id]; }));
    gantiBaris(sheetAtauBuat(ss, 'AMT Jam', ['Tanggal', 'Jam', 'Area', 'Lokasi', 'Nama AMT', 'Case', 'Jumlah', 'Sumber']), o.id,
      Object.keys(amj).map(x => { const p = x.split('\u0001'); return [o.tgl, +p[0], o.area, p[1], p[2], p[3], amj[x], o.id]; }));
    gantiBaris(ss.getSheetByName('AMT'), o.id, Object.keys(amt).map(x => { const p = x.split('\u0001'); return [o.area, p[0], p[1], p[2], amt[x], o.id]; }));
    return n;
  } finally {
    if (sementara) try { DriveApp.getFileById(sementara).setTrashed(true); } catch (e) { /* abaikan */ }
  }
}

/** Jam kejadian (0-23) dari kolom Time: nilai tanggal-jam Sheets atau teks "yyyy-mm-ddThh:mm:ss". */
function jamDari(x) {
  if (x instanceof Date) return x.getHours();
  const v = teks(x), t = v.match(/[T ](\d{1,2}):\d{2}/);
  if (t) return +t[1] < 24 ? +t[1] : null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? 0 : null;   // tanggal tanpa jam = 00.00
}
function sheetAtauBuat(ss, nama, hdr) {
  let sh = ss.getSheetByName(nama);
  if (!sh) { sh = ss.insertSheet(nama); sh.getRange(1, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold'); sh.setFrozenRows(1); sh.getRange('A:A').setNumberFormat('@'); }
  return sh;
}

/**
 * Memproses ulang semua file tarikan (mis. setelah ada kolom baru seperti jam kejadian).
 * Hanya menandai log; pekerjaannya dikerjakan prosesTarikan (pemicu 15 menit) sedikit demi sedikit.
 */
function prosesUlangSemuaTarikan() {
  const it = DriveApp.getFolderById(CFG.FOLDER_ID).getFilesByName(LOG_NAMA);
  if (!it.hasNext()) return;
  const sh = SpreadsheetApp.open(it.next()).getSheetByName(LOG_NAMA), n = sh.getLastRow() - 1;
  if (n > 0) sh.getRange(2, 5, n, 1).setValue(0);   // kolom "Diubah" = 0 -> dianggap berubah
  prosesTarikan();
}

/**
 * Membaca ulang file tarikan (mis. setelah file di folder area diganti / diunggah ulang).
 *   area  : nama area di Tarikan Sistem ("SUMBAGSEL"); "SUMBAGUT" mencakup Sumbagut 1 & 2; '' = semua area
 *   bulan : 1-12, atau kosong = semua bulan tarikan
 * 1. baris hasil dari file yang sudah tidak ada di folder (diunggah ulang dengan file baru / dihapus) dibuang,
 *    supaya tidak terhitung dobel;
 * 2. semua file yang cocok ditandai berubah lalu diproses ulang (sisa antrean dilanjutkan pemicu 15 menit).
 */
function bacaUlangTarikan(area, bulan) {
  area = teks(area).toUpperCase(); bulan = Number(bulan) || 0;
  const cocokArea = a => !area || teks(a).toUpperCase() === area || areaNorm(a) === area;
  const semua = daftarTarikan_(), daftar = semua.filter(o => cocokArea(o.area) && (!bulan || +o.tgl.slice(5, 7) === bulan));
  const label = (area || 'Semua area') + (bulan ? ' bulan ' + BULAN[bulan - 1].charAt(0) + BULAN[bulan - 1].slice(1).toLowerCase() : '');
  if (!daftar.length) throw new Error('Tidak ada file tarikan untuk ' + label + '. Periksa nama area di spreadsheet Tarikan Sistem.');
  const ada = {}; semua.forEach(o => { ada[o.id] = 1; });   // semua file yang masih ada di folder
  const ulang = {}; daftar.forEach(o => { ulang[o.id] = 1; });
  const folder = DriveApp.getFolderById(CFG.FOLDER_ID), it = folder.getFilesByType(MimeType.GOOGLE_SHEETS), kolomArea = { 'Event': 1, 'AMT': 0, 'Event Jam': 2, 'AMT Jam': 2 };
  let buang = 0;
  while (it.hasNext()) {
    const f = it.next(), m = teks(f.getName()).match(/^TARIKAN\s+(\d{1,2})\b/i);
    if (!m || (bulan && +m[1] !== bulan)) continue;
    const ss = SpreadsheetApp.open(f);
    Object.keys(kolomArea).forEach(n => {
      const sh = ss.getSheetByName(n); if (!sh || sh.getLastRow() < 2) return;
      const v = sh.getDataRange().getValues(), w = v[0].length, ka = kolomArea[n];
      const sisa = v.slice(1).filter(r => !cocokArea(r[ka]) || ada[teks(r[w - 1])]);
      if (sisa.length === v.length - 1) return;
      buang += v.length - 1 - sisa.length;
      sh.getRange(2, 1, v.length - 1, w).clearContent();
      if (sisa.length) sh.getRange(2, 1, sisa.length, w).setValues(sisa);
    });
  }
  // tandai file yang cocok sebagai berubah -> diproses ulang oleh prosesTarikan
  const itL = folder.getFilesByName(LOG_NAMA);
  if (itL.hasNext()) {
    const sh = SpreadsheetApp.open(itL.next()).getSheetByName(LOG_NAMA), v = sh.getDataRange().getValues();
    v.forEach((r, i) => { if (i && ulang[teks(r[0])]) sh.getRange(i + 1, 5).setValue(0); });
  }
  const pesan = label + ': ' + daftar.length + ' file ditandai untuk dibaca ulang, ' + buang + ' baris lama dari file yang sudah tidak ada dibuang. '
    + 'Pemrosesan berjalan sekarang (maks. 4,5 menit); sisanya dilanjutkan otomatis tiap 15 menit (lihat sheet Log Tarikan).';
  Logger.log(pesan);
  prosesTarikan();
  return pesan;
}
function bacaUlangTarikanArea(area) { return bacaUlangTarikan(area, 0); }
function menuBacaUlangArea() {
  const ui = SpreadsheetApp.getUi(), r = ui.prompt('Baca ulang tarikan', 'Nama area (mis. SUMBAGSEL, SUMBAGUT), atau kosongkan untuk semua area. Tambahkan nomor bulan bila perlu, mis. "SUMBAGSEL 10" atau "10":', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const s = teks(r.getResponseText()), m = s.match(/(?:^|\s)(\d{1,2})$/);
  ui.alert(bacaUlangTarikan(m ? s.slice(0, m.index).trim() : s, m ? +m[1] : 0));
}
/** Jalankan dari editor. */
function BACA_ULANG_SUMBAGSEL() { bacaUlangTarikan('SUMBAGSEL', 0); }
function BACA_ULANG_SEMUA_OKTOBER() { bacaUlangTarikan('', 10); }

function namaAmt(x) {
  const s = teks(x).replace(/\s*[\[(].*?[\])]\s*/g, ' ').replace(/^[\s.\-]+|[\s.\-]+$/g, '').toUpperCase();
  return s === '-' ? '' : s;
}

/** Mengganti semua baris milik satu file sumber (kolom terakhir = File ID) dengan baris baru. */
function gantiBaris(sh, sumber, baru) {
  const v = sh.getDataRange().getValues(), w = v[0].length;
  const sisa = v.slice(1).filter(r => r[w - 1] !== sumber).concat(baru);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, w).clearContent();
  if (sisa.length) sh.getRange(2, 1, sisa.length, w).setValues(sisa);
}

/** Membuka Google Sheet bernama `nama` di folder, atau membuatnya dengan sheet & judul kolom yang diberikan. */
function bukaAtauBuat(folder, nama, sheets) {
  const it = folder.getFilesByName(nama);
  while (it.hasNext()) { const f = it.next(); if (f.getMimeType() === MimeType.GOOGLE_SHEETS) return SpreadsheetApp.open(f); }
  const ss = SpreadsheetApp.create(nama);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  sheets.forEach((d, i) => {
    const sh = i === 0 ? ss.getSheets()[0].setName(d[0]) : ss.insertSheet(d[0]);
    sh.getRange(1, 1, 1, d[1].length).setValues([d[1]]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#4a7a53');
    sh.setFrozenRows(1);
  });
  return ss;
}

/** Ringkasan Log Tarikan untuk peringatan di dashboard. */
function bacaLogTarikan(folder) {
  const it = folder.getFilesByName(LOG_NAMA), out = { gagal: [] };
  if (!it.hasNext()) return out;
  const v = nilaiSheet(SpreadsheetApp.open(it.next()), LOG_NAMA) || [];
  v.slice(1).forEach(r => { if (/^GAGAL/.test(teks(r[7]))) out.gagal.push(teks(r[1]) + ' (' + teks(r[7]).slice(7, 80) + ')'); });
  return out;
}

/* ============================== HITUNG ============================== */
/**
 * Hasil untuk dashboard berupa tabel fakta ringkas; dashboard menjumlahkannya sesuai filter Area / Lokasi.
 *   lok    : [[nama lokasi, indeks area]]
 *   fakta  : [[bulan, indeks area, indeks lokasi, indeks parameter, jumlah]]
 *   harian : [[bulan, tanggal, indeks area, indeks lokasi, DB, DD, FM]]
 *   driver : { all, area, lok, nama } -> [[bulan, indeks area, indeks lokasi, indeks parameter, indeks nama, jumlah]]
 *            10 Driver teratas per bulan x parameter, untuk semua area, per area, dan per lokasi (kolom AMT 1).
 */
function hitung_(EV, AM, peta, catatan, peringatan) {
  const ada = {}; EV.forEach(e => { ada[e[0]] = 1; });
  const bulanAda = Object.keys(ada).map(Number).sort((a, b) => a - b);

  const params = [], pIdx = {};
  peta.urut.filter(o => o.k !== 'LAIN').forEach(o => {
    const P = o.p.toUpperCase();
    pIdx[o.p] = params.length;
    params.push({ key: o.p, label: LABEL_EVENT[P] || o.p, kat: PINDAH_KATEGORI[P] || o.k, katAsal: o.k, tipe: TIPE[P] || '-' });
  });

  // Satu lokasi = satu nama & satu area di semua bulan. Ejaan disamakan (tanda hubung/spasi diabaikan, ALIAS_LOKASI),
  // nama dan area diambil dari bulan terbaru (data tarikan mengikuti pembagian folder di Tarikan Sistem).
  const info = {};   // kunci -> {m, nama, area: {bulan: {area: jumlah}}}
  const catat = (m, a, l, n) => {
    if (!l) return;
    const k = kunciLok(l), o = info[k] || (info[k] = { m: -1, nama: l, area: {} });
    if (m >= o.m) { o.m = m; o.nama = ALIAS_LOKASI[l] || l; }
    if (a) { const x = o.area[m] || (o.area[m] = {}); x[a] = (x[a] || 0) + n; }
  };
  EV.forEach(e => catat(e[0], e[2], e[3], e[6])); AM.forEach(r => catat(r[0], r[1], r[2], r[6]));
  const areaLok = l => { const o = l && info[kunciLok(l)]; if (!o) return '';
    const ms = Object.keys(o.area).map(Number); if (!ms.length) return '';
    const x = o.area[Math.max.apply(null, ms)]; return Object.keys(x).sort((a, b) => x[b] - x[a])[0]; };
  const namaLok = l => l ? info[kunciLok(l)].nama : '(TANPA LOKASI)';

  const lok = [], lokIdx = {};
  const li = (l, ai) => { const k = ai + '|' + l; if (lokIdx[k] === undefined) { lokIdx[k] = lok.length; lok.push([l, ai]); } return lokIdx[k]; };
  const F = {}, H = {}, KI = { DB: 4, DD: 5, FM: 6 };
  let tanpaArea = 0;
  EV.forEach(e => {
    const m = e[0], pi = pIdx[e[4]], n = e[6];
    if (pi === undefined) return;
    const l = namaLok(e[3]), a = areaLok(e[3]) || e[2];
    if (!a) { tanpaArea += n; return; }
    const ai = AREAS.indexOf(a), L = li(l, ai);
    const fk = m + '|' + L + '|' + pi; (F[fk] || (F[fk] = [m, ai, L, pi, 0]))[4] += n;
    const hk = m + '|' + e[1] + '|' + L; (H[hk] || (H[hk] = [m, e[1], ai, L, 0, 0, 0]))[KI[params[pi].kat]] += n;
  });
  if (tanpaArea) catatan.push('Data: ' + tanpaArea + ' event tanpa Area dan Lokasi yang jelas tidak dihitung.');

  // Driver: jumlah per bulan x lokasi x parameter x nama, lalu 10 teratas per parameter
  //         untuk semua area, per area, dan per lokasi. Nama disimpan sekali di daftar `nama`.
  const X = {};
  AM.forEach(r => {
    const [m, a0, l0, nama, p, k, n] = r, pi = pIdx[p];
    if (pi === undefined) return;
    const l = namaLok(l0), a = areaLok(l0) || a0;
    if (!a) return;
    const ai = AREAS.indexOf(a), L = li(l, ai), key = m + '|' + L + '|' + pi + '|' + nama;
    (X[key] || (X[key] = { m: m, a: ai, l: L, p: pi, nama: nama, n: 0 })).n += n;
  });
  const terbesar = obj => +(Object.keys(obj).sort((a, b) => obj[b] - obj[a])[0] || 0);
  const xr = Object.keys(X).map(k => X[k]), nama = [], nIdx = {};
  const ni = s => { if (nIdx[s] === undefined) { nIdx[s] = nama.length; nama.push(s); } return nIdx[s]; };
  const top10 = grup => {
    const G = {};
    xr.forEach(o => {
      const g = grup(o) + '|' + o.p, key = g + '|' + o.nama;
      const x = G[key] || (G[key] = { g: g, m: o.m, p: o.p, nama: o.nama, n: 0, lokT: {}, areaT: {} });
      x.n += o.n; x.lokT[o.l] = (x.lokT[o.l] || 0) + o.n; x.areaT[o.a] = (x.areaT[o.a] || 0) + o.n;
    });
    const K = {}; Object.keys(G).forEach(k => (K[G[k].g] = K[G[k].g] || []).push(G[k]));
    const out = [];
    Object.keys(K).forEach(g => K[g].sort((a, b) => b.n - a.n).slice(0, 10)
      .forEach(o => out.push([o.m, terbesar(o.areaT), terbesar(o.lokT), o.p, ni(o.nama), o.n])));
    return out;
  };
  const driver = xr.length ? { all: top10(o => o.m), area: top10(o => o.m + '|' + o.a), lok: top10(o => o.m + '|' + o.l), nama: nama } : null;

  return {
    tahun: CFG.TAHUN, areas: AREAS, bulanAda: bulanAda, params: params, lok: lok,
    fakta: Object.keys(F).map(k => F[k]), harian: Object.keys(H).map(k => H[k]), driver: driver,
    catatan: catatan, peringatan: peringatan, updated: new Date().toISOString(),
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


