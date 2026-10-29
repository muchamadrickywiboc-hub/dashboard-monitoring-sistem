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
 *     Format sama dengan file Data (+ kolom Sumber). Mulai tanggal CFG.MULAI_TARIKAN hanya file Tarikan yang dipakai; tanggal sebelumnya memakai file Data
 *     (satu bulan boleh punya keduanya, mis. Oktober: tanggal 1-19 dari "Data 10 ...", tanggal 20 dst dari "Tarikan 10 ...").
 *     prosesTarikan butuh layanan lanjutan "Drive API" (Apps Script > Layanan > Drive API) untuk membaca .xlsx.
 * Semua rekap (parameter, regional, lokasi, TOP 10 AMT, event per hari) dihitung di sini, tanpa rumus spreadsheet.
 *
 *  - doGet()            : web app (?laporan=harian = Laporan GPS & Dashcam Daily/Monthly, LaporanHarian.gs).
 *  - getDashboardData() : dipanggil dashboard; hasil di-cache 6 jam + salinan di file Drive (menu "Perbarui data dashboard sekarang" setelah data diubah).
 *  - pasangPemicu()     : jalankan sekali; memeriksa data baru tiap 15 menit dan membangun ulang cache supaya dashboard langsung terbuka.
 */

/* ============================== PENGATURAN ============================== */
const CFG = {
  FOLDER_ID: '1nUJtRTcKwJua4Am9EdiFXoQxcTALgt9e',   // folder Drive "3. Data Dashboard"
  TARIKAN_ID: '11akfRibrQLixrBicdNXazEWX-TGmgfYu4zdYYNaOEy8',   // spreadsheet "Tarikan Sistem": kolom Area | linkgdrive (folder tarikan harian per regional)
  MULAI_TARIKAN: '2026-10-29',   // mulai tanggal ini data HANYA dari tarikan (link Tarikan Sistem); tanggal sebelumnya dari file "Data <nn> ..." dan "Jam <nn> ..."
  // area yang mulai dari tarikan pada tanggal lain: file rekap Sumbagut 1 & 2 di "Data 10 Oktober 2026" hanya sampai tanggal 26, jadi 27-28 dari tarikan
  MULAI_TARIKAN_AREA: { SUMBAGUT: '2026-10-27' },
  // folder "4. Report Data alert Per 4 Jam": subfolder per regional ("7. Malupa"), isinya file alert mentah sebulan (Google Sheet "MALUPA_OKTOBER 2026") yang diperbarui tiap 4 jam; file Excel di folder ini tidak dibaca.
  // Mulai MULAI_4JAM event area yang filenya sudah terbaca dari folder ini HANYA diambil dari sini (tarikan harian di Tarikan Sistem tidak dipakai lagi untuk area itu).
  ALERT4JAM_ID: '1ZLTierdGgXgpA2BwFszLnGfLa1fHRF0F',
  MULAI_4JAM: '2026-10-29',
  TAHUN: 2026,
  CACHE_DETIK: 21600,   // 6 jam (batas maksimum CacheService)
  JEDA_GABUNG_DETIK: 0,   // (mis. 10) alert yang sama (nopol + case) berulang dengan jeda <= ini dihitung 1 event; 0 = setiap baris dihitung
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
  'DISTRACTION MENGEMUDI': 'CCTV', 'SEAT BELT': 'CCTV', 'SOS': 'GPS',
};
/** Parameter yang hanya tampil untuk akun RTC (PUSAT); akun Area & Lokasi tidak menerimanya sama sekali (nama parameter huruf besar). */
const PARAM_KHUSUS_RTC = ['SOS', 'SEAT BELT'];
/** Parameter yang tidak ditampilkan untuk akun Area (Command Center) & Lokasi (Control Room); keduanya hanya melihat 9 event + GPS/Dashcam Offline di Laporan Harian. */
const PARAM_SEMBUNYI_LOKASI = ['ILLEGAL SHUTDOWN', 'CAMERA COVERING', 'MICROSLEEP', 'DRIVING > 4 HOURS', 'DISTRACTION MENGEMUDI'];
/** Nama event yang tampil di dashboard dan export (nama parameter huruf besar -> label). Kunci parameter tetap mengikuti sheet Pemetaan. */
const LABEL_EVENT = {
  'OVER SPEED': 'Overspeed', 'HARSH BRAKING': 'Harsh Brake', 'HARSH ACCELERATION': 'Harsh Acceleration', 'HARSH TURN / CORNERING': 'Harsh Cornering',
  'IDLING': 'Idle', 'DRIVING > 4 HOURS': 'Drive > 4 Hr', 'BLACK ZONE': 'Blackzone',
  'MICROSLEEP': 'Microsleep', 'MENGUAP': 'Menguap', 'MEROKOK / VAPE': 'Merokok', 'MENGGUNAKAN TELEPON': 'Menggunakan Telepon',
  'DISTRACTION MENGEMUDI': 'Driver Distracted', 'SEAT BELT': 'Seat Belt Detection',
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
      .addItem('Buat ulang Summary bulanan', 'buatUlangSummary')
      .addSeparator()
      .addItem('Buat / lengkapi akun (Pusat, Area, Lokasi)', 'buatSheetAkun')
      .addItem('Rapikan akun ganda (lokasi sama)', 'rapikanAkunGanda')
      .addItem('Seragamkan nama akun (Control Room / Command Center)', 'seragamkanNamaAkun')
      .addItem('Lengkapi sheet Pemetaan (case tarikan)', 'lengkapiPemetaan')
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
  gantiVersiData_();
  panaskanCache();
  try { SpreadsheetApp.getActiveSpreadsheet().toast('Data dashboard sudah diperbarui. Muat ulang dashboard.', 'Dashboard', 5); } catch (e) { Logger.log('Data dashboard diperbarui.'); }
}

/** Versi data untuk kunci cache per tanggal/jam dan Laporan Harian: diganti setiap data berubah, jadi cache lama tidak terpakai lagi. */
const VERSI_KODE = '2026-10-29b';   // ubah setiap kali cara hitung berubah, supaya cache lama otomatis dibangun ulang
function versiData_() { return (PropertiesService.getScriptProperties().getProperty('VERSI_DATA') || '0') + '|' + VERSI_KODE; }
function gantiVersiData_() { PropertiesService.getScriptProperties().setProperty('VERSI_DATA', String(Date.now() % 1e8)); }

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
/** Ikon tab browser: logo Elnusa Petrofin (file assets/elnusa-favicon.png di repo GitHub). */
const FAVICON_URL = 'https://raw.githubusercontent.com/muchamadrickywiboc-hub/dashboard-monitoring-sistem/main/assets/elnusa-favicon.png';
function doGet(e) {
  if (e && e.parameter && /^harian$/i.test(e.parameter.laporan || '')) return halamanLaporanHarian_();   // Lampiran 3A, lihat LaporanHarian.gs
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Monitoring Driving Behaviour, Driver Discipline & Fatigue Management')
    .setFaviconUrl(FAVICON_URL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Dijalankan pemicu waktu: membangun ulang cache supaya pengunjung tidak menunggu spreadsheet dihitung. */
function panaskanCache() {
  const versi = versiData_();
  simpanUtama_(JSON.stringify(bangunData_()));
  PropertiesService.getScriptProperties().setProperties({ VERSI_PANAS: versi, WAKTU_PANAS: String(Date.now()) });
  // Laporan Harian ikut dipanaskan bila waktu eksekusi masih cukup (batas Apps Script 6 menit)
  if (Date.now() - MULAI_EKSEKUSI_ < 4.5 * 60 * 1000) { try { panaskanLH_(); } catch (e) { Logger.log('Cache Laporan Harian gagal dipanaskan: ' + e.message); } }
}
const MULAI_EKSEKUSI_ = Date.now();   // dievaluasi sekali di awal setiap eksekusi
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
function bacaSnapshot_(bolehBasi) {
  try { const f = fileSnapshot_(); if (!f || (!bolehBasi && Date.now() - f.getLastUpdated().getTime() > SNAP_MAKS_JAM * 3600000)) return null; return f.getBlob().getDataAsString(); }
  catch (e) { return null; }
}
/** Data utama (gzip+base64): cache -> salinan Drive -> hitung ulang (hanya satu pengunjung, yang lain menunggu).
 *  Salinan Drive dipakai walau sudah lebih dari SNAP_MAKS_JAM: pengunjung tidak menunggu hitung ulang,
 *  data dibangun ulang oleh pemicu panaskanCache / prosesTarikan. Hitung ulang di sini hanya bila salinan belum ada. */
function dataUtamaZ_() {
  const ada = ambilCache_('DASHB4Z');
  if (ada) return ada;
  const basi = bacaSnapshot_(true);
  if (basi) { simpanCache_(basi, 'DASHB4Z', 900); return basi; }   // 15 menit, supaya data baru dari pemicu cepat terpakai
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

/** Jalankan sekali dari editor: memasang pemicu prosesTarikan & panaskanOtomatis tiap 15 menit. */
/**
 * Pemicu tiap 15 menit: dashboard & summary dibangun ulang bila ada data baru sejak pembangunan terakhir
 * (mis. prosesTarikan kehabisan waktu sebelum sempat memanaskan cache), atau bila sudah 1 jam. Kalau tidak ada yang berubah, langsung selesai
 * supaya kuota waktu harian Apps Script tidak habis.
 */
function panaskanOtomatis() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('VERSI_PANAS') === versiData_() && Date.now() - Number(p.getProperty('WAKTU_PANAS') || 0) < 55 * 60 * 1000 && ambilCache_('DASHB4Z')) return;
  panaskanCache();
}
function pasangPemicu() {
  ScriptApp.getProjectTriggers().filter(t => ['panaskanCache', 'panaskanOtomatis', 'prosesTarikan', 'buatSheetDataKosong'].indexOf(t.getHandlerFunction()) >= 0).forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('buatSheetDataKosong').timeBased().everyDays(1).atHour(6).create();   // sheet Data Kosong diperbarui tiap pagi
  ScriptApp.newTrigger('panaskanOtomatis').timeBased().everyMinutes(15).create();   // data baru tampil di dashboard maksimal 15 menit kemudian
  ScriptApp.newTrigger('prosesTarikan').timeBased().everyMinutes(15).create();   // file harian baru terbaca maksimal 15 menit setelah diunggah
  panaskanCache();
  Logger.log('Pemicu panaskanOtomatis (tiap 15 menit) dan prosesTarikan (tiap 15 menit) terpasang dan cache sudah diisi. Jalankan prosesTarikan sekali untuk mulai membaca file tarikan.');
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
  const kunci = 'SZ_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, ses.peran + '|v2|' + (ses.area || '') + '|' + (ses.lok || ''))).slice(0, 16);
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
  if (peran === 'MASTER') return { u: u, nama: nama, peran: 'PUSAT', master: true };   // akun induk: login sendiri = RTC; password-nya juga membuka akun lain (lihat login)
  if (peran === 'AREA' && area) return { u: u, nama: nama, peran: peran, area: area };
  if (peran === 'LOKASI' && lok) return { u: u, nama: nama, peran: peran, area: area, lok: ALIAS_LOKASI[lok] || lok };
  return null;
}

const aktifAkun_ = r => !/^(TIDAK|NO|FALSE|0|NONAKTIF)$/i.test(teks(r[6]));
const pwCocok_ = (r, p) => { const pw = teks(r[1]); return !!pw && (pw.indexOf('sha256:') === 0 ? pw === sidikPw_(teks(r[0]).toLowerCase(), p) : pw === p); };

/** Isi token sesi {u, c, t, m?} (tanpa memeriksa akun). */
function isiToken_(token) {
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(token || ''));
  if (!m || tandaSesi_(m[1]) !== m[2]) throw new Error('LOGIN');
  try { return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(m[1])).getDataAsString()); } catch (e) { throw new Error('LOGIN'); }
}
/** Dipanggil dashboard: apakah sesi ini dibuka dengan akun MASTER (boleh pindah ke akun lain). */
function akunSaya(token) { return JSON.stringify({ master: !!sesi_(token).master }); }
/** Akun MASTER: daftar semua akun (RTC, Command Center, Control Room) untuk pilihan "Masuk sebagai". */
function daftarAkunMaster(token) {
  if (!sesi_(token).master) throw new Error('Hanya untuk akun master.');
  return daftarLogin();
}
/** Akun MASTER: pindah ke akun lain tanpa password akun itu. Mengembalikan token baru (bentuk sama dengan login). */
function masukSebagai(token, username) {
  if (!sesi_(token).master) throw new Error('Hanya untuk akun master.');
  const o = isiToken_(token), mu = o.m || o.u, u = teks(username).toLowerCase();
  const v = sheetAkun_().getDataRange().getValues().slice(1), cari = x => v.filter(r => teks(r[0]).toLowerCase() === x)[0];
  const mr = cari(mu), r = cari(u);
  if (!mr || teks(mr[3]).toUpperCase() !== 'MASTER' || !aktifAkun_(mr)) throw new Error('LOGIN');
  if (!r || !aktifAkun_(r)) throw new Error('Akun ' + username + ' tidak ditemukan atau tidak aktif.');
  const ses = cakupanAkun_(r); if (!ses) throw new Error('Akun ' + username + ' belum lengkap di sheet Akun.');
  ses.master = true;
  const c = 'm' + capPw_(teks(mr[1])), isi = b64_(Utilities.newBlob(JSON.stringify({ u: u, c: c, t: Date.now(), m: mu })).getBytes());
  CacheService.getScriptCache().put('AK_' + u + '_' + c, JSON.stringify(ses), CEK_AKUN_DETIK);
  return JSON.stringify(Object.assign({ token: isi + '.' + tandaSesi_(isi) }, ses));
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
  const cocok = r && aktifAkun_(r) && pwCocok_(r, p);
  // password akun Peran MASTER membuka semua akun (RTC, Command Center, Control Room)
  const master = !cocok && r && aktifAkun_(r) ? v.slice(1).filter(x => teks(x[3]).toUpperCase() === 'MASTER' && aktifAkun_(x) && pwCocok_(x, p))[0] : null;
  if (!cocok && !master) { cache.put(kg, String(gagal + 1), 900); Utilities.sleep(600); throw new Error('Username atau password salah.'); }
  const ses = cakupanAkun_(r);
  if (!ses) throw new Error('Akun belum lengkap: isi Peran (PUSAT / AREA / LOKASI) beserta Area atau Lokasinya di sheet Akun.');
  if (master) ses.master = true;
  const c = master ? 'm' + capPw_(teks(master[1])) : capPw_(pw), isiSesi = { u: u, c: c, t: Date.now() };
  if (master) isiSesi.m = teks(master[0]).toLowerCase();
  const isi = b64_(Utilities.newBlob(JSON.stringify(isiSesi)).getBytes()), token = isi + '.' + tandaSesi_(isi);
  cache.put('AK_' + u + '_' + c, JSON.stringify(ses), CEK_AKUN_DETIK);
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
  const cari = u => v.slice(1).filter(x => teks(x[0]).toLowerCase() === u)[0];
  const r = cari(o.u), mr = o.m ? cari(o.m) : null;
  const pwOk = o.m ? mr && teks(mr[3]).toUpperCase() === 'MASTER' && aktifAkun_(mr) && teks(mr[1]) && 'm' + capPw_(teks(mr[1])) === o.c
    : r && teks(r[1]) && capPw_(teks(r[1])) === o.c;
  const ses = r && aktifAkun_(r) && pwOk ? cakupanAkun_(r) : null;
  if (!ses) throw new Error('LOGIN');
  if (o.m) ses.master = true;
  cache.put(kunci, JSON.stringify(ses), CEK_AKUN_DETIK);
  return ses;
}

