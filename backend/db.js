const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "cardapio.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  icone TEXT
);

CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  descricao TEXT,
  preco REAL NOT NULL,
  imagem TEXT,
  imagem_pos TEXT NOT NULL DEFAULT '50% 50%',
  disponivel INTEGER NOT NULL DEFAULT 1,
  tipo_entrega TEXT NOT NULL DEFAULT 'pronta',
  prazo_producao TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (categoria_id) REFERENCES categorias(id)
);

CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_nome TEXT NOT NULL,
  cliente_telefone TEXT NOT NULL,
  endereco TEXT,
  forma_pagamento TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  total REAL NOT NULL,
  itens_json TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS pedido_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL,
  produto_id INTEGER,
  nome_produto TEXT NOT NULL,
  preco_unitario REAL NOT NULL,
  quantidade INTEGER NOT NULL,
  subtotal REAL NOT NULL,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS loja_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  nome TEXT NOT NULL DEFAULT 'Minha Loja',
  tagline TEXT NOT NULL DEFAULT '',
  logo TEXT,
  capa1 TEXT,
  capa2 TEXT,
  capa3 TEXT,
  capa1_pos TEXT NOT NULL DEFAULT '50% 50%',
  capa2_pos TEXT NOT NULL DEFAULT '50% 50%',
  capa3_pos TEXT NOT NULL DEFAULT '50% 50%',
  capa1_tipo TEXT NOT NULL DEFAULT 'image',
  capa2_tipo TEXT NOT NULL DEFAULT 'image',
  capa3_tipo TEXT NOT NULL DEFAULT 'image',
  cor_primaria TEXT NOT NULL DEFAULT '#e8a33d',
  endereco TEXT NOT NULL DEFAULT '',
  texto_entrega TEXT NOT NULL DEFAULT '',
  instagram TEXT NOT NULL DEFAULT '',
  sempre_aberto INTEGER NOT NULL DEFAULT 1,
  horarios_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS produto_fotos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL,
  arquivo TEXT NOT NULL,
  posicao TEXT NOT NULL DEFAULT '50% 50%',
  ordem INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
);

CREATE TABLE IF NOT EXISTS depoimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome_cliente TEXT NOT NULL,
  texto TEXT NOT NULL DEFAULT '',
  foto TEXT,
  media TEXT,
  media_tipo TEXT NOT NULL DEFAULT 'image',
  ordem INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS visitas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pagina TEXT NOT NULL DEFAULT 'home',
  criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_produtos_categoria_disponivel ON produtos(categoria_id, disponivel);
CREATE INDEX IF NOT EXISTS idx_produto_fotos_produto_ordem ON produto_fotos(produto_id, ordem, id);
CREATE INDEX IF NOT EXISTS idx_pedidos_status_criado ON pedidos(status, criado_em);
CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido ON pedido_itens(pedido_id);
CREATE INDEX IF NOT EXISTS idx_visitas_criado ON visitas(criado_em);
`);

function tentarAdicionarColuna(tabela, definicaoColuna) {
  try {
    db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${definicaoColuna}`);
  } catch (e) {
    if (!/duplicate column name/i.test(String(e.message))) throw e;
  }
}

tentarAdicionarColuna("categorias", "icone TEXT");
tentarAdicionarColuna("produtos", "imagem_pos TEXT NOT NULL DEFAULT '50% 50%'");
tentarAdicionarColuna("loja_config", "capa1_pos TEXT NOT NULL DEFAULT '50% 50%'");
tentarAdicionarColuna("loja_config", "capa2_pos TEXT NOT NULL DEFAULT '50% 50%'");
tentarAdicionarColuna("loja_config", "capa3_pos TEXT NOT NULL DEFAULT '50% 50%'");
tentarAdicionarColuna("produtos", "tipo_entrega TEXT NOT NULL DEFAULT 'pronta'");
tentarAdicionarColuna("produtos", "prazo_producao TEXT NOT NULL DEFAULT ''");
tentarAdicionarColuna("loja_config", "instagram TEXT NOT NULL DEFAULT ''");
tentarAdicionarColuna("loja_config", "capa1_tipo TEXT NOT NULL DEFAULT 'image'");
tentarAdicionarColuna("loja_config", "capa2_tipo TEXT NOT NULL DEFAULT 'image'");
tentarAdicionarColuna("loja_config", "capa3_tipo TEXT NOT NULL DEFAULT 'image'");
tentarAdicionarColuna("depoimentos", "media TEXT");
tentarAdicionarColuna("depoimentos", "media_tipo TEXT NOT NULL DEFAULT 'image'");

const produtosComFotoAntiga = db
  .prepare("SELECT id, imagem, imagem_pos FROM produtos WHERE imagem IS NOT NULL AND imagem != ''")
  .all();
