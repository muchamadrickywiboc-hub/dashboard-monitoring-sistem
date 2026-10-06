/**
 * DASHBOARD MONITORING DRIVING BEHAVIOUR, DRIVER DISCIPLINE & FATIGUE
 * Versi REKAP BULANAN (Google Apps Script)
 *
 * Sumber data: file "Fom Laporan Bulanan GPS & Dashcam Mobil Tangki - <REGIONAL> <BULAN>.xlsx"
 * di folder CFG.FOLDER_DATA_ID. Yang dibaca hanya sheet rekap bulanan
 * ("Rekap Bulanan" / "REKAP BULANAN 2026" / "Rekapan Bulan" / "REKAPAN BULANAN"):
 * blok per lokasi (IT/FT/LPG) berisi parameter x Januari..Desember.
 *
 *  - prosesData()  : dijalankan trigger tiap jam. Untuk tiap regional diambil file TERBARU
 *                    di folder; bila file berubah, sheet rekapnya dibaca ulang dan isi
 *                    sheet DATA_BULANAN untuk regional tsb diganti.
 *  - doGet()       : web app; dashboard membaca DATA_BULANAN lewat getDashboardData().
 *
 * Pemasangan: tempel Kode.gs + Index.html, lalu jalankan MULAI_DI_SINI sekali.
 *
 * PERBAIKAN versi ini:
 *  - Sheet DATA_BULANAN / FILE_SUMBER dibuat otomatis bila belum ada (memperbaiki error
 *    "Cannot read properties of null (reading 'getLastRow')").
 *  - File .xlsx dibaca LANGSUNG (unzip + XML), tidak lagi dikonversi lewat Drive API/UrlFetchApp,
 *    sehingga error "You do not have permission to call drive.files.copy / UrlFetchApp.fetch" hilang.
 *  - Pencarian sheet rekap & pembacaan blok PARAMETER lebih toleran.
 */

/* ============================== PENGATURAN ============================== */
const CFG = {
  CTRL_ID: '17n0HQa78drV6u_kq9-oFMOZ6E_Lne0sAWw6w9PFJ_Dc',     // spreadsheet kontrol
  FOLDER_DATA_ID: '1XW9CBuZrbZ7ClI23v1kn7iRwxv73bgQj',          // folder "Kebutuhan Dashboard Monitoring Event Sistem"
  TAHUN: 2026,                 // tahun rekap yang dibaca
  JAM_TRIGGER: 1,              // proses otomatis tiap N jam
  SHEET_DATA: 'DATA_BULANAN',
  SHEET_FILE: 'FILE_SUMBER',
};

const REGIONS = ['SUMBAGUT', 'SUMBAGSEL', 'JABALINUS', 'KALIMANTAN', 'SULAWESI', 'MALUPA'];
const BULAN = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];

/**
 * Parameter laporan -> kode standar, tipe alat & kategori dashboard.
 * Kategori: DB = Driving Behaviour, DD = Driver Discipline, FM = Fatigue Management, LAIN = di luar 3 kategori.
 * Nama parameter di laporan dicocokkan setelah huruf besar & tanpa keterangan dalam kurung.
 */
