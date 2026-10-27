# Baca file tarikan harian (.xlsx, sheet pertama) -> JSON baris untuk impor_tarikan.js (tanggal-jam ditulis {"$d": "yyyy-mm-ddThh:mm:ss"}).
# Pemakaian: python3 -I impor_baca.py <file.xlsx> <keluaran.json>
import sys, json, datetime
from python_calamine import CalamineWorkbook
wb = CalamineWorkbook.from_path(sys.argv[1])
rows = wb.get_sheet_by_name(wb.sheet_names[0]).to_python(skip_empty_area=False)
def v(x):
    if isinstance(x, datetime.datetime): return {'$d': x.isoformat(timespec='seconds')}
    if isinstance(x, datetime.date): return {'$d': x.isoformat() + 'T00:00:00'}
    if isinstance(x, datetime.time): return {'$d': '1899-12-30T' + x.isoformat(timespec='seconds')}
    return x
w = max((len(r) for r in rows), default=0)
json.dump([[v(x) for x in r] + [''] * (w - len(r)) for r in rows], open(sys.argv[2], 'w'))
print(sys.argv[1], len(rows) - 1, 'baris')
