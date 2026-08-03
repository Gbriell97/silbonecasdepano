require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Permite acessar /admin (sem .html) diretamente
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Config do estabelecimento (troque no arquivo .env)
const CONFIG = {
  nomeLoja: process.env.NOME_LOJA || "Sabor Express",
  whatsapp: process.env.WHATSAPP_NUMERO || "5511999999999", // formato: 55 + DDD + numero
  chavePix: process.env.CHAVE_PIX || "",
  mpAccessToken: process.env.MP_ACCESS_TOKEN || "",
  adminSenha: process.env.ADMIN_SENHA || "admin123",
};

// Pasta onde as fotos enviadas pelo admin são salvas
const imgDir = path.join(__dirname, "public", "img");
if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, imgDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      cb(null, `produto-${req.params.id}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

const uploadLoja = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, imgDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      cb(null, `loja-${req.params.campo}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Protege todas as rotas /api/admin/* com senha (enviada no header x-admin-senha)
function checarSenhaAdmin(req, res, next) {
  const senha = req.headers["x-admin-senha"];
  if (senha !== CONFIG.adminSenha) {
    return res.status(401).json({ erro: "Senha incorreta." });
  }
  next();
}

// Calcula se a loja está aberta agora, com base no horário configurado (fuso de Brasília)
function calcularAberto(configLoja) {
  if (configLoja.sempre_aberto) return true;

  let horarios;
  try {
    horarios = JSON.parse(configLoja.horarios_json || "{}");
  } catch {
    return true;
  }

  const agoraSP = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const dias = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
  const diaHoje = horarios[dias[agoraSP.getDay()]];

  if (!diaHoje || !diaHoje.aberto) return false;

  const minutosAgora = agoraSP.getHours() * 60 + agoraSP.getMinutes();
  const [hi, mi] = (diaHoje.inicio || "00:00").split(":").map(Number);
  const [hf, mf] = (diaHoje.fim || "23:59").split(":").map(Number);
  const minutosInicio = hi * 60 + mi;
  const minutosFim = hf * 60 + mf;

  if (minutosFim > minutosInicio) {
    return minutosAgora >= minutosInicio && minutosAgora < minutosFim;
  }
  // horário que passa da meia-noite (ex: 18:00 às 02:00)
  return minutosAgora >= minutosInicio || minutosAgora < minutosFim;
}

// ---------- Rotas públicas ----------

app.get("/api/loja", (req, res) => {
  const configLoja = db.prepare("SELECT * FROM loja_config WHERE id = 1").get();
  let horarios = {};
  try {
    horarios = JSON.parse(configLoja.horarios_json || "{}");
  } catch {}

  const capas = [
    { arquivo: configLoja.capa1, posicao: configLoja.capa1_pos },
    { arquivo: configLoja.capa2, posicao: configLoja.capa2_pos },
    { arquivo: configLoja.capa3, posicao: configLoja.capa3_pos },
  ].filter((c) => c.arquivo);

  res.json({
    nome: configLoja.nome,
    tagline: configLoja.tagline,
    logo: configLoja.logo,
    capas,
    corPrimaria: configLoja.cor_primaria,
    endereco: configLoja.endereco,
    textoEntrega: configLoja.texto_entrega,
    aberto: calcularAberto(configLoja),
    horarios,
    whatsapp: CONFIG.whatsapp,
    aceitaPix: !!CONFIG.chavePix,
  });
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
  const nomeLoja = db.prepare("SELECT nome FROM loja_config WHERE id = 1").get()?.nome || CONFIG.nomeLoja;

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
    `*Novo pedido #${info.lastInsertRowid} - ${nomeLoja}*\n\n` +
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

// ---------- Área administrativa (protegida por senha) ----------

// Login: só confirma se a senha está correta
app.post("/api/admin/login", (req, res) => {
  const { senha } = req.body;
  if (senha !== CONFIG.adminSenha) {
    return res.status(401).json({ erro: "Senha incorreta." });
  }
  res.json({ ok: true });
});

app.get("/api/admin/pedidos", checarSenhaAdmin, (req, res) => {
  const pedidos = db.prepare("SELECT * FROM pedidos ORDER BY id DESC").all();
  res.json(pedidos);
});

// Cardápio completo (inclui itens indisponíveis, para o admin poder reativar)
app.get("/api/admin/cardapio", checarSenhaAdmin, (req, res) => {
  const categorias = db.prepare("SELECT * FROM categorias ORDER BY ordem").all();
  const produtos = db.prepare("SELECT * FROM produtos").all();
  const resultado = categorias.map((cat) => ({
    ...cat,
    produtos: produtos.filter((p) => p.categoria_id === cat.id),
  }));
  res.json(resultado);
});

// --- Categorias ---
app.post("/api/admin/categorias", checarSenhaAdmin, (req, res) => {
  const { nome, icone } = req.body;
  if (!nome) return res.status(400).json({ erro: "Nome da categoria é obrigatório." });
  const ordemMax = db.prepare("SELECT MAX(ordem) AS m FROM categorias").get().m || 0;
  const info = db
    .prepare("INSERT INTO categorias (nome, ordem, icone) VALUES (?, ?, ?)")
    .run(nome, ordemMax + 1, icone || null);
  res.json({ id: info.lastInsertRowid, nome, ordem: ordemMax + 1, icone: icone || null });
});

app.put("/api/admin/categorias/:id", checarSenhaAdmin, (req, res) => {
  const { nome, icone } = req.body;
  const atual = db.prepare("SELECT * FROM categorias WHERE id = ?").get(req.params.id);
  if (!atual) return res.status(404).json({ erro: "Categoria não encontrada." });
  db.prepare("UPDATE categorias SET nome = ?, icone = ? WHERE id = ?").run(
    nome ?? atual.nome,
    icone !== undefined ? icone : atual.icone,
    req.params.id
  );
  res.json({ ok: true });
});

app.delete("/api/admin/categorias/:id", checarSenhaAdmin, (req, res) => {
  const temProdutos = db.prepare("SELECT COUNT(*) AS c FROM produtos WHERE categoria_id = ?").get(req.params.id).c;
  if (temProdutos > 0) {
    return res.status(400).json({ erro: "Remova ou mova os produtos dessa categoria antes de excluí-la." });
  }
  db.prepare("DELETE FROM categorias WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// --- Produtos ---
app.post("/api/admin/produtos", checarSenhaAdmin, (req, res) => {
  const { categoria_id, nome, descricao, preco } = req.body;
  if (!categoria_id || !nome || preco === undefined) {
    return res.status(400).json({ erro: "Categoria, nome e preço são obrigatórios." });
  }
  const info = db
    .prepare("INSERT INTO produtos (categoria_id, nome, descricao, preco, disponivel) VALUES (?, ?, ?, ?, 1)")
    .run(categoria_id, nome, descricao || "", preco);
  res.json({ id: info.lastInsertRowid });
});

app.put("/api/admin/produtos/:id", checarSenhaAdmin, (req, res) => {
  const { categoria_id, nome, descricao, preco, disponivel, imagem_pos } = req.body;
  const atual = db.prepare("SELECT * FROM produtos WHERE id = ?").get(req.params.id);
  if (!atual) return res.status(404).json({ erro: "Produto não encontrado." });

  db.prepare(
    `UPDATE produtos SET categoria_id = ?, nome = ?, descricao = ?, preco = ?, disponivel = ?, imagem_pos = ? WHERE id = ?`
  ).run(
    categoria_id ?? atual.categoria_id,
    nome ?? atual.nome,
    descricao ?? atual.descricao,
    preco ?? atual.preco,
    disponivel !== undefined ? (disponivel ? 1 : 0) : atual.disponivel,
    imagem_pos ?? atual.imagem_pos,
    req.params.id
  );
  res.json({ ok: true });
});

app.delete("/api/admin/produtos/:id", checarSenhaAdmin, (req, res) => {
  db.prepare("DELETE FROM produtos WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Upload de foto do produto
app.post("/api/admin/produtos/:id/imagem", checarSenhaAdmin, upload.single("imagem"), (req, res) => {
  if (!req.file) return res.status(400).json({ erro: "Nenhum arquivo enviado." });

  const produto = db.prepare("SELECT * FROM produtos WHERE id = ?").get(req.params.id);
  if (!produto) return res.status(404).json({ erro: "Produto não encontrado." });

  // Remove a foto antiga, se existir e for um upload anterior
  if (produto.imagem) {
    const antiga = path.join(imgDir, produto.imagem);
    if (fs.existsSync(antiga)) fs.unlinkSync(antiga);
  }

  db.prepare("UPDATE produtos SET imagem = ? WHERE id = ?").run(req.file.filename, req.params.id);
  res.json({ ok: true, imagem: req.file.filename });
});

// --- Configuração da loja (capa, logo, cores, horário) ---

app.get("/api/admin/loja", checarSenhaAdmin, (req, res) => {
  const configLoja = db.prepare("SELECT * FROM loja_config WHERE id = 1").get();
  res.json(configLoja);
});

app.put("/api/admin/loja", checarSenhaAdmin, (req, res) => {
  const { nome, tagline, cor_primaria, endereco, texto_entrega, sempre_aberto, horarios } = req.body;
  const atual = db.prepare("SELECT * FROM loja_config WHERE id = 1").get();

  db.prepare(
    `UPDATE loja_config SET nome = ?, tagline = ?, cor_primaria = ?, endereco = ?, texto_entrega = ?, sempre_aberto = ?, horarios_json = ? WHERE id = 1`
  ).run(
    nome ?? atual.nome,
    tagline ?? atual.tagline,
    cor_primaria ?? atual.cor_primaria,
    endereco ?? atual.endereco,
    texto_entrega ?? atual.texto_entrega,
    sempre_aberto !== undefined ? (sempre_aberto ? 1 : 0) : atual.sempre_aberto,
    horarios ? JSON.stringify(horarios) : atual.horarios_json
  );
  res.json({ ok: true });
});

// Upload de logo ou capa (campo: "logo", "capa1", "capa2" ou "capa3")
app.post("/api/admin/loja/imagem/:campo", checarSenhaAdmin, (req, res, next) => {
  const camposValidos = ["logo", "capa1", "capa2", "capa3"];
  if (!camposValidos.includes(req.params.campo)) {
    return res.status(400).json({ erro: "Campo de imagem inválido." });
  }
  next();
}, uploadLoja.single("imagem"), (req, res) => {
  if (!req.file) return res.status(400).json({ erro: "Nenhum arquivo enviado." });

  const campo = req.params.campo;
  const atual = db.prepare("SELECT * FROM loja_config WHERE id = 1").get();

  // Remove a imagem antiga desse campo, se existir
  if (atual[campo]) {
    const antiga = path.join(imgDir, atual[campo]);
    if (fs.existsSync(antiga)) fs.unlinkSync(antiga);
  }

  db.prepare(`UPDATE loja_config SET ${campo} = ? WHERE id = 1`).run(req.file.filename);
  res.json({ ok: true, imagem: req.file.filename });
});

// Salva só a posição de enquadramento de uma capa (campo: "capa1", "capa2" ou "capa3")
app.put("/api/admin/loja/posicao/:campo", checarSenhaAdmin, (req, res) => {
  const camposValidos = ["capa1", "capa2", "capa3"];
  if (!camposValidos.includes(req.params.campo)) {
    return res.status(400).json({ erro: "Campo inválido." });
  }
  const { posicao } = req.body;
  if (!posicao) return res.status(400).json({ erro: "Posição é obrigatória." });

  db.prepare(`UPDATE loja_config SET ${req.params.campo}_pos = ? WHERE id = 1`).run(posicao);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Servidor de ${CONFIG.nomeLoja} rodando em http://localhost:${PORT}`);
});
