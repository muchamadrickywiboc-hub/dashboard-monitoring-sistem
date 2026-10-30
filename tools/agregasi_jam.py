# Agregasi file mentah satu (bulan, regional) -> JSON per tanggal x jam (logika sama dengan agregasi_regional.py, ditambah jam).
# Pemakaian: python3 -I agregasi_jam.py <bulan 1-12> <REGIONAL> <keluaran.json> <file mentah ...>
import sys, json, collections, datetime, re
from python_calamine import CalamineWorkbook
MON, REG, OUT = int(sys.argv[1]), sys.argv[2], sys.argv[3]
FILES = sys.argv[4:]
EPOCH = datetime.date(1899, 12, 30)
def T(x): return ' '.join(str(x).replace('\xa0', ' ').split()).upper() if x is not None else ''
def todate(v):
    if isinstance(v, datetime.datetime): return v.date()
    if isinstance(v, datetime.date): return v
    if isinstance(v, (int, float)) and 30000 < v < 80000: return EPOCH + datetime.timedelta(days=int(v))
    s = str(v).strip() if v is not None else ''
    if not s: return None
    if re.fullmatch(r'\d{5}(\.0+)?', s): return EPOCH + datetime.timedelta(days=int(float(s)))
    for f, n in (('%Y-%m-%d', 10), ('%d/%m/%Y', 10), ('%m/%d/%Y', 10), ('%d-%m-%Y', 10)):
        try: return datetime.datetime.strptime(s[:n], f).date()
        except Exception: pass
    return None
DTRE = re.compile(r'(\d{1,4}[/-]\d{1,2}[/-]\d{1,4})[ T]+(\d{1,2})[:.](\d{2})')
def jam_dt(v, longgar):
    # jam dari kolom tanggal+jam; tanggal saja (00:00:00 persis) dianggap tanpa jam
    if isinstance(v, datetime.datetime): return None if (v.hour, v.minute, v.second) == (0, 0, 0) else v.hour
    if isinstance(v, datetime.time): return v.hour
    if isinstance(v, (int, float)) and 30000 < v < 80000 and v % 1: return int((v % 1) * 24 + 1e-9)
    if isinstance(v, str):
        m = DTRE.search(v)
        if m and int(m.group(2)) < 24: return int(m.group(2))
        if longgar:
            m = re.fullmatch(r'\s*(\d{1,2})[:.](\d{2})([:.]\d{2})?\s*', v)
            if m and int(m.group(1)) < 24: return int(m.group(1))
    return None
def jam_kolom(v):
    if v is None or v == '': return None
    if isinstance(v, (datetime.datetime, datetime.time)): return v.hour
    if isinstance(v, (int, float)):
        if 0 <= v < 24 and float(v).is_integer(): return int(v)
        if 0 <= v < 1: return int(v * 24 + 1e-9)
        return None
    s = str(v).strip()
    m = re.fullmatch(r'(\d{1,2})([:.]\d{2})?([:.]\d{2})?(\.0+)?', s)
    if m and int(m.group(1)) < 24: return int(m.group(1))
    return None
def tojam(r, idt, ibl, ij, igps):
    L = len(r)
    for i in idt:
        if i < L:
            h = jam_dt(r[i], True)
            if h is not None: return h
    for i in ibl:
        if i < L:
            h = jam_dt(r[i], False)
            if h is not None: return h
    if not idt and ij is not None and ij < L:   # ada kolom tanggal+jam: kolom JAM (rumus) tidak dipakai, sering 0/23 palsu saat kosong
        h = jam_kolom(r[ij])
        # event GPS tanpa kolom waktu: JAM 0 adalah hasil rumus dari sel waktu kosong, bukan jam 00
        if h == 0 and igps is not None and igps < L and T(r[igps]) == 'GPS': return -1
        if h is not None: return h
    return -1
NAMA = lambda s: re.sub(r'\s*[\[(].*?[\])]\s*', ' ', s).strip(' .-') if s else ''
_NAMA = NAMA
_BUKAN = re.compile(r"^(NAN|NULL|NONE|N ?/ ?A|#N/A|NA|TIDAK ADA|KOSONG|UNKNOWN|NO NAME|NONAME|DRIVER|AMT ?\d*|SUPIR|SOPIR|TV ?\d*|CONTOH\b.*|TEST\b.*)$|^[A-Z]{1,2} ?\d{1,4} ?[A-Z]{0,3}$")
def NAMA(s):   # '-', '0', '0.0', satu huruf, nomor polisi, 'CONTOH 1' dll. bukan nama Driver (sama dengan namaAmt di Kode.gs)
    n = re.sub(r'\s+', ' ', re.sub(r'[\[(].*$', '', _NAMA(s))).strip(" .,'`|&/-").upper()
    return '' if len(re.sub('[^A-Z]', '', n)) < 2 or _BUKAN.match(n) else n
