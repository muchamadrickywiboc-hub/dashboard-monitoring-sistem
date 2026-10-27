# Gabung agregat regional satu bulan -> "Jam <nn> <Bulan> 2026.json.gz" untuk folder "3. Data Dashboard" (format: lihat fileJam_ di Kode.gs).
# Pemakaian: python3 -I bangun_jam.py <bulan 1-12> <folder agregat> <folder keluaran> "Pengaturan Dashboard.xlsx" [sebelum yyyy-mm-dd]
#   sebelum: hanya tanggal sebelum tanggal ini (bulan yang mulai tanggal itu diambil dari file tarikan, lihat CFG.MULAI_TARIKAN).
import sys, json, glob, gzip, collections, openpyxl
M = int(sys.argv[1]); AGG = sys.argv[2]; OUT = sys.argv[3]; ATUR = sys.argv[4]; SEBELUM = sys.argv[5] if len(sys.argv) > 5 else '9999'
BLN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
N = lambda x: ' '.join(str(x).replace('\xa0', ' ').split()).upper()
KEEP = {'SEAT BELT DETECTION', 'SEATBELT DETECTION', 'DRIVER IS NOT USING SEAT-BELT', 'DRIVER DISTRACTION'}   # kini dihitung di dashboard (KASUS_WAJIB)
skip = set()
for r in openpyxl.load_workbook(ATUR, read_only=True)['Pemetaan'].iter_rows(min_row=2, values_only=True):
    if r[0] and N(r[0]) not in KEEP and (r[2] is None or str(r[2]).strip().lower() == 'tidak dihitung'): skip.add(N(r[0]))
idx = {k: {} for k in ('area', 'lok', 'kasus', 'nama')}
def I(k, v):
    d = idx[k]
    if v not in d: d[v] = len(d)
    return d[v]
E = collections.defaultdict(collections.Counter); A = collections.defaultdict(collections.Counter)
for f in sorted(glob.glob(f'{AGG}/m{M:02d}_*.json')):
    d = json.load(open(f))
    for ds, h, a, l, c, n in d['EJ']:
        if not ds or ds >= SEBELUM or c in skip: continue
        E[int(ds[8:10])][(99 if h < 0 else h, I('area', a), I('lok', l), I('kasus', c))] += n
    for ds, h, a, l, nm, c, n in d['AJ']:
        if not ds or ds >= SEBELUM or c in skip: continue
        A[int(ds[8:10])][(99 if h < 0 else h, I('area', a), I('lok', l), I('nama', nm), I('kasus', c))] += n
kode = lambda day, h: h + 24 if day == 1 and h < 7 else h   # jam 00-06 tanggal 1 = Shift 3 bulan sebelumnya
BE = collections.Counter(); BA = collections.Counter()
for day, c in E.items():
    for k, n in c.items(): BE[(kode(day, k[0]),) + k[1:]] += n
for day, c in A.items():
    for k, n in c.items(): BA[(kode(day, k[0]),) + k[1:]] += n
ser = lambda c: ';'.join(','.join(map(str, k + (n,))) for k, n in sorted(c.items()))
out = {'v': 1, 'm': M - 1}
for k in idx: out[k] = list(idx[k])
out['d'] = {str(day): {'e': ser(E[day]), 'a': ser(A.get(day, {}))} for day in sorted(E)}
out['b'] = {'e': ser(BE), 'a': ser(BA)}
raw = json.dumps(out, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
p = f'{OUT}/Jam {M:02d} {BLN[M-1]} 2026.json.gz'
with gzip.open(p, 'wb', compresslevel=9) as g: g.write(raw)
import os
print(p, 'raw', len(raw), 'gz', os.path.getsize(p), 'hari', len(E), 'baris E', sum(len(c) for c in E.values()), 'A', sum(len(c) for c in A.values()), 'bE', len(BE), 'bA', len(BA))
