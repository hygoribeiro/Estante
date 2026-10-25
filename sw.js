// Service worker da Minha Estante
// - Deixa o app abrir sem internet (guarda a última versão da página e dos ícones)
// - Mostra o lembrete diário (notificação enviada por /api/lembrete)
const CACHE = 'estante-v1';
// Caminhos relativos à pasta do app (funciona na raiz da Vercel ou numa subpasta)
const BASE = self.registration.scope;
const INICIO = new URL('./', BASE).href;
const ARQUIVOS = ['./', 'manifest.webmanifest', 'icones/icone-192.png', 'icones/icone-512.png'].map(u => new URL(u, BASE).href);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Página: tenta a rede primeiro (sempre a versão nova) e usa a cópia guardada se estiver offline.
// Ícones e manifesto: cópia guardada primeiro. Nada de /api nem de outros sites passa por aqui.
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.href.startsWith(new URL('api/', BASE).href)) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const copia = r.clone(); caches.open(CACHE).then(c => c.put(INICIO, copia)); return r; })
      .catch(() => caches.match(INICIO)));
    return;
  }
  if (ARQUIVOS.includes(url.href)) e.respondWith(caches.match(req).then(r => r || fetch(req)));
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { corpo: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Minha Estante', {
    body: d.corpo || 'Que tal avançar um pouco hoje?',
    icon: new URL('icones/icone-192.png', BASE).href, badge: new URL('icones/icone-192.png', BASE).href,
    tag: 'lembrete-diario', renotify: true, data: { url: new URL(d.url || './#missoes', BASE).href }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const alvo = (e.notification.data && e.notification.data.url) || INICIO;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(janelas => {
    const j = janelas.find(w => new URL(w.url).origin === self.location.origin);
    if (j) { j.navigate(alvo).catch(() => {}); return j.focus(); }
    return self.clients.openWindow(alvo);
  }));
});
