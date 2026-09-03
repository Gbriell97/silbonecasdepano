# Cardápio Digital — V2.2.1

Versão do projeto com segurança de sessão, pedidos validados, imagens em alta qualidade com otimização WebP, vídeos de até 30 segundos em capas e posts/depoimentos, e favicon dinâmico para buscadores.

## Correção de autenticação (V2.2.1)

- A página `/admin.html` continua pública e exibe o formulário de login sem depender de uma sessão existente.
- A verificação de sessão usa `GET /api/admin/me`; sem sessão, ela mostra o formulário em vez de recarregar a página.
- `POST /api/admin/login` cria o cookie de sessão HttpOnly; `GET /api/admin/me` e as demais rotas administrativas exigem sessão válida.
- A rota `GET /api/admin/sessao` foi mantida por compatibilidade com instalações V2.2 anteriores.

## Mídias

- **Imagens:** JPG/JPEG/PNG/WebP, até 10 MB. O servidor guarda o original fora da pasta pública e gera WebP com qualidade 92%, sem reduzir a resolução no processamento do servidor.
- **Vídeos:** MP4 ou WebM, até 50 MB e no máximo 30 segundos. O servidor valida a duração com ffprobe e mantém o vídeo sem recompressão para preservar a qualidade.
- **Capas:** até 3 mídias; cada uma pode ser imagem ou vídeo.
- **Posts/depoimentos:** cada post pode ter foto ou vídeo.

## Logo no Google

O site agora publica `/favicon.png` a partir da logo configurada no painel e injeta o favicon na página. Isso permite que o Google use a logo como ícone do resultado de busca. A atualização do ícone no Google não é instantânea: depois do deploy e de a página ser rastreada novamente, o Google pode levar algum tempo para atualizar o resultado.

## Como rodar

Requer Node.js 18+.

```bash
cd backend
npm install
cp .env.example .env
npm start
```

Configure `ADMIN_SENHA` antes de produção.

## Render

Se usar disco persistente, configure `DATA_DIR` (por exemplo `/var/data`). Banco, uploads e originais serão gravados no disco persistente.

## Estrutura

```text
cardapio-site/
└── backend/
    ├── server.js
    ├── db.js
    ├── package.json
    ├── .env.example
    ├── data/
    └── public/
        ├── index.html
        ├── admin.html
        ├── app.js
        ├── admin.js
        ├── styles.css
        └── admin.css
```