/** Memotong data (bentuk hitung_) sesuai cakupan akun; nama lokasi & Driver di luar cakupan dihapus. */
function potongCakupan_(d, ses) {
  d.akun = { nama: ses.nama, peran: ses.peran, area: ses.area || '', lok: ses.lok || '' };
  if (ses.peran === 'PUSAT') return d;
  buangParam_(d, PARAM_KHUSUS_RTC, d.harianRtc);
  buangParam_(d, PARAM_SEMBUNYI_LOKASI, d.harianLok);
  delete d.harianRtc; delete d.harianLok;
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
/** Parameter dalam `daftar` dibuang (params, fakta, driver) dan bagian hariannya (`kurangHarian`) dikurangkan dari total harian per kategori.
 *  Akun Area & Lokasi: PARAM_KHUSUS_RTC dan PARAM_SEMBUNYI_LOKASI. */
function buangParam_(d, daftar, kurangHarian) {
  const P = d.params || [], baru = [], ganti = P.map(p => daftar.indexOf(teks(p.key).toUpperCase()) >= 0 ? -1 : baru.push(p) - 1);
  if (kurangHarian && kurangHarian.length) {
    const kurang = {}; kurangHarian.forEach(r => { kurang[r.slice(0, 4).join('|')] = r; });
    d.harian = d.harian.map(h => { const r = kurang[h.slice(0, 4).join('|')]; return r ? [h[0], h[1], h[2], h[3], h[4] - r[4], h[5] - r[5], h[6] - r[6]] : h; })
      .filter(h => h[4] || h[5] || h[6]);
  }
  if (baru.length === P.length) return d;
  d.params = baru;
  d.fakta = d.fakta.filter(f => ganti[f[3]] >= 0).map(f => [f[0], f[1], f[2], ganti[f[3]], f[4]]);
  if (d.driver) ['all', 'area', 'lok'].forEach(k => { d.driver[k] = d.driver[k].filter(r => ganti[r[3]] >= 0).map(r => [r[0], r[1], r[2], ganti[r[3]], r[4], r[5]]); });
  return d;
}
function potongJson_(json, ses, awalan) {
  // Pusat: data utuh + info akun, tanpa parse/stringify ulang data yang besar
  if (ses.peran === 'PUSAT') return json.replace(/\}\s*$/, ',"akun":' + JSON.stringify({ nama: ses.nama, peran: ses.peran, area: ses.area || '', lok: ses.lok || '' }) + '}');
  const kunci = awalan + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, ses.peran + '|v2|' + (ses.area || '') + '|' + (ses.lok || ''))).slice(0, 16);
  const ada = ambilCache_(kunci);
  if (ada) return ada;
  const out = JSON.stringify(potongCakupan_(JSON.parse(json), ses));
  simpanCache_(out, kunci, 900);
  return out;
}

/** Menu: kolom Nama di sheet Akun diseragamkan: akun Lokasi = "Control Room <lokasi>", akun Area = "Command Center <Area>". Kolom lain tidak diubah. */
function seragamkanNamaAkun() {
  const sh = sheetAkun_(); if (!sh || sh.getLastRow() < 2) return 0;
  const judul = x => teks(x).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
  const rg = sh.getRange(2, 3, sh.getLastRow() - 1, 1), nama = rg.getValues();
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, AKUN_HDR.length).getValues();
  let n = 0;
  v.forEach((r, i) => {
    if (teks(r[0]).toLowerCase() === 'contoh.lokasi') return;
    const c = cakupanAkun_(r); if (!c) return;
    const baru = c.peran === 'LOKASI' ? 'Control Room ' + teks(r[5]).toUpperCase() : c.peran === 'AREA' ? 'Command Center ' + judul(c.area) : null;
    if (baru && teks(nama[i][0]) !== baru) { nama[i][0] = baru; n++; }
  });
  if (n) rg.setValues(nama);
  CacheService.getScriptCache().remove('LGLIST');
  Logger.log(n + ' nama akun diseragamkan.');
  return n;
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
/* ============================== LOG EXPORT ============================== */
const LOG_EKSPOR = 'Log Export';
const LOG_EKSPOR_HDR = ['ID_Log', 'Area', 'Lokasi', 'Jenis Laporan', 'Tanggal Data', 'Target Pelaporan', 'Realisasi Pelaporan'];
const TARGET_LAPOR_JAM = 7;   // Daily: H+1 pukul 07.00; Monthly: tanggal 1 bulan berikutnya pukul 07.00
/**
 * Dipanggil halaman setelah PDF diunduh: satu baris di spreadsheet "Log Export" (folder data), terbaru di paling atas.
 * o: { area, lokasi, jenis ('Daily' / 'Monthly' / 'Dashboard ...'), tanggalData ('yyyy-mm-dd' / 'yyyy-mm' / teks), waktuPdf (ISO) }
 */
function catatEkspor(token, o) {
  const ses = sesi_(token); o = o || {};
  const t = x => { const v = teks(x).slice(0, 200); return /^[=+\-@]/.test(v) ? "'" + v : v; };   // cegah teks dibaca sebagai rumus
  const area = t(o.area || ses.area || ''), lokasi = t(o.lokasi || ses.lok || ''), jenis = t(o.jenis);
  const d = teks(o.tanggalData).match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  let tgl = t(o.tanggalData), target = '', fmtTgl = '@';
  if (d && d[3]) { tgl = new Date(+d[1], +d[2] - 1, +d[3]); fmtTgl = 'dd/MM/yyyy'; if (jenis === 'Daily') target = new Date(+d[1], +d[2] - 1, +d[3] + 1, TARGET_LAPOR_JAM); }
  else if (d) { tgl = new Date(+d[1], +d[2] - 1, 1); fmtTgl = 'MMMM yyyy'; if (jenis === 'Monthly') target = new Date(+d[1], +d[2], 1, TARGET_LAPOR_JAM); }
  const w = o.waktuPdf ? new Date(o.waktuPdf) : null, realisasi = w && !isNaN(w) && Math.abs(w - Date.now()) < 864e5 * 400 ? w : new Date();
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const ss = bukaAtauBuat(DriveApp.getFolderById(CFG.FOLDER_ID), LOG_EKSPOR, [[LOG_EKSPOR, LOG_EKSPOR_HDR]]);
    let sh = ss.getSheetByName(LOG_EKSPOR);
    if (sh.getRange(1, 1, 1, LOG_EKSPOR_HDR.length).getValues()[0].join('|') !== LOG_EKSPOR_HDR.join('|')) {   // format kolom lama -> disimpan, buat sheet baru
      sh.setName(LOG_EKSPOR + ' (format lama)');
      sh = ss.insertSheet(LOG_EKSPOR, 0);
      sh.getRange(1, 1, 1, LOG_EKSPOR_HDR.length).setValues([LOG_EKSPOR_HDR]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#4a7a53');
      sh.setFrozenRows(1);
    }
    const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues() : [];
    const no = ids.reduce((m, r) => Math.max(m, +(teks(r[0]).match(/(\d+)$/) || [0, 0])[1]), 0) + 1;
    sh.insertRowAfter(1);
    sh.getRange(2, 1, 1, 7).setValues([['LOG-' + ('00000' + no).slice(-6), area, lokasi, jenis, tgl, target, realisasi]])
      .setFontWeight('normal').setFontColor('#000000').setBackground(null);
    sh.getRange(2, 5).setNumberFormat(fmtTgl);
    sh.getRange(2, 6, 1, 2).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  } finally { lock.releaseLock(); }
  return true;
}

/**
 * Menu: akun Lokasi yang menunjuk lokasi yang sama (ejaan lama / ALIAS_LOKASI, mis. FT PANGKAL BALAM & FT PANGKALAN BALAM)
 * dijadikan satu. Yang dipertahankan: baris yang Lokasi-nya sudah memakai nama sekarang; kolom Lokasi & Nama disamakan.
 */
function rapikanAkunGanda() {
  const sh = sheetAkun_(); if (!sh || sh.getLastRow() < 2) return;
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, AKUN_HDR.length).getValues(), grup = {};
  v.forEach((r, i) => {
    if (teks(r[3]).toUpperCase() !== 'LOKASI' || !teks(r[5])) return;
    (grup[kunciLok(r[5])] = grup[kunciLok(r[5])] || []).push(i);
  });
  const hapus = [], pesan = [];
  Object.keys(grup).forEach(k => {
    const ii = grup[k], lok = teks(v[ii[0]][5]).toUpperCase(), baku = ALIAS_LOKASI[lok] || lok;
    const simpan = ii.filter(i => teks(v[i][5]).toUpperCase() === baku)[0];
    const pakai = simpan !== undefined ? simpan : ii[0];
    if (teks(v[pakai][5]).toUpperCase() !== baku) { sh.getRange(pakai + 2, 6).setValue(baku); sh.getRange(pakai + 2, 3).setValue('Control Room ' + baku); }
    ii.filter(i => i !== pakai).forEach(i => { hapus.push(i); pesan.push(teks(v[i][0]) + ' -> ' + teks(v[pakai][0])); });
  });
  hapus.sort((a, b) => b - a).forEach(i => sh.deleteRow(i + 2));
  CacheService.getScriptCache().remove('LGLIST');
  const t = hapus.length ? hapus.length + ' akun ganda dihapus (dipakai akun sebelah kanan): ' + pesan.join(', ') : 'Tidak ada akun ganda.';
  try { SpreadsheetApp.getUi().alert(t); } catch (e) { Logger.log(t); }
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
 *   d = tanggal (0 = semua tanggal), s = shift (0 = semua, 1-3), h = jam (-1 = semua), d2 = tanggal akhir rentang (kosong = d saja).
 * Bentuknya sama dengan hitung_(): "bulan" 0 = jendela terpilih, 1 = pembanding (rentang sepanjang itu tepat sebelumnya, shift/jam yang sama);
 * kolom "tanggal" di harian berisi jam + 1, jadi harian = event per jam.
 */
function getDataWaktu(token, m, d, s, h, d2) {
  const ses = sesi_(token);
  return potongJson_(dataWaktu_(m, d, s, h, d2), ses, 'SW_' + versiData_() + '_' + [m, d, s, h, +d2 || 0].join('_') + '_');
}
function dataWaktu_(m, d, s, h, d2) {
  m = +m; d = +d || 0; s = +s || 0; h = (h === undefined || h === null || h === '') ? -1 : +h;
  d2 = d ? Math.max(d, +d2 || d) : 0;
  const L = d2 - d + 1, diJendela = t => t >= d && t <= d2, diPrev = t => t >= d - L && t < d;   // pembanding: L hari tepat sebelum rentang
  const kunci = 'WKT2_' + versiData_() + '_' + [m, d, s, h, d2].join('_');
  const kosongW = (pesan) => JSON.stringify(Object.assign(kosong([pesan]), { waktu: { m: m, d: d, d2: d2, s: s, h: h, adaPrev: false } }));
  const ada = ambilCache_(kunci);
  if (ada) return ada;
  const folder = DriveApp.getFolderById(CFG.FOLDER_ID), S = sumberBulan_(folder), src = S.perBulan[m] || [];
  if (!S.atur || !src.length) return kosongW('Data jam ' + BULAN[m] + ' belum ada.');
  const peta = bacaPemetaan(nilaiSheet(SpreadsheetApp.open(S.atur), 'Pemetaan') || []);
  const J = jamBulan_(folder, m, src, peta);   // Sum_Jam & Sum_AMT_Jam di file Summary bulan itu
  if (!J.EJ.length) return kosongW('Data jam ' + BULAN[m] + ' belum ada.');
  const okJam = j => (h < 0 || j === h) && (!s || diShift(j, s));
  // shift yang melewati tengah malam (Shift 3) ikut tanggal mulainya: jam 00.00-07.00 dihitung ke tanggal sebelumnya
  const jendela = (t0, j) => { if (!okJam(j)) return -1; const t = s && SHIFT[s][0] > SHIFT[s][1] && j < SHIFT[s][1] ? t0 - 1 : t0;
    if (!d) return t >= 1 ? 0 : -1; return diJendela(t) ? 0 : diPrev(t) ? 1 : -1; };
  // w: 0 = jendela terpilih, 1 = pembanding, 2 = event tanpa jam di tanggal terpilih (tidak bisa disaring per jam)
  const tanpa = !s && h < 0;   // hanya filter tanggal: event tanpa jam tetap dihitung
  const w = (t0, j) => { if (j >= 0) return jendela(t0, j); const x = !d ? 0 : diJendela(t0) ? 0 : diPrev(t0) ? 1 : -1; return x < 0 ? -1 : tanpa ? x : (x === 0 ? 2 : -1); };
  const kat = {}; peta.urut.forEach(o => { kat[o.p] = o.k; });
  const EV = [], AM = [];
  J.EJ.forEach(e => { const x = w(e[0], e[1]); if (x >= 0) EV.push([x, e[1] < 0 ? 0 : e[1] + 1, e[2], e[3], e[4], kat[e[4]], e[5]]); });
  J.AJ.forEach(r => { const x = w(r[0], r[1]); if (x >= 0) AM.push([x, r[2], r[3], r[4], r[5], kat[r[5]], r[6]]); });
  const hasil = hitung_(EV, AM, peta, [], []);
  hasil.waktu = { m: m, d: d, d2: d2, s: s, h: h, adaPrev: d > 1 };
  const json = JSON.stringify(hasil);
  simpanCache_(json, kunci, CFG.CACHE_DETIK);   // kunci ikut versi data: berganti setiap tarikan / summary baru
  return json;
}

/**
 * Event per tanggal satu bulan (0-11) untuk filter Event di dashboard: bentuknya sama dengan hitung_(), tetapi kolom "bulan"
 * di fakta berisi tanggal (1-31), jadi fakta = jumlah per tanggal x lokasi x parameter. Dipotong sesuai cakupan akun.
 */
