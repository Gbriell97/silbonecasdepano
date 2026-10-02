# Backend V2.1

## Principais mudanças
- Autenticação administrativa por cookie HttpOnly, sem guardar senha no sessionStorage.
- Sessão com expiração configurável.
- Limite de tentativas de login.
- Validação de preços e quantidades no servidor.
- Preço do pedido sempre vem do banco, nunca do navegador.
- `pedido_itens` normaliza os itens dos pedidos.
- **Upload de imagens de até 10 MB.**
- **Conversão automática para WebP com qualidade 92, mantendo a resolução original.**
- **A imagem original é preservada em armazenamento privado, fora da pasta pública.**
- **As imagens entregues ao site ficam otimizadas e recebem cache de até 30 dias em produção.**
- Headers básicos de segurança.
- CORS configurável.
- Limite de JSON recebido.
- Índices no SQLite.
- Migração automática dos pedidos antigos para `pedido_itens`.
- Rotas administrativas mantêm os mesmos caminhos usados pelo painel atual.

## Sistema de imagens V2.1

O fluxo é:

```text
Imagem original (até 10 MB)
        ↓
Validação do formato
        ↓
Sharp
        ↓
Correção automática de orientação
        ↓
WebP qualidade 92
        ↓
Arquivo otimizado usado pelo site
```

A resolução não é reduzida automaticamente. Uma foto de 4000x4000 continua 4000x4000, mas é convertida para WebP e comprimida com alta qualidade.

O original é guardado em uma pasta privada (`originals`) e não fica acessível pela rota `/img`. Isso permite recuperar/reprocessar a imagem no futuro.

### Dependência adicional

A V2.1 utiliza `sharp`. Ao instalar em uma máquina ou no Render, execute:

```bash
npm install
npm start
```

O `package-lock.json` foi removido da entrega porque a nova dependência precisa ser resolvida novamente pelo npm no ambiente de instalação.

## Instalação

Copie `.env.example` para `.env` e configure principalmente `ADMIN_SENHA`.

## Observação sobre sessões

A sessão V2.1 fica em memória. Isso é adequado para uma única instância do Render. Se futuramente houver múltiplas instâncias, migrar sessões para Redis/SQLite persistente é o próximo passo.