const PARAM = [
  { key: 'OVERSPEED',    label: 'Over Speed',          tipe: 'GPS',  kat: 'DB',   alias: ['OVER SPEED', 'OVERSPEED'] },
  { key: 'HARSH_TURN',   label: 'Harsh Turn / Cornering', tipe: 'GPS', kat: 'DB', alias: ['HARSH CONNERING', 'HARSH CORNERING', 'HARSH TURN'] },
  { key: 'HARSH_BRAKE',  label: 'Harsh Braking',       tipe: 'GPS',  kat: 'DB',   alias: ['HARSH BREAKE', 'HARSH BREAKING', 'HARSH BRAKE', 'HARSH BRAKING'] },
  { key: 'HARSH_ACC',    label: 'Harsh Acceleration',  tipe: 'GPS',  kat: 'DB',   alias: ['HARSH ACCELERATION'] },
  { key: 'BLACKZONE',    label: 'Black Zone',          tipe: 'GPS',  kat: 'DD',   alias: ['BLACK ZONE', 'BLACKZONE'] },
  { key: 'IDLING',       label: 'Idling',              tipe: 'GPS',  kat: 'DD',   alias: ['IDLING', 'IDLE', 'MT IDLE'] },
  { key: 'TELEPON',      label: 'Menggunakan Telepon', tipe: 'CCTV', kat: 'DD',   alias: ['MENGGUNAKAN TELEPON', 'PHONE DETECTION'] },
  { key: 'MEROKOK',      label: 'Merokok / Vape',      tipe: 'CCTV', kat: 'DD',   alias: ['MEROKOK/VAPE', 'MEROKOK / VAPE', 'MEROKOK', 'SMOKING DETECTION'] },
  { key: 'MICROSLEEP',   label: 'Microsleep',          tipe: 'CCTV', kat: 'FM',   alias: ['MICROSLEEP', 'DRIVER FATIGUE'] },
  { key: 'MENGUAP',      label: 'Menguap',             tipe: 'CCTV', kat: 'FM',   alias: ['MENGUAP', 'YAWNING DETECTION'] },
  { key: 'DRIVING4H',    label: 'Driving > 4 Hours',   tipe: 'GPS',  kat: 'DB',   alias: ['DRIVING > 4 HOURS', 'DRIVING >4 HOURS', 'DRIVING > 4 JAM'] },
  { key: 'DISTRACTION',  label: 'Distraction Pengemudi', tipe: 'CCTV', kat: 'LAIN', alias: ['DISTRACTION PENGEMUDI', 'DRIVER DISTRACTION'] },
  { key: 'CAMCOVER',     label: 'Camera Covering',     tipe: 'CCTV', kat: 'LAIN', alias: ['CAMERA COVERING', 'CAMERA COVERING ALARM'] },
  { key: 'GPS_OFF',      label: 'GPS Offline',         tipe: 'GPS',  kat: 'LAIN', alias: ['GPS OFFLINE'] },
  { key: 'DASHCAM_OFF',  label: 'Dashcam Offline',     tipe: 'CCTV', kat: 'LAIN', alias: ['DASHCAM OFFLINE'] },
];

/* ============================== MULAI DI SINI ============================== */
/**
 * JALANKAN SEKALI dari editor (pilih MULAI_DI_SINI > Run):
 *  - menghapus data lama (ringkasan harian/jam September, daftar sumber, log impor, progres)
 *  - menyiapkan sheet FILE_SUMBER & DATA_BULANAN
 *  - memasang proses otomatis tiap jam dan langsung membaca folder sumber
 */
function MULAI_DI_SINI() {
  const ss = ctrl();
  siapkanSheetPada(ss);      // buat sheet baru dulu (spreadsheet harus selalu punya minimal 1 sheet)
  hapusDataLama(ss);
  pasangTrigger();
  const hasil = prosesData(true);
  Logger.log('Selesai. ' + hasil);
  Logger.log('Langkah berikut: Deploy > Manage deployments > Edit > Version: New version > Deploy (atau New deployment > Web app).');
}

/** Menghapus semua sheet & pengaturan dari versi data harian sebelumnya. */
function hapusDataLama(ss) {
  ['SUMBER', 'IMPOR', 'PROGRES', 'RINGKASAN_JAM', 'RINGKASAN_UNIT', 'RINGKASAN_LAIN'].forEach(n => {
    const sh = ss.getSheetByName(n);
    if (sh && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
  const props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).forEach(k => { if (k.indexOf('MON_') === 0 || k === 'LAST_RUN') props.deleteProperty(k); });
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'prosesData').forEach(t => ScriptApp.deleteTrigger(t));
  hapusCache();
}

/* ============================== MENU ============================== */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Dashboard')
    .addItem('Proses data sekarang', 'prosesDataManual')
    .addItem('Baca ulang semua file', 'bacaUlangSemua')
    .addSeparator()
    .addItem('Aktifkan proses otomatis', 'aktifkanTrigger')
    .addItem('Matikan proses otomatis', 'matikanTrigger')
    .addItem('Hapus cache dashboard', 'hapusCache')
    .addToUi();
}

function ctrl() {
  const id = CFG.CTRL_ID || PropertiesService.getScriptProperties().getProperty('CTRL_ID');
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Isi CFG.CTRL_ID dengan ID spreadsheet kontrol.');
  return ss;
}

function beritahu(pesan) {
  try { SpreadsheetApp.getUi().alert(pesan); } catch (e) { Logger.log(pesan); }
}