function getDataEvent(token, m) {
  const ses = sesi_(token);
  return potongJson_(dataEventHarian_(m), ses, 'SE_' + versiData_() + '_' + (+m) + '_');
}
function dataEventHarian_(m) {
  m = +m;
  const kunci = 'EVH1_' + versiData_() + '_' + m, ada = ambilCache_(kunci);
  if (ada) return ada;
  const folder = DriveApp.getFolderById(CFG.FOLDER_ID), S = sumberBulan_(folder), src = S.perBulan[m] || [];
  if (!S.atur || !src.length) return JSON.stringify(kosong(['Data ' + BULAN[m] + ' belum ada.']));
  const peta = bacaPemetaan(nilaiSheet(SpreadsheetApp.open(S.atur), 'Pemetaan') || []);
  const kat = {}; peta.urut.forEach(o => { kat[o.p] = o.k; });
  const x = dataBulan_(folder, m, src, peta, {}, 0, true), EV = [];
  x.EV.forEach(e => { if (kat[e[3]] && kat[e[3]] !== 'LAIN') EV.push([e[0], e[0], e[1], e[2], e[3], kat[e[3]], e[4]]); });
  const hasil = hitung_(EV, [], peta, [], []);
  hasil.harian = []; hasil.harianRtc = []; hasil.harianLok = [];   // tidak dipakai: cukup fakta per tanggal
  hasil.bulan = m;
  const json = JSON.stringify(hasil);
  simpanCache_(json, kunci, CFG.CACHE_DETIK);
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
  let hasil = null;
  while (it.hasNext()) { const f = it.next(), t = teks(f.getName()).match(/^JAM\s+(\d{1,2})\b/i); if (t && +t[1] === m + 1) hasil = terbaru_(hasil, f); }
  return hasil;
}
function bacaJam_(f) {
  const b = f.getBlob().setContentType('application/x-gzip');
  return JSON.parse(Utilities.ungzip(b).getDataAsString('UTF-8'));
}
/* ============================== SHEET DATA KOSONG ============================== */
/** Menyamakan sheet Pemetaan dan Catatan dengan KASUS_WAJIB (Distraction Mengemudi dan Seat Belt kini dihitung) dan KASUS_TARIKAN. */
function sinkronPemetaan_(ss) {
  const sh = ss.getSheetByName('Pemetaan');
  let n = 0;
  if (sh && sh.getLastRow() > 1) {
    const v = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues(), ada = {};
    v.forEach((r, i) => { const c = normKasus(r[0]), w = KASUS_WAJIB[c]; if (!c) return; ada[c] = 1;
      if (w && (teks(r[1]) !== w[0] || teks(r[2]) !== w[1])) sh.getRange(i + 2, 2, 1, 2).setValues([w]); });
    // case wajib + case dari file tarikan (KASUS_TARIKAN) yang belum ada ditambahkan di bawah; baris yang sudah ada tidak diubah
    const baru = Object.keys(KASUS_WAJIB).filter(c => !ada[c]).map(c => [c].concat(KASUS_WAJIB[c]))
      .concat(Object.keys(KASUS_TARIKAN).filter(c => !ada[c] && !KASUS_WAJIB[c]).map(c => [c].concat(KASUS_TARIKAN[c])));
    let akhir = v.length; while (akhir > 0 && !teks(v[akhir - 1][0])) akhir--;   // baris terakhir kolom Case (kolom Area/Lokasi bisa lebih panjang)
    if (baru.length) sh.getRange(akhir + 2, 1, baru.length, 3).setValues(baru);
    n = baru.length;
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
  return n;
}
/** Menu: menambahkan case file tarikan yang belum ada ke sheet Pemetaan (SOS, HARSH ... ALARM, DRIVER ATTENTION HAS BEEN DISTRACTED, dll.). */
function lengkapiPemetaan() {
  const n = sinkronPemetaan_(SpreadsheetApp.open(fileAtur_()));
  const t = n ? n + ' case baru ditambahkan ke sheet Pemetaan.' : 'Sheet Pemetaan sudah lengkap.';
  try { SpreadsheetApp.getUi().alert(t); } catch (e) { Logger.log(t); }
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
      const j = JAM[m + '|' + ai], tarikan = !j && m >= BULAN_MULAI_TARIKAN;
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
  const S = sumberBulan_(folder), atur = S.atur, tarikan = S.tarikan, dataBulan = S.dataBulan;
  if (!atur) { peringatan.push('File "Pengaturan Dashboard" tidak ditemukan di folder data.'); return kosong(peringatan); }
  const ssA = SpreadsheetApp.open(atur);
  const peta = bacaPemetaan(nilaiSheet(ssA, 'Pemetaan') || []);
  const catatan = (nilaiSheet(ssA, 'Catatan') || []).map(r => teks(r[0])).filter(s => s);

  const EV = [], AM = [];   // EV: [bulan, tanggal, regional, lokasi, parameter, kategori, jumlah]; AM: [bulan, regional, lokasi, nama, parameter, kategori, jumlah]
  const belum = {}, kat = {}, jamAda = [], batasTulis = Date.now() + 3 * 60 * 1000;   // summary yang belum sempat ditulis dilanjutkan di jalan berikutnya
  let ditulis = 0;
  peta.urut.forEach(o => { kat[o.p] = o.k; });
  // per bulan dari file "Summary <nn> ..." (ditulis ulang dari file Data / Jam / Tarikan bila sumbernya berubah)
  Object.keys(S.perBulan).map(Number).sort((a, b) => a - b).forEach(m => {
    const x = dataBulan_(folder, m, S.perBulan[m], peta, belum, batasTulis);
    if (x.jam) jamAda.push(m);
    if (x.ditulis) ditulis++;
    // Summary juga memuat parameter khusus Laporan Harian (Camera Covering, Illegal Shutdown): tidak dihitung di dashboard
    x.EV.forEach(e => { if (kat[e[3]] && kat[e[3]] !== 'LAIN') EV.push([m, e[0], e[1], e[2], e[3], kat[e[3]], e[4]]); });
    x.AM.forEach(r => { if (kat[r[3]] && kat[r[3]] !== 'LAIN') AM.push([m, r[0], r[1], r[2], r[3], kat[r[3]], r[4]]); });
  });
  if (Object.keys(belum).length) peringatan.push('Case belum ada di Pemetaan (tidak dihitung): ' + Object.keys(belum).slice(0, 15).join(', '));
  if (!dataBulan.length) peringatan.push('Belum ada file "Data <nomor bulan> ..." atau "Tarikan <nomor bulan> ..." (Google Sheet) di folder data.');
  else if (!tarikan[BULAN_MULAI_TARIKAN]) peringatan.push('Data mulai ' + (+CFG.MULAI_TARIKAN.slice(8, 10)) + ' ' + BULAN[BULAN_MULAI_TARIKAN].charAt(0) + BULAN[BULAN_MULAI_TARIKAN].slice(1).toLowerCase() + ' dan seterusnya menunggu file tarikan selesai diproses. Pastikan layanan Drive API sudah ditambahkan, lalu jalankan menu Dashboard > Proses file tarikan sekarang.');
  const log = bacaLogTarikan(folder);
  if (log.proses) peringatan.push('Data sedang dalam proses update secara otomatis.');
  if (log.gagal.length) peringatan.push('File tarikan gagal dibaca: ' + log.gagal.slice(0, 5).join('; '));
  const hasil = hitung_(EV, AM, peta, catatan, peringatan);
  hasil.jamAda = jamAda;   // bulan yang punya jam kejadian -> filter Tanggal / Shift / Jam aktif
  if (ditulis) gantiVersiData_();   // cache filter waktu & Laporan Harian ikut summary baru
  return hasil;
}

function kosong(peringatan) {
  return { tahun: CFG.TAHUN, areas: AREAS, bulanAda: [], params: [], lok: [], fakta: [], harian: [], driver: null, catatan: [], peringatan: peringatan, updated: new Date().toISOString() };
}

function nilaiSheet(ss, nama) {
  const sh = ss.getSheets().filter(s => teks(s.getName()).toUpperCase() === nama.toUpperCase())[0];
  return sh ? sh.getDataRange().getValues() : null;
}

/* ============================== SUMMARY BULANAN ============================== */
/**
 * Satu Google Sheet per bulan di subfolder "Summary Bulanan": "Summary 10 Oktober 2026". Bahan baca utama dashboard:
 *   Sum_Bulanan : Jumlah Event per parameter dan per lokasi (rumus dari Sum_Harian).
 *   Sum_Harian  : Tanggal | Area | Lokasi | satu kolom per parameter           <- angka bulanan, per tanggal, per lokasi; Laporan Harian
 *   Sum_AMT     : Area | Lokasi | Nama AMT | satu kolom per parameter          <- Top Driver
 *   Sum_Jam     : Tanggal | Jam | Area | Lokasi | satu kolom per parameter     <- filter Tanggal / Shift / Jam (Jam kosong = event tanpa jam)
 *   Sum_AMT_Jam : Tanggal | Area | Lokasi | Rincian (jam, NAMA, PARAMETER=jumlah ... dipisah tab; satu baris per AMT per jam) <- Top Driver saat filter waktu
 *   Info        : sumber dan tanda sumber.
 * Diisi otomatis dari file sumber (Data / Jam / Tarikan) dan ditulis ulang setiap file sumber bulan itu atau sheet Pemetaan berubah.
 * Koreksi manual di Summary dipakai dashboard sampai summary ditulis ulang.
 */
const SUM_FOLDER = 'Summary Bulanan';
const SUM_TANDA = 'Tanda sumber (jangan diubah)';
const SUM_TANPA_LOKASI = '(TANPA LOKASI)';
/** Judul kolom di Summary -> parameter (huruf besar, sheet Pemetaan). Parameter lain yang ada di data ditambahkan di belakang dengan namanya sendiri. */
const SUM_KOLOM = [
  ['OVERSPEED', 'OVER SPEED'], ['HARSH CORNERING', 'HARSH TURN / CORNERING'], ['HARSH BRAKE', 'HARSH BRAKING'], ['HARSH ACCELERATION', 'HARSH ACCELERATION'],
  ['DRIVE > 4 HR', 'DRIVING > 4 HOURS'], ['BLACKZONE', 'BLACK ZONE'], ['IDLE', 'IDLING'], ['MENGGUNAKAN TELEPON', 'MENGGUNAKAN TELEPON'],
  ['MEROKOK', 'MEROKOK / VAPE'], ['DISTRACTION MENGEMUDI', 'DISTRACTION MENGEMUDI'], ['SEAT BELT DETECTION', 'SEAT BELT'], ['SOS', 'SOS'],
  ['FATIGUE', 'MICROSLEEP'], ['MENGUAP', 'MENGUAP'],
];

/** Pengaturan dan file sumber per bulan: file Data untuk tanggal sebelum mulai tarikan, file Tarikan sesudahnya (file ganda: yang terakhir diubah). */
function sumberBulan_(folder) {
  let atur = null; const lama = {}, tarikan = {};
  const it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) {
    const f = it.next(), n = teks(f.getName());
    if (/^PENGATURAN/i.test(n)) { atur = f; continue; }
    const t = n.match(/^(DATA|TARIKAN)\s+(\d{1,2})\b/i);
    if (t && +t[2] >= 1 && +t[2] <= 12) { const o = t[1].toUpperCase() === 'TARIKAN' ? tarikan : lama, m = +t[2] - 1; o[m] = terbaru_(o[m], f); }
  }
  const dataBulan = [], perBulan = {};
  for (let m = 0; m < 12; m++) {
    if (lama[m] && m <= BULAN_MULAI_TARIKAN) dataBulan.push({ m: m, f: lama[m], tarikan: false });
    if (tarikan[m] && m >= BULAN_MULAI_TARIKAN) dataBulan.push({ m: m, f: tarikan[m], tarikan: true });
  }
  dataBulan.forEach(o => (perBulan[o.m] = perBulan[o.m] || []).push(o));
  return { atur: atur, tarikan: tarikan, dataBulan: dataBulan, perBulan: perBulan };
}

/** File Summary bulan m beserta tanda sumber sekarang; segar = tandanya cocok (isinya boleh dipakai). */
function cariSummary_(folder, m, src, peta, buat) {
  const o = { tanda: tandaSumber_(src, peta), sf: folderSummary_(folder, buat), f: null, ss: null, info: {}, segar: false };
  if (o.sf) { const it = o.sf.getFilesByName(namaBulan_('Summary', m)); while (it.hasNext()) { const x = it.next(); if (x.getMimeType() === MimeType.GOOGLE_SHEETS) o.f = terbaru_(o.f, x); } }
  if (o.f) {
    o.ss = SpreadsheetApp.open(o.f);
    (nilaiSheet(o.ss, 'Info') || []).forEach(r => { o.info[teks(r[0])] = r[1]; });
    o.segar = teks(o.info[SUM_TANDA]) === o.tanda;
  }
  return o;
}

/**
 * Event & AMT satu bulan: dari file Summary bila tandanya cocok dengan sumber sekarang, selain itu dari file sumber
 * (lalu Summary ditulis ulang bila waktu < tulis, batas waktu dalam ms). EV: [tanggal, area, lokasi, parameter, jumlah];
 * AM: [area, lokasi, nama, parameter, jumlah]; jam: bulan ini punya data jam; ditulis: summary baru ditulis.
 * hanyaEvent: AMT tidak dibaca (Laporan Harian), summary tidak ditulis.
 */
function dataBulan_(folder, m, src, peta, belum, tulis, hanyaEvent) {
  const S = cariSummary_(folder, m, src, peta, !!tulis);
  if (S.segar) { const x = bacaSummary_(S.ss, peta, hanyaEvent); if (x) { x.jam = angka(S.info['Baris jam']) > 0; return x; } }
  const x = bacaSumberBulan_(src, peta, belum, hanyaEvent);
  if (tulis && !hanyaEvent && Date.now() < tulis) {
    const cache = CacheService.getScriptCache(), kunci = 'SUM_TULIS_' + m;   // dua proses tidak menulis summary yang sama bersamaan
    if (!cache.get(kunci)) {
      cache.put(kunci, '1', 600);
      try { const j = bacaJamSumber_(folder, m, src, peta); tulisSummary_(S.ss, S.sf, m, x, j, peta, src, S.tanda); x.jam = j.EJ.length > 0; x.ditulis = true; }
      catch (e) { Logger.log('Summary ' + namaBulan_('Summary', m) + ' gagal ditulis: ' + e.message); }
      finally { cache.remove(kunci); }
    }
  }
  if (x.jam === undefined) x.jam = adaJamSumber_(folder, m, src);
  return x;
}

/** Data per jam satu bulan untuk filter waktu: dari Summary bila segar, selain itu dari file sumber. EJ / AJ: lihat bacaJamSumber_. */
function jamBulan_(folder, m, src, peta) {
  const S = cariSummary_(folder, m, src, peta, false);
  return (S.segar && bacaJamSummary_(S.ss, peta)) || bacaJamSumber_(folder, m, src, peta);
}

/** true bila sumber bulan ini punya jam kejadian: file "Jam <nn> ..." (tanggal sebelum mulai tarikan) atau sheet Event Jam di file Tarikan. */
function adaJamSumber_(folder, m, src) {
  if (m <= BULAN_MULAI_TARIKAN && fileJam_(folder, m)) return true;
  return src.some(o => { if (!o.tarikan) return false; const sh = SpreadsheetApp.open(o.f).getSheetByName('Event Jam'); return sh && sh.getLastRow() > 1; });
}

/**
 * Event & AMT per tanggal x jam satu bulan dari file sumber: "Jam <nn> ....json.gz" untuk tanggal sebelum mulai tarikan, sheet Event Jam / AMT Jam
 * file Tarikan sesudahnya. EJ: [tanggal, jam (-1 = tanpa jam), area, lokasi, parameter, jumlah]; AJ: [tanggal, jam, area, lokasi, nama, parameter, jumlah].
 */
