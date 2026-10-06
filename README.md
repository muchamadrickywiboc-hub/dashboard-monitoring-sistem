# Dashboard Monitoring Sistem

Dashboard rekap bulanan Driving Behaviour, Driver Discipline & Fatigue Management (Google Apps Script).

Data diambil dari file "Fom Laporan Bulanan GPS & Dashcam Mobil Tangki - <REGIONAL> <BULAN>.xlsx" di folder Google Drive sumber (sheet "Rekap Bulanan"), lalu ditampilkan sebagai web app.

## Isi
- `Kode.gs`: membaca file laporan bulanan per regional, menyimpan ke sheet DATA_BULANAN, dan menyediakan data ke dashboard.
- `Index.html`: tampilan dashboard (Bulanan dan Rekap YTD).

## Fitur tampilan
- Perbandingan bulan dengan bulan pembanding bebas (default: bulan sebelumnya).
- Per kategori: tren Jan–Des, kenaikan/penurunan tertinggi per lokasi, tabel parameter, dan rata-rata per hari.
- Tabel lokasi × parameter dengan perubahan terbesar antara dua bulan.
- Rekap per regional dan per lokasi, filter regional dan lokasi.

## Pemasangan
1. Buka spreadsheet kontrol > Ekstensi > Apps Script.
2. Tempel `Kode.gs`, lalu buat file HTML bernama `Index` dan tempel `Index.html`.
3. Jalankan `MULAI_DI_SINI` sekali dan beri izin.
4. Deploy > New deployment > Web app.

Setelah mengganti kode: menu Dashboard > Hapus cache dashboard, lalu Deploy > Manage deployments > Edit > New version.
