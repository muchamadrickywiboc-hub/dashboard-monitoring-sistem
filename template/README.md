# Template desain dashboard (Elnusa Petrofin · RTC)

Template ini diambil dari dashboard **Monitoring Driving Behaviour, Driver Discipline & Fatigue Management** (`Index.html`), supaya semua dashboard baru punya tampilan yang sama: header gradien hijau dengan tab logo putih, kartu KPI putih yang "naik" ke header, kartu kategori dengan grafik batang dan garis tren merah, tabel berjudul hijau, peringkat Top 10, footer tab merah, halaman login dua kolom, dan Mode TV.

## Isi folder

| File | Fungsi |
|---|---|
| `tema.css` | Semua gaya: warna, huruf Poppins, komponen. **Sumber utama**, jangan diubah per dashboard. |
| `tema.js` | Fungsi bantu tanpa library: `Tema.grafikBatang`, `Tema.tabel`, `Tema.peringkat`, `Tema.persen`, `Tema.angka`, `Tema.modeTV`, `Tema.login`, `Tema.server`, `Tema.memuat`. |
| `aset/` | Logo Danantara, Elnusa Petrofin, RTC, ilustrasi login, ikon heksagon. |
| `aset.js` | Logo sebagai data URI (dibuat oleh `build.py`). |
| `contoh.html` | Halaman contoh lengkap. Buka langsung di browser. `?tanpaLogin` melewati login, `?tanpaLogin&tv` membuka Mode TV. |
| `apps-script/` | Versi siap tempel ke Google Apps Script: `Template.gs`, `Halaman.html`, `Tema.html`, `TemaJs.html`, `Aset.html`. |
| `build.py` | Bangun ulang `aset.js` dan folder `apps-script/` setelah `tema.css`, `tema.js`, `contoh.html` atau `aset/` diubah. |

## Membuat dashboard baru di Apps Script

1. Buat proyek Apps Script baru.
2. Buat file HTML bernama **Tema**, **TemaJs**, **Aset**, **Halaman**, lalu tempel isi file yang sama dari `apps-script/`.
3. Tempel `Template.gs` ke `Kode.gs`. Ganti judul di `setTitle`.
4. Ubah `Halaman.html`: ganti judul, hapus bagian yang tidak perlu, dan ganti data contoh di `<script>` paling bawah dengan data dari server (`Tema.server('namaFungsi', ...)`).
5. Deploy sebagai Web app.

Untuk dashboard yang sudah ada (misalnya Cash in Cash Out): tambahkan `<?!= include('Tema') ?>` di `<head>` dan `<?!= include('Aset') ?><?!= include('TemaJs') ?>` sebelum `</body>`, lalu pakai struktur HTML dan class dari `contoh.html`.

## Kerangka halaman

```
body.login              -> tampilkan halaman login (hapus class untuk masuk)
 .lg                    -> login dua kolom (kiri ilustrasi hijau, kanan pilihan akun)
 header.hero            -> header hijau
   .brandbar .tab.l/.tab.r   -> tab logo putih kiri/kanan
   .heroin .eyebrow h1 .sub  -> label kecil, judul, keterangan
   .preview             -> pil info (update data, tombol akun)
   .ctrlrow .seg .pick  -> kontrol periode
   .filters .chip       -> filter area (aktif = lime)
 main.wrap              -> isi (naik 72px ke header; pakai header.hero.ringkas bila tidak mau)
   .kpis > .kpi(.utama) -> kartu KPI (.kpis.k3 = 3 kolom)
   .bingkai             -> latar abu yang mengelompokkan kartu
   .anahead             -> judul bagian + .hint
   .grid.g-11 / .g-21 / .g-111 / .g-auto -> tata letak kolom
   .panel > .ph h2 p    -> panel umum
   .ana                 -> kartu kategori: h3 + .chg, .boxes, .anachart, .cattbl
   .panel.drv           -> kartu Top driver (.drvtbl + .amtbar)
   .warnbar, .notes     -> peringatan dan catatan
 footer.footer .redtab .src  -> footer merah
```

## Warna

| Token | Nilai | Dipakai untuk |
|---|---|---|
| `--forest` | `#4a7a53` | judul tabel, tombol, aksen utama |
| `--leaf` / `--leaf-2` | `#6aa459` / `#93b833` | gradien header |
| `--lime` | `#b8ca10` | filter aktif, garis catatan |
| `--red` | `#e03d3e` | footer |
| `--up` / `--down` | `#b42324` / `#2f7a2f` | naik (memburuk) / turun (membaik) |
| `--c1`…`--c7` | biru, oranye, hijau toska, kuning, merah muda, hijau, ungu | warna seri: kategori, area |
| `--trend` | `#d64541` | garis tren di grafik |

Kategori standar: **Driving Behaviour = `--c1`**, **Driver Discipline = `--c2`**, **Fatigue Management = `--c3`**.

## Fungsi `Tema`

```js
Tema.grafikBatang('#host', {label: ['1','2',…], nilai: [..], warna: 'var(--c1)', sorot: 9, banding: [..], satuan: 'event'});
Tema.tabel('#host', [{judul:'Regional', kunci:'nama', kiri:true}, {judul:'Okt', kunci:'kini', format:'angka', urut:true},
                     {judul:'Kenaikan', kunci:'kini', format:'persen', banding:'lalu'}], baris, {total:true, urut:'kini'});
Tema.peringkat('#host', [{nama, nilai, sub, warna}], {klik: item => …});
Tema.persen(kini, lalu)        // "▲ 12,3%" merah / "▼ 4,1%" hijau
Tema.angka(1234567)            // "1.234.567"
Tema.ringkas(1234567)          // "1,2 jt"
Tema.modeTV(true)              // layar TV: elemen .tv-sembunyi disembunyikan, isi diperkecil agar muat satu layar
Tema.login({masuk: (peran, pw) => Tema.server('cekLogin', peran, pw)});
Tema.memuat(true, 'Memuat data…');
```