function siapkanSheetPada(ss) {
  const buat = (nama, header, lebar) => {
    let sh = ss.getSheetByName(nama);
    if (!sh) sh = ss.insertSheet(nama);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, header.length).setValues([header])
        .setFontWeight('bold').setBackground('#4a7a53').setFontColor('#ffffff');
      sh.setFrozenRows(1);
      (lebar || []).forEach((w, i) => sh.setColumnWidth(i + 1, w));
    }
    return sh;
  };
  buat(CFG.SHEET_FILE, ['Regional', 'Nama File', 'ID File', 'Diubah', 'Sheet Rekap', 'Jumlah Lokasi', 'Bulan Terakhir', 'Diproses', 'Status'],
    [110, 420, 10, 150, 170, 110, 120, 150, 380]).hideColumns(3);
  buat(CFG.SHEET_DATA, ['Regional', 'Lokasi', 'Kode Parameter', 'Parameter (laporan)', 'Tipe', 'Kategori'].concat(BULAN.map(b => b.charAt(0) + b.slice(1).toLowerCase())),
    [110, 190, 120, 200, 60, 80]);
  const awal = ss.getSheetByName('Sheet1') || ss.getSheetByName('Sheet 1') || ss.getSheetByName('Lembar1');
  if (awal && awal.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(awal);
}

/** Ambil sheet; bila belum ada, siapkan semua sheet dulu (anti error "null.getLastRow"). */
function getSh(ss, nama) {
  let sh = ss.getSheetByName(nama);
  if (!sh) { siapkanSheetPada(ss); sh = ss.getSheetByName(nama); }
  if (!sh) throw new Error('Sheet "' + nama + '" tidak bisa dibuat di spreadsheet kontrol.');
  return sh;
}

function pasangTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'prosesData').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('prosesData').timeBased().everyHours(CFG.JAM_TRIGGER).create();
}
function aktifkanTrigger() { pasangTrigger(); beritahu('Proses otomatis aktif setiap ' + CFG.JAM_TRIGGER + ' jam.'); }
function matikanTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'prosesData').forEach(t => ScriptApp.deleteTrigger(t));
  beritahu('Proses otomatis dimatikan.');
}
function prosesDataManual() {
  const hasil = prosesData();
  try { ctrl().toast(hasil, 'Proses data', 10); } catch (e) { Logger.log(hasil); }
}
function bacaUlangSemua() {
  const hasil = prosesData(true);
  beritahu(hasil);
}

/* ============================== PROSES ============================== */
/**
 * Membaca folder sumber. Untuk tiap regional dipakai file yang paling baru diubah.
 * File hanya dibaca ulang bila berubah (atau paksa = true).
 */
function prosesData(paksa) {
  paksa = paksa === true;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return 'Proses lain masih berjalan.';
  const pesan = [];
  try {
    const ss = ctrl();
    siapkanSheetPada(ss);
    const log = bacaLogFile(ss);
    const pilihan = pilihFileTerbaru();                 // {REGIONAL: {id,nama,mime,updated}}
    const data = bacaData(ss);                          // {REGIONAL: [baris...]}
    let berubah = false;

    // regional yang filenya sudah tidak ada di folder -> datanya dihapus
    Object.keys(data).forEach(r => { if (!pilihan[r]) { delete data[r]; delete log[r]; berubah = true; } });

    Object.keys(pilihan).forEach(r => {
      const f = pilihan[r], L = log[r];
      if (!paksa && L && L.id === f.id && L.updated === f.updated && L.status === 'OK') return;
      const rec = { regional: r, nama: f.nama, id: f.id, updated: f.updated, sheet: '', lokasi: 0, bulan: '', diproses: new Date(), status: '' };
      try {
        const rekap = ambilRekap(f);
        if (!rekap) throw new Error('Sheet rekap bulanan tidak ditemukan (nama sheet harus memuat kata "Rekap")');
        const blok = parseRekap(rekap.values);
        if (!blok.length) throw new Error('Tidak ada blok PARAMETER di sheet "' + rekap.nama + '"');
        data[r] = blok.map(b => {
          const p = cocokParam(b.param);
          return [r, b.lokasi, p.key, b.param, p.tipe, p.kat].concat(b.vals.map(v => v === null ? '' : v));
        });
        const lastM = bulanTerakhir(blok);
        rec.sheet = rekap.nama;
        rec.lokasi = new Set(blok.map(b => b.lokasi)).size;
        rec.bulan = lastM >= 0 ? BULAN[lastM] : '-';
        rec.status = 'OK';
        berubah = true;
        pesan.push(r + ': ' + rec.lokasi + ' lokasi, s/d ' + rec.bulan);
      } catch (e) {
        rec.status = 'Gagal: ' + e.message;
        pesan.push(r + ': GAGAL - ' + e.message);
      }
      log[r] = rec;
    });

    if (berubah) { tulisData(ss, data); hapusCache(); }
    tulisLogFile(ss, log);
    hapusCache();
    PropertiesService.getScriptProperties().setProperty('LAST_RUN', new Date().toISOString());
  } finally {
    lock.releaseLock();
  }
  return pesan.length ? pesan.join(' | ') : 'Tidak ada file yang berubah.';
}

