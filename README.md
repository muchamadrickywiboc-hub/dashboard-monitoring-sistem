# Dashboard Monitoring Sistem

Dashboard rekap bulanan Driving Behaviour, Driver Discipline & Fatigue Management (Google Apps Script web app).

## Sumber data: folder Google Drive
Dashboard membaca satu folder Drive (`CFG.FOLDER_ID` di `Kode.gs`, folder "3. Data Dashboard"). Semua rekap dihitung di Apps Script, tanpa rumus spreadsheet.

| File di folder | Isi |
|---|---|
| `Pengaturan Dashboard` | Sheet `Pemetaan` (Case → Parameter → Kategori, Area → Regional, Lokasi → Regional), `Catatan`, `Kelengkapan` |
| `Data 01 Januari 2026`, `Data 02 Februari 2026`, ... | Satu Google Sheet per bulan. Sheet `Event`: `Tanggal (yyyy-mm-dd) \| Area \| Lokasi \| Case \| Jumlah`. Sheet `AMT`: `Area \| Lokasi \| Nama AMT \| Case \| Jumlah` |

Mulai Oktober 2026 data juga datang dari **tarikan harian**: spreadsheet *Tarikan Sistem* (`CFG.TARIKAN_ID`, kolom `Area | linkgdrive`) berisi folder per regional dengan file `Tarikan_<REGIONAL>_GPS_CCTV_<yyyy-mm-dd>.xlsx` (satu baris per alarm: TBBM, Time, Alarm Status, AMT 1, ...). `prosesTarikan()` (pemicu tiap 15 menit) merangkum file baru/berubah ke `Tarikan <nn> <Bulan> 2026` di folder data dan mencatatnya di `Log Tarikan`. Mulai `CFG.BULAN_TARIKAN` (10 = Oktober) data hanya dari file Tarikan; bulan sebelumnya memakai file `Data <nn> ...` (summary). Butuh layanan lanjutan **Drive API** di Apps Script untuk membaca .xlsx. Teks Alarm Status dipetakan lewat `KASUS_TARIKAN` di `Kode.gs` (bisa ditimpa di sheet Pemetaan).

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


## Dashboard RTC Pusat: filter Area & Lokasi

`hitung()` mengirim tabel fakta ringkas (`lok`, `fakta`, `harian`, `amt`) dan dashboard menjumlahkannya sesuai filter **Area** (chip) dan **Lokasi** (dropdown). Semua panel, termasuk parameter per kategori, Top 10 Area, Top 10 Lokasi dan TOP 10 AMT, mengikuti filter.
Satu lokasi memakai satu nama dan satu area di semua bulan: ejaan disamakan (tanda hubung/spasi diabaikan, `ALIAS_LOKASI` untuk lokasi yang ganti nama) dan area diambil dari bulan terbaru.

## Filter waktu: Tanggal, Shift (8 jam), Jam

- Mulai Oktober (file tarikan), `prosesTarikan` juga mencatat jam kejadian dari kolom **Time** ke sheet `Event Jam` dan `AMT Jam` di file "Tarikan nn ...".
- Di dashboard, baris **Waktu** berisi Tanggal, Shift (Shift 1 07.00–15.00, Shift 2 15.00–23.00, Shift 3 23.00–07.00 yang ikut tanggal mulainya; diatur di `SHIFT` pada Kode.gs dan Index.html) dan Jam. Grafik event berubah menjadi per jam; Top 10 Area/Lokasi, TOP 10 Driver, rekap per area dan per lokasi ikut jendela waktu, dibanding tanggal sebelumnya pada shift/jam yang sama. Tren & parameter per kategori juga berubah menjadi per jam.
- Data jendela waktu dihitung saat dipilih oleh `getDataWaktu(m, d, s, h)` dan disimpan di cache 15 menit.
- Januari–September: jam diambil dari file mentah per regional dan disimpan di file `Jam <nn> <Bulan> 2026.json.gz` (satu per bulan) di folder "3. Data Dashboard". Dibuat dengan `tools/agregasi_jam.py` (per bulan × regional) lalu `tools/bangun_jam.py`. Jam diambil dari kolom tanggal+jam (`TANGGAL CCTV`, `TANGGAL & JAM CCTV`, atau kolom tanpa judul berisi tanggal+jam); kolom `JAM` hanya dipakai bila kolom tanggal+jam tidak ada, karena rumusnya bernilai 0/23 saat kosong.
- Banyak event GPS (Harsh, Idle, Overspeed, Driving > 4 Hours, Black Zone) di file mentah Januari–September tidak punya jam. Event itu tetap dihitung saat hanya Tanggal yang dipilih, tetapi tidak ikut filter Shift/Jam; jumlahnya ditampilkan di keterangan grafik dan kartu kategori.
- Setelah memasang versi ini, jalankan sekali **Dashboard > Proses ulang semua file tarikan** (`prosesUlangSemuaTarikan`) supaya file tarikan yang sudah diproses dibaca ulang beserta jamnya.

