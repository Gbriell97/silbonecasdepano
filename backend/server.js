require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Config do estabelecimento (troque no arquivo .env)
const CONFIG = {
  nomeLoja: process.env.NOME_LOJA || "Sabor Express",
  whatsapp: process.env.WHATSAPP_NUMERO || "5511999999999", // formato: 55 + DDD + numero
  chavePix: process.env.CHAVE_PIX || "",
  mpAccessToken: process.env.MP_ACCESS_TOKEN || "",
};

// ---------- Rotas públicas ----------

app.get("/api/config", (req, res) => {
  res.json({ nomeLoja: CONFIG.nomeLoja, aceitaPix: !!CONFIG.chavePix });
});

app.get("/api/cardapio", (req, res) => {
  const categorias = db.prepare("SELECT * FROM categorias ORDER BY ordem").all();
  const produtos = db.prepare("SELECT * FROM produtos WHERE disponivel = 1").all();

  const resultado = categorias.map((cat) => ({
    ...cat,
    produtos: produtos.filter((p) => p.categoria_id === cat.id),
  }));

  res.json(resultado);
});

// Cria pedido e devolve link do WhatsApp já formatado
app.post("/api/pedidos", (req, res) => {
  const { cliente_nome, cliente_telefone, endereco, forma_pagamento, itens } = req.body;

  if (!cliente_nome || !cliente_telefone || !itens || !itens.length) {
    return res.status(400).json({ erro: "Dados incompletos para criar o pedido." });
  }

  const total = itens.reduce((soma, item) => soma + item.preco * item.quantidade, 0);

  const stmt = db.prepare(`
    INSERT INTO pedidos (cliente_nome, cliente_telefone, endereco, forma_pagamento, total, itens_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    cliente_nome,
    cliente_telefone,
    endereco || "",
    forma_pagamento,
    total,
    JSON.stringify(itens)
  );

  // Monta mensagem para o WhatsApp
  const linhas = itens
    .map((i) => `• ${i.quantidade}x ${i.nome} — R$ ${(i.preco * i.quantidade).toFixed(2)}`)
    .join("\n");

  const mensagem =
    `*Novo pedido #${info.lastInsertRowid} - ${CONFIG.nomeLoja}*\n\n` +
    `${linhas}\n\n` +
    `*Total: R$ ${total.toFixed(2)}*\n` +
    `Forma de pagamento: ${forma_pagamento}\n` +
    (endereco ? `Endereço: ${endereco}\n` : "") +
    `Cliente: ${cliente_nome} (${cliente_telefone})`;

  const linkWhatsapp = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(mensagem)}`;

  res.json({
    pedido_id: info.lastInsertRowid,
    total,
    link_whatsapp: linkWhatsapp,
  });
});

app.get("/api/pedidos/:id", (req, res) => {
  const pedido = db.prepare("SELECT * FROM pedidos WHERE id = ?").get(req.params.id);
  if (!pedido) return res.status(404).json({ erro: "Pedido não encontrado." });
  res.json(pedido);
});

// ---------- Pagamento online (Mercado Pago - Pix / Cartão) ----------
// Requer MP_ACCESS_TOKEN configurado no .env (conta Mercado Pago do lojista)
app.post("/api/pagamento/criar-preferencia", async (req, res) => {
  if (!CONFIG.mpAccessToken) {
    return res.status(400).json({
      erro: "Pagamento online não configurado. Defina MP_ACCESS_TOKEN no arquivo .env.",
    });
  }

  const { itens, pedido_id } = req.body;

  try {
    const resposta = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.mpAccessToken}`,
      },
      body: JSON.stringify({
        items: itens.map((i) => ({
          title: i.nome,
          quantity: i.quantidade,
          unit_price: i.preco,
          currency_id: "BRL",
        })),
        external_reference: String(pedido_id),
      }),
    });

    const dados = await resposta.json();
    res.json({ checkout_url: dados.init_point });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: "Falha ao criar pagamento." });
  }
});

// ---------- Admin simples (listar pedidos) ----------
app.get("/api/admin/pedidos", (req, res) => {
  const pedidos = db.prepare("SELECT * FROM pedidos ORDER BY id DESC").all();
  res.json(pedidos);
});

app.listen(PORT, () => {
  console.log(`Servidor de ${CONFIG.nomeLoja} rodando em http://localhost:${PORT}`);
});