/** Untuk tiap regional (dibaca dari nama file) ambil file Excel/Google Sheets yang paling baru diubah. */
function pilihFileTerbaru() {
  const excel = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
    'application/vnd.ms-excel.sheet.macroEnabled.12'];
  const out = {};
  const it = DriveApp.getFolderById(CFG.FOLDER_DATA_ID).getFiles();
  while (it.hasNext()) {
    const f = it.next(), mt = f.getMimeType();
    if (mt !== MimeType.GOOGLE_SHEETS && excel.indexOf(mt) < 0) continue;
    const nama = f.getName(), up = nama.toUpperCase();
    if (up.indexOf('_TMP_') === 0) continue;            // abaikan salinan sementara
    const r = REGIONS.filter(x => up.indexOf(x) >= 0)[0];
    if (!r) continue;
    const t = f.getLastUpdated().getTime();
    if (!out[r] || t > out[r].t) out[r] = { id: f.getId(), nama: nama, mime: mt, t: t, updated: new Date(t).toISOString() };
  }
  return out;
}

/* ===== Pembaca file Excel (.xlsx) langsung, TANPA konversi, TANPA Drive API / UrlFetchApp ===== */
const NS_M = XmlService.getNamespace('http://schemas.openxmlformats.org/spreadsheetml/2006/main');
const NS_R = XmlService.getNamespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships');
const NS_REL = XmlService.getNamespace('http://schemas.openxmlformats.org/package/2006/relationships');

/** Ambil sheet rekap dari satu file sumber -> {nama, values} atau null bila sheet rekap tidak ada. */
function ambilRekap(f) {
  if (f.mime === MimeType.GOOGLE_SHEETS) {
    const sheet = cariSheetRekap(SpreadsheetApp.openById(f.id));
    return sheet ? { nama: sheet.getName(), values: sheet.getDataRange().getValues() } : null;
  }
  return bacaRekapXlsx(DriveApp.getFileById(f.id).getBlob());
}

function skorNamaRekap(nama, tersembunyi) {
  const n = String(nama).toUpperCase();
  if (!/REKAP/.test(n)) return -100;
  let sk = 0;
  if (n.indexOf(String(CFG.TAHUN)) >= 0) sk += 4;
  if (/BULAN/.test(n)) sk += 2;
  if (tersembunyi) sk -= 5;
  return sk;
}

function kolomDariRef(huruf) {
  let c = 0;
  for (let i = 0; i < huruf.length; i++) c = c * 26 + (huruf.charCodeAt(i) - 64);
  return c - 1;
}

function teksSi(el) {
  let s = '';
  el.getChildren().forEach(ch => {
    const n = ch.getName();
    if (n === 't') s += ch.getText();
    else if (n === 'r') { const t = ch.getChild('t', NS_M); if (t) s += t.getText(); }
  });
  return s;
}

