/**
 * LAPORAN OPERASIONAL GPS & DASHCAM (Daily & Monthly)
 *
 * Halaman kedua di web app yang sama: <url web app>?laporan=harian (lihat doGet di Kode.gs).
 * Memakai akun, sheet Pemetaan, dan folder data yang sama dengan dashboard bulanan (tidak perlu unggah dua kali):
 *   - Event per tanggal & lokasi dibaca dari sheet "Event" file "Tarikan <nn> ..." (mulai tanggal CFG.MULAI_TARIKAN)
 *     atau "Data <nn> ..." (tanggal sebelumnya; satu bulan boleh memakai keduanya).
 *   - GPS & Dashcam (ADAS) dibaca dari sheet "Justifikasi Uptime" spreadsheet "LAPORAN KENDALA DEVICE CONTROL ROOM" (LH.KENDALA_ID):
 *     setiap Nopol yang tercatat pada satu tanggal = 100%, yang Status-nya Offline = offline.
 *     Bulanan: jumlah Nopol tercatat dan offline dijumlahkan untuk semua tanggal di bulan itu.
 *     Lokasi & area diambil dari kolom Lokasi / Area sheet itu sendiri (nama unit dicocokkan ke Master Lokasi).
 *   - Command Center (jumlah & hadir; kolom RTC di sheet input) serta nama Command Center / Manager Region S&D diisi lewat form Input Harian di halaman ini,
 *     disimpan di spreadsheet LH.INPUT_NAMA di folder data (dibuat otomatis).
 *   - Logo: file gambar di folder data yang namanya diawali "Logo" (mis. "Logo Pertamina Patra Niaga.png").
 *     Tanpa file itu dipakai logo bawaan di HalamanHarian.html.
 * Camera Covering dan Illegal Shutdown tetap dihitung di laporan ini walau di sheet Pemetaan ditandai "tidak dihitung".
 */
const LH = {
  INPUT_NAMA: 'Input Harian GPS Dashcam RTC',
  INPUT_HDR: ['Tanggal', 'Area', 'Lokasi', 'GPS Terpasang', 'GPS Online', 'Dashcam Terpasang', 'Dashcam Online', 'RTC Jumlah', 'RTC Online',
    'Operator', 'Fleet Supervisor', 'Diinput oleh', 'Waktu input'],
  CACHE_DETIK: 900,   // 15 menit, mengikuti pemicu prosesTarikan
  KENDALA_ID: '1nHNYOFXLh7JNYNWz7CI5-83SI_cd7jZ9THqLgcoW6s4',   // spreadsheet "Kegagalan & Penormalan Operasi" (sheet Justifikasi Uptime & Master Lokasi)
};
/** 14 jenis event laporan: judul tabel, judul grafik, teks Case yang masuk, dan nama parameter Pemetaan (cadangan). */
const LH_PANEL = [
  { k: 'HC', tabel: 'Harsh Cornering', grafik: 'Harsh Cornering', kasus: ['HARSH TURN', 'HARSH CORNERING', 'HARSH TURN / CORNERING', 'HARSH CORNERING ALARM', 'HARSH TURN ALARM'], param: ['HARSH TURN / CORNERING'] },
  { k: 'OS', tabel: 'Over Speed', grafik: 'Over Speed', kasus: ['OVERSPEED', 'OVER SPEED', 'OVERSPEED INSTANT', 'OVER SPEED ALARM'], param: ['OVER SPEED'] },
  { k: 'HB', tabel: 'Harsh Brake', grafik: 'Harsh Brake', kasus: ['HARSH BREAKING', 'HARSH BRAKING', 'HARSH BRAKE', 'HARSH BRAKING ALARM', 'HARSH BRAKE ALARM', 'HARSH BREAKING ALARM'], param: ['HARSH BRAKING'] },
  { k: 'HA', tabel: 'Harsh Acceleration', grafik: 'Harsh Acceleration', kasus: ['HARSH ACCELERATION', 'HARSH ACCELERATION ALARM'], param: ['HARSH ACCELERATION'] },
  { k: 'ID', tabel: 'Idle', grafik: 'Idle', kasus: ['IDLE', 'IDLE REPORT', 'IDLING'], param: ['IDLING'] },
  { k: 'D4', tabel: 'Driving > 4 hrs', grafik: 'Driving > 4 hrs', kasus: ['DRIVING > 4 HOURS', 'OVER DRIVING (4 HOURS)'], param: ['DRIVING > 4 HOURS'] },
  { k: 'BZ', tabel: 'Blackzone', grafik: 'Blackzone', kasus: ['BLACKZONE', 'BLACKZONE ALARM', 'BLACK ZONE'], param: ['BLACK ZONE'] },
  { k: 'FT', tabel: 'Driver Behavior - Fatigue', grafik: 'Fatigue', kasus: ['DRIVER FATIGUE', 'FATIGUE', 'MICROSLEEP'], param: ['MICROSLEEP'] },
  { k: 'MG', tabel: 'Driver Behavior - Menguap', grafik: 'Menguap', kasus: ['YAWNING DETECTION', 'DRIVER HAS BEEN YAWNING'], param: ['MENGUAP'] },
  { k: 'MR', tabel: 'Driver Behavior - Merokok', grafik: 'Merokok', kasus: ['SMOKING DETECTION', 'DRIVER HAS BEEN SMOKING'], param: ['MEROKOK / VAPE'] },
  { k: 'TL', tabel: 'Driver Behavior - Telepon', grafik: 'Menggunakan Telepon', kasus: ['PHONE DETECTION', 'DRIVER IS USING PHONE'], param: ['MENGGUNAKAN TELEPON'] },
  { k: 'CC', tabel: 'Camera Covering', grafik: 'Camera Covering', kasus: ['CAMERA COVERING ALARM', 'CAMERA COVERING'], param: ['CAMERA COVERING'] },
  { k: 'IS', tabel: 'Illegal Shutdown', grafik: 'Illegal Shutdown', kasus: ['ILLEGAL SHUTDOWN'], param: ['ILLEGAL SHUTDOWN'] },
  { k: 'DS', tabel: 'Distraction Mengemudi', grafik: 'Distraction Mengemudi', kasus: ['DRIVER DISTRACTION', 'DRIVER ATTENTION HAS BEEN DISTRACTED'], param: ['DISTRACTION MENGEMUDI'] },
];

