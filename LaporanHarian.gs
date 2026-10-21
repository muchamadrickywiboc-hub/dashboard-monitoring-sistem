/**
 * LAPORAN OPERASIONAL GPS & DASHCAM (Daily & Monthly)
 *
 * Halaman kedua di web app yang sama: <url web app>?laporan=harian (lihat doGet di Kode.gs).
 * Memakai akun, sheet Pemetaan, dan folder data yang sama dengan dashboard bulanan (tidak perlu unggah dua kali):
 *   - Event per tanggal & lokasi dibaca dari sheet "Event" file "Tarikan <nn> ..." (mulai CFG.BULAN_TARIKAN)
 *     atau "Data <nn> ..." (bulan sebelumnya).
 *   - GPS & Dashcam (ADAS) dibaca dari sheet "Justifikasi Uptime" spreadsheet "LAPORAN KENDALA DEVICE CONTROL ROOM" (LH.KENDALA_ID):
 *     setiap Nopol yang tercatat pada satu tanggal = 100%, yang Status-nya Offline = offline.
 *     Bulanan: jumlah Nopol tercatat dan offline dijumlahkan untuk semua tanggal di bulan itu.
 *     Lokasi & area tiap Nopol diambil dari sheet Master GPS / Master CCTV.
 *   - RTC (jumlah & online) serta nama Operator / Fleet Supervisor diisi lewat form Input Harian di halaman ini,
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
  KENDALA_ID: '1XL7AskYFqEQBIrISThFTaJ3dNrVrMZi10202a-vO3zE',   // spreadsheet "LAPORAN KENDALA DEVICE CONTROL ROOM"
};
/** 14 jenis event laporan: judul tabel, judul grafik, teks Case yang masuk, dan nama parameter Pemetaan (cadangan). */
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
    .setTitle('Laporan Operasional GPS & Dashcam')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Alamat halaman Laporan, untuk tombol di dashboard bulanan (hanya tampil untuk akun Control Room). */
/** Laporan Harian (dan export PDF-nya) untuk akun Command Center (AREA). false = disembunyikan; ubah ke true untuk memunculkan kembali. */
const LH_UNTUK_AREA = false;
function urlLaporanHarian(peran) { return peran === 'AREA' && !LH_UNTUK_AREA ? '' : ScriptApp.getService().getUrl() + '?laporan=harian'; }
/** Sesi untuk halaman Laporan; akun AREA ditolak selama LH_UNTUK_AREA = false. */
function sesiLH_(token) {
  const ses = sesi_(token);
  if (ses.peran === 'AREA' && !LH_UNTUK_AREA) throw new Error('Laporan Harian sedang tidak tersedia untuk akun Command Center.');
  return ses;
}

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
  const ses = sesiLH_(token);
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
 * Isi laporan untuk satu hari (periode yyyy-mm-dd) atau satu bulan (periode yyyy-mm) dan cakupan.
 * Baris tabel = lokasi dalam cakupan (Pusat tanpa pilihan area: per Area).
 */