function bacaJamSumber_(folder, m, src, peta) {
  const EJ = [], AJ = [], kasus = c => { const x = peta.kasus[normKasus(c)]; return x && x.k !== 'LAIN' ? x.p : null; };
  const fJam = m <= BULAN_MULAI_TARIKAN ? fileJam_(folder, m) : null;
  if (fJam) {
    const J = bacaJam_(fJam), ks = J.kasus.map(kasus), area = J.area.map(areaNorm);
    Object.keys(J.d).forEach(t => {
      const tg = { m: m, d: +t }, blok = J.d[t], jam = x => +x === 99 ? -1 : +x;
      (blok.e ? blok.e.split(';') : []).forEach(x => { const v = x.split(','), p = ks[+v[3]], n = +v[4], a = area[+v[1]];
        if (p && n && !dariTarikan_(tg, a)) EJ.push([tg.d, jam(v[0]), a, J.lok[+v[2]], p, n]); });
      (blok.a ? blok.a.split(';') : []).forEach(x => { const v = x.split(','), p = ks[+v[4]], n = +v[5], a = area[+v[1]];
        const nm = namaAmt(J.nama[+v[3]]); if (p && n && nm && !dariTarikan_(tg, a)) AJ.push([tg.d, jam(v[0]), a, J.lok[+v[2]], nm, p, n]); });
    });
  }
  src.filter(o => o.tarikan).forEach(o => {
    const ss = SpreadsheetApp.open(o.f);
    (nilaiSheet(ss, 'Event Jam') || []).slice(1).forEach(r => {
      const tg = tanggalTeks(r[0]), p = kasus(r[4]), n = angka(r[5]) || 0;
      if (tg && tg.m === m && p && n && dariTarikan_(tg, r[2])) EJ.push([tg.d, +r[1], areaNorm(r[2]), teks(r[3]).toUpperCase(), p, n]);
    });
    (nilaiSheet(ss, 'AMT Jam') || []).slice(1).forEach(r => {
      const tg = tanggalTeks(r[0]), p = kasus(r[5]), n = angka(r[6]) || 0, nama = namaAmt(r[4]);
      if (tg && tg.m === m && p && n && nama && dariTarikan_(tg, r[2])) AJ.push([tg.d, +r[1], areaNorm(r[2]), teks(r[3]).toUpperCase(), nama, p, n]);
    });
  });
  return { EJ: EJ, AJ: AJ };
}

/** Baris Event & AMT satu bulan langsung dari file Data / Tarikan (aturan tanggal mulai tarikan per area seperti biasa). */
function bacaSumberBulan_(src, peta, belum, hanyaEvent) {
  const EV = [], AM = [], lh = kasusLH_(peta);
  src.forEach(o => {
    const ss = SpreadsheetApp.open(o.f), sumberOk = {};   // file Tarikan: AMT hanya dari sumber (file harian) yang event-nya dipakai
    (nilaiSheet(ss, 'Event') || []).slice(1).forEach(r => {
      const kc = normKasus(r[3]), c = peta.kasus[kc], n = angka(r[4]) || 0;
      if (!kc || !n) return;
      const tg = tanggalTeks(r[0]);
      if (!tg || tg.m !== o.m || dariTarikan_(tg, r[1]) !== o.tarikan) return;
      if (o.tarikan) sumberOk[teks(r[5])] = 1;
      if (!c && !KASUS_ABAIKAN[kc]) belum[kc] = 1;
      const p = c && c.k !== 'LAIN' ? c.p : lh[kc];   // case di luar dashboard tetap disimpan bila dipakai Laporan Harian
      if (p) EV.push([tg.d, areaNorm(r[1]), teks(r[2]).toUpperCase(), p, n]);
    });
    if (!hanyaEvent) (nilaiSheet(ss, 'AMT') || []).slice(1).filter(r => !o.tarikan || sumberOk[teks(r[5])]).forEach(r => {
      const c = peta.kasus[normKasus(r[3])], n = angka(r[4]) || 0, nama = namaAmt(r[2]);
      if (!c || c.k === 'LAIN' || !n || !nama) return;
      AM.push([areaNorm(r[0]), teks(r[1]).toUpperCase(), nama, c.p, n]);
    });
  });
  return { EV: EV, AM: AM };
}

/** Case -> parameter panel Laporan Harian (mis. CAMERA COVERING ALARM -> CAMERA COVERING), untuk case yang tidak dihitung di dashboard. */
function kasusLH_(peta) {
  const o = {};
  if (typeof LH_PANEL === 'undefined') return o;
  LH_PANEL.forEach(p => p.kasus.forEach(c => { o[c] = p.param[0]; }));
  Object.keys(peta.kasus).forEach(c => {   // lalu lewat parameter di sheet Pemetaan
    const P = teks(peta.kasus[c].p).toUpperCase();
    if (!o[c] && LH_PANEL.some(p => p.param.indexOf(P) >= 0)) o[c] = P;
  });
  return o;
}

/** Judul kolom Summary -> kunci parameter (sheet Pemetaan); judul yang tidak dikenal dipakai sebagai nama parameternya sendiri. */
function paramJudul_(peta) {
  const kunci = {}; peta.urut.forEach(o => { kunci[o.p.toUpperCase()] = o.p; });
  return h => { const u = teks(h).toUpperCase(); if (!u) return null; const s = SUM_KOLOM.filter(x => x[0] === u)[0], P = s ? s[1] : u; return kunci[P] || P; };
}
const lokSum_ = x => { const l = teks(x).toUpperCase(); return l === SUM_TANPA_LOKASI ? '' : l; };

/** Isi Sum_Harian & Sum_AMT; null bila sheet-nya tidak ada. */
function bacaSummary_(ss, peta, hanyaEvent) {
  const H = nilaiSheet(ss, 'Sum_Harian'), A = hanyaEvent ? [[]] : nilaiSheet(ss, 'Sum_AMT');
  if (!H || !A || !H.length || !A.length) return null;
  const pj = paramJudul_(peta), kol = (hdr, dari) => hdr.map((h, j) => j < dari ? null : pj(h));
  const EV = [], AM = [], kh = kol(H[0], 3), ka = kol(A[0], 3);
  H.slice(1).forEach(r => {
    const tg = tanggalTeks(r[0]); if (!tg) return;
    for (let j = 3; j < r.length; j++) { const n = kh[j] && angka(r[j]); if (n) EV.push([tg.d, areaNorm(r[1]), lokSum_(r[2]), kh[j], n]); }
  });
  A.slice(1).forEach(r => {
    const nama = namaAmt(r[2]); if (!nama) return;
    for (let j = 3; j < r.length; j++) { const n = ka[j] && angka(r[j]); if (n) AM.push([areaNorm(r[0]), lokSum_(r[1]), nama, ka[j], n]); }
  });
  return { EV: EV, AM: AM };
}

/** Isi Sum_Jam & Sum_AMT_Jam (format bacaJamSumber_); null bila sheet-nya tidak ada. */
function bacaJamSummary_(ss, peta) {
  const H = nilaiSheet(ss, 'Sum_Jam'), A = nilaiSheet(ss, 'Sum_AMT_Jam');
  if (!H || !A || !H.length || !A.length) return null;
  const pj = paramJudul_(peta), kh = H[0].map((h, j) => j < 4 ? null : pj(h)), EJ = [], AJ = [];
  const jam = x => teks(x) === '' || teks(x) === '-' ? -1 : +x;
  H.slice(1).forEach(r => {
    const tg = tanggalTeks(r[0]); if (!tg) return;
    for (let j = 4; j < r.length; j++) { const n = kh[j] && angka(r[j]); if (n) EJ.push([tg.d, jam(r[1]), areaNorm(r[2]), lokSum_(r[3]), kh[j], n]); }
  });
  A.slice(1).forEach(r => {
    const tg = tanggalTeks(r[0]); if (!tg) return;
    const a = areaNorm(r[1]), l = lokSum_(r[2]);
    teks(r[3]) && String(r[3]).split('\n').forEach(baris => {
      const v = baris.split('\t'); if (v.length < 3) return;
      const nama = namaAmt(v[1]); if (!nama) return;
      for (let i = 2; i < v.length; i++) { const k = v[i].lastIndexOf('='), p = k > 0 && pj(v[i].slice(0, k)), n = k > 0 && angka(v[i].slice(k + 1)); if (p && n) AJ.push([tg.d, jam(v[0]), a, l, nama, p, n]); }
    });
  });
  return { EJ: EJ, AJ: AJ };
}

