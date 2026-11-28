/**
 * Template web app Apps Script dengan tema dashboard Elnusa Petrofin · RTC.
 *
 * Cara pakai di proyek Apps Script baru:
 *   1. Buat file HTML: Tema, TemaJs, Aset, Halaman (salin dari folder template/apps-script).
 *   2. Salin isi file ini ke Kode.gs (atau gabungkan fungsi include & doGet ke Kode.gs yang sudah ada).
 *   3. Deploy > New deployment > Web app.
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('Halaman')
    .evaluate()
    .setTitle('Judul Dashboard Anda')
    .setFaviconUrl('https://raw.githubusercontent.com/muchamadrickywiboc-hub/dashboard-monitoring-sistem/main/assets/elnusa-favicon.png')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Menyisipkan file HTML lain: <?!= include('Tema') ?> */
function include(nama) {
  return HtmlService.createHtmlOutputFromFile(nama).getContent();
}

/** Contoh fungsi server yang dipanggil dari halaman: Tema.server('cekLogin', peran, password) */
function cekLogin(peran, password) {
  // Ganti dengan pemeriksaan sungguhan (mis. dari sheet Pengaturan).
  if (!password) throw new Error('Password salah.');
  return {peran: peran};
}