function lhLaporan(token, periode, area, lokasi) {
  const ses = sesiLH_(token), p = teks(periode), bulanan = /^\d{4}-\d{1,2}$/.test(p);
  const tg = tanggalTeks(bulanan ? p + '-01' : p);
  if (!tg) throw new Error('Tanggal tidak valid.');
  const m = tg.m, hari = bulanan ? null : tg.d;
  const c = cakupanLH_(ses, area, lokasi), E = eventBulanLH_(m), J = kendalaBulan_(m), perArea = ses.peran === 'PUSAT' && !c.area && !c.lok;
  const info = lokasiLH_(ses), areaLok = {};
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
  const V = LH_PANEL.map(() => []), evHari = {};
  let adaEvent = false;
  Object.keys(E.tanggal).filter(diHari).forEach(d => E.tanggal[d].forEach(r => {
    if (!masuk(r[0], r[1])) return;
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
  const inp = bacaInputLH_().filter(r => r.tanggal >= awal && r.tanggal <= akhir && masuk(r.lokasi, r.area));
  const jml = a => inp.reduce((s, r) => s + (r[a] || 0), 0);
  const satu = !bulanan && c.lok && inp.length === 1 ? inp[0] : null;   // nama operator/supervisor hanya untuk laporan harian satu lokasi
  const nHari = bulanan ? new Date(CFG.TAHUN, m + 1, 0).getDate() : 1;

  return JSON.stringify({
    mode: bulanan ? 'bulanan' : 'harian', periode: bulanan ? awal.slice(0, 7) : awal,
    area: c.area || (c.lok ? areaDari(c.lok, '') : ''),
    lokasi: c.lok || (c.area ? 'Command Center ' + c.area : 'Semua Area'), baris: perArea ? 'Area' : 'Lokasi', sumber: E.sumber,
    panel: LH_PANEL.map((pn, i) => ({ tabel: pn.tabel, grafik: pn.grafik, rows: baris.map((n, j) => ({ n: n, v: V[i][j] || 0 })), total: V[i].reduce((s, v) => s + (v || 0), 0) })),
    perangkat: {
      gps: bagi(up.gps), dashcam: bagi(up.cctv), rtc: { terpasang: jml('rtcT'), online: jml('rtcO') },
      adaJustifikasi: adaJust, lokasiInput: inp.length, lokasiCakupan: perArea ? info.length : baris.length,
    },
    perBaris: baris.map((n, i) => ({ n: n, gps: bagi((upBaris[i] || kosong()).gps), dashcam: bagi((upBaris[i] || kosong()).cctv), event: V.reduce((s, x) => s + (x[i] || 0), 0) })),
    perHari: bulanan ? Array.from({ length: nHari }, (_, k) => { const d = k + 1, u = upHari[d] || kosong();
      return { d: d, event: (evHari[d] || []).reduce((s, v) => s + v, 0), gps: bagi(u.gps), dashcam: bagi(u.cctv) }; }) : [],
    offline: offline, offlineTotal: offSemua.length,
    operator: satu ? satu.operator : '', supervisor: satu ? satu.supervisor : '', operatorTtd: satu ? ttdLH_(satu.lokasi, satu.operator) : '',
    adaEvent: adaEvent,
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
 * Lokasi & area diambil dari Master GPS / Master CCTV berdasarkan Nopol (cadangan: kolom Lokasi + Master Lokasi).
 * { hari: { d: [[lokasi, area, jenis, jumlahNopol, nopolOffline], ...] }, off: [[d, lokasi, area, lokasiDiSheet, perangkat, nopol, durasi, justifikasi, keterangan], ...] }
 * Cache 10 menit.
 */
function kendalaBulan_(m) {
  const kunci = 'LHJU2_' + m, ada = ambilCache_(kunci);
  if (ada) return JSON.parse(ada);
  const ss = SpreadsheetApp.openById(LH.KENDALA_ID), v = nilaiSheet(ss, 'Justifikasi Uptime') || [], k = petaKolom(v[0] || []);
  const kol = awalan => { const h = Object.keys(k).filter(x => x.indexOf(awalan) === 0)[0]; return h === undefined ? undefined : k[h]; };
  const iT = k['TANGGAL'], iL = k['LOKASI'], iP = k['PERANGKAT'], iN = k['NOPOL'], iS = k['STATUS'], iD = kol('DURASI'), iJ = kol('JUSTIFIKASI'), iK = kol('KETERANGAN');
  if (iT === undefined || iL === undefined || iP === undefined || iN === undefined) throw new Error('Sheet Justifikasi Uptime harus punya kolom Tanggal, Lokasi, Perangkat, dan Nopol.');
  // lokasi & area resmi tiap Nopol dari Master GPS / Master CCTV (Justifikasi bisa memakai nama unit yang lebih rinci)
  const kunciNopol = x => teks(x).toUpperCase().replace(/[^A-Z0-9]/g, ''), M = { gps: {}, cctv: {} }, areaL = {};
  const muat = (nama, f) => { const w = nilaiSheet(ss, nama) || [], h = petaKolom(w[0] || []); w.slice(1).forEach(r => f(r, h)); };
  muat('Master Lokasi', (r, h) => { const l = teks(r[h['LOKASI']]).toUpperCase(); if (l) areaL[kunciLok(l)] = areaNorm(r[h['AREA']]); });
  [['gps', 'Master GPS'], ['cctv', 'Master CCTV']].forEach(([j, nama]) => muat(nama, (r, h) => {
    const n = kunciNopol(r[h['NOPOL']]), l = teks(r[h['LOKASI']]).toUpperCase();
    if (n && l) M[j][n] = [ALIAS_LOKASI[l] || l, areaNorm(r[h['AREA']]) || areaL[kunciLok(l)] || ''];
  }));
  const N = {};   // d|lokasi|jenis|nopol -> [d, lokasi, area, jenis, offline, baris]
  v.slice(1).forEach(r => {
    const tg = tglKendala_(r[iT]), jenis = jenisPerangkat_(teks(r[iP])), lokAsli = teks(r[iL]).toUpperCase(), nopol = kunciNopol(r[iN]);
    if (!tg || tg.m !== m || !jenis || !lokAsli || !nopol) return;
    const [lok, area] = M[jenis][nopol] || M[jenis === 'gps' ? 'cctv' : 'gps'][nopol] || [ALIAS_LOKASI[lokAsli] || lokAsli, areaL[kunciLok(lokAsli)] || ''];
    const off = iS !== undefined && teks(r[iS]) ? /OFF/i.test(teks(r[iS])) : (angka(iD === undefined ? 0 : r[iD]) || 0) > 0;
    const u = tg.d + '|' + kunciLok(lok) + '|' + jenis + '|' + nopol, o = N[u] || (N[u] = [tg.d, lok, area, jenis, false, null]);
    if (off && !o[4]) { o[4] = true; o[5] = r; }   // satu kendaraan dihitung sekali per hari
  });
  const H = {}, out = { hari: {}, off: [] };
  Object.keys(N).forEach(u => {
    const [d, lok, area, jenis, off, r] = N[u], kk = d + '|' + kunciLok(lok) + '|' + jenis;
    (H[kk] || (H[kk] = [d, lok, area, jenis, 0, 0]))[4]++;
    if (!off) return;
    H[kk][5]++;
    out.off.push([d, lok, area, teks(r[iL]), teks(r[iP]), teks(r[iN]), iD === undefined ? '' : angka(r[iD]) || 0, iJ === undefined ? '' : teks(r[iJ]), iK === undefined ? '' : teks(r[iK])]);
  });
  Object.keys(H).forEach(kk => { const x = H[kk]; (out.hari[x[0]] = out.hari[x[0]] || []).push(x.slice(1)); });
  out.off.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  simpanCache_(JSON.stringify(out), kunci, 600);
  return out;
}

const teksTanggal_ = tg => CFG.TAHUN + '-' + ('0' + (tg.m + 1)).slice(-2) + '-' + ('0' + tg.d).slice(-2);

/* ---- Input harian GPS / Dashcam / RTC ---- */
function sheetInputLH_() {
  const ss = bukaAtauBuat(DriveApp.getFolderById(CFG.FOLDER_ID), LH.INPUT_NAMA, [['Input', LH.INPUT_HDR]]);
  LH.ss = ss;
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
  const ses = sesiLH_(token), tg = tanggalTeks(tanggal), lok = ses.peran === 'LOKASI' ? ses.lok : teks(lokasi).toUpperCase();
  if (!tg || !lok) return JSON.stringify({ ada: null, sebelumnya: null });
  const t = teksTanggal_(tg), L = bacaInputLH_().filter(r => kunciLok(r.lokasi) === kunciLok(lok));
  const sebelum = L.filter(r => r.tanggal < t).sort((a, b) => a.tanggal < b.tanggal ? 1 : -1)[0] || null;
  const ada = L.filter(r => r.tanggal === t)[0] || null, isi = ada || sebelum;
  return JSON.stringify({ ada: ada, sebelumnya: sebelum, ttd: isi ? ttdLH_(isi.lokasi, isi.operator) : '' });
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
  const rT = n(o.rtcT, 'Jumlah RTC'), rO = n(o.rtcO, 'RTC online');
  if (rO > rT) throw new Error('Jumlah RTC online tidak boleh lebih dari jumlah RTC.');
  const t = teksTanggal_(tg), baru = [t, L.a, L.n, '', '', '', '', rT, rO, teks(o.operator), teks(o.supervisor), ses.u || ses.nama, new Date()];
  const kunci = LockService.getScriptLock(); kunci.waitLock(10000);
  try {
    const sh = sheetInputLH_(), v = sh.getDataRange().getValues();
    const i = v.findIndex((r, j) => j > 0 && tanggalTeks(r[0]) && teksTanggal_(tanggalTeks(r[0])) === t && kunciLok(r[2]) === kunciLok(L.n));
    if (i > 0) sh.getRange(i + 1, 1, 1, baru.length).setValues([baru]); else sh.appendRow(baru);
    CacheService.getScriptCache().remove('LHIN');
    // tanda tangan: o.ttd = data URI baru, '' = hapus, undefined = tidak diubah
    if (o.ttd !== undefined && teks(o.operator)) {
      if (o.ttd && (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+\/=]+$/.test(o.ttd) || o.ttd.length > 45000)) throw new Error('File tanda tangan tidak valid atau terlalu besar.');
      simpanTtdLH_(L.n, o.operator, o.ttd || null, ses.u || ses.nama);
    }
  } finally { kunci.releaseLock(); }
  return JSON.stringify({ ok: true, lokasi: L.n, tanggal: t });
}

/* ---- Tanda tangan Operator: sheet "TTD" di spreadsheet input, satu baris per lokasi + nama operator.
   Gambar disimpan sebagai data URI PNG (diperkecil di browser, < 45.000 karakter = muat dalam satu sel). ---- */
const TTD_HDR = ['Lokasi', 'Nama Operator', 'Tanda Tangan', 'Diubah oleh', 'Waktu'];
function sheetTtdLH_() { if (!LH.ss) sheetInputLH_(); return sheetAtauBuat(LH.ss, 'TTD', TTD_HDR); }
const kunciTtd_ = (lok, nama) => kunciLok(lok) + '|' + teks(nama).toUpperCase();
function ttdLH_(lok, nama) {
  if (!teks(nama)) return '';
  const c = CacheService.getScriptCache(), k = 'LHTTD_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, kunciTtd_(lok, nama))).slice(0, 16);
  const ada = c.get(k); if (ada !== null) return ada;
  const r = sheetTtdLH_().getDataRange().getValues().slice(1).filter(x => kunciTtd_(x[0], x[1]) === kunciTtd_(lok, nama))[0];
  const out = r && /^data:image\/(png|jpeg);base64,/.test(teks(r[2])) ? teks(r[2]) : '';
  try { c.put(k, out, LH.CACHE_DETIK); } catch (e) { /* tanpa cache */ }
  return out;
}
function simpanTtdLH_(lok, nama, gambar, oleh) {
  const sh = sheetTtdLH_(), v = sh.getDataRange().getValues(), i = v.findIndex((x, j) => j > 0 && kunciTtd_(x[0], x[1]) === kunciTtd_(lok, nama));
  if (gambar === null) { if (i > 0) sh.deleteRow(i + 1); }
  else { const baru = [lok, teks(nama), gambar, oleh, new Date()]; if (i > 0) sh.getRange(i + 1, 1, 1, baru.length).setValues([baru]); else sh.appendRow(baru); }
  CacheService.getScriptCache().remove('LHTTD_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, kunciTtd_(lok, nama))).slice(0, 16));
}
/** Pratinjau tanda tangan di form input (lokasi + nama operator). */
function lhTtd(token, lokasi, nama) {
  const ses = sesiLH_(token), lok = ses.peran === 'LOKASI' ? ses.lok : teks(lokasi).toUpperCase();
  const L = lokasiLH_(ses).filter(x => kunciLok(x.n) === kunciLok(lok))[0];
  return L ? ttdLH_(L.n, nama) : '';
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