/** Menulis (ulang) file Summary satu bulan. x: hasil bacaSumberBulan_, j: hasil bacaJamSumber_. */
function tulisSummary_(ss, sf, m, x, j, peta, src, tanda) {
  if (!ss) { ss = SpreadsheetApp.create(namaBulan_('Summary', m)); DriveApp.getFileById(ss.getId()).moveTo(sf); }
  // kolom parameter: urutan SUM_KOLOM, lalu parameter lain yang ada datanya (urutan sheet Pemetaan)
  const urutP = {}; peta.urut.forEach((o, i) => { urutP[o.p.toUpperCase()] = i; });
  const ada = {}; [[x.EV, 3], [x.AM, 3], [j.EJ, 4], [j.AJ, 5]].forEach(([L, i]) => L.forEach(r => { ada[r[i].toUpperCase()] = 1; }));
  const kol = SUM_KOLOM.concat(Object.keys(ada).filter(P => !SUM_KOLOM.some(s => s[1] === P)).sort((a, b) => (a in urutP ? urutP[a] : 999) - (b in urutP ? urutP[b] : 999) || (a < b ? -1 : 1)).map(P => [P, P]));
  const ci = {}; kol.forEach((k, i) => { ci[k[1]] = i; });
  const pivot = (rows, nk) => {   // nk kolom kunci, lalu parameter & jumlah
    const T = {};
    rows.forEach(r => {
      const k = r.slice(0, nk).join('\u0001'), t = T[k] || (T[k] = r.slice(0, nk).concat(kol.map(() => ''))), i = nk + ci[r[nk].toUpperCase()];
      t[i] = (t[i] || 0) + r[nk + 1];
    });
    return Object.keys(T).map(k => T[k]);
  };
  const tgl = d => CFG.TAHUN + '-' + ('0' + (m + 1)).slice(-2) + '-' + ('0' + d).slice(-2);
  const ai = a => { const i = AREAS.indexOf(a); return i < 0 ? 99 : i; };
  const banding = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const harian = pivot(x.EV.map(e => [tgl(e[0]), e[1], e[2] || SUM_TANPA_LOKASI, e[3], e[4]]), 3)
    .sort((a, b) => banding(a[0], b[0]) || ai(a[1]) - ai(b[1]) || banding(a[2], b[2]));
  const amt = pivot(x.AM.map(r => [r[0], r[1] || SUM_TANPA_LOKASI, r[2], r[3], r[4]]), 3)
    .sort((a, b) => ai(a[0]) - ai(b[0]) || banding(a[1], b[1]) || banding(a[2], b[2]));
  const jamK = h => h < 0 ? '' : h;
  const perJam = pivot(j.EJ.map(e => [tgl(e[0]), jamK(e[1]), e[2], e[3] || SUM_TANPA_LOKASI, e[4], e[5]]), 4)
    .sort((a, b) => banding(a[0], b[0]) || (a[1] === '' ? 99 : a[1]) - (b[1] === '' ? 99 : b[1]) || ai(a[2]) - ai(b[2]) || banding(a[3], b[3]));
  // Sum_AMT_Jam: satu sel per tanggal x area x lokasi, satu baris teks per AMT per jam (sel dipecah bila terlalu panjang)
  const G = {};
  j.AJ.forEach(r => {
    const g = tgl(r[0]) + '\u0001' + r[2] + '\u0001' + (r[3] || SUM_TANPA_LOKASI), k = (r[1] < 0 ? '-' : ('0' + r[1]).slice(-2)) + '\t' + r[4];
    const o = G[g] || (G[g] = {}), t = o[k] || (o[k] = {}); t[r[5].toUpperCase()] = (t[r[5].toUpperCase()] || 0) + r[6];
  });
  const amtJam = [];
  Object.keys(G).sort((a, b) => { const p = a.split('\u0001'), q = b.split('\u0001'); return banding(p[0], q[0]) || ai(p[1]) - ai(q[1]) || banding(p[2], q[2]); }).forEach(g => {
    const kunci = g.split('\u0001'), o = G[g];
    let isi = '';
    Object.keys(o).sort().forEach(k => {
      const b = k + '\t' + kol.filter(c => o[k][c[1]]).map(c => c[0] + '=' + o[k][c[1]]).join('\t');
      if (isi && isi.length + b.length > 40000) { amtJam.push(kunci.concat([isi])); isi = ''; }
      isi += (isi ? '\n' : '') + b;
    });
    if (isi) amtJam.push(kunci.concat([isi]));
  });

  const judul = kol.map(k => k[0]);
  const sheet = nama => { const sh = ss.getSheetByName(nama) || ss.insertSheet(nama); sh.getDataRange().breakApart(); sh.clear(); return sh; };
  const tabel = (sh, hdr, rows, garis) => {
    sh.getRange(1, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold').setBackground('#d9e7da');
    for (let i = 0; i < rows.length; i += 20000) sh.getRange(2 + i, 1, Math.min(20000, rows.length - i), hdr.length).setValues(rows.slice(i, i + 20000));
    if (garis) sh.getRange(1, 1, rows.length + 1, hdr.length).setBorder(true, true, true, true, true, true);
    sh.setFrozenRows(1);
  };
  const shH = sheet('Sum_Harian');
  shH.getRange(1, 1, harian.length + 1, 1).setNumberFormat('@');   // tanggal sebagai teks yyyy-mm-dd
  tabel(shH, ['Tanggal', 'Area', 'Lokasi'].concat(judul), harian, true);
  tabel(sheet('Sum_AMT'), ['Area', 'Lokasi', 'Nama AMT'].concat(judul), amt, true);
  const shJ = sheet('Sum_Jam');
  shJ.getRange(1, 1, perJam.length + 1, 1).setNumberFormat('@');
  tabel(shJ, ['Tanggal', 'Jam', 'Area', 'Lokasi'].concat(judul), perJam, false);
  const shAJ = sheet('Sum_AMT_Jam');
  shAJ.getRange(1, 1, amtJam.length + 1, 1).setNumberFormat('@');
  tabel(shAJ, ['Tanggal', 'Area', 'Lokasi', 'Rincian: jam, Nama AMT, PARAMETER=jumlah (dipisah tab; satu baris per AMT per jam; jam - = tanpa jam)'], amtJam, false);

  // Sum_Bulanan: susunan "Jumlah Event" dan "Jumlah Event di Setiap Lokasi", angka dari rumus ke Sum_Harian
  const shB = ss.getSheetByName('Sum_Bulanan') || ss.getSheets()[0].setName('Sum_Bulanan');
  shB.getDataRange().breakApart(); shB.clear();
  const huruf = n => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
  const nH = harian.length + 1, kolH = i => 'Sum_Harian!$' + huruf(4 + i) + '$2:$' + huruf(4 + i) + '$' + Math.max(2, nH);   // rentang terbatas, bukan satu kolom penuh: hitung ulang lebih ringan
  shB.getRange(2, 1, 1, 2).merge().setValue('Jumlah Event').setHorizontalAlignment('center').setFontWeight('bold');
  shB.getRange(3, 1, 1, 2).setValues([['Parameter Event', 'Jumlah']]).setFontWeight('bold');
  shB.getRange(4, 1, kol.length, 2).setFormulas(kol.map((k, i) => ['="' + k[0].replace(/"/g, '""') + '"', '=SUM(' + kolH(i) + ')']));
  shB.getRange(2, 1, kol.length + 2, 2).setBorder(true, true, true, true, true, true);
  const r0 = kol.length + 5, lokasi = [], lihat = {};
  harian.slice().sort((a, b) => ai(a[1]) - ai(b[1]) || banding(a[2], b[2])).forEach(r => { if (!lihat[r[2]]) { lihat[r[2]] = 1; lokasi.push(r[2]); } });
  shB.getRange(r0, 1, 1, kol.length + 1).setValues([['Jumlah Event di Setiap Lokasi'].concat(judul)]).setFontWeight('bold');
  if (lokasi.length) shB.getRange(r0 + 1, 1, lokasi.length, kol.length + 1).setFormulas(lokasi.map((l, i) =>
    ['="' + l.replace(/"/g, '""') + '"'].concat(kol.map((k, c) => '=SUMIFS(' + kolH(c) + ',Sum_Harian!$C$2:$C$' + Math.max(2, nH) + ',$A' + (r0 + 1 + i) + ')'))));
  shB.getRange(r0, 1, lokasi.length + 1, kol.length + 1).setBorder(true, true, true, true, true, true);
  shB.getRange(4, 2, kol.length, 1).setNumberFormat('#,##0;-#,##0;;@');
  if (lokasi.length) shB.getRange(r0 + 1, 2, lokasi.length, kol.length).setNumberFormat('#,##0;-#,##0;;@');   // 0 tampil kosong
  shB.autoResizeColumns(1, kol.length + 1);

  const shI = sheet('Info');
  shI.getRange(1, 1, 6, 2).setValues([
    ['Summary', BULAN[m].charAt(0) + BULAN[m].slice(1).toLowerCase() + ' ' + CFG.TAHUN],
    ['Sumber', src.map(o => o.f.getName()).join(' + ')],
    ['Diperbarui', new Date()],
    ['Catatan', 'Dibuat otomatis dari file sumber dan dibaca dashboard. Koreksi manual dipakai sampai file sumber bulan ini berubah (summary lalu ditulis ulang).'],
    ['Baris jam', perJam.length],
    [SUM_TANDA, tanda],
  ]);
  ss.getSheets().forEach((sh, i) => { const urut = ['Sum_Bulanan', 'Sum_Harian', 'Sum_AMT', 'Sum_Jam', 'Sum_AMT_Jam', 'Info'].indexOf(sh.getName()); if (urut >= 0 && urut !== i) { ss.setActiveSheet(sh); ss.moveActiveSheet(urut + 1); } });
  Logger.log('Summary ' + namaBulan_('Summary', m) + ': ' + harian.length + ' baris harian, ' + amt.length + ' baris AMT, ' + perJam.length + ' baris jam, ' + amtJam.length + ' baris AMT jam.');
}

/** Tanda sumber: berubah bila file sumber, sheet Pemetaan, atau tanggal mulai tarikan berubah. */
function tandaSumber_(src, peta) {
  const isi = [CFG.MULAI_TARIKAN, JSON.stringify(CFG.MULAI_TARIKAN_AREA || {}), JSON.stringify(peta.kasus)]
    .concat(src.map(o => o.f.getId() + '@' + o.f.getLastUpdated().getTime())).join('|');
  return 'v1-' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, isi, Utilities.Charset.UTF_8)).slice(0, 22);
}
/** Subfolder "Summary Bulanan" (dibuat bila buat = true). */
function folderSummary_(folder, buat) {
  const it = folder.getFoldersByName(SUM_FOLDER);
  return it.hasNext() ? it.next() : buat ? folder.createFolder(SUM_FOLDER) : null;
}
/** "Summary 10 Oktober 2026" untuk m = 9. */
function namaBulan_(awalan, m) { return awalan + ' ' + ('0' + (m + 1)).slice(-2) + ' ' + BULAN[m].charAt(0) + BULAN[m].slice(1).toLowerCase() + ' ' + CFG.TAHUN; }

/** Menu: menulis ulang semua file Summary dari file sumber (koreksi manual di Summary tertimpa), lalu memperbarui dashboard. */
function buatUlangSummary() {
  const sf = folderSummary_(DriveApp.getFolderById(CFG.FOLDER_ID), false), it = sf ? sf.getFilesByType(MimeType.GOOGLE_SHEETS) : null;
  while (it && it.hasNext()) {
    const sh = SpreadsheetApp.open(it.next()).getSheetByName('Info');
    if (sh) sh.getDataRange().getValues().forEach((r, i) => { if (teks(r[0]) === SUM_TANDA) sh.getRange(i + 1, 2).setValue(''); });
  }
  hapusCache();
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

/** Alarm yang memang bukan event dashboard: tidak dihitung dan tidak dimunculkan di peringatan. */
const KASUS_ABAIKAN = { 'PARKING': 1, 'MAX PARKING': 1 };

/** Pemetaan bawaan untuk teks "Alarm Status" di file tarikan; baris di sheet Pemetaan menimpa ini. */
const KASUS_TARIKAN = {
  'OVERSPEED INSTANT': ['Over Speed', 'Driving Behaviour'], 'OVER SPEED ALARM': ['Over Speed', 'Driving Behaviour'],
  'OVER DRIVING (4 HOURS)': ['Driving > 4 Hours', 'Driving Behaviour'], 'OVERDRIVING ALARM': ['Driving > 4 Hours', 'Driving Behaviour'],
  'BLACKZONE ALARM': ['Black Zone', 'Driver Discipline'], 'IDLE REPORT': ['Idling', 'Driver Discipline'],
  'DRIVER IS USING PHONE': ['Menggunakan Telepon', 'Driver Discipline'], 'DRIVER HAS BEEN SMOKING': ['Merokok / Vape', 'Driver Discipline'],
  'DRIVER HAS BEEN YAWNING': ['Menguap', 'Fatigue Management'],
  'MICRO SLEEP': ['Microsleep', 'Fatigue Management'], 'MICROSLEEP': ['Microsleep', 'Fatigue Management'], 'DRIVER FATIGUE': ['Microsleep', 'Fatigue Management'],
  'HARSH CORNERING ALARM': ['Harsh Turn / Cornering', 'Driving Behaviour'], 'HARSH TURN ALARM': ['Harsh Turn / Cornering', 'Driving Behaviour'],
  'HARSH BRAKING ALARM': ['Harsh Braking', 'Driving Behaviour'], 'HARSH BRAKE ALARM': ['Harsh Braking', 'Driving Behaviour'], 'HARSH BREAKING ALARM': ['Harsh Braking', 'Driving Behaviour'],
  'HARSH ACCELERATION ALARM': ['Harsh Acceleration', 'Driving Behaviour'],
  'DRIVER ATTENTION HAS BEEN DISTRACTED': ['Distraction Mengemudi', 'Driver Discipline'],
  'SOS': ['SOS', 'Driver Discipline'], 'SOS ALARM': ['SOS', 'Driver Discipline'],   // hanya tampil di akun RTC (PARAM_KHUSUS_RTC)
};
/** Event yang selalu dihitung, menimpa baris lama di sheet Pemetaan ("Parameter lain" / "Tidak dihitung"). */
const KASUS_WAJIB = {
  'DRIVER DISTRACTION': ['Distraction Mengemudi', 'Driver Discipline'],
  'SEAT BELT DETECTION': ['Seat Belt', 'Driver Discipline'], 'SEATBELT DETECTION': ['Seat Belt', 'Driver Discipline'],
  'DRIVER IS NOT USING SEAT-BELT': ['Seat Belt', 'Driver Discipline'],
};
/** Menyeragamkan teks Case: huruf besar; "Blackzone Alarm - <nama zona>" -> "BLACKZONE ALARM"; "Over Speed Alarm (62 Km/H)" -> "OVER SPEED ALARM"; "Harsh Cornering Alarm (0.08G)" -> "HARSH CORNERING ALARM". */
function normKasus(x) {
  let s = teks(x).toUpperCase();
  if (/^BLACK ?ZONE ALARM/.test(s)) return 'BLACKZONE ALARM';
  s = s.replace(/\s*\(\s*[\d.,]+\s*(?:KM\/H|G)?\s*\)\s*$/, '');   // nilai ukur di belakang: (62 Km/H), (0.08G)
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
  'FT PANGKAL BALAM': 'FT PANGKALAN BALAM', 'FT KOLONEDALE': 'FT KOLONODALE', 'FT SIANTAR': 'FT PEMATANG SIANTAR',
  'IT IT PONTIANAK': 'IT PONTIANAK', 'PONTIANAK': 'IT PONTIANAK', 'FT PONTIANAK': 'IT PONTIANAK',
  'SAMARINDA': 'FT SAMARINDA', 'IT SAMARINDA': 'FT SAMARINDA', 'BALIKPAPAN': 'IT BALIKPAPAN', 'BANJARMASIN': 'IT BANJARMASIN',
  'IT BADAS': 'FT BADAS', 'FT TENAU': 'IT TENAU', 'FT DONGGALA': 'IT DONGGALA',
  // tarikan memakai "TLPG ..." mulai September 2026; dashboard tetap memakai nama "LPG ..."
  'TLPG ARUN': 'LPG ARUN', 'TLPG BATAM': 'LPG BATAM', 'TLPG DUMAI': 'LPG DUMAI', 'TLPG KARIMUN': 'LPG KARIMUN',
  'TLPG PANGKALAN SUSU': 'LPG PANGKALAN SUSU', 'TLPG TANJUNG UBAN': 'LPG TANJUNG UBAN', 'TLPG TELUK KABUNG': 'LPG TELUK KABUNG',
  // ganti nama mulai September 2026 (nama lama hanya ada di data Januari-September)
  'FT LHOKSEUMAWE': 'IT LHOKSEUMAWE', 'FT JAYAPURA': 'IT JAYAPURA', 'JOBBER TANJUNG PANDAN': 'FT TANJUNG PANDAN',
};
function kunciLok(l) { const u = teks(l).toUpperCase(); return (ALIAS_LOKASI[u] || u).replace(/[^A-Z0-9]/g, ''); }
/** "Sumbagut 1" / "SUMBAGUT II" -> "SUMBAGUT"; nama area yang tidak dikenal -> '' (area diambil dari lokasinya). */
/** Dari dua file bernama sama (mis. "Data 10 ..." lama dan baru), yang terakhir diubah. */
function terbaru_(a, b) { return !a || b.getLastUpdated().getTime() > a.getLastUpdated().getTime() ? b : a; }
function areaNorm(x) {
  const s = teks(x).toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().replace(/^SUMBAGUT\s*(1|2|I|II)$/, 'SUMBAGUT');
  return AREAS.indexOf(s) >= 0 ? s : '';
}
function tanggalTeks(x) {
  if (x instanceof Date) return { m: x.getMonth(), d: x.getDate() };
  const t = teks(x).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return t ? { m: +t[2] - 1, d: +t[3] } : null;
}
/** Tanggal mulai tarikan (yyyy-mm-dd) untuk satu area: CFG.MULAI_TARIKAN_AREA bila ada, selain itu CFG.MULAI_TARIKAN. */
function mulaiTarikan_(area) { return (CFG.MULAI_TARIKAN_AREA || {})[areaNorm(area)] || CFG.MULAI_TARIKAN; }
/** true bila tanggal {m, d} area itu diambil dari file Tarikan (mulai mulaiTarikan_), false bila dari file Data / Jam. */
function dariTarikan_(tg, area) {
  const mt = mulaiTarikan_(area), m0 = +mt.slice(5, 7) - 1, d0 = +mt.slice(8, 10);
  return tg.m > m0 || (tg.m === m0 && tg.d >= d0);
}
const BULAN_MULAI_TARIKAN = Math.min.apply(null, [CFG.MULAI_TARIKAN].concat(Object.values(CFG.MULAI_TARIKAN_AREA || {})).map(t => +t.slice(5, 7) - 1));   // 0-11

/* ============================== TARIKAN HARIAN ============================== */
const BATAS_MS = 3 * 60 * 1000;     // file baru tidak dimulai lewat dari ini (Apps Script berhenti di 6 menit; satu file besar bisa 2 menit lebih)
const BATAS_CACHE_MS = 4 * 60 * 1000;   // lewat dari ini cache tidak dipanaskan di sini, diserahkan ke pemicu panaskanOtomatis tiap 15 menit
const LOG_NAMA = 'Log Tarikan';
const LOG_HDR = ['File ID', 'Nama file', 'Area', 'Tanggal', 'Diubah', 'Baris event', 'Diproses', 'Status', 'Lanjut dari'];   // Lanjut dari: file per 4 jam dibaca lagi mulai tanggal ini

/**
 * Membaca file tarikan harian baru/berubah dari folder-folder di spreadsheet "Tarikan Sistem",
 * merangkumnya per Tanggal x Area x Lokasi x Case, lalu menulisnya ke file "Tarikan <nn> <Bulan> <tahun>" di folder data.
 * Aman dijalankan berulang: file yang sudah diproses (dan tidak berubah) dilewati; sisa pekerjaan dilanjutkan di jalan berikutnya.
 */
function prosesTarikan() {
  const mulai = Date.now();
  // tanda "sedang berjalan" di cache, bukan kunci skrip: kunci skrip yang dipegang sampai 6 menit
  // membuat dashboard, input laporan, dan log export ikut menunggu
  const cache = CacheService.getScriptCache(), kunci = LockService.getScriptLock();
  if (!kunci.tryLock(5000)) return;
  try { if (cache.get('TARIKAN_JALAN')) return; cache.put('TARIKAN_JALAN', String(mulai), 7 * 60); }
  finally { kunci.releaseLock(); }
  try {
    try { bersihkanSementara_(); } catch (e) { /* dicoba lagi di jalan berikutnya */ }
    const folder = DriveApp.getFolderById(CFG.FOLDER_ID);
    const logSs = bukaAtauBuat(folder, LOG_NAMA, [[LOG_NAMA, LOG_HDR]]);
    const logSh = logSs.getSheetByName(LOG_NAMA);
    if (!teks(logSh.getRange(1, LOG_HDR.length).getValue())) logSh.getRange(1, LOG_HDR.length).setValue(LOG_HDR[LOG_HDR.length - 1]);
    let diimpor = 0;
    try { diimpor = imporTarikan_(folder, logSh, mulai); } catch (e) { Logger.log('Impor tarikan gagal: ' + e.message); }
    let logV = logSh.getDataRange().getValues(), dibuang = 0;
    const statusLog = {}; logV.slice(1).forEach(r => { statusLog[teks(r[0])] = teks(r[7]); });
    const daftar = daftarTarikan_(statusLog), ada = {};
    daftar.forEach(o => { ada[o.id] = 1; });
    // baris log file yang sudah tidak ada di folder (dihapus / diganti file baru / tanggal 29+ yang sekarang dari folder per 4 jam) dibuang,
    // begitu juga hasilnya di file Tarikan, supaya tidak terhitung dobel dan peringatan "gagal dibaca" lama tidak muncul terus
    if (daftar.length) for (let i = logV.length - 1; i >= 1; i--) if (!ada[teks(logV[i][0])]) { logSh.deleteRow(i + 1); dibuang++; }
    if (dibuang) try { buangSumberHilang_(folder, ada); } catch (e) { Logger.log('Membuang baris file lama gagal: ' + e.message); }
    logV = logSh.getDataRange().getValues();
    const sudah = {};
    const isoTgl_ = v => v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : teks(v).slice(0, 10);
    logV.slice(1).forEach((r, i) => { sudah[r[0]] = { baris: i + 2, diubah: Number(r[4]) || 0, status: teks(r[7]), lanjut: isoTgl_(r[8]) }; });

    // baru, berubah, gagal sebelumnya, atau file per 4 jam yang belum selesai terbaca
    const antre = daftar.filter(o => !sudah[o.id] || sudah[o.id].diubah !== o.diubah || /^(GAGAL|SEBAGIAN)/.test(sudah[o.id].status));
    // file yang pernah gagal diproses paling akhir, supaya tidak menahan file lain (file yang dibaca bertahap tidak ditunda)
    const gagal = o => sudah[o.id] && /^GAGAL/.test(sudah[o.id].status) ? 1 : 0;
    antre.sort((a, b) => gagal(a) - gagal(b) || (a.tgl < b.tgl ? -1 : a.tgl > b.tgl ? 1 : 0));
    let n = 0;
    for (const o of antre) {
      if (Date.now() - mulai > BATAS_MS) break;
      let status = 'OK', baris = 0, lanjut = sudah[o.id] ? sudah[o.id].lanjut : '';
      // ditandai dulu: kalau Apps Script menghentikan proses di tengah file ini, jalan berikutnya tahu file ini gagal
      const tanda = [o.id, o.nama, o.area, o.tgl, 0, 0, new Date(), 'GAGAL: waktu habis saat diproses, dicoba lagi otomatis'];
      if (sudah[o.id]) logSh.getRange(sudah[o.id].baris, 1, 1, tanda.length).setValues([tanda]);
      else { logSh.appendRow(tanda); sudah[o.id] = { baris: logSh.getLastRow(), diubah: 0, status: tanda[7] }; }
      SpreadsheetApp.flush();
      try {
        if (o.multi) {
          const h = prosesMulti_(folder, o, mulai + BATAS_MS, lanjut);
          baris = h.n; lanjut = h.sampai;
          if (!h.selesai) status = 'SEBAGIAN: terbaca s/d ' + h.sampai + ', dilanjutkan otomatis';
        } else baris = prosesSatuTarikan(folder, o, mulai + BATAS_MS);
      } catch (e) { status = 'GAGAL: ' + e.message; }
      const row = [o.id, o.nama, o.area, o.tgl, o.diubah, baris, new Date(), status, lanjut || ''];
      logSh.getRange(sudah[o.id].baris, 1, 1, row.length).setValues([row]);
      n++;
    }
    Logger.log('File tarikan diproses: ' + n + ' dari ' + antre.length + ' yang menunggu.');
    if (n || dibuang || diimpor) gantiVersiData_();
    if (n || diimpor) try { cekLokasiTanpaAkun(); } catch (e) { Logger.log('Cek lokasi tanpa akun gagal: ' + e.message); }
    if ((n || dibuang || diimpor) && Date.now() - mulai < BATAS_CACHE_MS) { try { panaskanCache(); } catch (e) { /* dicoba lagi oleh pemicu */ } }   // cache lama ditimpa, tidak dikosongkan dulu
  } finally { cache.remove('TARIKAN_JALAN'); }
}

/**
 * Semua file harian bertanggal >= mulai tarikan areanya (MULAI_TARIKAN / MULAI_TARIKAN_AREA) di folder yang terdaftar, termasuk subfolder sampai dua tingkat
 * (mis. "1. TARIKAN EVENT SISTEM RTC" > "10. OKTOBER 2026" > "1. Sumbagut 1" > "20 Oktober 2026.xlsx").
 * Nama file memuat tanggal: "Tarikan_<REG>_..._<yyyy-mm-dd>.xlsx" atau "20 Oktober 2026.xlsx".
 * Area = nama subfolder bila berupa nama area ("1. Sumbagut 1"), selain itu kolom Area di Tarikan Sistem.
 * Hasil: [{id, nama, area, tgl, diubah, mime, file}].
 */
function daftarTarikan_(statusLog) {
  const v = SpreadsheetApp.openById(CFG.TARIKAN_ID).getSheets()[0].getDataRange().getValues();
  const out = [], lihat = {};
  // folder per 4 jam dulu: area yang filenya sudah pernah terbaca OK tidak lagi mengambil tarikan harian mulai MULAI_4JAM
  const empat = daftar4Jam_(), tercakup = {};
  if (!statusLog) { const it = DriveApp.getFolderById(CFG.FOLDER_ID).getFilesByName(LOG_NAMA); statusLog = {};
    if (it.hasNext()) (nilaiSheet(SpreadsheetApp.open(it.next()), LOG_NAMA) || []).slice(1).forEach(r => { statusLog[teks(r[0])] = teks(r[7]); }); }
  empat.forEach(o => { lihat[o.id] = 1; out.push(o); if (/^(OK|SEBAGIAN)/.test(statusLog[o.id] || '')) tercakup[areaNorm(o.area)] = 1; });
  const baca = (folder, area, dalam) => {   // dalam = sisa tingkat subfolder yang dibaca
    const it = folder.getFiles();
    while (it.hasNext()) {
      const f = it.next(), nama = f.getName(), tgl = tanggalNama_(nama);
      if (!tgl || lihat[f.getId()] || +tgl.slice(0, 4) !== CFG.TAHUN || tgl < mulaiTarikan_(area)) continue;
      if (CFG.MULAI_4JAM && tgl >= CFG.MULAI_4JAM && tercakup[areaNorm(area)]) continue;   // sudah dari folder per 4 jam
      const mime = f.getMimeType();
      if (mime !== MimeType.MICROSOFT_EXCEL && mime !== MimeType.GOOGLE_SHEETS) continue;
      lihat[f.getId()] = 1;
      out.push({ id: f.getId(), nama: nama, area: area.toUpperCase(), tgl: tgl, diubah: f.getLastUpdated().getTime(), mime: mime, file: f });
    }
    if (dalam) { const sub = folder.getFolders(); while (sub.hasNext()) { const f = sub.next(), nm = teks(f.getName()).replace(/^\d+\s*[.)]\s*/, '').toUpperCase(); baca(f, areaNorm(nm) ? nm : area, dalam - 1); } }
  };
  v.forEach(r => {
    const area = teks(r[0]), link = teks(r[1]);
    const id = (link.match(/folders\/([-\w]{20,})/) || link.match(/[?&]id=([-\w]{20,})/) || [])[1];
    if (!area || !id || /^AREA$/i.test(area)) return;
    baca(DriveApp.getFolderById(id), area, 2);
  });
  return out;
}

/**
 * File di folder "4. Report Data alert Per 4 Jam" (CFG.ALERT4JAM_ID) dan subfolder regionalnya ("7. Malupa", "6. Sulawesi").
 * Satu file memuat banyak tanggal (mis. sebulan), jadi ditandai multi: barisnya dikelompokkan per tanggal dan hanya tanggal >= MULAI_4JAM yang dipakai.
 * Area = nama subfolder, selain itu awal nama file ("MALUPA_OKTOBER 2026.xlsx"). Tanggal di log = tanggal 1 bulan di nama file (atau MULAI_4JAM).
 */
function daftar4Jam_() {
  if (!CFG.ALERT4JAM_ID) return [];
  const out = [];
  const baca = (folder, area, dalam) => {
    const it = folder.getFiles();
    while (it.hasNext()) {
      const f = it.next(), nama = f.getName(), mime = f.getMimeType();
      if (mime !== MimeType.GOOGLE_SHEETS) continue;   // hanya Google Sheet; file Excel (.xlsx) di folder ini tidak dibaca
      const a = area || areaNorm(teks(nama).split(/[_\-]/)[0]);
      if (!a) continue;
      const bl = teks(nama).toUpperCase().match(/(JANUARI|FEBRUARI|MARET|APRIL|MEI|JUNI|JULI|AGUSTUS|SEPTEMBER|OKTOBER|NOVEMBER|DESEMBER)\s*(\d{4})/);
      const tgl = tanggalNama_(nama) || (bl ? bl[2] + '-' + ('0' + (BULAN.indexOf(bl[1]) + 1)).slice(-2) + '-01' : CFG.MULAI_4JAM);
      if (bl && +bl[2] !== CFG.TAHUN) continue;
      out.push({ id: f.getId(), nama: nama, area: a, tgl: tgl, diubah: f.getLastUpdated().getTime(), mime: mime, file: f, multi: true });
    }
    if (dalam) { const sub = folder.getFolders(); while (sub.hasNext()) { const f = sub.next(), nm = areaNorm(teks(f.getName()).replace(/^\d+\s*[.)]\s*/, '')); baca(f, nm || area, dalam - 1); } }
  };
  baca(DriveApp.getFolderById(CFG.ALERT4JAM_ID), '', 2);
  return out;
}

/**
 * Sheet "Lokasi Tanpa Akun" di file Pengaturan Dashboard: lokasi (kolom TBBM) di file Tarikan bulan ini yang belum punya akun LOKASI di sheet Akun.
 * Diperbarui setiap kali ada file tarikan / per 4 jam yang dibaca; bisa juga dijalankan langsung dari editor.
 */
function cekLokasiTanpaAkun() {
  const ss = SpreadsheetApp.open(fileAtur_()), akun = {};
  (nilaiSheet(ss, 'Akun') || []).slice(1).forEach(r => { const c = cakupanAkun_(r); if (c && c.peran === 'LOKASI' && teks(r[6]).toUpperCase() !== 'TIDAK') akun[kunciLok(c.lok)] = 1; });
  const sekarang = new Date(Date.now() + 7 * 36e5), m = sekarang.getUTCMonth() + 1, folder = DriveApp.getFolderById(CFG.FOLDER_ID);
  const it = folder.getFilesByName('Tarikan ' + ('0' + m).slice(-2) + ' ' + BULAN[m - 1].charAt(0) + BULAN[m - 1].slice(1).toLowerCase() + ' ' + CFG.TAHUN);
  const per = {};
  while (it.hasNext()) {
    const f = it.next(); if (f.getMimeType() !== MimeType.GOOGLE_SHEETS) continue;
    (nilaiSheet(SpreadsheetApp.open(f), 'Event') || []).slice(1).forEach(r => {
      const lok = teks(r[2]).toUpperCase(), area = areaNorm(r[1]) || teks(r[1]).toUpperCase(); if (!lok || akun[kunciLok(lok)]) return;
      const kk = area + '\u0001' + (ALIAS_LOKASI[lok] || lok), tg = teks(r[0]);
      const x = per[kk] = per[kk] || { n: 0, awal: tg, akhir: tg };
      x.n += Number(r[4]) || 0; if (tg < x.awal) x.awal = tg; if (tg > x.akhir) x.akhir = tg;
    });
  }
  const rows = Object.keys(per).sort().map(kk => { const p = kk.split('\u0001'), x = per[kk]; return [p[0], p[1], x.n, x.awal, x.akhir]; });
  let sh = ss.getSheetByName('Lokasi Tanpa Akun');
  if (!sh) sh = ss.insertSheet('Lokasi Tanpa Akun');
  sh.clearContents();
  sh.getRange(1, 1, 1, 5).setValues([['Area', 'Lokasi (TBBM)', 'Jumlah event', 'Tanggal pertama', 'Tanggal terakhir']]).setFontWeight('bold');
  sh.getRange('D:E').setNumberFormat('@');
  if (rows.length) sh.getRange(2, 1, rows.length, 5).setValues(rows);
  sh.getRange(rows.length + 3, 1).setValue('Diperbarui ' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'dd MMM yyyy HH.mm') + ' WIB dari file Tarikan bulan ini. Kosong = semua lokasi sudah punya akun.');
  return rows;
}

/** File tanpa baris yang dipakai: hasil lamanya di file Tarikan bulan file itu dibuang. */
function bersihkanSumber_(folder, o) {
  const ss = bukaTarikan_(folder, +o.tgl.slice(5, 7));
  Object.keys(HDR_TARIKAN).forEach(n => { const sh = ss.getSheetByName(n); if (sh) gantiBaris(sh, x => idSumber_(x) === o.id, []); });
}

/** Membuang baris di semua file "Tarikan <nn> ..." yang sumbernya (kolom terakhir = File ID) sudah tidak ada di daftar file. */
function buangSumberHilang_(folder, ada) {
  const it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) {
    const f = it.next(); if (!/^TARIKAN\s+\d{1,2}\b/i.test(teks(f.getName()))) continue;
    const ss = SpreadsheetApp.open(f);
    Object.keys(HDR_TARIKAN).forEach(n => {
      const sh = ss.getSheetByName(n); if (!sh || sh.getLastRow() < 2) return;
      const v = sh.getDataRange().getValues(), w = v[0].length, sisa = v.slice(1).filter(r => ada[idSumber_(r[w - 1])]);
      if (sisa.length === v.length - 1) return;
      sh.getRange(2, 1, v.length - 1, w).clearContent();
      if (sisa.length) sh.getRange(2, 1, sisa.length, w).setValues(sisa);
      Logger.log(f.getName() + ' / ' + n + ': ' + (v.length - 1 - sisa.length) + ' baris dari file yang sudah tidak dipakai dibuang.');
    });
  }
}

/**
 * Mengubah file xlsx menjadi Google Sheet sementara ("_tmp_<nama>") dan mengembalikan id-nya.
 * File besar kadang membuat Drive membalas "Internal Error" padahal konversinya selesai di belakang:
 * file sementara itu dicari dan dipakai; kalau tidak ada, dicoba lagi (maksimal 3 kali, selama waktu masih cukup).
 */
function konversiXlsx_(o, batas) {
  const nama = '_tmp_' + o.nama, blob = o.file.getBlob();
  let galat = null;
  for (let coba = 1; coba <= 3; coba++) {
    const mulai = Date.now() - 60 * 1000;
    try {
      return Drive.Files.create ? Drive.Files.create({ name: nama, mimeType: MimeType.GOOGLE_SHEETS }, blob).id
                                : Drive.Files.insert({ title: nama, mimeType: MimeType.GOOGLE_SHEETS }, blob, { convert: true }).id;
    } catch (e) { galat = e; }
    Utilities.sleep(5000 * coba);
    let pakai = null;
    const it = DriveApp.getFilesByName(nama);
    while (it.hasNext()) {
      const f = it.next();
      if (f.isTrashed()) continue;
      if (!pakai && f.getMimeType() === MimeType.GOOGLE_SHEETS && f.getDateCreated().getTime() >= mulai) pakai = f;
      else try { f.setTrashed(true); } catch (e) {}
    }
    if (pakai) return pakai.getId();
    if (Date.now() > batas) break;   // waktu tidak cukup untuk mencoba lagi; dilanjutkan di jalan berikutnya
  }
  throw galat;
}

/** Membuang Google Sheet sementara "_tmp_Tarikan_..." yang tertinggal (lebih dari 1 jam) dari konversi yang gagal. */
function bersihkanSementara_() {
  const batas = Date.now() - 60 * 60 * 1000;
  const it = DriveApp.searchFiles("title contains '_tmp_Tarikan' and trashed = false");
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf('_tmp_') === 0 && f.getDateCreated().getTime() < batas) try { f.setTrashed(true); } catch (e) {}
  }
}

/** Tanggal (yyyy-mm-dd) dari nama file: "..._2026-10-20.xlsx" atau "FU RTC 20 Oktober 2026.xlsx". */
function tanggalNama_(nama) {
  let t = nama.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (t) return t[1] + '-' + t[2] + '-' + t[3];
  t = nama.toUpperCase().match(/(\d{1,2})\s*(JANUARI|FEBRUARI|MARET|APRIL|MEI|JUNI|JULI|AGUSTUS|SEPTEMBER|OKTOBER|NOVEMBER|DESEMBER)\s*(\d{4})/);
  return t ? t[3] + '-' + ('0' + (BULAN.indexOf(t[2]) + 1)).slice(-2) + '-' + ('0' + t[1]).slice(-2) : null;
}

const HDR_TARIKAN = {
  'Event': ['Tanggal', 'Area', 'Lokasi', 'Case', 'Jumlah', 'Sumber'], 'AMT': ['Area', 'Lokasi', 'Nama AMT', 'Case', 'Jumlah', 'Sumber'],
  'Event Jam': ['Tanggal', 'Jam', 'Area', 'Lokasi', 'Case', 'Jumlah', 'Sumber'], 'AMT Jam': ['Tanggal', 'Jam', 'Area', 'Lokasi', 'Nama AMT', 'Case', 'Jumlah', 'Sumber'],
};
/** Google Sheet "Tarikan <nn> <Bulan> <tahun>" (bulan 1-12) di folder data; dibuat bila belum ada. */
function bukaTarikan_(folder, m) {
  const ss = bukaAtauBuat(folder, 'Tarikan ' + ('0' + m).slice(-2) + ' ' + BULAN[m - 1].charAt(0) + BULAN[m - 1].slice(1).toLowerCase() + ' ' + CFG.TAHUN,
    [['Event', HDR_TARIKAN['Event']], ['AMT', HDR_TARIKAN['AMT']]]);
  ss.getSheetByName('Event').getRange('A:A').setNumberFormat('@');   // tanggal disimpan sebagai teks yyyy-mm-dd
  return ss;
}

/**
 * File per 4 jam (o.multi): satu Google Sheet sebulan per area, ratusan ribu baris berurutan waktu, terus bertambah di bawah.
 * Dibaca bertahap supaya tidak kehabisan waktu:
 *   - baris pertama tanggal `lanjut` (atau mulai tarikan area) dicari dengan pencarian biner, tanpa membaca seluruh kolom;
 *   - dari situ dibaca per blok 25.000 baris sampai akhir file atau batas waktu;
 *   - hasil ditulis per tanggal (Sumber = "File ID#yyyy-mm-dd"); tanggal terakhir yang terpotong batas waktu tidak ditulis.
 * Jalan berikutnya cukup melanjutkan dari tanggal terakhir (`sampai`), karena baris baru selalu ditambahkan di bawah.
 * Hasil: { n: event yang ditulis, sampai: tanggal untuk dilanjutkan, selesai: true bila sampai akhir file }.
 */
function prosesMulti_(folder, o, batas, lanjut) {
  const sh = SpreadsheetApp.openById(o.id).getSheets()[0], akhir = sh.getLastRow();
  const awalMulti = [CFG.MULAI_4JAM || '', mulaiTarikan_(o.area)].sort()[1];
  // baris bertanggal setelah hari ini (jam perangkat salah) dilewati, supaya titik lanjut tidak melompati tanggal yang masih bertambah
  const hariIni = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
  if (lanjut > hariIni) lanjut = hariIni;
  const penuh = !lanjut || lanjut < awalMulti, mulai = penuh ? awalMulti : lanjut;   // penuh: belum pernah dibaca bertahap, hasil lama file ini dibuang semua
  const tglMs = t => { const x = new Date(t); return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2); };
  const ke = n => akhir < 2 ? null : n;
  const k = akhir < 1 ? {} : petaKolom(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
  const kol = hs => { for (const h of hs) if (k[h] !== undefined) return k[h]; return -1; };
  const cWk = kol(['TIME', 'START ALERT']), cTb = kol(['TBBM']), cAl = kol(['ALARM STATUS']), cAm = kol(['AMT 1']);
  const cG = kol(['ALERT GROUP ID', 'UNIQ CODE']), cPl = kol(['PLATE', 'IMEI']), jeda = (CFG.JEDA_GABUNG_DETIK || 0) * 1000;
  if (ke(1) !== null && (cWk < 0 || cTb < 0 || cAl < 0)) throw new Error('kolom Time / TBBM / Alarm Status tidak ditemukan');

  // baris pertama bertanggal >= mulai
  let dari = akhir + 1;
  if (akhir >= 2) {
    const tglBaris = b => { const t = waktuMs(sh.getRange(b, cWk + 1).getValue(), true); return t === null || t === undefined ? '' : tglMs(t); };
    const t0 = tglBaris(2), t1 = tglBaris(akhir);
    if (t0 && t1 && t0 <= t1) {
      let lo = 2, hi = akhir + 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (tglBaris(mid) >= mulai) hi = mid; else lo = mid + 1; }
      dari = lo;
    } else {   // tidak berurutan waktu: kolom waktu dibaca penuh (lambat, tapi tetap benar)
      const ms = sh.getRange(2, cWk + 1, akhir - 1, 1).getValues().map(r => waktuMs(r[0], true));
      const i = ms.findIndex(t => t !== null && t !== undefined && tglMs(t) >= mulai);
      dari = i < 0 ? akhir + 1 : i + 2;
    }
  }

  const BLOK = 25000, henti = Math.max(Date.now() + 60 * 1000, (batas || Date.now()) + 90 * 1000);
  const ev = {}, evj = {}, amt = {}, amj = {}, lihat = {}, akhirKp = {}, nTgl = {};
  let b = dari, selesai = true, tAkhir = '';
  while (b <= akhir) {
    if (Date.now() > henti) { selesai = false; break; }
    const m = Math.min(BLOK, akhir - b + 1), baca = c => c < 0 ? null : sh.getRange(b, c + 1, m, 1).getValues();
    const wk = baca(cWk), tb = baca(cTb), al = baca(cAl), am = baca(cAm), gid = baca(cG), pl = jeda ? baca(cPl) : null;
    for (let i = 0; i < m; i++) {
      const t = waktuMs(wk[i][0], true); if (t === null || t === undefined) continue;
      const tg = tglMs(t); if (tg < mulai || tg > hariIni || +tg.slice(0, 4) !== CFG.TAHUN) continue;
      if (tg > tAkhir) tAkhir = tg;
      const c = normKasus(al[i][0]); if (!c) continue;
      const g = gid ? teks(gid[i][0]) : '';
      if (g) { if (lihat[g]) continue; lihat[g] = 1; }   // baris dobel (Alert Group ID sama) dihitung sekali
      const kp = pl ? teks(pl[i][0]).toUpperCase() + '\u0001' + c : '';
      if (kp) { const s0 = akhirKp[kp]; akhirKp[kp] = t; if (s0 !== undefined && t - s0 <= jeda) continue; }
      const lok = teks(tb[i][0]).toUpperCase(), jam = jamDari(wk[i][0]), kc = lok + '\u0001' + c, kt = tg + '\u0001' + kc;
      ev[kt] = (ev[kt] || 0) + 1; nTgl[tg] = (nTgl[tg] || 0) + 1;
      if (jam !== null) { const kj = tg + '\u0001' + jam + '\u0001' + kc; evj[kj] = (evj[kj] || 0) + 1; }
      const nama = am ? namaAmt(am[i][0]) : '';
      if (nama) { const ka = lok + '\u0001' + nama + '\u0001' + c, kb = tg + '\u0001' + ka; amt[kb] = (amt[kb] || 0) + 1; if (jam !== null) { const kj = tg + '\u0001' + jam + '\u0001' + ka; amj[kj] = (amj[kj] || 0) + 1; } }
    }
    b += m;
  }
  // tanggal yang ditulis: semua bila sampai akhir file; bila terpotong waktu, tanggal terakhir yang terbaca belum lengkap dan menunggu jalan berikutnya
  const tulis = {}; Object.keys(nTgl).forEach(tg => { if (selesai || tg < tAkhir) tulis[tg] = 1; });
  const bulan = {}; Object.keys(tulis).forEach(tg => { bulan[+tg.slice(5, 7)] = 1; });
  if (penuh) { bulan[+o.tgl.slice(5, 7)] = 1; bulan[+mulai.slice(5, 7)] = 1; }
  if (selesai) tAkhir = tAkhir || mulai;
  const hapus = x => { const s0 = teks(x); if (idSumber_(s0) !== o.id) return false; if (penuh) return true; const tg = s0.split('#')[1] || ''; return !!tulis[tg] || (selesai && tg >= mulai); };
  Object.keys(bulan).forEach(mm => {
    const diBulan = x => +x.slice(5, 7) === +mm && tulis[x.slice(0, 10)], bagi = x => x.split('\u0001'), sb = tg => o.id + '#' + tg;
    const ss = bukaTarikan_(folder, +mm), hapusDi = x => hapus(x) && (teks(x).indexOf('#') < 0 || +teks(x).split('#')[1].slice(5, 7) === +mm);
    gantiBaris(ss.getSheetByName('Event'), hapusDi, Object.keys(ev).filter(diBulan).map(x => { const p = bagi(x); return [p[0], o.area, p[1], p[2], ev[x], sb(p[0])]; }));
    gantiBaris(sheetAtauBuat(ss, 'Event Jam', HDR_TARIKAN['Event Jam']), hapusDi,
      Object.keys(evj).filter(diBulan).map(x => { const p = bagi(x); return [p[0], +p[1], o.area, p[2], p[3], evj[x], sb(p[0])]; }));
    gantiBaris(sheetAtauBuat(ss, 'AMT Jam', HDR_TARIKAN['AMT Jam']), hapusDi,
      Object.keys(amj).filter(diBulan).map(x => { const p = bagi(x); return [p[0], +p[1], o.area, p[2], p[3], p[4], amj[x], sb(p[0])]; }));
    gantiBaris(ss.getSheetByName('AMT'), hapusDi, Object.keys(amt).filter(diBulan).map(x => { const p = bagi(x); return [o.area, p[1], p[2], p[3], amt[x], sb(p[0])]; }));
  });
  let n = 0; Object.keys(tulis).forEach(tg => { n += nTgl[tg]; });
  Logger.log(o.nama + ' (' + o.area + '): mulai ' + mulai + ' dari baris ' + dari + ' / ' + akhir + ', ' + n + ' event ditulis' + (selesai ? '' : ', berhenti di ' + tAkhir + ' (batas waktu)'));
  return { n: n, sampai: tAkhir, selesai: selesai };
}

/** Merangkum satu file tarikan dan menulis hasilnya (menggantikan hasil lama file yang sama). Mengembalikan jumlah baris event. */
function prosesSatuTarikan(folder, o, batas) {
  let ssId = o.id, sementara = null;
  if (o.mime === MimeType.MICROSOFT_EXCEL) {
    if (typeof Drive === 'undefined') throw new Error('layanan Drive API belum diaktifkan di Apps Script');
    sementara = konversiXlsx_(o, batas || Date.now() + BATAS_MS);
    ssId = sementara;
  }
  try {
    const sh = SpreadsheetApp.openById(ssId).getSheets()[0];
    const nr0 = sh.getLastRow() - 1, nc = sh.getLastColumn();
    if (nr0 < 1) return 0;
    const k = petaKolom(sh.getRange(1, 1, 1, nc).getValues()[0]);
    const kolDari = (h, dari) => { if (k[h] === undefined) return null; return sh.getRange(2 + dari, k[h] + 1, nr0 - dari, 1).getValues(); };
    // file per 4 jam (o.multi) memuat banyak tanggal: setiap baris ikut tanggalnya sendiri, hanya mulai MULAI_4JAM / mulai tarikan areanya
    const awalMulti = [CFG.MULAI_4JAM || '', mulaiTarikan_(o.area)].sort()[1];
    const tglMs = t => { const x = new Date(t); return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2); };
    // kolom waktu dibaca dulu; untuk file per 4 jam kolom lain hanya dibaca mulai baris pertama yang bertanggal >= awalMulti
    // (file sebulan bisa ratusan ribu baris, sebagian besar tanggal lama yang tidak dipakai)
    let wk = kolDari('TIME', 0) || kolDari('START ALERT', 0), ms = wk ? wk.map(r => waktuMs(r[0], o.multi)) : [], dari = 0;
    if (o.multi && wk) {
      dari = ms.findIndex(t => t !== null && t !== undefined && tglMs(t) >= awalMulti);
      if (dari < 0) dari = nr0;
      wk = wk.slice(dari); ms = ms.slice(dari);
    }
    const nr = nr0 - dari;
    if (nr < 1) { bersihkanSumber_(folder, o); return 0; }
    const kol = h => kolDari(h, dari);
    const tb = kol('TBBM'), al = kol('ALARM STATUS'), am = kol('AMT 1'), gid = kol('ALERT GROUP ID') || kol('UNIQ CODE');
    const pl = kol('PLATE') || kol('IMEI'), jeda = (CFG.JEDA_GABUNG_DETIK || 0) * 1000;
    if (!tb || !al) throw new Error('kolom TBBM / Alarm Status tidak ditemukan');
    const ev = {}, evj = {}, amt = {}, amj = {}, lihat = {}, akhir = {};
    // urut waktu supaya alert beruntun per nopol bisa digabung
    const urut = [];
    for (let i = 0; i < nr; i++) urut.push(i);
    if (jeda && pl && wk) urut.sort((a, b) => (ms[a] || 0) - (ms[b] || 0));
    // baris yang kolom Time-nya bukan tanggal file (mis. file "20 Oktober" ikut memuat baris 22 Oktober) dilewati:
    // baris itu milik file tanggalnya sendiri, jadi kalau ikut dihitung akan dobel
    let n = 0, diluar = 0;
    for (const i of urut) {
      const c = normKasus(al[i][0]); if (!c) continue;
      let tg = o.tgl;
      if (o.multi) {
        if (ms[i] === null || ms[i] === undefined) { diluar++; continue; }
        tg = tglMs(ms[i]);
        if (tg < awalMulti || +tg.slice(0, 4) !== CFG.TAHUN) { diluar++; continue; }
      } else if (wk && ms[i] !== null && ms[i] !== undefined && tglMs(ms[i]) !== o.tgl) { diluar++; continue; }
      const g = gid ? teks(gid[i][0]) : '';
      if (g) { if (lihat[g]) continue; lihat[g] = 1; }   // baris dobel (Alert Group ID sama) dihitung sekali
      // alert yang sama dari kendaraan yang sama berulang tiap 1-10 detik (mis. Yawning) = satu kejadian
      const kp = pl ? teks(pl[i][0]).toUpperCase() + '\u0001' + c : '', t = ms[i];
      if (jeda && kp && t !== null && t !== undefined) { const s = akhir[kp]; akhir[kp] = t; if (s !== undefined && t - s <= jeda) continue; }
      const lok = teks(tb[i][0]).toUpperCase();
      const jam = wk ? jamDari(wk[i][0]) : null, ke = lok + '\u0001' + c, kt = tg + '\u0001' + ke;
      ev[kt] = (ev[kt] || 0) + 1; n++;
      if (jam !== null) { const kj = tg + '\u0001' + jam + '\u0001' + ke; evj[kj] = (evj[kj] || 0) + 1; }
      const nama = am ? namaAmt(am[i][0]) : '';
      if (nama) { const ka = lok + '\u0001' + nama + '\u0001' + c, kb = tg.slice(0, 7) + '\u0001' + ka; amt[kb] = (amt[kb] || 0) + 1; if (jam !== null) { const kj = tg + '\u0001' + jam + '\u0001' + ka; amj[kj] = (amj[kj] || 0) + 1; } }
    }
    if (diluar) Logger.log(o.nama + ' (' + o.area + '): ' + diluar + ' baris ' + (o.multi ? 'sebelum ' + awalMulti + ' / tanpa waktu' : 'bertanggal lain') + ' dilewati.');
    // ditulis ke file Tarikan bulan masing-masing; file per 4 jam yang belum punya baris >= MULAI_4JAM tetap membersihkan hasil lamanya di bulan file itu
    const bulan = {}; bulan[+o.tgl.slice(5, 7)] = 1;
    Object.keys(ev).forEach(x => { bulan[+x.slice(5, 7)] = 1; });
    Object.keys(bulan).forEach(m => {
      const diBulan = x => +x.slice(5, 7) === +m, bagi = x => x.split('\u0001');
      const ss = bukaTarikan_(folder, +m);
      gantiBaris(ss.getSheetByName('Event'), o.id, Object.keys(ev).filter(diBulan).map(x => { const p = bagi(x); return [p[0], o.area, p[1], p[2], ev[x], o.id]; }));
      gantiBaris(sheetAtauBuat(ss, 'Event Jam', HDR_TARIKAN['Event Jam']), o.id,
        Object.keys(evj).filter(diBulan).map(x => { const p = bagi(x); return [p[0], +p[1], o.area, p[2], p[3], evj[x], o.id]; }));
      gantiBaris(sheetAtauBuat(ss, 'AMT Jam', HDR_TARIKAN['AMT Jam']), o.id,
        Object.keys(amj).filter(diBulan).map(x => { const p = bagi(x); return [p[0], +p[1], o.area, p[2], p[3], p[4], amj[x], o.id]; }));
      gantiBaris(ss.getSheetByName('AMT'), o.id, Object.keys(amt).filter(diBulan).map(x => { const p = bagi(x); return [o.area, p[1], p[2], p[3], amt[x], o.id]; }));
    });
    return n;
  } finally {
    if (sementara) try { DriveApp.getFileById(sementara).setTrashed(true); } catch (e) { /* abaikan */ }
  }
}

