"""Bangun ulang file template setelah tema.css / tema.js / contoh.html / aset/ diubah.

    python3 template/build.py

Menghasilkan:
  template/aset.js                 -> logo & gambar sebagai data URI (dipakai contoh.html)
  template/apps-script/Tema.html   -> <style> isi tema.css </style>
  template/apps-script/TemaJs.html -> <script> isi tema.js </script>
  template/apps-script/Aset.html   -> <script> isi aset.js </script>
  template/apps-script/Halaman.html-> contoh.html dengan <?!= include('...') ?>
"""
import base64, json, pathlib, re

T = pathlib.Path(__file__).resolve().parent
AS = T / 'apps-script'
ASET = {  # kunci data-aset -> file
    'danantara': 'logo-danantara.png',
    'elnusa': 'logo-elnusa-petrofin.png',
    'rtc': 'logo-rtc.png',
    'ilustrasi': 'ilustrasi-login.webp',
    'heksagon': 'ikon-heksagon.webp',
}
MIME = {'.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'}

uri = {k: f"data:{MIME[(T/'aset'/f).suffix]};base64," + base64.b64encode((T/'aset'/f).read_bytes()).decode() for k, f in ASET.items()}
aset_js = '/* dibuat oleh build.py — jangan diubah manual */\nwindow.ASET_TEMA = ' + json.dumps(uri, indent=0) + ';\n'
(T/'aset.js').write_text(aset_js)
AS.mkdir(exist_ok=True)
(AS/'Tema.html').write_text('<style>\n' + (T/'tema.css').read_text() + '</style>\n')
(AS/'TemaJs.html').write_text('<script>\n' + (T/'tema.js').read_text() + '</script>\n')
(AS/'Aset.html').write_text('<script>\n' + aset_js + '</script>\n')

html = (T/'contoh.html').read_text()
inc = lambda m: "<?!= include('" + m.group(1) + "') ?>"
html = re.sub(r'<link rel="stylesheet" href="[^"]+"><!--@include (\w+)-->', inc, html)
html = re.sub(r'<script src="[^"]+"></script><!--@include (\w+)-->', inc, html)
assert '@include' not in html, 'penanda @include tidak terganti'
(AS/'Halaman.html').write_text(html)
print('OK:', ', '.join(p.name for p in [T/'aset.js', *sorted(AS.glob('*.html'))]))