## Sheet Data Kosong

`buatSheetDataKosong()` (menu **Dashboard > Perbarui sheet Data Kosong**, juga otomatis tiap pagi lewat `pasangPemicu`) menulis sheet **Data Kosong** di file Pengaturan Dashboard: ringkasan bagian yang tidak ada datanya, lalu per bulan × regional tanggal tanpa data, hari dengan event sangat sedikit (< 35% median), persentase event tanpa jam per kategori (dari file Jam), dan penjelasan. Catatan sumber yang menyebut "batas Excel"/"terpotong" di sheet Catatan ikut dimasukkan ke baris bulan & regionalnya.

## Akun Pusat, Area, Lokasi

- Dashboard sekarang meminta login. Akun disimpan di sheet **Akun** pada file Pengaturan Dashboard: `Username | Password | Nama | Peran (PUSAT / AREA / LOKASI) | Area | Lokasi | Aktif`.
- Buat akunnya lewat menu **Dashboard > Buat / lengkapi akun (Pusat, Area, Lokasi)**: 1 akun Pusat, 1 akun per Area, dan 1 akun per Lokasi yang ada di data, masing-masing dengan password pendek berformat username + 2 angka (mis. `ft.jambi` → `ftjambi48`). Untuk mengganti password akun yang sudah ada ke format ini, pakai **Dashboard > Buat ulang semua password (format pendek)**. Menu ini aman dijalankan lagi untuk menambah akun lokasi baru. Setelah password dicatat, jalankan **Dashboard > Amankan password akun** supaya password disimpan sebagai sidik SHA-256.
- Data dipotong di server (`potongCakupan_`): akun Area hanya menerima data areanya, akun Lokasi hanya lokasinya. Fungsi pembaca data berakhiran `_` supaya tidak bisa dipanggil langsung dari browser.
- Sesi login tidak punya batas waktu (untuk layar monitor). Token ditandatangani HMAC dengan kunci di Script Properties; sesi berhenti bila akun dinonaktifkan atau passwordnya diganti (dicek ulang paling lama tiap 10 menit), atau lewat menu **Dashboard > Keluarkan semua sesi login**. 5 kali salah password mengunci username itu 15 menit.
- Command Center dan Control Room tidak punya filter Shift (Tanggal dan Jam tetap ada).
- Tombol **Export PDF**: akun RTC mengunduh ringkasan 1 halaman A4 lanskap sesuai filter (total per kategori, tabel parameter, grafik per hari/jam, peringkat dan Top 10 driver). Akun Command Center dan Control Room mengunduh **export per event**: untuk tiap event (Overspeed, Harsh Brake, Harsh Acceleration, Harsh Cornering, Idle, Drive > 4 Hr, Blackzone, Fatigue, Menguap, Merokok, Menggunakan Telepon, Distraction Mengemudi, Seat Belt Detection) ada tabel kecil dan grafik batang dengan batang Total berwarna merah. Baris Command Center = lokasi di areanya; baris Control Room = 5 driver teratas plus driver lain / tanpa nama. Pustaka html2canvas dan jsPDF dimuat dari cdnjs saat tombol ditekan.
- Distraction Mengemudi (DRIVER DISTRACTION) dan Seat Belt Detection (SEAT BELT DETECTION / DRIVER IS NOT USING SEAT-BELT) dihitung di Driver Discipline lewat `KASUS_WAJIB` di Kode.gs, menimpa baris lama di sheet Pemetaan. Menu *Perbarui sheet Data Kosong* juga menyamakan baris Pemetaan dan Catatan. Nama event di layar diatur di `LABEL_EVENT`.
- Penjelasan cara ringkasan dibuat ada di Google Doc **Cara Ringkasan Dibuat** di folder "3. Data Dashboard" (diperbarui langsung di sana).
- Deploy web app: Jalankan sebagai **Saya**, akses **Siapa saja** (tanpa akun, pengunjung hanya melihat halaman masuk).