/** Membaca sheet rekap dari blob .xlsx dengan membuka zip & XML-nya sendiri. */
function bacaRekapXlsx(blob) {
  let files;
  try { files = Utilities.unzip(blob.copyBlob().setContentType('application/zip')); }
  catch (e) { throw new Error('File bukan .xlsx yang valid (jika .xls lama, simpan ulang sebagai .xlsx)'); }
  const peta = {};
  files.forEach(b => { peta[b.getName()] = b; });
  const teks = n => peta[n] ? peta[n].getDataAsString('UTF-8') : null;

  const wbXml = teks('xl/workbook.xml'), relXml = teks('xl/_rels/workbook.xml.rels');
  if (!wbXml || !relXml) throw new Error('Struktur .xlsx tidak dikenali (workbook.xml tidak ada)');
  const daftar = XmlService.parse(wbXml).getRootElement().getChild('sheets', NS_M).getChildren('sheet', NS_M).map(s => {
    const st = s.getAttribute('state');
    return { nama: s.getAttribute('name').getValue(), rid: s.getAttribute('id', NS_R).getValue(), hidden: !!(st && st.getValue() !== 'visible') };
  });
  const rel = {};
  XmlService.parse(relXml).getRootElement().getChildren('Relationship', NS_REL).forEach(r => {
    let t = r.getAttribute('Target').getValue().replace(/^\//, '');
    if (t.indexOf('xl/') !== 0) t = 'xl/' + t;
    rel[r.getAttribute('Id').getValue()] = t;
  });

  const kand = daftar.map(d => ({ d: d, k: skorNamaRekap(d.nama, d.hidden) })).filter(x => x.k > -100).sort((a, b) => b.k - a.k);
  if (!kand.length) return null;
  const pilih = kand[0].d;
  const xmlSheet = teks(rel[pilih.rid]);
  if (!xmlSheet) throw new Error('Isi sheet "' + pilih.nama + '" tidak ditemukan di dalam file');

  const ss = [];
  const ssXml = teks('xl/sharedStrings.xml');
  if (ssXml) XmlService.parse(ssXml).getRootElement().getChildren('si', NS_M).forEach(si => ss.push(teksSi(si)));

  const sel = [];
  let maxR = -1, maxC = -1, rowNo = 0;
  XmlService.parse(xmlSheet).getRootElement().getChild('sheetData', NS_M).getChildren('row', NS_M).forEach(row => {
    const ra = row.getAttribute('r');
    const ri = ra ? Number(ra.getValue()) - 1 : rowNo;
    rowNo = ri + 1;
    row.getChildren('c', NS_M).forEach(c => {
      const m = /^([A-Z]+)(\d+)$/.exec(c.getAttribute('r').getValue());
      if (!m) return;
      const t = c.getAttribute('t'), tipe = t ? t.getValue() : 'n';
      const v = c.getChild('v', NS_M);
      let val = '';
      if (tipe === 'inlineStr') { const is = c.getChild('is', NS_M); val = is ? teksSi(is) : ''; }
      else if (v) {
        const tx = v.getText();
        if (tipe === 's') val = ss[Number(tx)] !== undefined ? ss[Number(tx)] : '';
        else if (tipe === 'str' || tipe === 'b') val = tx;
        else if (tipe === 'e') val = '';
        else val = tx === '' ? '' : Number(tx);
      }
      if (val === '' || val === null) return;
      const ci = kolomDariRef(m[1]);
      sel.push([ri, ci, val]);
      if (ri > maxR) maxR = ri;
      if (ci > maxC) maxC = ci;
    });
  });
  const values = [];
  for (let r = 0; r <= maxR; r++) values.push(new Array(maxC + 1).fill(''));
  sel.forEach(x => { values[x[0]][x[1]] = x[2]; });
  return { nama: pilih.nama, values: values };
}

/**
 * Sheet yang namanya memuat "REKAP" (Rekap Bulanan / Rekapan Bulanan / Rekapan Bulan / REKAP BULANAN 2026).
 * Bila lebih dari satu, pilih yang paling cocok: memuat tahun CFG.TAHUN, memuat kata BULAN, tidak tersembunyi.
 */
function cariSheetRekap(ss) {
  const kand = ss.getSheets().map(s => {
    let h = false; try { h = s.isSheetHidden(); } catch (e) { /* abaikan */ }
    return { s: s, k: skorNamaRekap(s.getName(), h) };
  }).filter(x => x.k > -100).sort((a, b) => b.k - a.k);
  return kand.length ? kand[0].s : null;
}

/**
 * Membaca blok rekap: baris yang memuat sel "PARAMETER" (kolom A-D) adalah judul tabel;
 * nama lokasi ada di baris-baris di atasnya; baris parameter di bawahnya sampai sel parameter kosong.
 * Kolom bulan dicocokkan dari judul (nama penuh atau singkatan 3 huruf); kolom bertahun lain,
 * mis. "DESEMBER (2025)", dilewati.
 */
function parseRekap(v) {
  const out = [];
  const th = String(CFG.TAHUN);
  const idxBulan = s => {
    s = s.replace(/\(.*\)/, '').replace(/\s+/g, ' ').trim();
    let m = BULAN.indexOf(s);
    if (m < 0 && s.length === 3) m = BULAN.findIndex(b => b.slice(0, 3) === s);
    return m;
  };
  for (let i = 0; i < v.length; i++) {
    let c = -1;
    for (let j = 0; j < Math.min(4, v[i].length); j++) {
      if (String(v[i][j]).trim().toUpperCase() === 'PARAMETER') { c = j; break; }
    }
    if (c < 0) continue;

    const kolom = {};
    v[i].forEach((h, j) => {
      const s = String(h).trim().toUpperCase();
      const thn = s.match(/(20\d\d)/);
      if (thn && thn[1] !== th) return;
      const m = idxBulan(s);
      if (m >= 0 && kolom[m] === undefined) kolom[m] = j;
    });

    let lokasi = '';
    for (let k = i - 1; k >= Math.max(0, i - 3) && !lokasi; k--) {
      for (let j = 0; j <= c; j++) {
        const a = v[k][j] == null ? '' : String(v[k][j]).trim();
        if (a && !/^(LAPORAN|PERIODE|NO\.?$)/i.test(a)) { lokasi = a.toUpperCase().replace(/\s+/g, ' '); break; }
      }
    }

    for (let k = i + 1; k < v.length; k++) {
      const p = v[k][c] == null ? '' : String(v[k][c]).trim();
      if (!p || p.toUpperCase() === 'PARAMETER') break;
      const vals = BULAN.map((_, m) => kolom[m] === undefined ? null : angka(v[k][kolom[m]]));
      out.push({ lokasi: lokasi || '(TANPA NAMA)', param: p, vals: vals });
    }
  }
  return out;
}

function angka(x) {
  if (typeof x === 'number') return isFinite(x) ? x : null;
  const s = String(x == null ? '' : x).trim().replace(/\./g, '').replace(',', '.');
  if (s === '' || /^(N\/?A|-|NA)$/i.test(s)) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function cocokParam(nama) {
  const n = String(nama).toUpperCase().replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  for (const p of PARAM) if (p.alias.indexOf(n) >= 0) return p;
  return { key: 'LAIN:' + n, label: nama, tipe: '-', kat: 'LAIN' };
}

/** Bulan terakhir yang berisi data (ada nilai > 0). */
function bulanTerakhir(blok) {
  let last = -1;
  blok.forEach(b => b.vals.forEach((x, m) => { if (x !== null && x > 0 && m > last) last = m; }));
  return last;
}

/**
 * DIAGNOSA (opsional): jalankan dari editor untuk melihat hasil baca sheet rekap
 * tiap regional di View > Logs, TANPA mengubah data dashboard.
 */
function UJI_BACA_REKAP() {
  const pilihan = pilihFileTerbaru();
  Object.keys(pilihan).forEach(r => {
    const f = pilihan[r];
    try {
      const rekap = ambilRekap(f);
      if (!rekap) { Logger.log(r + ' | ' + f.nama + ' -> sheet rekap TIDAK ditemukan'); return; }
      const blok = parseRekap(rekap.values);
      const lokasi = Array.from(new Set(blok.map(b => b.lokasi)));
      const lain = Array.from(new Set(blok.map(b => cocokParam(b.param)).filter(p => p.key.indexOf('LAIN:') === 0).map(p => p.label)));
      const lm = bulanTerakhir(blok);
      Logger.log(r + ' | ' + f.nama + ' | sheet "' + rekap.nama + '" | ' + lokasi.length + ' lokasi: ' + lokasi.join(', '));
      Logger.log('   baris parameter: ' + blok.length + ' | bulan terakhir: ' + (lm >= 0 ? BULAN[lm] : '-')
        + (lain.length ? ' | parameter tak dikenal: ' + lain.join('; ') : ''));
    } catch (e) {
      Logger.log(r + ' | GAGAL: ' + e.message);
    }
  });
}

/* ============================== SHEET I/O ============================== */
function bacaLogFile(ss) {
  const sh = getSh(ss, CFG.SHEET_FILE), out = {};
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues().forEach(r => {
    if (r[0]) out[r[0]] = { regional: r[0], nama: r[1], id: r[2], updated: String(r[3]), sheet: r[4], lokasi: r[5], bulan: r[6], diproses: r[7], status: String(r[8]) };
  });
  return out;
}

function tulisLogFile(ss, log) {
  const rows = REGIONS.filter(r => log[r]).map(r => {
    const L = log[r];
    return [r, L.nama, L.id, L.updated, L.sheet, L.lokasi, L.bulan, L.diproses, L.status];
  });
  tulis(getSh(ss, CFG.SHEET_FILE), rows, 9, [4]);
}

function bacaData(ss) {
  const sh = getSh(ss, CFG.SHEET_DATA), out = {};
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 18).getValues().forEach(r => {
    if (!r[0]) return;
    (out[r[0]] = out[r[0]] || []).push(r);
  });
  return out;
}

function tulisData(ss, data) {
  const rows = [];
  REGIONS.forEach(r => (data[r] || []).forEach(x => rows.push(x)));
  tulis(getSh(ss, CFG.SHEET_DATA), rows, 18, [1, 2, 3, 4, 5, 6]);
}

function tulis(sh, rows, lebar, kolTeks) {
  const lama = sh.getLastRow();
  if (lama > 1) sh.getRange(2, 1, lama - 1, Math.max(lebar, sh.getLastColumn())).clearContent();
  if (!rows.length) return;
  const perlu = rows.length + 1;
  if (sh.getMaxRows() < perlu) sh.insertRowsAfter(sh.getMaxRows(), perlu - sh.getMaxRows());
  (kolTeks || []).forEach(c => sh.getRange(2, c, rows.length, 1).setNumberFormat('@'));
  sh.getRange(2, 1, rows.length, lebar).setValues(rows);
}

/* ============================== WEB APP ============================== */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Monitoring Driving Behaviour, Driver Discipline & Fatigue')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Dipanggil dashboard (google.script.run). Hasil disimpan di cache 10 menit. */
function getDashboardData() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('DASHB');
  if (hit) return hit;
  const json = JSON.stringify(bangunData());
  try { if (json.length < 95000) cache.put('DASHB', json, 600); } catch (e) { /* tanpa cache */ }
  return json;
}

