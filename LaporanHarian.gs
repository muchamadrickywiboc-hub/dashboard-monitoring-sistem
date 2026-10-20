/**
 * LAPORAN HARIAN OPERASIONAL GPS & DASHCAM (Lampiran 3A)
 *
 * Halaman kedua di web app yang sama: <url web app>?laporan=harian (lihat doGet di Kode.gs).
 * Memakai akun, sheet Pemetaan, dan folder data yang sama dengan dashboard bulanan (tidak perlu unggah dua kali):
 *   - Event per tanggal & lokasi dibaca dari sheet "Event" file "Tarikan <nn> ..." (mulai CFG.BULAN_TARIKAN)
 *     atau "Data <nn> ..." (bulan sebelumnya).
 *   - GPS / Dashcam / RTC (terpasang & online) diisi lewat form Input Harian di halaman ini, disimpan di
 *     spreadsheet LH.INPUT_NAMA di folder data (dibuat otomatis). Nanti bisa diganti pembacaan otomatis.
 *   - Logo: file gambar di folder data yang namanya diawali "Logo" (mis. "Logo Pertamina Patra Niaga.png").
 *     Tanpa file itu dipakai logo bawaan di HalamanHarian.html.
 * Camera Covering dan Illegal Shutdown tetap dihitung di laporan ini walau di sheet Pemetaan ditandai "tidak dihitung".
 */
const LH = {
  INPUT_NAMA: 'Input Harian GPS Dashcam RTC',
  INPUT_HDR: ['Tanggal', 'Area', 'Lokasi', 'GPS Terpasang', 'GPS Online', 'Dashcam Terpasang', 'Dashcam Online', 'RTC Jumlah', 'RTC Online',
    'Operator', 'Fleet Supervisor', 'Diinput oleh', 'Waktu input'],
  CACHE_DETIK: 900,   // 15 menit, mengikuti pemicu prosesTarikan
};
/** 14 panel event Lampiran 3A: judul tabel, judul grafik, teks Case yang masuk, dan nama parameter Pemetaan (cadangan). */
const LH_PANEL = [
  { k: 'HC', tabel: 'Harsh Cornering', grafik: 'Harsh Cornering', kasus: ['HARSH TURN', 'HARSH CORNERING', 'HARSH TURN / CORNERING'], param: ['HARSH TURN / CORNERING'] },
  { k: 'OS', tabel: 'Over Speed', grafik: 'Over Speed', kasus: ['OVERSPEED', 'OVER SPEED', 'OVERSPEED INSTANT', 'OVER SPEED ALARM'], param: ['OVER SPEED'] },
  { k: 'HB', tabel: 'Harsh Brake', grafik: 'Harsh Brake', kasus: ['HARSH BREAKING', 'HARSH BRAKING', 'HARSH BRAKE'], param: ['HARSH BRAKING'] },
  { k: 'HA', tabel: 'Harsh Acceleration', grafik: 'Harsh Acceleration', kasus: ['HARSH ACCELERATION'], param: ['HARSH ACCELERATION'] },
  { k: 'ID', tabel: 'Idle', grafik: 'Idle', kasus: ['IDLE', 'IDLE REPORT', 'IDLING'], param: ['IDLING'] },
  { k: 'D4', tabel: 'Driving > 4 hrs', grafik: 'Driving > 4 hrs', kasus: ['DRIVING > 4 HOURS', 'OVER DRIVING (4 HOURS)'], param: ['DRIVING > 4 HOURS'] },
  { k: 'BZ', tabel: 'Blackzone', grafik: 'Blackzone', kasus: ['BLACKZONE', 'BLACKZONE ALARM', 'BLACK ZONE'], param: ['BLACK ZONE'] },
  { k: 'FT', tabel: 'Driver Behavior - Fatigue', grafik: 'Fatigue', kasus: ['DRIVER FATIGUE', 'FATIGUE', 'MICROSLEEP'], param: ['MICROSLEEP'] },
  { k: 'MG', tabel: 'Driver Behavior - Menguap', grafik: 'Menguap', kasus: ['YAWNING DETECTION', 'DRIVER HAS BEEN YAWNING'], param: ['MENGUAP'] },
  { k: 'MR', tabel: 'Driver Behavior - Merokok', grafik: 'Merokok', kasus: ['SMOKING DETECTION', 'DRIVER HAS BEEN SMOKING'], param: ['MEROKOK / VAPE'] },
  { k: 'TL', tabel: 'Driver Behavior - Telepon', grafik: 'Menggunakan Telepon', kasus: ['PHONE DETECTION', 'DRIVER IS USING PHONE'], param: ['MENGGUNAKAN TELEPON'] },
  { k: 'CC', tabel: 'Camera Covering', grafik: 'Camera Covering', kasus: ['CAMERA COVERING ALARM', 'CAMERA COVERING'], param: ['CAMERA COVERING'] },
  { k: 'IS', tabel: 'Illegal Shutdown', grafik: 'Illegal Shutdown', kasus: ['ILLEGAL SHUTDOWN'], param: ['ILLEGAL SHUTDOWN'] },
  { k: 'DS', tabel: 'Distraction Mengemudi', grafik: 'Distraction Mengemudi', kasus: ['DRIVER DISTRACTION'], param: ['DISTRACTION MENGEMUDI'] },
];

