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
 *  - doGet()            : web app.
 *  - getDashboardData() : dipanggil dashboard; hasil di-cache 6 jam (jalankan hapusCache setelah data diubah).
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
const AREAS = ['SUMBAGUT I', 'SUMBAGUT II', 'SUMBAGSEL', 'JABALINUS', 'KALIMANTAN', 'SULAWESI', 'MALUPA'];
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
      .addItem('Pasang pemicu otomatis', 'pasangPemicu')
      .addItem('Proses file tarikan sekarang', 'prosesTarikan')
      .addToUi();
  } catch (e) { /* dijalankan dari luar spreadsheet */ }
}

function hapusCache() {
  CacheService.getScriptCache().remove('DASHB3_N');
  CacheService.getScriptCache().remove('DASHB3');
  try { SpreadsheetApp.getActiveSpreadsheet().toast('Cache dihapus. Muat ulang dashboard.', 'Dashboard', 5); } catch (e) { Logger.log('Cache dihapus.'); }
}

/** DIAGNOSA: jalankan dari editor, lihat hasilnya di View > Logs. */
function UJI_BACA_SUMBER() {
  const d = bangunData();
  Logger.log('Bulan berisi data: ' + d.bulanAda.map(m => BULAN[m]).join(', '));
  Logger.log('Parameter: ' + d.params.map(p => p.label + ' (' + p.kat + ')').join('; '));
  Logger.log('Lokasi: ' + d.lok.length + ' | baris fakta: ' + d.fakta.length + ' | baris harian: ' + d.harian.length);
  Logger.log('Top AMT: ' + (d.amt ? d.amt.all.length + ' / ' + d.amt.area.length + ' / ' + d.amt.lok.length + ' baris (semua / area / lokasi)' : 'data AMT belum ada'));
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
  ScriptApp.getProjectTriggers().filter(t => ['panaskanCache', 'prosesTarikan'].indexOf(t.getHandlerFunction()) >= 0).forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('panaskanCache').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('prosesTarikan').timeBased().everyMinutes(15).create();   // file harian baru terbaca maksimal 15 menit setelah diunggah
  panaskanCache();
  Logger.log('Pemicu panaskanCache (tiap jam) dan prosesTarikan (tiap 15 menit) terpasang dan cache sudah diisi. Jalankan prosesTarikan sekali untuk mulai membaca file tarikan.');
}

function simpanCache(json) {
  try {
    const parts = {}, size = 90000;
    for (let i = 0; i * size < json.length; i++) parts['DASHB3_' + i] = json.substr(i * size, size);
    parts.DASHB3_N = String(Object.keys(parts).length);
    CacheService.getScriptCache().putAll(parts, CFG.CACHE_DETIK);
  } catch (e) { /* tanpa cache */ }
}

function getDashboardData() {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('DASHB3_N') || 0);
  if (n) {
    const keys = []; for (let i = 0; i < n; i++) keys.push('DASHB3_' + i);
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
  return hitung(EV, AM, peta, catatan, peringatan);
}

function kosong(peringatan) {
  return { tahun: CFG.TAHUN, areas: AREAS, bulanAda: [], params: [], lok: [], fakta: [], harian: [], amt: null, catatan: [], peringatan: peringatan, updated: new Date().toISOString() };
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
  'DRIVER IS NOT USING SEAT-BELT': ['', 'Tidak dihitung'],
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
/** "Sumbagut 1" / "SUMBAGUT I" -> "SUMBAGUT I"; nama area yang tidak dikenal -> '' (area diambil dari lokasinya). */
function areaNorm(x) {
  const s = teks(x).toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().replace(/^SUMBAGUT\s*(1|I)$/, 'SUMBAGUT I').replace(/^SUMBAGUT\s*(2|II)$/, 'SUMBAGUT II');
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

    const antre = daftarTarikan().filter(o => !sudah[o.id] || sudah[o.id].diubah !== o.diubah || /^GAGAL/.test(sudah[o.id].status));   // baru, berubah, atau gagal sebelumnya
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
    if (n) { hapusCache(); try { panaskanCache(); } catch (e) { /* dicoba lagi oleh pemicu */ } }
  } finally { kunci.releaseLock(); }
}

