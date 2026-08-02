const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

// Garante que a pasta "data" existe antes de criar o banco
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, "cardapio.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  descricao TEXT,
  preco REAL NOT NULL,
  imagem TEXT,
  disponivel INTEGER NOT NULL DEFAULT 1,
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

CREATE TABLE IF NOT EXISTS loja_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  nome TEXT NOT NULL DEFAULT 'Minha Loja',
  tagline TEXT NOT NULL DEFAULT '',
  logo TEXT,
  capa1 TEXT,
  capa2 TEXT,
  capa3 TEXT,
  cor_primaria TEXT NOT NULL DEFAULT '#e8a33d',
  endereco TEXT NOT NULL DEFAULT '',
  texto_entrega TEXT NOT NULL DEFAULT '',
  sempre_aberto INTEGER NOT NULL DEFAULT 1,
  horarios_json TEXT NOT NULL DEFAULT '{}'
);
`);

// Seed da configuração da loja (linha única, id fixo = 1)
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
    "Sabor Express",
    "Comida boa, feita com carinho.",
    "#e8a33d",
    "Entrega em até 40 min",
    JSON.stringify(horariosPadrao)
  );
}

// Seed inicial (apenas se o banco estiver vazio)
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

module.exports = db;