function halamanLaporanHarian_() {
  return HtmlService.createHtmlOutputFromFile('HalamanHarian')
    .setTitle('Laporan Harian Operasional GPS & Dashcam')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Alamat halaman Laporan Harian, untuk tombol di dashboard bulanan (hanya tampil untuk akun Control Room). */
function urlLaporanHarian() { return ScriptApp.getService().getUrl() + '?laporan=harian'; }

/** Case (sudah dinormKasus) -> indeks panel. Teks Case langsung, lalu parameter di sheet Pemetaan. */
function petaPanel_(peta) {
  const out = {};
  LH_PANEL.forEach((p, i) => p.kasus.forEach(c => { out[c] = i; }));
  Object.keys(peta.kasus).forEach(c => {
    if (out[c] !== undefined) return;
    const P = teks(peta.kasus[c].p).toUpperCase(), i = LH_PANEL.findIndex(p => p.param.indexOf(P) >= 0);
    if (i >= 0) out[c] = i;
  });
  return out;
}

/**
 * Event satu bulan per tanggal: { sumber, tanggal: { d: [[lokasi, area, panel, jumlah], ...] } }.
 * Disimpan di cache 15 menit.
 */
function eventBulanLH_(m) {
  const kunci = 'LH1_' + m, ada = ambilCache_(kunci);
  if (ada) return JSON.parse(ada);
  const folder = DriveApp.getFolderById(CFG.FOLDER_ID), cari = m + 1 >= CFG.BULAN_TARIKAN ? 'TARIKAN' : 'DATA';
  let atur = null, file = null;
  const it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) {
    const f = it.next(), n = teks(f.getName()), t = n.match(/^(DATA|TARIKAN)\s+(\d{1,2})\b/i);
    if (/^PENGATURAN/i.test(n)) atur = f; else if (t && t[1].toUpperCase() === cari && +t[2] === m + 1) file = f;
  }
  const out = { sumber: file ? file.getName() : '', tanggal: {}, lokArea: {} };
  if (atur && file) {
    const peta = bacaPemetaan(nilaiSheet(SpreadsheetApp.open(atur), 'Pemetaan') || []), pp = petaPanel_(peta);
    const T = {};
    (nilaiSheet(SpreadsheetApp.open(file), 'Event') || []).slice(1).forEach(r => {
      const tg = tanggalTeks(r[0]), pi = pp[normKasus(r[3])], n = angka(r[4]) || 0, l = teks(r[2]).toUpperCase();
      if (!tg || tg.m !== m || pi === undefined || !n || !l) return;
      const lok = ALIAS_LOKASI[l] || l, area = areaNorm(r[1]) || peta.lokasi[lok] || '';
      if (area) out.lokArea[lok] = area;
      const k = tg.d + '|' + lok + '|' + pi;
      (T[k] || (T[k] = [tg.d, lok, area, pi, 0]))[4] += n;
    });
    Object.keys(T).forEach(k => { const x = T[k]; (out.tanggal[x[0]] = out.tanggal[x[0]] || []).push(x.slice(1)); });
  }
  simpanCache_(JSON.stringify(out), kunci, LH.CACHE_DETIK);
  return out;
}

