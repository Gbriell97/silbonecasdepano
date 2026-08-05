// Service worker mínimo — necessário para o navegador (principalmente Android/Chrome)
// reconhecer o site como um app instalável e permitir "Adicionar à tela inicial"
// com ícone próprio (em vez de um simples atalho).

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});

// Repassa as requisições normalmente (sem cache customizado por enquanto)
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
