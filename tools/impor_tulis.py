# JSON dari impor_tarikan.js -> "Impor Tarikan <nn> <Bulan> 2026.xlsx" (sheet Event, AMT, Event Jam, AMT Jam, Log) untuk folder "3. Data Dashboard".
# Pemakaian: python3 -I impor_tulis.py <hasil.json> <keluaran.xlsx>
import sys, json, openpyxl
d = json.load(open(sys.argv[1]))
HDR = {'Event': ['Tanggal', 'Area', 'Lokasi', 'Case', 'Jumlah', 'Sumber'], 'AMT': ['Area', 'Lokasi', 'Nama AMT', 'Case', 'Jumlah', 'Sumber'],
       'Event Jam': ['Tanggal', 'Jam', 'Area', 'Lokasi', 'Case', 'Jumlah', 'Sumber'], 'AMT Jam': ['Tanggal', 'Jam', 'Area', 'Lokasi', 'Nama AMT', 'Case', 'Jumlah', 'Sumber'],
       'Log': ['File ID', 'Nama file', 'Area', 'Tanggal', 'Diubah', 'Baris event']}
wb = openpyxl.Workbook(write_only=True)
for n, h in HDR.items():
    sh = wb.create_sheet(n); sh.append(h)
    for r in d[n]: sh.append(r)
wb.save(sys.argv[2])
print(sys.argv[2], {n: len(d[n]) for n in HDR})