/**
 * File "Impor Tarikan ..." (.xlsx atau Google Sheet) di folder data: rangkuman file harian yang sudah dihitung di luar Apps Script
 * (tools/impor_tarikan.js, dengan prosesSatuTarikan yang sama), supaya banyak file tidak perlu menunggu pemicu 15 menit satu per satu.
 * Sheet Event / AMT / Event Jam / AMT Jam (format sama dengan file Tarikan) + Log (File ID, Nama file, Area, Tanggal, Diubah, Baris event).
 * Hasilnya menggantikan baris file yang sama di "Tarikan <nn> ...", Log Tarikan ditandai OK supaya file itu tidak diproses lagi,
 * lalu file impor dipindah ke subfolder "xlsx asli" dengan awalan "Sudah diimpor - ".
 */
function imporTarikan_(folder, logSh, mulai) {
  const it = folder.getFiles(), daftar = [];
  while (it.hasNext()) { const f = it.next(); if (/^IMPOR TARIKAN/i.test(teks(f.getName())) && !f.isTrashed()) daftar.push(f); }
  const arsip = () => folder.getFoldersByName('xlsx asli').hasNext() ? folder.getFoldersByName('xlsx asli').next() : folder.createFolder('xlsx asli');
  let n = 0;
  for (const f of daftar) {
    if (Date.now() - mulai > BATAS_MS) break;
    let sementara = null;
    try {
      if (f.getMimeType() === MimeType.MICROSOFT_EXCEL) {
        if (typeof Drive === 'undefined') throw new Error('layanan Drive API belum diaktifkan di Apps Script');
        sementara = konversiXlsx_({ nama: f.getName(), file: f }, mulai + BATAS_MS);
      } else if (f.getMimeType() !== MimeType.GOOGLE_SHEETS) continue;
      const src = SpreadsheetApp.openById(sementara || f.getId());
      const tglTeks = x => x instanceof Date ? Utilities.formatDate(x, Session.getScriptTimeZone(), 'yyyy-MM-dd') : teks(x);
      const log = (nilaiSheet(src, 'Log') || []).slice(1).filter(r => teks(r[0]));
      if (!log.length) throw new Error('sheet Log kosong');
      const ids = {}; log.forEach(r => { ids[teks(r[0])] = 1; });
      const bulan = {}; log.forEach(r => { bulan[+tglTeks(r[3]).slice(5, 7)] = 1; });
      Object.keys(bulan).forEach(m => {
        const ss = bukaTarikan_(folder, +m);
        Object.keys(HDR_TARIKAN).forEach(nama => {
          const hdr = HDR_TARIKAN[nama], w = hdr.length, adaTgl = hdr[0] === 'Tanggal';
          const baru = (nilaiSheet(src, nama) || []).slice(1).filter(r => teks(r[w - 1]) && (!adaTgl || +tglTeks(r[0]).slice(5, 7) === +m))
            .map(r => { const x = r.slice(0, w); if (adaTgl) x[0] = tglTeks(x[0]); x[w - 1] = teks(x[w - 1]); return x; });
          const sh = sheetAtauBuat(ss, nama, hdr), v = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, w).getValues() : [];
          const sisa = v.filter(r => !ids[teks(r[w - 1])]);
          if (sisa.length < v.length) {   // sebagian file sudah pernah diproses: tulis ulang tanpa baris lamanya
            sh.getRange(2, 1, v.length, w).clearContent();
            if (sisa.length) sh.getRange(2, 1, sisa.length, w).setValues(sisa);
          }
          if (baru.length) sh.getRange(sisa.length + 2, 1, baru.length, w).setValues(baru);
        });
      });
      // Log Tarikan: baris file yang sama diganti, file baru ditambahkan
      const lv = logSh.getDataRange().getValues(), baris = {};
      lv.forEach((r, i) => { if (i) baris[teks(r[0])] = i; });
      const tambah = [];
      log.forEach(r => {
        const row = [teks(r[0]), teks(r[1]), teks(r[2]), tglTeks(r[3]), Number(r[4]) || 0, Number(r[5]) || 0, new Date(), 'OK (impor)'];
        if (baris[row[0]] !== undefined) lv[baris[row[0]]] = row; else tambah.push(row);
      });
      const semua = lv.slice(1).map(r => r.slice(0, LOG_HDR.length)).concat(tambah);
      if (semua.length) logSh.getRange(2, 1, semua.length, LOG_HDR.length).setValues(semua);
      f.setName('Sudah diimpor - ' + f.getName()); f.moveTo(arsip());
      n += log.length;
      Logger.log('Impor tarikan: ' + f.getName() + ', ' + log.length + ' file harian.');
    } catch (e) {
      Logger.log('Impor tarikan ' + f.getName() + ' gagal: ' + e.message);
    } finally {
      if (sementara) try { DriveApp.getFileById(sementara).setTrashed(true); } catch (e) { /* abaikan */ }
    }
  }
  return n;
}