const contarFotos = db.prepare("SELECT COUNT(*) AS c FROM produto_fotos WHERE produto_id = ?");
const inserirFotoAntiga = db.prepare(
  "INSERT INTO produto_fotos (produto_id, arquivo, posicao, ordem) VALUES (?, ?, ?, 0)"
);
for (const produto of produtosComFotoAntiga) {
  if (!contarFotos.get(produto.id).c) {
    inserirFotoAntiga.run(produto.id, produto.imagem, produto.imagem_pos || "50% 50%");
  }
}

const configExiste = db.prepare("SELECT COUNT(*) AS c FROM loja_config WHERE id = 1").get().c;
if (!configExiste) {
  const horariosPadrao = {
    dom: { aberto: true, inicio: "10:00", fim: "22:00" },
    seg: { aberto: true, inicio: "10:00", fim: "22:00" },
    ter: { aberto: true, inicio: "10:00", fim: "22:00" },
    qua: { aberto: true, inicio: "10:00", fim: "22:00" },
    qui: { aberto: true, inicio: "10:00", fim: "22:00" },
    sex: { aberto: true, inicio: "10:00", fim: "22:00" },
    sab: { aberto: true, inicio: "10:00", fim: "22:00" },
  };
  db.prepare(
    `INSERT INTO loja_config (id, nome, tagline, cor_primaria, texto_entrega, sempre_aberto, horarios_json)
     VALUES (1, ?, ?, ?, ?, 1, ?)`
  ).run(
    process.env.NOME_LOJA || "Sabor Express",
    "Comida boa, feita com carinho.",
    "#e8a33d",
    "Entrega em até 40 min",
    JSON.stringify(horariosPadrao)
  );
}

const count = db.prepare("SELECT COUNT(*) AS c FROM categorias").get().c;
if (count === 0) {
  const insertCategoria = db.prepare("INSERT INTO categorias (nome, ordem) VALUES (?, ?)");
  const insertProduto = db.prepare(`
    INSERT INTO produtos (categoria_id, nome, descricao, preco, imagem, disponivel)
    VALUES (?, ?, ?, ?, ?, 1)
  `);

  const catLanches = insertCategoria.run("Lanches", 1).lastInsertRowid;
  const catPratos = insertCategoria.run("Pratos Feitos", 2).lastInsertRowid;
  const catBebidas = insertCategoria.run("Bebidas", 3).lastInsertRowid;
  const catSobremesas = insertCategoria.run("Sobremesas", 4).lastInsertRowid;

  insertProduto.run(catLanches, "X-Burger Artesanal", "Pão brioche, blend 150g, queijo, alface, tomate e molho da casa", 24.9, "burger.jpg");
  insertProduto.run(catLanches, "X-Bacon", "Pão brioche, blend 150g, bacon crocante, queijo cheddar", 27.9, "xbacon.jpg");
  insertProduto.run(catPratos, "Marmita Fitness", "Frango grelhado, arroz integral, brócolis e batata doce", 22.0, "marmita.jpg");
  insertProduto.run(catPratos, "Feijoada Completa", "Feijoada tradicional com acompanhamentos", 32.0, "feijoada.jpg");
  insertProduto.run(catBebidas, "Refrigerante Lata", "350ml, diversos sabores", 6.0, "refri.jpg");
  insertProduto.run(catBebidas, "Suco Natural", "500ml, feito na hora", 9.0, "suco.jpg");
  insertProduto.run(catSobremesas, "Pudim de Leite", "Fatia individual", 8.0, "pudim.jpg");
}

// Migra pedidos antigos para a tabela normalizada, sem apagar o itens_json usado pelo frontend atual.
const pedidosSemItensNormalizados = db.prepare(`
  SELECT p.id, p.itens_json
  FROM pedidos p
  WHERE NOT EXISTS (SELECT 1 FROM pedido_itens pi WHERE pi.pedido_id = p.id)
`).all();
const inserirPedidoItem = db.prepare(`
  INSERT INTO pedido_itens
    (pedido_id, produto_id, nome_produto, preco_unitario, quantidade, subtotal)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const normalizarPedidos = db.transaction(() => {
  for (const pedido of pedidosSemItensNormalizados) {
    let itens;
    try { itens = JSON.parse(pedido.itens_json || "[]"); } catch { itens = []; }
    for (const item of Array.isArray(itens) ? itens : []) {
      const quantidade = Number(item.quantidade);
      const preco = Number(item.preco);
      if (!Number.isInteger(quantidade) || quantidade <= 0 || !Number.isFinite(preco) || preco < 0) continue;
      inserirPedidoItem.run(
        pedido.id,
        Number.isInteger(Number(item.id)) ? Number(item.id) : null,
        String(item.nome || "Produto"),
        preco,
        quantidade,
        Number((preco * quantidade).toFixed(2))
      );
    }
  }
});
normalizarPedidos();

module.exports = db;