function hapusCache() {
  const c = CacheService.getScriptCache();
  c.remove('DASHB'); c.remove('DASH_N');
}

/** data[regional][lokasi][kodeParameter] = [12 nilai, null = kosong/N/A] */
function bangunData() {
  const ss = ctrl();
  siapkanSheetPada(ss);                                 // pastikan sheet ada walau MULAI_DI_SINI belum dijalankan
  const data = {}, extra = {};
  const raw = bacaData(ss);
  Object.keys(raw).forEach(r => raw[r].forEach(x => {
    const lok = String(x[1]), key = String(x[2]);
    const reg = data[r] = data[r] || {};
    const o = reg[lok] = reg[lok] || {};
    const vals = x.slice(6, 18).map(v => v === '' || v === null ? null : Number(v));
    if (o[key]) o[key] = o[key].map((a, i) => a === null && vals[i] === null ? null : (a || 0) + (vals[i] || 0));
    else o[key] = vals;
    if (key.indexOf('LAIN:') === 0) extra[key] = { key: key, label: String(x[3]), tipe: '-', kat: 'LAIN' };
  }));
  const log = bacaLogFile(ss);
  const files = {};
  REGIONS.forEach(r => { if (log[r]) files[r] = { nama: log[r].nama, bulan: log[r].bulan, status: log[r].status, lokasi: log[r].lokasi, updated: log[r].updated }; });
  let trig = false;
  try { trig = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'prosesData'); } catch (e) { trig = true; }
  return {
    tahun: CFG.TAHUN, regions: REGIONS, bulan: BULAN,
    params: PARAM.map(p => ({ key: p.key, label: p.label, tipe: p.tipe, kat: p.kat })).concat(Object.values(extra)),
    data: data, files: files,
    updated: PropertiesService.getScriptProperties().getProperty('LAST_RUN'),
    otomatis: trig,
  };
}