/** Panel yang tidak ditampilkan untuk akun Area (Command Center) & Lokasi (Control Room): Illegal Shutdown, Camera Covering, Fatigue, Driving > 4 hrs, Distraction Mengemudi. */
const LH_SEMBUNYI_LOKASI = ['IS', 'CC', 'FT', 'D4', 'DS'];

function halamanLaporanHarian_() {
  return HtmlService.createHtmlOutputFromFile('HalamanHarian')
    .setTitle('Laporan Operasional GPS & Dashcam')
    .setFaviconUrl(FAVICON_URL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Alamat halaman Laporan, untuk tombol di dashboard bulanan (hanya tampil untuk akun Control Room). */
/** Laporan Harian (dan export PDF-nya) untuk akun Command Center (AREA). false = disembunyikan; ubah ke true untuk memunculkan kembali. */
const LH_UNTUK_AREA = true;
function urlLaporanHarian(peran) { return peran === 'AREA' && !LH_UNTUK_AREA ? '' : ScriptApp.getService().getUrl() + '?laporan=harian'; }
/** Sesi untuk halaman Laporan; akun AREA ditolak selama LH_UNTUK_AREA = false. */
function sesiLH_(token) {
  const ses = sesi_(token);
  if (ses.peran === 'AREA' && !LH_UNTUK_AREA) throw new Error('Laporan Harian sedang tidak tersedia untuk akun Command Center.');
  return ses;
}

/**
 * Event satu bulan per tanggal: { sumber, tanggal: { d: [[lokasi, area, panel, jumlah], ...] } }.
 * Disimpan di cache 6 jam; kuncinya ikut versi data (berganti setiap tarikan / summary baru), jadi tidak basi.
 */
function eventBulanLH_(m) {
  const kunci = 'LH2_' + versiData_() + '_' + m, ada = ambilCache_(kunci);
  if (ada) return JSON.parse(ada);
  const folder = DriveApp.getFolderById(CFG.FOLDER_ID), S = sumberBulan_(folder), src = S.perBulan[m] || [];
  const out = { sumber: src.map(o => o.f.getName()).join(' + '), tanggal: {}, lokArea: {} };
  if (S.atur && src.length) {
    // dari file Summary bulan itu (Sum_Harian) bila masih sesuai sumbernya; summary ditulis oleh dashboard, bukan di sini
    const peta = bacaPemetaan(nilaiSheet(SpreadsheetApp.open(S.atur), 'Pemetaan') || []), pp = {};
    LH_PANEL.forEach((p, i) => p.param.forEach(P => { pp[P] = i; }));
    const T = {};
    const t0 = Date.now(), x = dataBulan_(folder, m, src, peta, {}, false, true);
    Logger.log('Laporan Harian ' + BULAN[m] + ': ' + x.EV.length + ' baris event, ' + (Date.now() - t0) + ' ms.');
    x.EV.forEach(e => {
      // baris tanpa Lokasi tetap dihitung di total area (sama seperti dashboard: baris "(TANPA LOKASI)")
      const pi = pp[e[3].toUpperCase()], l = e[2] || '(TANPA LOKASI)';
      if (pi === undefined) return;
      const lok = ALIAS_LOKASI[l] || l, area = e[1] || peta.lokasi[lok] || '';
      if (area) out.lokArea[lok] = area;
      const k = e[0] + '|' + lok + '|' + pi;
      (T[k] || (T[k] = [e[0], lok, area, pi, 0]))[4] += e[4];
    });
    Object.keys(T).forEach(k => { const x = T[k]; (out.tanggal[x[0]] = out.tanggal[x[0]] || []).push(x.slice(1)); });
  }
  simpanCache_(JSON.stringify(out), kunci, CFG.CACHE_DETIK);
  return out;
}

/** Lokasi dalam cakupan akun: [{n: nama, a: area}], diambil dari data dashboard bulanan. */
function lokasiLH_(ses) {
  // cache per cakupan akun: tanpa ini setiap laporan membuka dan mem-parse seluruh data dashboard (beberapa MB)
  const c = CacheService.getScriptCache(), kunci = 'LHLOK_' + versiData_() + '_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, ses.peran + '|' + (ses.area || '') + '|' + (ses.lok || ''))).slice(0, 16);
  const ada = c.get(kunci);
  if (ada) return JSON.parse(ada);
  const d = JSON.parse(potongJson_(dataUtama_(), ses, 'SC_')), unik = {};
  d.lok.filter(x => x[0] && !/^\(TANPA/.test(x[0])).forEach(x => { const k = kunciLok(x[0]); unik[k] = unik[k] || { n: x[0], a: d.areas[x[1]] || '' }; });
  const out = Object.keys(unik).map(k => unik[k]).sort((a, b) => AREAS.indexOf(a.a) - AREAS.indexOf(b.a) || (a.n < b.n ? -1 : 1));
  try { c.put(kunci, JSON.stringify(out), 3600); } catch (e) { /* tanpa cache */ }
  return out;
}
/** Dipanggil halaman: akun, daftar lokasi dalam cakupan, dan tanggal terakhir yang ada event. */
function lhInfo(token) {
  const ses = sesiLH_(token);
  return JSON.stringify({ akun: { nama: ses.nama, peran: ses.peran, area: ses.area || '', lok: ses.lok || '' }, areas: AREAS, tahun: CFG.TAHUN, lokasi: lokasiLH_(ses), tanggalAkhir: (() => { try { return tanggalAkhirLH_(); } catch (e) { Logger.log('Tanggal terakhir gagal dibaca: ' + e.message); return ''; } })() });
}
/** Tanggal terakhir yang punya data event (yyyy-mm-dd), untuk pilihan awal halaman. */
function tanggalAkhirLH_() {
  for (let m = 11; m >= 0; m--) {
    const t = Object.keys(eventBulanLH_(m).tanggal).map(Number);
    if (t.length) return CFG.TAHUN + '-' + ('0' + (m + 1)).slice(-2) + '-' + ('0' + Math.max.apply(null, t)).slice(-2);
    if (m < BULAN_MULAI_TARIKAN - 1) break;   // cukup periksa beberapa bulan terakhir
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
 * Isi laporan untuk satu hari (periode yyyy-mm-dd) atau satu bulan (periode yyyy-mm) dan cakupan.
 * Baris tabel = lokasi dalam cakupan (Pusat tanpa pilihan area: per Area).
 */
function lhLaporan(token, periode, area, lokasi) {
  const ses = sesiLH_(token), p = teks(periode), bulanan = /^\d{4}-\d{1,2}$/.test(p);
  const tg = tanggalTeks(bulanan ? p + '-01' : p);
  if (!tg) throw new Error('Tanggal tidak valid.');
  const m = tg.m, hari = bulanan ? null : tg.d;
  // setiap sumber dibaca terpisah: bila satu gagal, bagian lain laporan tetap tampil dan halaman diberi keterangan
  const gagal = [], coba = (nama, f, cadangan) => { try { return f(); } catch (e) { Logger.log(nama + ' gagal dibaca: ' + e.message); gagal.push(nama + ' gagal dibaca (' + e.message + ')'); return cadangan; } };
  const t0 = Date.now(), c = cakupanLH_(ses, area, lokasi), perArea = ses.peran === 'PUSAT' && !c.area && !c.lok;
  const E = coba('Data Driving Behaviour (event)', () => eventBulanLH_(m), { sumber: '', tanggal: {}, lokArea: {} }), t1 = Date.now();
  const J = coba('Data GPS & Dashcam (Justifikasi Uptime)', () => kendalaBulan_(m), { hari: {}, off: [] }), t2 = Date.now();
  const info = coba('Daftar lokasi', () => lokasiLH_(ses), []), areaLok = {};
  Logger.log('lhLaporan ' + p + ': event ' + (t1 - t0) + ' ms, kendala ' + (t2 - t1) + ' ms, lokasi ' + (Date.now() - t2) + ' ms.');   // lihat Apps Script > Eksekusi bila laporan lambat
  info.forEach(o => { areaLok[kunciLok(o.n)] = o.a; });
  Object.keys(E.lokArea).forEach(l => { const k = kunciLok(l); areaLok[k] = areaLok[k] || E.lokArea[l]; });
  const areaDari = (lok, a) => a || areaLok[kunciLok(lok)] || '';
  const masuk = (lok, a) => cocokLH_(c, lok, areaDari(lok, a));
  const diHari = d => hari === null || +d === hari;
  // baris tabel: semua lokasi dalam cakupan, ditambah lokasi yang hanya muncul di data periode ini
  const baris = [], idx = {};
  const tambah = (nama, a) => { const k = perArea ? areaDari(nama, a) : kunciLok(nama); if (!k || idx[k] !== undefined) return -1; idx[k] = baris.length; baris.push(perArea ? k : nama); return idx[k]; };
  const iBaris = (nama, a) => { const k = perArea ? areaDari(nama, a) : kunciLok(nama); return idx[k] !== undefined ? idx[k] : tambah(nama, a); };
  if (perArea) AREAS.forEach(a => tambah(a, a));
  else info.filter(o => cocokLH_(c, o.n, o.a)).forEach(o => tambah(o.n, o.a));

  // event
  const V = LH_PANEL.map(() => []), evHari = {}, tampil = LH_PANEL.map(p => !(ses.peran !== 'PUSAT' && LH_SEMBUNYI_LOKASI.indexOf(p.k) >= 0));
  let adaEvent = false;
  Object.keys(E.tanggal).filter(diHari).forEach(d => E.tanggal[d].forEach(r => {
    if (!tampil[r[2]] || !masuk(r[0], r[1])) return;
    const i = iBaris(r[0], r[1]); if (i < 0) return;
    V[r[2]][i] = (V[r[2]][i] || 0) + r[3]; adaEvent = true;
    (evHari[d] || (evHari[d] = LH_PANEL.map(() => 0)))[r[2]] += r[3];
  }));

  // GPS & Dashcam dari Justifikasi Uptime: setiap Nopol yang tercatat di tanggal itu = 100%
  const kosong = () => ({ gps: [0, 0], cctv: [0, 0] });
  const upBaris = [], upHari = {}, up = kosong();
  let adaJust = false;
  Object.keys(J.hari).filter(diHari).forEach(d => J.hari[d].forEach(([lok, ar, jenis, total, off]) => {
    if (!masuk(lok, ar)) return;
    const i = iBaris(lok, ar); if (i < 0) return;
    adaJust = true;
    [up, upBaris[i] || (upBaris[i] = kosong()), upHari[d] || (upHari[d] = kosong())].forEach(o => { o[jenis][0] += total; o[jenis][1] += off; });
  }));
  const bagi = x => ({ terpasang: x[0], online: x[0] - x[1] });
  const offSemua = J.off.filter(r => diHari(r[0]) && masuk(r[1], r[2]));
  const offline = offSemua.slice(0, 500)
    .map(r => ({ tanggal: teksTanggal_({ m: m, d: r[0] }), lokasi: r[3], perangkat: r[4], nopol: r[5], durasi: r[6], justifikasi: r[7], keterangan: r[8] }));

  // RTC & penanda tangan dari form input
  const awal = teksTanggal_({ m: m, d: hari || 1 }), akhir = teksTanggal_({ m: m, d: hari || 31 });
  const inp = coba('Input RTC & penanda tangan', () => bacaInputLH_(), []).filter(r => r.tanggal >= awal && r.tanggal <= akhir && masuk(r.lokasi, r.area));
  const jml = a => inp.reduce((s, r) => s + (r[a] || 0), 0);
  const satu = !bulanan && c.lok && inp.length === 1 ? inp[0] : null;   // nama operator/supervisor hanya untuk laporan harian satu lokasi
  const nHari = bulanan ? new Date(CFG.TAHUN, m + 1, 0).getDate() : 1;

  // tren per baris & jenis event: event per tanggal (harian: tanggal 1 s/d tanggal terpilih) dan per jenis event periode sebelumnya (H-1 / bulan lalu)
  const cariBaris = (nama, a) => { const k = perArea ? areaDari(nama, a) : kunciLok(nama); return idx[k] !== undefined ? idx[k] : -1; };
  const nTren = bulanan ? nHari : hari, trenHari = [], Vlalu = LH_PANEL.map(() => []);
  Object.keys(E.tanggal).filter(d => +d <= nTren).forEach(d => E.tanggal[d].forEach(r => {
    if (!tampil[r[2]] || !masuk(r[0], r[1])) return;
    const i = cariBaris(r[0], r[1]); if (i < 0) return;
    const t = trenHari[i] || (trenHari[i] = LH_PANEL.map(() => new Array(nTren).fill(0)));
    t[r[2]][d - 1] += r[3];
  }));
  let lalu = '', baruLalu = [];
  if (!bulanan && hari > 1) { lalu = teksTanggal_({ m: m, d: hari - 1 }); baruLalu = E.tanggal[hari - 1] || []; }
  else if (m > 0) {
    const E0 = coba('Data Driving Behaviour bulan sebelumnya', () => eventBulanLH_(m - 1), { tanggal: {} }), hs = Object.keys(E0.tanggal).map(Number);
    if (bulanan) { lalu = teksTanggal_({ m: m - 1, d: 1 }).slice(0, 7); hs.forEach(d => { baruLalu = baruLalu.concat(E0.tanggal[d]); }); }
    else { const dl = new Date(CFG.TAHUN, m, 0).getDate(); lalu = teksTanggal_({ m: m - 1, d: dl }); baruLalu = E0.tanggal[dl] || []; }
  }
  baruLalu.forEach(r => {
    if (!tampil[r[2]] || !masuk(r[0], r[1])) return;
    const i = cariBaris(r[0], r[1]); if (i < 0) return;
    Vlalu[r[2]][i] = (Vlalu[r[2]][i] || 0) + r[3];
  });

  return JSON.stringify({
    mode: bulanan ? 'bulanan' : 'harian', periode: bulanan ? awal.slice(0, 7) : awal,
    area: c.area || (c.lok ? areaDari(c.lok, '') : ''),
    lokasi: c.lok || (c.area ? 'Command Center ' + c.area : 'Semua Area'), baris: perArea ? 'Area' : 'Lokasi', sumber: E.sumber,
    panel: LH_PANEL.map((pn, i) => ({ w: i, tabel: pn.tabel, grafik: pn.grafik, rows: baris.map((n, j) => ({ n: n, v: V[i][j] || 0 })), total: V[i].reduce((s, v) => s + (v || 0), 0) })).filter((_, i) => tampil[i]),
    perangkat: {
      gps: bagi(up.gps), dashcam: bagi(up.cctv), rtc: { terpasang: jml('rtcT'), online: jml('rtcO') },
      adaJustifikasi: adaJust, lokasiInput: inp.length, lokasiCakupan: perArea ? info.length : baris.length,
    },
    perBaris: baris.map((n, i) => ({ n: n, gps: bagi((upBaris[i] || kosong()).gps), dashcam: bagi((upBaris[i] || kosong()).cctv), event: V.reduce((s, x) => s + (x[i] || 0), 0) })),
    perHari: bulanan ? Array.from({ length: nHari }, (_, k) => { const d = k + 1, u = upHari[d] || kosong();
      return { d: d, event: (evHari[d] || []).reduce((s, v) => s + v, 0), gps: bagi(u.gps), dashcam: bagi(u.cctv) }; }) : [],
    offline: offline, offlineTotal: offSemua.length,
    operator: satu ? satu.operator : '', supervisor: satu ? satu.supervisor : '',
    gagal: gagal,
    adaEvent: adaEvent,
    tren: { lalu: lalu, hari: nTren, rows: baris.map((n, i) => ({ n: n, h: LH_PANEL.map((_, pi) => trenHari[i] ? trenHari[i][pi] : new Array(nTren).fill(0)).filter((_, pi) => tampil[pi]), l: LH_PANEL.map((_, pi) => Vlalu[pi][i] || 0).filter((_, pi) => tampil[pi]) })) },
  });
}
/* ---- GPS & Dashcam dari spreadsheet LAPORAN KENDALA DEVICE CONTROL ROOM, sheet Justifikasi Uptime ---- */
const jenisPerangkat_ = x => /GPS/i.test(x) ? 'gps' : /ADAS|DASH|CCTV|KAMERA|CAMERA|DSM|MDVR/i.test(x) ? 'cctv' : '';
/** Tanggal di sheet kendala: objek Date, yyyy-mm-dd, atau dd/mm/yyyy. */
function tglKendala_(x) {
  const t = tanggalTeks(x); if (t) return t;
  const s = teks(x).match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  return s ? { m: +s[2] - 1, d: +s[1] } : null;
}
/**
 * Justifikasi Uptime satu bulan. Setiap baris = satu Nopol per tanggal & perangkat; Status "Offline" = offline.
 * Lokasi & area hanya dari kolom Lokasi / Area sheet ini. Nama unit yang lebih rinci
 * ("FT SIBOLGA POLTAPLUS MOR I") dicocokkan ke nama lokasi terpanjang di Master Lokasi yang menjadi awalannya ("FT SIBOLGA").
 * { hari: { d: [[lokasi, area, jenis, jumlahNopol, nopolOffline], ...] }, off: [[d, lokasi, area, lokasiDiSheet, perangkat, nopol, durasi, justifikasi, keterangan], ...] }
 * Sheet dibaca sekali untuk semua bulan (bukan sekali per bulan) lalu setiap bulan disimpan di cache 6 jam;
 * kuncinya ikut waktu ubah spreadsheet kendala, jadi isian baru langsung terbaca.
 */
function kendalaBulan_(m) {
  const versi = DriveApp.getFileById(LH.KENDALA_ID).getLastUpdated().getTime(), kunci = x => 'LHJU5_' + x + '_' + versi, ada = ambilCache_(kunci(m));
  if (ada) return JSON.parse(ada);
  const t0 = Date.now(), semua = kendalaSemua_();
  Object.keys(semua).forEach(x => simpanCache_(JSON.stringify(semua[x]), kunci(x), CFG.CACHE_DETIK));
  Logger.log('Justifikasi Uptime dibaca: ' + (Date.now() - t0) + ' ms.');
  return semua[m] || { hari: {}, off: [] };
}
/** Kolom 1 s/d kolom terakhir yang dipakai saja (bukan seluruh lebar sheet) dari sheet bernama `nama`; [] bila tidak ada. */
function kolomDipakai_(ss, nama, perlu) {
  const sh = ss.getSheets().filter(x => teks(x.getName()).toUpperCase() === nama.toUpperCase())[0];
  if (!sh || sh.getLastRow() < 1) return [];
  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], k = petaKolom(hdr);
  const n = Math.max.apply(null, [1].concat(Object.keys(k).filter(h => perlu.some(p => h.indexOf(p) === 0)).map(h => k[h] + 1)));
  return [hdr.slice(0, n)].concat(sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, n).getValues() : []);
}
/** Justifikasi Uptime semua bulan: { m: { hari, off } } (lihat kendalaBulan_). */
function kendalaSemua_() {
  const t0 = Date.now(), ss = SpreadsheetApp.openById(LH.KENDALA_ID), t1 = Date.now();
  const v = kolomDipakai_(ss, 'Justifikasi Uptime', ['TANGGAL', 'AREA', 'LOKASI', 'PERANGKAT', 'NOPOL', 'STATUS', 'DURASI', 'JUSTIFIKASI', 'KETERANGAN']), k = petaKolom(v[0] || []);
  Logger.log('Justifikasi Uptime: buka file ' + (t1 - t0) + ' ms, baca ' + (v.length - 1) + ' baris x ' + (v[0] || []).length + ' kolom ' + (Date.now() - t1) + ' ms.');
  const kol = awalan => { const h = Object.keys(k).filter(x => x.indexOf(awalan) === 0)[0]; return h === undefined ? undefined : k[h]; };
  const iT = k['TANGGAL'], iA = k['AREA'], iL = k['LOKASI'], iP = k['PERANGKAT'], iN = k['NOPOL'], iS = k['STATUS'], iD = kol('DURASI'), iJ = kol('JUSTIFIKASI'), iK = kol('KETERANGAN');
  if (iT === undefined || iL === undefined || iP === undefined || iN === undefined) throw new Error('Sheet Justifikasi Uptime harus punya kolom Tanggal, Lokasi, Perangkat, dan Nopol.');
  const kunciNopol = x => teks(x).toUpperCase().replace(/[^A-Z0-9]/g, '');
  // nama lokasi resmi (Master Lokasi + alias), terpanjang dulu agar "FT SIBOLGA X" tidak jatuh ke nama yang lebih pendek
  const areaL = {}, resmi = [];
  const w = kolomDipakai_(ss, 'Master Lokasi', ['LOKASI', 'AREA']), h = petaKolom(w[0] || []);
  w.slice(1).forEach(r => { const l = teks(r[h['LOKASI']]).toUpperCase(); if (l) { const n = ALIAS_LOKASI[l] || l; areaL[kunciLok(n)] = areaNorm(r[h['AREA']]); resmi.push(l); } });
  Object.keys(ALIAS_LOKASI).forEach(l => resmi.push(l));
  resmi.sort((a, b) => b.length - a.length);
  const petaLok = {};
  const lokasiDari = l => petaLok[l] || (petaLok[l] = (() => {
    if (ALIAS_LOKASI[l]) return ALIAS_LOKASI[l];
    const r = resmi.filter(x => l === x || l.indexOf(x + ' ') === 0)[0];
    return r ? ALIAS_LOKASI[r] || r : l;
  })());
  const N = {};   // m|d|lokasi|jenis|nopol -> [m, d, lokasi, area, jenis, offline, baris]
  v.slice(1).forEach(r => {
    const tg = tglKendala_(r[iT]), jenis = jenisPerangkat_(teks(r[iP])), lokAsli = teks(r[iL]).toUpperCase(), nopol = kunciNopol(r[iN]);
    if (!tg || !jenis || !lokAsli || !nopol) return;
    const lok = lokasiDari(lokAsli), area = areaL[kunciLok(lok)] || (iA === undefined ? '' : areaNorm(r[iA]));
    const off = iS !== undefined && teks(r[iS]) ? /OFF/i.test(teks(r[iS])) : (angka(iD === undefined ? 0 : r[iD]) || 0) > 0;
    const u = tg.m + '|' + tg.d + '|' + kunciLok(lok) + '|' + jenis + '|' + nopol, o = N[u] || (N[u] = [tg.m, tg.d, lok, area, jenis, false, null]);
    if (off && !o[5]) { o[5] = true; o[6] = r; }   // satu kendaraan dihitung sekali per hari
  });
  const H = {}, semua = {}, bulan = m => semua[m] || (semua[m] = { hari: {}, off: [] });
  Object.keys(N).forEach(u => {
    const [m, d, lok, area, jenis, off, r] = N[u], kk = m + '|' + d + '|' + kunciLok(lok) + '|' + jenis;
    (H[kk] || (H[kk] = [m, d, lok, area, jenis, 0, 0]))[5]++;
    if (!off) return;
    H[kk][6]++;
    bulan(m).off.push([d, lok, area, teks(r[iL]), teks(r[iP]), teks(r[iN]), iD === undefined ? '' : angka(r[iD]) || 0, iJ === undefined ? '' : teks(r[iJ]), iK === undefined ? '' : teks(r[iK])]);
  });
  Object.keys(H).forEach(kk => { const x = H[kk], o = bulan(x[0]).hari; (o[x[1]] = o[x[1]] || []).push(x.slice(2)); });
  Logger.log('Justifikasi Uptime: diolah ' + (Date.now() - t0) + ' ms sejak mulai.');
  Object.keys(semua).forEach(m => semua[m].off.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)));
  return semua;
}

const teksTanggal_ = tg => CFG.TAHUN + '-' + ('0' + (tg.m + 1)).slice(-2) + '-' + ('0' + tg.d).slice(-2);

/* ---- Input harian GPS / Dashcam / RTC ---- */
function sheetInputLH_(tulis) {
  const ss = bukaAtauBuat(DriveApp.getFolderById(CFG.FOLDER_ID), LH.INPUT_NAMA, [['Input', LH.INPUT_HDR]]);
  LH.ss = ss;
  const sh = ss.getSheetByName('Input');
  if (tulis) sh.getRange('A:A').setNumberFormat('@');   // tanggal disimpan sebagai teks yyyy-mm-dd (hanya saat menyimpan, bukan setiap baca)
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
  const ses = sesiLH_(token), tg = tanggalTeks(tanggal), lok = ses.peran === 'LOKASI' ? ses.lok : teks(lokasi).toUpperCase();
  if (!tg || !lok) return JSON.stringify({ ada: null, sebelumnya: null });
  const t = teksTanggal_(tg), L = bacaInputLH_().filter(r => kunciLok(r.lokasi) === kunciLok(lok));
  const sebelum = L.filter(r => r.tanggal < t).sort((a, b) => a.tanggal < b.tanggal ? 1 : -1)[0] || null;
  const ada = L.filter(r => r.tanggal === t)[0] || null;
  return JSON.stringify({ ada: ada, sebelumnya: sebelum });
}
/** Menyimpan (menimpa) input satu tanggal & lokasi. Akun Lokasi hanya lokasinya, akun Area hanya lokasi di areanya. */
function lhSimpanInput(token, o) {
  const ses = sesiLH_(token), tg = tanggalTeks(o && o.tanggal);
  if (!tg) throw new Error('Tanggal tidak valid.');
  const info = { lokasi: lokasiLH_(ses) };
  const lok = ses.peran === 'LOKASI' ? ses.lok : teks(o.lokasi).toUpperCase();
  const L = info.lokasi.filter(x => kunciLok(x.n) === kunciLok(lok))[0];
  if (!L) throw new Error('Lokasi ' + lok + ' tidak ada dalam cakupan akun ini.');
  const n = (x, nama) => { const v = Number(x); if (!isFinite(v) || v < 0 || Math.round(v) !== v) throw new Error(nama + ' harus bilangan bulat 0 atau lebih.'); return v; };
  // GPS & Dashcam kini dibaca dari spreadsheet kendala; kolomnya di sheet Input dibiarkan kosong
  const rT = n(o.rtcT, 'Jumlah Command Center'), rO = n(o.rtcO, 'Jumlah hadir');
  if (rO > rT) throw new Error('Jumlah hadir tidak boleh lebih dari jumlah Command Center.');
  const t = teksTanggal_(tg), baru = [t, L.a, L.n, '', '', '', '', rT, rO, teks(o.operator), teks(o.supervisor), ses.u || ses.nama, new Date()];
  const kunci = LockService.getScriptLock(); kunci.waitLock(10000);
  try {
    const sh = sheetInputLH_(true), v = sh.getDataRange().getValues();
    const i = v.findIndex((r, j) => j > 0 && tanggalTeks(r[0]) && teksTanggal_(tanggalTeks(r[0])) === t && kunciLok(r[2]) === kunciLok(L.n));
    if (i > 0) sh.getRange(i + 1, 1, 1, baru.length).setValues([baru]); else sh.appendRow(baru);
    CacheService.getScriptCache().remove('LHIN');
  } finally { kunci.releaseLock(); }
  return JSON.stringify({ ok: true, lokasi: L.n, tanggal: t });
}

/* ---- Waktu export PDF pertama per laporan (mode | periode | lokasi), disimpan di Script Properties ---- */
const kunciEkspor_ = k => 'LHEXP_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, teks(k))).slice(0, 20);
function lhEksporPertama(token, k) { sesiLH_(token); return PropertiesService.getScriptProperties().getProperty(kunciEkspor_(k)) || ''; }
/** Mencatat waktu export (ISO dari browser) hanya bila laporan ini belum pernah diexport; mengembalikan waktu yang tersimpan. */
function lhCatatEkspor(token, k, iso) {
  sesiLH_(token);
  const t = new Date(iso);
  if (isNaN(t) || Math.abs(t.getTime() - Date.now()) > 864e5) throw new Error('Waktu export tidak valid.');
  const P = PropertiesService.getScriptProperties(), kunci = kunciEkspor_(k), lock = LockService.getScriptLock(); lock.waitLock(10000);
  try { if (!P.getProperty(kunci)) P.setProperty(kunci, t.toISOString()); return P.getProperty(kunci); }
  finally { lock.releaseLock(); }
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

/**
 * Dipanggil panaskanCache (pemicu tiap jam & setelah tarikan baru): mengisi cache Laporan Harian bulan berjalan dan bulan sebelumnya,
 * supaya pengguna tidak menunggu summary, spreadsheet kendala, dan data dashboard dibaca ulang.
 */
function panaskanLH_() {
  const t0 = Date.now(), now = new Date(), m = now.getFullYear() === CFG.TAHUN ? now.getMonth() : 11;
  const coba = (nama, f) => { try { f(); } catch (e) { Logger.log('Panaskan ' + nama + ' gagal: ' + e.message); } };
  coba('tanggal terakhir', tanggalAkhirLH_);
  [m, m - 1].filter(x => x >= 0).forEach(x => coba('event ' + BULAN[x], () => eventBulanLH_(x)));
  coba('input', bacaInputLH_);
  coba('Justifikasi Uptime', () => kendalaBulan_(m));   // semua bulan sekaligus
  Logger.log('Cache Laporan Harian dipanaskan: ' + (Date.now() - t0) + ' ms.');
}
