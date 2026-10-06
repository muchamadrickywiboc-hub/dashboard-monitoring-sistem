# Dashboard Monitoring Sistem

Dashboard rekap bulanan Driving Behaviour, Driver Discipline & Fatigue Management (Google Apps Script web app).

## Sumber data: folder Google Drive
Dashboard membaca satu folder Drive (`CFG.FOLDER_ID` di `Kode.gs`, folder "3. Data Dashboard"). Semua rekap dihitung di Apps Script, tanpa rumus spreadsheet.

| File di folder | Isi |
|---|---|
| `Pengaturan Dashboard` | Sheet `Pemetaan` (Case → Parameter → Kategori, Area → Regional, Lokasi → Regional), `Catatan`, `Kelengkapan` |
| `Data 01 Januari 2026`, `Data 02 Februari 2026`, ... | Satu Google Sheet per bulan. Sheet `Event`: `Tanggal (yyyy-mm-dd) \| Area \| Lokasi \| Case \| Jumlah`. Sheet `AMT`: `Area \| Lokasi \| Nama AMT \| Case \| Jumlah` |

Nomor bulan diambil dari nama file. Bulan baru = tambah file `Data 11 November 2026`. File .xlsx harus dikonversi ke Google Sheet (setelan Drive "Konversi upload"), atau aktifkan layanan Drive API di Apps Script supaya dikonversi otomatis. Case yang tidak ada di `Pemetaan` dilaporkan di bagian Catatan dashboard.

## Fitur tampilan
- Bulanan: grafik event per hari (dibanding tanggal yang sama di bulan pembanding), bulan terpilih dibanding bulan pembanding (default bulan sebelumnya), tren dan tabel parameter per kategori, rekap regional, TOP 10 AMT, lokasi yang paling berubah, rekap per lokasi.
- Rekap YTD: event per bulan, peringkat regional, parameter terbanyak, TOP 10 AMT seluruh periode, lokasi terbanyak.
- `DRIVING > 4 HOURS` dihitung di Driving Behaviour.

## Pemasangan
1. Unggah file `Data ...` dan `Pengaturan Dashboard` ke folder Drive sebagai Google Sheet.
2. Di Apps Script, ganti isi `Kode.gs` dan `Index`.
3. Jalankan `pasangPemicu` sekali (memberi izin, mengisi cache, dan memasang pembaruan cache tiap jam).
4. Deploy > Manage deployments > Edit > New version.

Setelah data diubah: jalankan `hapusCache` (atau tunggu pembaruan tiap jam).

## Membangun ulang sheet ringkasan dari file mentah
Folder `tools/` berisi skrip Python (butuh `openpyxl`) untuk membuat spreadsheet ringkasan dari file laporan mentah per bulan (kolom Case, Area, Tanggal, Lokasi, AMT 1, ...):

```
python3 tools/agregasi_mentah.py <file_mentah.xlsx> agg/<nama>.json      # satu kali per file
python3 tools/bangun_summary.py agg <summary_lama.json> Summary_Dashboard_2026.xlsx sheets.json
```

Nama file JSON di `agg/` menentukan bulannya: `raw_<Bulan>.json` (mis. `raw_Juli.json`) atau `rawagu_<REGIONAL>.json` untuk Agustus. Hasilnya berisi semua sheet di atas; salin sheet-sheet itu ke spreadsheet sumber.

## Spreadsheet Summary berbasis rumus (lama)
`tools/bangun_summary_rumus.py` membuat spreadsheet Summary yang semua angkanya berupa **rumus** (SUMIFS / QUERY / COUNTUNIQUEIFS), sehingga setiap angka bisa ditelusuri ke datanya:

```
# satu kali per bulan & regional (semua file regional itu sekaligus; baris dobel antar file dihitung sekali)
python3 tools/agregasi_regional.py 9 SULAWESI agg/raw_September_SULAWESI.json "<folder 2026>/9. September 2026/SULAWESI/"*.xlsx
python3 tools/bangun_summary_rumus.py agg Summary_Dashboard_2026_Rumus.xlsx
```
`agregasi_regional.py` butuh `python-calamine`. Sheet `Kelengkapan` merangkum file sumber, jumlah baris, dan tanggal yang kosong per bulan & regional.

Struktur: `Data_Event` (Bulan × Tanggal × Area × Lokasi × Case → Jumlah) dan `Data_AMT` (Bulan × Area × Lokasi × Nama AMT × Case → Jumlah) berisi hasil pivot file mentah; kolom Regional/Parameter/Kategori terisi otomatis lewat `Pemetaan`. Sheet yang dibaca dashboard (`Parameter_Bulanan`, `Rekap_Regional`, `Rekap_Lokasi_*`, `Top_AMT`, `Harian`) seluruhnya rumus. `Cek` menampilkan pemeriksaan (Case/Area yang belum terpetakan, total). Unggah file .xlsx ke Google Drive lalu **File → Simpan sebagai Google Spreadsheet** (rumus QUERY/ARRAYFORMULA butuh Google Sheets).

Update bulanan (rincian lengkap ada di sheet `Panduan`): buat pivot dari file mentah bulan baru, tempel ke `Data_Event` dan `Data_AMT` lalu isi kolom Bulan, salin blok bulan terakhir di `Rekap_Regional`, `Rekap_Lokasi_*` dan `Top_AMT` lalu ganti angka bulan di sel kuning, kemudian periksa sheet `Cek`.

## Ekspor data untuk folder Drive
`tools/ekspor_data_drive.py <summary_rumus.xlsx> <folder_keluaran>` mengubah hasil `bangun_summary_rumus.py` menjadi file `Data <nn> <Bulan> 2026.xlsx` per bulan dan `Pengaturan Dashboard.xlsx`.

