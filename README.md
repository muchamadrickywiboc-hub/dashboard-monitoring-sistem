# Dashboard Monitoring Sistem

Dashboard rekap bulanan Driving Behaviour, Driver Discipline & Fatigue Management (Google Apps Script web app).

Data dibaca langsung dari spreadsheet Summary_Dashboard_2026_Jan-Agu
(`https://docs.google.com/spreadsheets/d/1eyKwUV9co0L4-39bWqEdpdg8XB7QZ6CAGrMqlguS5Rw`, diatur di `CFG.SUMBER_ID` pada `Kode.gs`).

## Sheet yang dibaca
| Sheet | Isi yang dipakai |
|---|---|
| `Parameter_Bulanan` | Jumlah event per parameter per bulan (nasional) |
| `Rekap_Regional` | Total per regional per bulan, plus rincian kategori per regional |
| `Rekap_Lokasi_<Bln>` (mis. `Rekap_Lokasi_Agu`) | Rekap per lokasi untuk bulan itu, dengan pembanding bulan sebelumnya |
| `Rekap_Lokasi_YTD` | Rekap per lokasi seluruh periode |
| `Top_AMT` (opsional) | Data untuk panel TOP 10 Pelanggaran AMT |
| `Harian` (opsional) | Event per tanggal per regional, untuk grafik Event per hari |
| `Catatan` | Ditampilkan di bagian Catatan data |

### Format sheet `Top_AMT`
Baris 1 judul kolom, satu baris per AMT per bulan:

`Bulan | Nama AMT | Regional | Lokasi | Driving Behaviour | Driver Discipline | Fatigue Management | Total | Pelanggaran Terbanyak`

Bulan boleh ditulis `Agustus`, `Agu`, atau angka `8`. Baris dengan Bulan `YTD` dipakai untuk peringkat seluruh periode. Selama sheet ini belum ada, panel AMT menampilkan petunjuk format ini.

### Format sheet `Harian`
`Tanggal | Regional | Driving Behaviour | Driver Discipline | Fatigue Management | Total`

## Fitur tampilan
- Bulanan: grafik event per hari (dibanding tanggal yang sama di bulan pembanding), bulan terpilih dibanding bulan pembanding (default bulan sebelumnya), tren dan tabel parameter per kategori, rekap regional, TOP 10 AMT, lokasi yang paling berubah, rekap per lokasi.
- Rekap YTD: event per bulan, peringkat regional, parameter terbanyak, TOP 10 AMT seluruh periode, lokasi terbanyak.
- `DRIVING > 4 HOURS` dihitung di Driving Behaviour.

## Pemasangan
1. Buka Apps Script proyek dashboard.
2. Ganti isi `Kode.gs`, lalu ganti isi file HTML `Index` dengan `Index.html`.
3. Jalankan `UJI_BACA_SUMBER` sekali untuk memberi izin dan memeriksa sheet yang terbaca (lihat log).
4. Deploy > Manage deployments > Edit > New version.

Setelah mengubah data sumber, dashboard memuat ulang otomatis (cache 10 menit). Untuk langsung: menu Dashboard > Hapus cache dashboard.

## Membangun ulang sheet ringkasan dari file mentah
Folder `tools/` berisi skrip Python (butuh `openpyxl`) untuk membuat spreadsheet ringkasan dari file laporan mentah per bulan (kolom Case, Area, Tanggal, Lokasi, AMT 1, ...):

```
python3 tools/agregasi_mentah.py <file_mentah.xlsx> agg/<nama>.json      # satu kali per file
python3 tools/bangun_summary.py agg <summary_lama.json> Summary_Dashboard_2026.xlsx sheets.json
```

Nama file JSON di `agg/` menentukan bulannya: `raw_<Bulan>.json` (mis. `raw_Juli.json`) atau `rawagu_<REGIONAL>.json` untuk Agustus. Hasilnya berisi semua sheet di atas; salin sheet-sheet itu ke spreadsheet sumber.

## Spreadsheet Summary berbasis rumus (disarankan)
`tools/bangun_summary_rumus.py` membuat spreadsheet Summary yang semua angkanya berupa **rumus** (SUMIFS / QUERY / COUNTUNIQUEIFS), sehingga setiap angka bisa ditelusuri ke datanya:

```
python3 tools/bangun_summary_rumus.py agg <summary_lama.json> Summary_Dashboard_2026_Rumus.xlsx
```

Struktur: `Data_Event` (Bulan × Tanggal × Area × Lokasi × Case → Jumlah) dan `Data_AMT` (Bulan × Area × Lokasi × Nama AMT × Case → Jumlah) berisi hasil pivot file mentah; kolom Regional/Parameter/Kategori terisi otomatis lewat `Pemetaan`. Sheet yang dibaca dashboard (`Parameter_Bulanan`, `Rekap_Regional`, `Rekap_Lokasi_*`, `Top_AMT`, `Harian`) seluruhnya rumus. `Juli_Manual` menampung angka Juli selama file mentah Juli belum masuk, dan `Cek` menampilkan pemeriksaan (Case/Area yang belum terpetakan, total). Unggah file .xlsx ke Google Drive lalu **File → Simpan sebagai Google Spreadsheet** (rumus QUERY/ARRAYFORMULA butuh Google Sheets).

Update bulanan (rincian lengkap ada di sheet `Panduan`): buat pivot dari file mentah bulan baru, tempel ke `Data_Event` dan `Data_AMT` lalu isi kolom Bulan, salin blok bulan terakhir di `Rekap_Regional`, `Rekap_Lokasi_*` dan `Top_AMT` lalu ganti angka bulan di sel kuning, kemudian periksa sheet `Cek`.