/** Lokasi dalam cakupan akun: [{n: nama, a: area}], diambil dari data dashboard bulanan. */
function lokasiLH_(ses) {
  const d = JSON.parse(potongJson_(dataUtama_(), ses, 'SC_')), unik = {};
  d.lok.filter(x => x[0] && !/^\(TANPA/.test(x[0])).forEach(x => { const k = kunciLok(x[0]); unik[k] = unik[k] || { n: x[0], a: d.areas[x[1]] || '' }; });
  return Object.keys(unik).map(k => unik[k]).sort((a, b) => AREAS.indexOf(a.a) - AREAS.indexOf(b.a) || (a.n < b.n ? -1 : 1));
}
/** Dipanggil halaman: akun, daftar lokasi dalam cakupan, dan tanggal terakhir yang ada event. */
function lhInfo(token) {
  const ses = sesi_(token);
  return JSON.stringify({ akun: { nama: ses.nama, peran: ses.peran, area: ses.area || '', lok: ses.lok || '' }, areas: AREAS, tahun: CFG.TAHUN, lokasi: lokasiLH_(ses), tanggalAkhir: tanggalAkhirLH_() });
}
/** Tanggal terakhir yang punya data event (yyyy-mm-dd), untuk pilihan awal halaman. */
function tanggalAkhirLH_() {
  for (let m = 11; m >= 0; m--) {
    const t = Object.keys(eventBulanLH_(m).tanggal).map(Number);
    if (t.length) return CFG.TAHUN + '-' + ('0' + (m + 1)).slice(-2) + '-' + ('0' + Math.max.apply(null, t)).slice(-2);
    if (m + 1 < CFG.BULAN_TARIKAN - 1) break;   // cukup periksa beberapa bulan terakhir
  }
  return '';
}

/** Cakupan laporan: akun Area/Lokasi dikunci ke area/lokasinya; Pusat bebas memilih. */
function cakupanLH_(ses, area, lokasi) {
  area = areaNorm(area); lokasi = teks(lokasi).toUpperCase();
  if (ses.peran === 'LOKASI') return { area: ses.area || '', lok: ses.lok };
  if (ses.peran === 'AREA') return { area: ses.area, lok: lokasi };
  return { area: area, lok: lokasi };
}
const cocokLH_ = (c, lok, area) => c.lok ? kunciLok(lok) === kunciLok(c.lok) : !c.area || area === c.area;

/**
 * Isi Lampiran 3A untuk satu tanggal (yyyy-mm-dd) dan cakupan.
 * Baris tabel event = lokasi dalam cakupan (Pusat tanpa pilihan area: per Area).
 */
function lhLaporan(token, tanggal, area, lokasi) {
  const ses = sesi_(token), tg = tanggalTeks(tanggal);
  if (!tg) throw new Error('Tanggal tidak valid.');
  const c = cakupanLH_(ses, area, lokasi), E = eventBulanLH_(tg.m), perArea = ses.peran === 'PUSAT' && !c.area && !c.lok;
  const info = { lokasi: lokasiLH_(ses) };
  // baris tabel: semua lokasi dalam cakupan (juga yang tanpa event), ditambah lokasi yang hanya ada di data tanggal ini
  const baris = [], idx = {};
  const tambah = (nama, ar) => { const k = perArea ? ar : kunciLok(nama); if (!k || idx[k] !== undefined) return; idx[k] = baris.length; baris.push(perArea ? ar : nama); };
  if (perArea) AREAS.forEach(a => tambah(a, a));
  else info.lokasi.filter(o => cocokLH_(c, o.n, o.a)).forEach(o => tambah(o.n, o.a));
  const rows = (E.tanggal[tg.d] || []).filter(r => cocokLH_(c, r[0], r[1] || info.lokasi.filter(o => kunciLok(o.n) === kunciLok(r[0])).map(o => o.a)[0] || ''));
  rows.forEach(r => tambah(r[0], r[1]));
  const V = LH_PANEL.map(() => baris.map(() => 0));
  rows.forEach(r => { const i = idx[perArea ? r[1] : kunciLok(r[0])]; if (i !== undefined) V[r[2]][i] += r[3]; });
  const inp = bacaInputLH_().filter(r => r.tanggal === teksTanggal_(tg) && cocokLH_(c, r.lokasi, r.area || (info.lokasi.filter(o => kunciLok(o.n) === kunciLok(r.lokasi))[0] || {}).a || ''));
  const jml = (a, b) => inp.reduce((s, r) => s + (r[a] || 0), 0) - (b ? inp.reduce((s, r) => s + (r[b] || 0), 0) : 0);
  const satu = c.lok && inp.length === 1 ? inp[0] : null;   // nama operator/supervisor hanya untuk laporan satu lokasi
  const labelLok = c.lok || (c.area ? 'Command Center ' + c.area : 'Semua Area');
  return JSON.stringify({
    tanggal: teksTanggal_(tg), lokasi: labelLok, baris: perArea ? 'Area' : 'Lokasi', sumber: E.sumber,
    panel: LH_PANEL.map((p, i) => ({ tabel: p.tabel, grafik: p.grafik, rows: baris.map((n, j) => ({ n: n, v: V[i][j] })), total: V[i].reduce((s, v) => s + v, 0) })),
    perangkat: {
      gps: { terpasang: jml('gpsT'), online: jml('gpsO') }, dashcam: { terpasang: jml('camT'), online: jml('camO') }, rtc: { terpasang: jml('rtcT'), online: jml('rtcO') },
      lokasiInput: inp.length, lokasiCakupan: perArea ? info.lokasi.length : baris.length,
    },
    operator: satu ? satu.operator : '', supervisor: satu ? satu.supervisor : '',
    adaEvent: rows.length > 0,
  });
}
const teksTanggal_ = tg => CFG.TAHUN + '-' + ('0' + (tg.m + 1)).slice(-2) + '-' + ('0' + tg.d).slice(-2);

/* ---- Input harian GPS / Dashcam / RTC ---- */
function sheetInputLH_() {
  const ss = bukaAtauBuat(DriveApp.getFolderById(CFG.FOLDER_ID), LH.INPUT_NAMA, [['Input', LH.INPUT_HDR]]);
  const sh = ss.getSheetByName('Input');
  sh.getRange('A:A').setNumberFormat('@');   // tanggal disimpan sebagai teks yyyy-mm-dd
  return sh;
}
function bacaInputLH_() {
  const ada = CacheService.getScriptCache().get('LHIN');
  if (ada) return JSON.parse(ada);
  const v = sheetInputLH_().getDataRange().getValues().slice(1), n = x => Math.max(0, Math.round(angka(x) || 0));
  const out = v.filter(r => tanggalTeks(r[0]) && teks(r[2])).map(r => ({
    tanggal: teksTanggal_(tanggalTeks(r[0])), area: areaNorm(r[1]), lokasi: teks(r[2]).toUpperCase(),
    gpsT: n(r[3]), gpsO: n(r[4]), camT: n(r[5]), camO: n(r[6]), rtcT: n(r[7]), rtcO: n(r[8]), operator: teks(r[9]), supervisor: teks(r[10]),
  }));
  try { CacheService.getScriptCache().put('LHIN', JSON.stringify(out), LH.CACHE_DETIK); } catch (e) { /* terlalu besar: tanpa cache */ }
  return out;
}
/** Isi form untuk satu tanggal & lokasi: data tanggal itu, atau data terakhir sebelumnya sebagai usulan. */
function lhAmbilInput(token, tanggal, lokasi) {
  const ses = sesi_(token), tg = tanggalTeks(tanggal), lok = ses.peran === 'LOKASI' ? ses.lok : teks(lokasi).toUpperCase();
  if (!tg || !lok) return JSON.stringify({ ada: null, sebelumnya: null });
  const t = teksTanggal_(tg), L = bacaInputLH_().filter(r => kunciLok(r.lokasi) === kunciLok(lok));
  const sebelum = L.filter(r => r.tanggal < t).sort((a, b) => a.tanggal < b.tanggal ? 1 : -1)[0] || null;
  return JSON.stringify({ ada: L.filter(r => r.tanggal === t)[0] || null, sebelumnya: sebelum });
}
/** Menyimpan (menimpa) input satu tanggal & lokasi. Akun Lokasi hanya lokasinya, akun Area hanya lokasi di areanya. */
function lhSimpanInput(token, o) {
  const ses = sesi_(token), tg = tanggalTeks(o && o.tanggal);
  if (!tg) throw new Error('Tanggal tidak valid.');
  const info = { lokasi: lokasiLH_(ses) };
  const lok = ses.peran === 'LOKASI' ? ses.lok : teks(o.lokasi).toUpperCase();
  const L = info.lokasi.filter(x => kunciLok(x.n) === kunciLok(lok))[0];
  if (!L) throw new Error('Lokasi ' + lok + ' tidak ada dalam cakupan akun ini.');
  const n = (x, nama) => { const v = Number(x); if (!isFinite(v) || v < 0 || Math.round(v) !== v) throw new Error(nama + ' harus bilangan bulat 0 atau lebih.'); return v; };
  const gT = n(o.gpsT, 'GPS terpasang'), gO = n(o.gpsO, 'GPS online'), cT = n(o.camT, 'Dashcam terpasang'), cO = n(o.camO, 'Dashcam online'), rT = n(o.rtcT, 'Jumlah RTC'), rO = n(o.rtcO, 'RTC online');
  if (gO > gT || cO > cT || rO > rT) throw new Error('Jumlah online tidak boleh lebih dari jumlah terpasang.');
  const t = teksTanggal_(tg), baru = [t, L.a, L.n, gT, gO, cT, cO, rT, rO, teks(o.operator), teks(o.supervisor), ses.u || ses.nama, new Date()];
  const kunci = LockService.getScriptLock(); kunci.waitLock(10000);
  try {
    const sh = sheetInputLH_(), v = sh.getDataRange().getValues();
    const i = v.findIndex((r, j) => j > 0 && tanggalTeks(r[0]) && teksTanggal_(tanggalTeks(r[0])) === t && kunciLok(r[2]) === kunciLok(L.n));
    if (i > 0) sh.getRange(i + 1, 1, 1, baru.length).setValues([baru]); else sh.appendRow(baru);
    CacheService.getScriptCache().remove('LHIN');
  } finally { kunci.releaseLock(); }
  return JSON.stringify({ ok: true, lokasi: L.n, tanggal: t });
}

/** Logo dari folder data (file gambar yang namanya diawali "Logo"), sebagai data URI; '' bila tidak ada. */
function lhLogo() {
  const c = CacheService.getScriptCache(), ada = c.get('LHLOGO');
  if (ada !== null) return ada;
  let uri = '';
  const it = DriveApp.getFolderById(CFG.FOLDER_ID).getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (/^LOGO/i.test(f.getName()) && /^image\//.test(f.getMimeType()) && f.getSize() < 70000) { uri = 'data:' + f.getMimeType() + ';base64,' + Utilities.base64Encode(f.getBlob().getBytes()); break; }
  }
  try { c.put('LHLOGO', uri, 21600); } catch (e) { /* tanpa cache */ }
  return uri;
}