/** Semua file "Tarikan_<REG>_..._<yyyy-mm-dd>" di folder yang terdaftar: [{id, nama, area, tgl, diubah, mime, file}]. */
function daftarTarikan() {
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
    const tb = kol('TBBM'), al = kol('ALARM STATUS'), am = kol('AMT 1'), gid = kol('ALERT GROUP ID');
    if (!tb || !al) throw new Error('kolom TBBM / Alarm Status tidak ditemukan');
    const ev = {}, amt = {}, lihat = {};
    let n = 0;
    for (let i = 0; i < nr; i++) {
      const c = normKasus(al[i][0]); if (!c) continue;
      const g = gid ? teks(gid[i][0]) : '';
      if (g) { if (lihat[g]) continue; lihat[g] = 1; }   // baris dobel (Alert Group ID sama) dihitung sekali
      const lok = teks(tb[i][0]).toUpperCase();
      const ke = lok + '\u0001' + c; ev[ke] = (ev[ke] || 0) + 1; n++;
      const nama = am ? namaAmt(am[i][0]) : '';
      if (nama) { const ka = lok + '\u0001' + nama + '\u0001' + c; amt[ka] = (amt[ka] || 0) + 1; }
    }
    const m = +o.tgl.slice(5, 7);
    const ss = bukaAtauBuat(folder, 'Tarikan ' + ('0' + m).slice(-2) + ' ' + BULAN[m - 1].charAt(0) + BULAN[m - 1].slice(1).toLowerCase() + ' ' + CFG.TAHUN,
      [['Event', ['Tanggal', 'Area', 'Lokasi', 'Case', 'Jumlah', 'Sumber']], ['AMT', ['Area', 'Lokasi', 'Nama AMT', 'Case', 'Jumlah', 'Sumber']]]);
    ss.getSheetByName('Event').getRange('A:A').setNumberFormat('@');   // tanggal disimpan sebagai teks yyyy-mm-dd
    gantiBaris(ss.getSheetByName('Event'), o.id, Object.keys(ev).map(x => { const p = x.split('\u0001'); return [o.tgl, o.area, p[0], p[1], ev[x], o.id]; }));
    gantiBaris(ss.getSheetByName('AMT'), o.id, Object.keys(amt).map(x => { const p = x.split('\u0001'); return [o.area, p[0], p[1], p[2], amt[x], o.id]; }));
    return n;
  } finally {
    if (sementara) try { DriveApp.getFileById(sementara).setTrashed(true); } catch (e) { /* abaikan */ }
  }
}

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
 *   amt    : { all, area, lok } -> [[bulan (-2 = YTD), indeks area, indeks lokasi, nama AMT, DB, DD, FM, total, indeks parameter terbanyak]]
 *            10 teratas per bulan untuk semua area, per area, dan per lokasi.
 */
function hitung(EV, AM, peta, catatan, peringatan) {
  const ada = {}; EV.forEach(e => { ada[e[0]] = 1; });
  const bulanAda = Object.keys(ada).map(Number).sort((a, b) => a - b);

  const params = [], pIdx = {};
  peta.urut.filter(o => o.k !== 'LAIN').forEach(o => {
    const P = o.p.toUpperCase();
    pIdx[o.p] = params.length;
    params.push({ key: o.p, label: o.p, kat: PINDAH_KATEGORI[P] || o.k, katAsal: o.k, tipe: TIPE[P] || '-' });
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

  // AMT: jumlah per (bulan & YTD) x area x lokasi x nama, lalu 10 teratas per kelompok
  const X = {};
  AM.forEach(r => {
    const [m, a0, l0, nama, p, k, n] = r, pi = pIdx[p];
    if (pi === undefined) return;
    const l = namaLok(l0), a = areaLok(l0) || a0;
    if (!a) return;
    const ai = AREAS.indexOf(a), L = li(l, ai), kat = params[pi].kat;
    [m, -2].forEach(b => {
      const key = b + '|' + L + '|' + nama;
      const o = X[key] || (X[key] = { b: b, a: ai, l: L, nama: nama, DB: 0, DD: 0, FM: 0, t: 0, par: {} });
      o[kat] += n; o.t += n; o.par[pi] = (o.par[pi] || 0) + n;
    });
  });
  const terbesar = obj => +(Object.keys(obj).sort((a, b) => obj[b] - obj[a])[0] || 0);
  const gabung = (rows, kunci) => {   // gabung baris lokasi menjadi per area / semua area
    const G = {};
    rows.forEach(o => {
      const key = kunci(o) + '|' + o.nama;
      const g = G[key] || (G[key] = { b: o.b, nama: o.nama, DB: 0, DD: 0, FM: 0, t: 0, par: {}, lokT: {}, areaT: {} });
      g.DB += o.DB; g.DD += o.DD; g.FM += o.FM; g.t += o.t;
      Object.keys(o.par).forEach(p => g.par[p] = (g.par[p] || 0) + o.par[p]);
      g.lokT[o.l] = (g.lokT[o.l] || 0) + o.t; g.areaT[o.a] = (g.areaT[o.a] || 0) + o.t;
    });
    return Object.keys(G).map(k => { const g = G[k]; return { b: g.b, a: terbesar(g.areaT), l: terbesar(g.lokT), nama: g.nama, DB: g.DB, DD: g.DD, FM: g.FM, t: g.t, par: g.par }; });
  };
  const top10 = (rows, grup) => {
    const G = {}; rows.forEach(o => (G[grup(o)] = G[grup(o)] || []).push(o));
    const out = [];
    Object.keys(G).forEach(g => G[g].sort((a, b) => b.t - a.t).slice(0, 10).forEach(o => out.push([o.b, o.a, o.l, o.nama, o.DB, o.DD, o.FM, o.t, terbesar(o.par)])));
    return out;
  };
  const xr = Object.keys(X).map(k => X[k]);
  const amt = AM.length ? {
    lok: top10(xr, o => o.b + '|' + o.l),
    area: top10(gabung(xr, o => o.b + '|' + o.a), o => o.b + '|' + o.a),
    all: top10(gabung(xr, o => o.b), o => o.b),
  } : null;

  return {
    tahun: CFG.TAHUN, areas: AREAS, bulanAda: bulanAda, params: params, lok: lok,
    fakta: Object.keys(F).map(k => F[k]), harian: Object.keys(H).map(k => H[k]), amt: amt,
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


