# Dashboard Monitoring Sistem

Dashboard rekap bulanan Driving Behaviour, Driver Discipline & Fatigue Management (Google Apps Script web app).

Data dibaca langsung dari spreadsheet Summary Dashboard
(`https://docs.google.com/spreadsheets/d/1N1_qYb-SDrFIkC0GNB2Ztgyqz0i7OjgQ7ZWBz0_H0Bc`, diatur di `CFG.SUMBER_ID` pada `Kode.gs`).

## Sheet yang dibaca
| Sheet | Isi yang dipakai |
|---|---|
| `Parameter_Bulanan` | Jumlah event per parameter per bulan (nasional) |
| `Rekap_Regional` | Total per regional per bulan, plus rincian kategori per regional |
| `Rekap_Lokasi_<Bln>` (mis. `Rekap_Lokasi_Agu`) | Rekap per lokasi untuk bulan itu, dengan pembanding bulan sebelumnya |
| `Rekap_Lokasi_YTD` | Rekap per lokasi seluruh periode |
| `Top_AMT` (opsional) | Data untuk panel TOP 10 Pelanggaran AMT |
| `Catatan` | Ditampilkan di bagian Catatan data |

### Format sheet `Top_AMT`
Baris 1 judul kolom, satu baris per AMT per bulan:

`Bulan | Nama AMT | Regional | Lokasi | Driving Behaviour | Driver Discipline | Fatigue Management | Total | Pelanggaran Terbanyak`

Bulan boleh ditulis `Agustus`, `Agu`, atau angka `8`. Selama sheet ini belum ada, panel AMT menampilkan petunjuk format ini.

## Fitur tampilan
- Bulanan: bulan terpilih dibanding bulan pembanding (default bulan sebelumnya), tren dan tabel parameter per kategori, rekap regional, TOP 10 AMT, lokasi yang paling berubah, rekap per lokasi.
- Rekap YTD: event per bulan, peringkat regional, parameter terbanyak, TOP 10 AMT seluruh periode, lokasi terbanyak.
- `DRIVING > 4 HOURS` dihitung di Driving Behaviour.

## Pemasangan
1. Buka Apps Script proyek dashboard.
2. Ganti isi `Kode.gs`, lalu ganti isi file HTML `Index` dengan `Index.html`.
3. Jalankan `UJI_BACA_SUMBER` sekali untuk memberi izin dan memeriksa sheet yang terbaca (lihat log).
4. Deploy > Manage deployments > Edit > New version.

Setelah mengubah data sumber, dashboard memuat ulang otomatis (cache 10 menit). Untuk langsung: menu Dashboard > Hapus cache dashboard.