/** Waktu (ms) dari kolom Time: nilai tanggal-jam Sheets atau teks "yyyy-mm-dd hh:mm:ss"; null bila tidak terbaca. */
function waktuMs(x, bulanDulu) {
  if (x instanceof Date) return x.getTime();
  const t = teks(x).match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (t) return new Date(+t[1], +t[2] - 1, +t[3], +t[4], +t[5], +(t[6] || 0)).getTime();
  // file per 4 jam: teks "10/29/2026 13:05" / "10/29/26 13:05" (bulan/tanggal/tahun) bila kolom Time tidak terbaca sebagai tanggal
  const u = bulanDulu && teks(x).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return u ? new Date(+u[3] < 100 ? 2000 + +u[3] : +u[3], +u[1] - 1, +u[2], +u[4], +u[5], +(u[6] || 0)).getTime() : null;
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
function BACA_ULANG_SUMBAGUT_OKTOBER() { bacaUlangTarikan('SUMBAGUT', 10); }

function namaAmt(x) {
  const s = teks(x).replace(/\s*[\[(].*?[\])]\s*/g, ' ').replace(/[\[(].*$/, '')
    .replace(/^[\s.,'`|&\/\-]+|[\s.,'`|&\/\-]+$/g, '').replace(/\s+/g, ' ').toUpperCase();
  return bukanNamaAmt_(s) ? '' : s;
}
/** "0", "0.0", "-", "N/A", satu huruf, nomor polisi (B 9577 SEI), "CONTOH 1", "TV6" dll. bukan nama Driver. */
function bukanNamaAmt_(s) {
  return s.replace(/[^A-Z]/g, '').length < 2
    || /^(NAN|NULL|NONE|N ?\/ ?A|#N\/A|NA|TIDAK ADA|KOSONG|UNKNOWN|NO NAME|NONAME|DRIVER|AMT ?\d*|SUPIR|SOPIR|TV ?\d*|CONTOH\b.*|TEST\b.*)$/.test(s)
    || /^[A-Z]{1,2} ?\d{1,4} ?[A-Z]{0,3}$/.test(s);
}

/** Kolom Sumber berisi File ID, atau "File ID#yyyy-mm-dd" untuk file per 4 jam (ditulis per tanggal). */
const idSumber_ = x => teks(x).split('#')[0];

/** Mengganti semua baris milik satu file sumber (kolom terakhir = File ID, atau fungsi pencocok nilai kolom itu) dengan baris baru. */
function gantiBaris(sh, sumber, baru) {
  const cocok = typeof sumber === 'function' ? sumber : x => x === sumber;
  // cepat: hanya kolom sumber yang dibaca; baris file ini biasanya satu blok (selalu ditulis di bawah), jadi cukup blok itu yang dihapus
  const n = sh.getLastRow() - 1, w0 = sh.getLastColumn(), idx = [];
  if (n > 0) sh.getRange(2, w0, n, 1).getValues().forEach((r, i) => { if (cocok(r[0])) idx.push(i); });
  if (!idx.length || (idx[idx.length - 1] - idx[0] + 1 === idx.length && idx.length < n)) {
    if (idx.length) sh.deleteRows(idx[0] + 2, idx.length);
    if (baru.length) sh.getRange(sh.getLastRow() + 1, 1, baru.length, baru[0].length).setValues(baru);
    return;
  }
  const v = sh.getDataRange().getValues(), w = v[0].length;
  const sisa = v.slice(1).filter(r => !cocok(r[w - 1])).concat(baru);
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
  const it = folder.getFilesByName(LOG_NAMA), out = { gagal: [], proses: 0 };   // proses = file yang kehabisan waktu dan dicoba lagi otomatis
  if (!it.hasNext()) return out;
  const v = nilaiSheet(SpreadsheetApp.open(it.next()), LOG_NAMA) || [];
  v.slice(1).forEach(r => { const st = teks(r[7]);
    if (/^SEBAGIAN/.test(st)) { out.proses++; return; }
    if (!/^GAGAL/.test(st)) return;
    if (/waktu habis/i.test(st)) out.proses++; else out.gagal.push(teks(r[1]) + ' (' + st.slice(7, 80) + ')'); });
  return out;
}

/* ============================== HITUNG ============================== */
/**
 * Hasil untuk dashboard berupa tabel fakta ringkas; dashboard menjumlahkannya sesuai filter Area / Lokasi.
 *   lok    : [[nama lokasi, indeks area]]
 *   fakta  : [[bulan, indeks area, indeks lokasi, indeks parameter, jumlah]]
 *   harian : [[bulan, tanggal, indeks area, indeks lokasi, DB, DD, FM]]
 *   driver : { all, area, lok, nama } -> [[bulan, indeks area, indeks lokasi, indeks parameter, indeks nama, jumlah]]
 *            5 Driver teratas per bulan x parameter, untuk semua area, per area, dan per lokasi (kolom AMT 1).
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
  const F = {}, H = {}, HR = {}, HL = {}, KI = { DB: 4, DD: 5, FM: 6 };
  const khusus = params.map(p => PARAM_KHUSUS_RTC.indexOf(p.key.toUpperCase()) >= 0);
  const sembunyiLok = params.map(p => PARAM_SEMBUNYI_LOKASI.indexOf(p.key.toUpperCase()) >= 0);
  let tanpaArea = 0;
  EV.forEach(e => {
    const m = e[0], pi = pIdx[e[4]], n = e[6];
    if (pi === undefined) return;
    const l = namaLok(e[3]), a = areaLok(e[3]) || e[2];
    if (!a) { tanpaArea += n; return; }
    const ai = AREAS.indexOf(a), L = li(l, ai);
    const fk = m + '|' + L + '|' + pi; (F[fk] || (F[fk] = [m, ai, L, pi, 0]))[4] += n;
    const hk = m + '|' + e[1] + '|' + L; (H[hk] || (H[hk] = [m, e[1], ai, L, 0, 0, 0]))[KI[params[pi].kat]] += n;
    if (khusus[pi]) (HR[hk] || (HR[hk] = [m, e[1], ai, L, 0, 0, 0]))[KI[params[pi].kat]] += n;   // bagian khusus RTC, dikurangkan untuk akun lain
    if (sembunyiLok[pi]) (HL[hk] || (HL[hk] = [m, e[1], ai, L, 0, 0, 0]))[KI[params[pi].kat]] += n;   // dikurangkan untuk akun Area & Lokasi
  });
  if (tanpaArea) catatan.push('Data: ' + tanpaArea + ' event tanpa Area dan Lokasi yang jelas tidak dihitung.');

  // Driver: jumlah per bulan x lokasi x parameter x nama, lalu 5 teratas per parameter
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
    Object.keys(K).forEach(g => K[g].sort((a, b) => b.n - a.n || (a.nama < b.nama ? -1 : a.nama > b.nama ? 1 : 0)).slice(0, 5)
      .forEach(o => out.push([o.m, terbesar(o.areaT), terbesar(o.lokT), o.p, ni(o.nama), o.n])));
    return out;
  };
  const driver = xr.length ? { all: top10(o => o.m), area: top10(o => o.m + '|' + o.a), lok: top10(o => o.m + '|' + o.l), nama: nama } : null;

  return {
    tahun: CFG.TAHUN, areas: AREAS, bulanAda: bulanAda, params: params, lok: lok,
    fakta: Object.keys(F).map(k => F[k]), harian: Object.keys(H).map(k => H[k]), driver: driver,
    harianRtc: Object.keys(HR).map(k => HR[k]), harianLok: Object.keys(HL).map(k => HL[k]),
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


