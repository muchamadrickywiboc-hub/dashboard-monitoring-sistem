# Agregasi semua file mentah satu (bulan, regional) -> JSON (format sama dengan agg.py: DL & AMT)
# Baris yang sama persis di dua file (file tumpang tindih) dihitung sekali: gabungan multiset (max per baris).
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
NAMA = lambda s: re.sub(r'\s*[\[(].*?[\])]\s*', ' ', s).strip(' .-') if s else ''
TIMECOLS = ('TANGGAL & JAM', 'TANGGAL CCTV', 'JAM', 'LOKASI_1', 'ALAMAT', 'LAT,LONG')
merged = collections.Counter(); keyof = {}
info = {'files': [], 'rows': 0, 'nodate': 0, 'outmonth': collections.Counter(), 'dup_removed': 0}
for p in FILES:
    fc = collections.Counter(); fi = {'file': p.split('/2026/', 1)[-1], 'sheets': []}
    wb = CalamineWorkbook.from_path(p)
    for sn in wb.sheet_names:
        try: rows = wb.get_sheet_by_name(sn).to_python(skip_empty_area=False)
        except Exception as e: fi['sheets'].append([sn, 'ERR ' + str(e)[:60]]); continue
        hdr = None; n = 0
        for r in rows:
            if hdr is None:
                h = [T(x) for x in r]
                if 'CASE' in h and 'TANGGAL' in h and 'AREA' in h:
                    hdr = {}
                    for i, k in enumerate(h):
                        if k and k not in hdr: hdr[k] = i
                    g = lambda k: hdr.get(k)
                    ic, ia, itg, il, i1 = g('CASE'), g('AREA'), g('TANGGAL'), g('LOKASI'), g('AMT 1')
                    inp = g('NO.POL') if g('NO.POL') is not None else g('NOPOL')
                    ila, ilo = g('LAT'), g('LONG')
                    itm = [g(k) for k in TIMECOLS if g(k) is not None]
                continue
            L = len(r); V = lambda i: r[i] if i is not None and i < L else None
            case = T(V(ic))
            if not case: continue
            n += 1
            d = todate(V(itg))
            if d is None: info['nodate'] += 1; ds = ''
            elif d.month != MON or d.year != 2026: info['outmonth'][d.isoformat()[:7]] += 1; continue
            else: ds = d.isoformat()
            area = T(V(ia)) or REG; lok = T(V(il)); a1 = NAMA(T(V(i1)))
            k = (ds, area, lok, case, a1)
            raw = (k, T(V(inp)), str(V(ila)), str(V(ilo))) + tuple(str(V(i)) for i in itm)
            h = hash(raw); fc[h] += 1; keyof[h] = k
        fi['sheets'].append([sn, n])
    for h, c in fc.items():
        if c > merged[h]: info['dup_removed'] += merged[h]; merged[h] = c
        else: info['dup_removed'] += c
    info['files'].append(fi)
DL = collections.Counter(); AMT = collections.Counter()
for h, c in merged.items():
    ds, area, lok, case, a1 = keyof[h]
    DL[(ds, area, lok, case)] += c
    if a1: AMT[(MON - 1, area, lok, a1, case)] += c
info['rows'] = sum(merged.values()); info['outmonth'] = dict(info['outmonth'])
ser = lambda c: [list(k) + [v] for k, v in c.items()]
json.dump({'mon': MON, 'reg': REG, 'info': info, 'DL': ser(DL), 'AMT': ser(AMT)}, open(OUT, 'w'))
print(MON, REG, info['rows'], 'nodate', info['nodate'], 'dup', info['dup_removed'], 'out', info['outmonth'], [s for f in info['files'] for s in f['sheets']])
