#!/usr/bin/env python3
# Mini serveur local de Partoche and Friends (Mac / Linux, et Lancer.bat du dépôt).
# Sert l'appli sur http://localhost:53682/ et présente le dossier « Partitions » comme un dossier Partoche :
#   Partitions/*.mscz (sous-dossiers compris) -> MSCZ/…   ·   Partitions/Friends/ -> Friends/ (profil, annotations)
# Usage : serveur.py [dossier de l'appli] [dossier Partitions]
import email.utils, json, os, sys, urllib.parse, webbrowser, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'app'))
PARTS = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'Partitions'))
PORT = 53682
os.makedirs(os.path.join(PARTS, 'Friends'), exist_ok=True)


def meta(full):
    st = os.stat(full)
    return {'size': st.st_size, 'hash': '%d-%d' % (st.st_size, int(st.st_mtime)), 'modified': email.utils.formatdate(st.st_mtime, usegmt=True)}


def real(virtual):
    # MSCZ/x -> Partitions/x ; Friends/x -> Partitions/Friends/x ; rien d'autre
    v = virtual.replace('\\', '/')
    if v.startswith('MSCZ/'): rel = v[5:]
    elif v.startswith('Friends/'): rel = v
    else: return None
    full = os.path.abspath(os.path.join(PARTS, rel))
    return full if full.startswith(PARTS + os.sep) else None


def listing():
    out = {}
    for d, dirs, files in os.walk(PARTS):
        dirs[:] = [x for x in dirs if not x.startswith('.')]
        for f in files:
            full = os.path.join(d, f)
            rel = os.path.relpath(full, PARTS).replace(os.sep, '/')
            if rel.startswith('Friends/'): out[rel] = meta(full)
            elif f.lower().endswith('.mscz'): out['MSCZ/' + rel] = meta(full)
    return out


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=APP, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, *a): pass

    def send(self, code, body=b'', ctype='application/json'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def api(self):
        u = urllib.parse.urlparse(self.path)
        if not u.path.startswith('/_paf/'): return False
        name = u.path[6:]
        if name == 'info':
            self.send(200, json.dumps({'folder': os.path.basename(PARTS), 'path': PARTS}).encode())
        elif name == 'list':
            self.send(200, json.dumps(listing()).encode())
        elif name == 'file':
            p = real(urllib.parse.parse_qs(u.query).get('p', [''])[0])
            if not p: self.send(400); return True
            if self.command == 'GET':
                if not os.path.isfile(p): self.send(404); return True
                with open(p, 'rb') as f: self.send(200, f.read(), 'application/octet-stream')
            elif self.command == 'PUT':
                n = int(self.headers.get('Content-Length') or 0)
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p + '.tmp', 'wb') as f: f.write(self.rfile.read(n))
                os.replace(p + '.tmp', p)
                self.send(200, json.dumps(meta(p)).encode())
            elif self.command == 'DELETE':
                if os.path.isfile(p): os.remove(p)
                self.send(200, b'{}')
        else:
            self.send(404)
        return True

    def do_GET(self):
        if not self.api(): super().do_GET()

    def do_PUT(self): self.api() or self.send(405)
    def do_DELETE(self): self.api() or self.send(405)


if __name__ == '__main__':
    try:
        srv = ThreadingHTTPServer(('127.0.0.1', PORT), H)
    except OSError:
        print('Partoche and Friends tourne déjà (ou le port %d est pris).' % PORT)
        webbrowser.open('http://localhost:%d/' % PORT); sys.exit(0)
    print('Partoche and Friends tourne sur http://localhost:%d/' % PORT)
    print('Tes partitions : %s' % PARTS)
    print('Ferme cette fenêtre pour arrêter.')
    if not os.environ.get('PAF_NO_BROWSER'):
        threading.Timer(1, lambda: webbrowser.open('http://localhost:%d/' % PORT)).start()
    srv.serve_forever()