TIMECOLS = ('TANGGAL & JAM', 'TANGGAL CCTV', 'JAM', 'LOKASI_1', 'ALAMAT', 'LAT,LONG')
merged = collections.Counter(); keyof = {}
info = {'files': [], 'rows': 0, 'nodate': 0, 'nojam': 0, 'outmonth': collections.Counter(), 'dup_removed': 0}
for p in FILES:
    fc = collections.Counter(); fi = {'file': p.split('/2026/', 1)[-1], 'sheets': []}
    wb = CalamineWorkbook.from_path(p)
    for sn in wb.sheet_names:
        try: rows = wb.get_sheet_by_name(sn).to_python(skip_empty_area=False)
        except Exception as e: fi['sheets'].append([sn, 'ERR ' + str(e)[:60]]); continue
        hdr = None; n = 0; jamOk = True
        for r in rows:
            if hdr is None:
                h = [T(x) for x in r]
                if 'CASE' in h and 'TANGGAL' in h and 'AREA' in h:
                    hdr = {}
                    for i, k in enumerate(h):
                        if k and k not in hdr: hdr[k] = i
                    g = lambda k: hdr.get(k)
                    ic, ia, itg, il, i1 = g('CASE'), g('AREA'), g('TANGGAL'), g('LOKASI'), next((g(x) for x in ('AMT 1', 'AMT1', 'AMT I') if g(x) is not None), None)
                    inp = g('NO.POL') if g('NO.POL') is not None else g('NOPOL')
                    ila, ilo = g('LAT'), g('LONG')
                    itm = [g(k) for k in TIMECOLS if g(k) is not None]
                    ij = g('JAM'); igps = g('GPS/CCTV')
                    idt = [i for i, k in enumerate(h) if k in ('TANGGAL CCTV', 'TANGGAL & JAM CCTV', 'TANGGAL & JAM', 'TANGGAL DAN JAM', 'WAKTU', 'TIME', 'START ALERT')]
                    ibl = [i for i, k in enumerate(h) if not k and i > itg]
                    # kolom JAM yang berisi angka >= 24 (mis. durasi) bukan jam kejadian: abaikan untuk sheet ini
                    if ij is not None:
                        num = [x[ij] for x in rows if ij < len(x) and isinstance(x[ij], (int, float))]
                        besar = sum(1 for x in num if x >= 24); nol = sum(1 for x in num if x == 0)
                        if num and (besar / len(num) > 0.002 or nol / len(num) > 0.25):   # jam 00 normalnya < 10% event
                            ij = None; info.setdefault('jam_diabaikan', []).append([p.split('/2026/', 1)[-1], sn, besar, len(num)])
                continue
            L = len(r); V = lambda i: r[i] if i is not None and i < L else None
            case = T(V(ic))
            if not case: continue
            n += 1
            d = todate(V(itg))
            if d is None: info['nodate'] += 1; ds = ''
            elif d.month == MON and d.year in (2027, 2028):   # salah ketik tahun di file sumber (mis. 26/10/2027 hasil tarik isi otomatis)
                info['tahun_diperbaiki'] = info.get('tahun_diperbaiki', 0) + 1; ds = d.replace(year=2026).isoformat()
            elif d.month != MON or d.year != 2026: info['outmonth'][d.isoformat()[:7]] += 1; continue
            else: ds = d.isoformat()
            area = T(V(ia)) or REG; lok = T(V(il)); a1 = NAMA(T(V(i1)))
            jm = tojam(r, idt, ibl, ij, igps)
            k = (ds, jm, area, lok, case, a1)
            raw = ((ds, area, lok, case, a1), T(V(inp)), str(V(ila)), str(V(ilo))) + tuple(str(V(i)) for i in itm)
            hh = hash(raw); keyof[hh] = k
            # baris yang sama persis sampai jam (detik), nomor polisi & koordinat dalam satu file = tempel ganda: dihitung sekali.
            # Tanpa jam (mis. Sumbagut) baris sama bisa kejadian berbeda, jadi tetap dihitung semua.
            if jm >= 0 and fc[hh]: info['kembar_dibuang'] = info.get('kembar_dibuang', 0) + 1
            else: fc[hh] += 1
        fi['sheets'].append([sn, n])
    for hh, c in fc.items():
        if c > merged[hh]: info['dup_removed'] += merged[hh]; merged[hh] = c
        else: info['dup_removed'] += c
    info['files'].append(fi)
EJ = collections.Counter(); AJ = collections.Counter()
for hh, c in merged.items():
    ds, jm, area, lok, case, a1 = keyof[hh]
    if jm < 0: info['nojam'] += c
    EJ[(ds, jm, area, lok, case)] += c
    if a1: AJ[(ds, jm, area, lok, a1, case)] += c
info['rows'] = sum(merged.values()); info['outmonth'] = dict(info['outmonth'])
ser = lambda c: [list(k) + [v] for k, v in c.items()]
json.dump({'mon': MON, 'reg': REG, 'info': info, 'EJ': ser(EJ), 'AJ': ser(AJ)}, open(OUT, 'w'))
print(MON, REG, info['rows'], 'nodate', info['nodate'], 'nojam', info['nojam'], 'dup', info['dup_removed'], 'EJ', len(EJ), 'AJ', len(AJ), [s for f in info['files'] for s in f['sheets']])
