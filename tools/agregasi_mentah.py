# Agregasi satu file event mentah -> JSON counter
import sys, json, collections, datetime, openpyxl
src, out = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
C = collections.Counter()      # (m, area, lokasi, case)
DAY = collections.Counter()    # (m, d, area, case)
AMT = collections.Counter()    # (m, area, lokasi, amt1, case)
AMT2 = collections.Counter()   # (m, area, lokasi, amt2, case)
info = {'sheets': [], 'rows': 0, 'nodate': 0, 'noamt1': 0, 'bad': 0}
def T(x): return ' '.join(str(x).split()).upper() if x is not None else ''
for ws in wb.worksheets:
    it = ws.iter_rows(values_only=True)
    hdr = None; n = 0
    for r in it:
        if hdr is None:
            h = [T(x) for x in r]
            if 'CASE' in h and 'TANGGAL' in h and 'AREA' in h:
                hdr = {k: h.index(k) for k in h if k}
                ic, ia, it_, il = hdr['CASE'], hdr.get('AREA'), hdr['TANGGAL'], hdr.get('LOKASI')
                i1, i2 = hdr.get('AMT 1'), hdr.get('AMT 2')
            continue
        if not r or all(v is None for v in r): continue
        case = T(r[ic]) if ic < len(r) else ''
        if not case: continue
        n += 1
        d = r[it_] if it_ < len(r) else None
        if isinstance(d, datetime.datetime): m, dd = d.month - 1, d.day
        else:
            try:
                d = datetime.datetime.strptime(str(d).strip()[:10], '%Y-%m-%d'); m, dd = d.month - 1, d.day
            except Exception:
                info['nodate'] += 1; m, dd = -1, 0
        area = T(r[ia]) if ia is not None and ia < len(r) else ''
        lok = T(r[il]) if il is not None and il < len(r) else ''
        C[(m, area, lok, case)] += 1
        DAY[(m, dd, area, case)] += 1
        a1 = T(r[i1]) if i1 is not None and i1 < len(r) else ''
        a2 = T(r[i2]) if i2 is not None and i2 < len(r) else ''
        if not a1: info['noamt1'] += 1
        AMT[(m, area, lok, a1, case)] += 1
        if a2: AMT2[(m, area, lok, a2, case)] += 1
    info['sheets'].append([ws.title, n]); info['rows'] += n
ser = lambda c: [list(k) + [v] for k, v in c.items()]
json.dump({'src': src, 'info': info, 'C': ser(C), 'DAY': ser(DAY), 'AMT': ser(AMT), 'AMT2': ser(AMT2)}, open(out, 'w'))
print(src, info)
