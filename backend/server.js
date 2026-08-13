require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const sharp = require("sharp");
const db = require("./db");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === "production";
app.disable("x-powered-by");
app.set("trust proxy", 1);

const CONFIG = {
  nomeLoja: process.env.NOME_LOJA || "Sabor Express",
  whatsapp: process.env.WHATSAPP_NUMERO || "",
  chavePix: process.env.CHAVE_PIX || "",
  mpAccessToken: process.env.MP_ACCESS_TOKEN || "",
  adminSenha: process.env.ADMIN_SENHA || "",
  sessionHours: Math.max(1, Number(process.env.ADMIN_SESSION_HOURS) || 8),
  allowedOrigin: process.env.ALLOWED_ORIGIN || "",
};

if (IS_PROD && !CONFIG.adminSenha) {
  throw new Error("ADMIN_SENHA precisa estar configurada em produção.");
}

const allowedOrigins = CONFIG.allowedOrigin
  ? CONFIG.allowedOrigin.split(",").map((v) => v.trim()).filter(Boolean)
  : [];

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origem não permitida pelo CORS."));
  },
  credentials: true,
}));
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (req, res) => res.json({ ok: true, version: "2.1.0" }));

// -------------------- Segurança / sessão --------------------
const sessoes = new Map();
const tentativasLogin = new Map();
const SESSION_COOKIE = "admin_session";

function limparSessoesExpiradas() {
  const agora = Date.now();
  for (const [token, sessao] of sessoes) {
    if (sessao.expiraEm <= agora) sessoes.delete(token);
  }
}
setInterval(limparSessoesExpiradas, 10 * 60 * 1000).unref();

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) out[key] = decodeURIComponent(rest.join("="));
  }
  return out;
}

function criarSessao(res) {
  const token = crypto.randomBytes(32).toString("hex");
  sessoes.set(token, { expiraEm: Date.now() + CONFIG.sessionHours * 60 * 60 * 1000 });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    maxAge: CONFIG.sessionHours * 60 * 60 * 1000,
    path: "/",
  });
}

function destruirSessao(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) sessoes.delete(token);
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: IS_PROD, sameSite: "lax", path: "/" });
}

function checarSessaoAdmin(req, res, next) {
  limparSessoesExpiradas();
  const token = parseCookies(req)[SESSION_COOKIE];
  const sessao = token ? sessoes.get(token) : null;
  if (!sessao || sessao.expiraEm <= Date.now()) {
    if (token) sessoes.delete(token);
    return res.status(401).json({ erro: "Sessão expirada. Faça login novamente." });
  }
  next();
}

function compararSenha(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function ipKey(req) {
  return req.ip || req.socket.remoteAddress || "desconhecido";
}

function loginPermitido(req) {
  const agora = Date.now();
  const chave = ipKey(req);
  const item = tentativasLogin.get(chave) || { falhas: 0, bloqueadoAte: 0 };
  if (item.bloqueadoAte > agora) return false;
  return true;
}

function registrarFalhaLogin(req) {
  const chave = ipKey(req);
  const item = tentativasLogin.get(chave) || { falhas: 0, bloqueadoAte: 0 };
  item.falhas += 1;
  if (item.falhas >= 5) {
    item.bloqueadoAte = Date.now() + 15 * 60 * 1000;
    item.falhas = 0;
  }
  tentativasLogin.set(chave, item);
}

function limparFalhasLogin(req) {
  tentativasLogin.delete(ipKey(req));
}

// -------------------- Uploads --------------------
const dataRoot = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const imgDir = process.env.DATA_DIR
  ? path.join(dataRoot, "uploads")
  : path.join(__dirname, "public", "img");
// Originais ficam fora da pasta pública e nunca são servidos diretamente pelo Express.
const originalDir = path.join(dataRoot, "originals");
if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
if (!fs.existsSync(originalDir)) fs.mkdirSync(originalDir, { recursive: true });
app.use("/img", express.static(imgDir, { maxAge: IS_PROD ? "30d" : 0, etag: true, immutable: IS_PROD }));

// Upload de alta qualidade: aceita até 10 MB e gera automaticamente uma versão WebP otimizada.
// A resolução original é preservada; não fazemos resize. O original fica guardado fora da pasta pública.
const EXTENSOES = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const WEBP_QUALITY = 92;

function validarArquivoImagem(file) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  return EXTENSOES.has(ext) && MIMES.has(file.mimetype);
}

function criarUpload() {
  return multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => cb(null, validarArquivoImagem(file)),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });
}

const upload = criarUpload();
const uploadLoja = criarUpload();
const uploadDepoimento = criarUpload();

async function otimizarImagemUpload(req, res, next) {
  try {
    if (!req.file) return next();

    const extOriginal = path.extname(req.file.originalname || ".jpg").toLowerCase() || ".jpg";
    const base = `${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex")}`;
    const nomeOriginal = `${base}.original${extOriginal}`;
    const nomeOtimizado = `${base}.webp`;
    const caminhoOriginal = path.join(originalDir, nomeOriginal);
    const caminhoOtimizado = path.join(imgDir, nomeOtimizado);

    const pipeline = sharp(req.file.buffer, { failOn: "error" }).rotate();
    const metadata = await pipeline.metadata();

    if (!metadata.width || !metadata.height) {
      return res.status(400).json({ erro: "Não foi possível identificar as dimensões da imagem." });
    }

    await fs.promises.writeFile(caminhoOriginal, req.file.buffer);
    await sharp(req.file.buffer, { failOn: "error" })
      .rotate()
      .webp({ quality: WEBP_QUALITY, effort: 5, smartSubsample: true })
      .toFile(caminhoOtimizado);

    const stat = await fs.promises.stat(caminhoOtimizado);
    req.file.filename = nomeOtimizado;
    req.file.originalFilename = nomeOriginal;
    req.file.originalSize = req.file.size;
    req.file.optimizedSize = stat.size;
    req.file.width = metadata.width;
    req.file.height = metadata.height;
    req.file.optimizedFormat = "webp";

    return next();
  } catch (err) {
    try { if (typeof caminhoOriginal !== "undefined") await fs.promises.rm(caminhoOriginal, { force: true }); } catch {}
    try { if (typeof caminhoOtimizado !== "undefined") await fs.promises.rm(caminhoOtimizado, { force: true }); } catch {}
    console.error("Erro ao otimizar imagem:", err);
    return res.status(400).json({ erro: "Não foi possível processar a imagem. Verifique se o arquivo é uma imagem válida." });
  }
}

function removerArquivoSeguro(nome) {
  if (!nome) return;
  const base = path.basename(nome);
  const caminho = path.join(imgDir, base);
  const raizPublica = path.resolve(imgDir) + path.sep;
  if (caminho.startsWith(raizPublica) && fs.existsSync(caminho)) {
    try { fs.unlinkSync(caminho); } catch (e) { console.warn("Não foi possível remover arquivo:", e.message); }
  }

  // Para imagens V2, também remove a cópia original preservada fora da pasta pública.
  const stem = path.basename(base, path.extname(base));
  const originalPrefix = `${stem}.original`;
  try {
    for (const arquivo of fs.readdirSync(originalDir)) {
      if (arquivo.startsWith(originalPrefix + ".")) {
        const originalPath = path.join(originalDir, arquivo);
        if (originalPath.startsWith(path.resolve(originalDir) + path.sep)) fs.unlinkSync(originalPath);
      }
    }
  } catch (e) {
    console.warn("Não foi possível remover original:", e.message);
  }
}

function uploadErrorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ erro: "Imagem muito grande. O limite é 10 MB." });
    return res.status(400).json({ erro: `Upload inválido: ${err.message}` });
  }
  if (err) return res.status(400).json({ erro: "Arquivo inválido. Use JPG, PNG ou WebP de até 10 MB." });
  next();
}

function removerArquivoSeguro(nome) {
  if (!nome) return;
  const base = path.basename(nome);
  const caminho = path.join(imgDir, base);
  if (caminho.startsWith(path.resolve(imgDir) + path.sep) && fs.existsSync(caminho)) {
    try { fs.unlinkSync(caminho); } catch (e) { console.warn("Não foi possível remover arquivo:", e.message); }
  }
}

// -------------------- Utilidades --------------------
function ehBotDePreview(userAgent = "") {
  return /whatsapp|facebookexternalhit|telegrambot|slackbot|discordbot|linkedinbot|twitterbot/i.test(userAgent);
}

function baseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function calcularAberto(configLoja) {
  if (configLoja.sempre_aberto) return true;
  let horarios;
  try { horarios = JSON.parse(configLoja.horarios_json || "{}"); } catch { return false; }
  const agora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const dias = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
  const dia = horarios[dias[agora.getDay()]];
  if (!dia || !dia.aberto) return false;
  const [hi, mi] = String(dia.inicio || "00:00").split(":").map(Number);
  const [hf, mf] = String(dia.fim || "23:59").split(":").map(Number);
  const agoraMin = agora.getHours() * 60 + agora.getMinutes();
  const inicio = hi * 60 + mi;
  const fim = hf * 60 + mf;
  return fim > inicio ? agoraMin >= inicio && agoraMin < fim : agoraMin >= inicio || agoraMin < fim;
}

function anexarFotos(produtos) {
  if (!produtos.length) return produtos;
  const ids = produtos.map((p) => p.id);
  const placeholders = ids.map(() => "?").join(",");
  const fotos = db.prepare(`SELECT * FROM produto_fotos WHERE produto_id IN (${placeholders}) ORDER BY ordem ASC, id ASC`).all(...ids);
  return produtos.map((p) => {
    const fotosProduto = fotos.filter((f) => f.produto_id === p.id);
    return { ...p, fotos: fotosProduto, imagem: fotosProduto[0]?.arquivo || p.imagem || null, imagem_pos: fotosProduto[0]?.posicao || p.imagem_pos || "50% 50%" };
  });
}

function numeroInteiroPositivo(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}
function precoValido(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 && n <= 1000000 ? Number(n.toFixed(2)) : null;
}
function texto(valor, max = 5000) {
  if (valor === undefined || valor === null) return "";
  return String(valor).trim().slice(0, max);
}
function validarFormaPagamento(valor) {
  const permitidas = new Set(["Pix", "Dinheiro", "Cartão", "Pagamento online", "Cartão de crédito", "Cartão de débito"]);
  return permitidas.has(valor) ? valor : null;
}

function obterItensConfiaveis(itensRecebidos) {
  if (!Array.isArray(itensRecebidos) || itensRecebidos.length === 0 || itensRecebidos.length > 50) {
    throw new Error("O pedido precisa conter entre 1 e 50 itens.");
  }
  const mapa = new Map();
  for (const bruto of itensRecebidos) {
    const produtoId = numeroInteiroPositivo(bruto?.id ?? bruto?.produto_id);
    const quantidade = numeroInteiroPositivo(bruto?.quantidade);
    if (!produtoId || !quantidade || quantidade > 100) throw new Error("Item ou quantidade inválida.");
    mapa.set(produtoId, (mapa.get(produtoId) || 0) + quantidade);
  }
  if (mapa.size > 50) throw new Error("Quantidade de produtos no pedido excedida.");

  const ids = [...mapa.keys()];
  const placeholders = ids.map(() => "?").join(",");
  const produtos = db.prepare(`SELECT id, nome, preco, disponivel FROM produtos WHERE id IN (${placeholders})`).all(...ids);
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const itens = [];
  for (const [id, quantidade] of mapa) {
    const produto = porId.get(id);
    if (!produto || !produto.disponivel) throw new Error(`Produto #${id} não está disponível.`);
    const preco = Number(produto.preco);
    const subtotal = Number((preco * quantidade).toFixed(2));
    itens.push({ id: produto.id, nome: produto.nome, preco, quantidade, subtotal });
  }
  const total = Number(itens.reduce((sum, i) => sum + i.subtotal, 0).toFixed(2));
  return { itens, total };
}

// -------------------- SEO / PWA --------------------
app.get("/", (req, res) => {
  const configLoja = db.prepare("SELECT * FROM loja_config WHERE id = 1").get();
  const url = baseUrl(req);
  const imagemUrl = configLoja.logo ? `${url}/img/${configLoja.logo}` : configLoja.capa1 ? `${url}/img/${configLoja.capa1}` : `${url}/img/`;
  if (!ehBotDePreview(req.headers["user-agent"])) db.prepare("INSERT INTO visitas (pagina) VALUES ('home')").run();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Store",
    name: configLoja.nome,
    description: configLoja.tagline || undefined,
    image: configLoja.logo ? imagemUrl : undefined,
    address: configLoja.endereco || undefined,
    telephone: CONFIG.whatsapp || undefined,
    url,
  };
  let html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf-8");
  html = html
    .replace(/%%OG_TITLE%%/g, configLoja.nome || "Cardápio Digital")
    .replace(/%%OG_DESCRICAO%%/g, configLoja.tagline || "Confira nosso cardápio!")
    .replace(/%%OG_IMAGEM%%/g, imagemUrl)
    .replace(/%%OG_URL%%/g, url)
    .replace(/%%JSON_LD%%/g, JSON.stringify(jsonLd).replace(/</g, "\\u003c"))
    .replace(/%%GOOGLE_VERIFICATION%%/g, process.env.GOOGLE_SITE_VERIFICATION ? `<meta name="google-site-verification" content="${texto(process.env.GOOGLE_SITE_VERIFICATION, 200)}" />` : "");
  res.send(html);
});

app.get("/robots.txt", (req, res) => {
  const url = baseUrl(req);
  res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${url}/sitemap.xml`);
});
app.get("/sitemap.xml", (req, res) => {
  const url = baseUrl(req);
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${url}/</loc></url></urlset>`);
});
app.use(express.static(path.join(__dirname, "public")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

function montarManifest({ startUrl, sufixoNome }) {
  const configLoja = db.prepare("SELECT * FROM loja_config WHERE id = 1").get();
  const logoUrl = configLoja.logo ? `/img/${configLoja.logo}` : null;
  const ext = configLoja.logo ? path.extname(configLoja.logo).toLowerCase() : "";
  const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  const nome = configLoja.nome || CONFIG.nomeLoja;
  return {
    name: sufixoNome ? `${sufixoNome} ${nome}` : nome,
    short_name: sufixoNome ? `Admin ${nome.split(" ")[0]}` : nome.split(" ").slice(0, 2).join(" "),
    start_url: startUrl,
    display: "standalone",
    background_color: "#ffffff",
    theme_color: configLoja.cor_primaria || "#2f6b3a",
    icons: logoUrl ? [{ src: logoUrl, sizes: "192x192", type: mimeType, purpose: "any maskable" }, { src: logoUrl, sizes: "512x512", type: mimeType, purpose: "any maskable" }] : [],
  };
}
app.get("/manifest.json", (req, res) => res.json(montarManifest({ startUrl: "/" })));
app.get("/manifest-admin.json", (req, res) => res.json(montarManifest({ startUrl: "/admin", sufixoNome: "Admin —" })));

// -------------------- API pública --------------------
app.get("/api/loja", (req, res) => {
  const c = db.prepare("SELECT * FROM loja_config WHERE id = 1").get();
  let horarios = {};
  try { horarios = JSON.parse(c.horarios_json || "{}"); } catch {}
  res.json({
    nome: c.nome,
    tagline: c.tagline,
    logo: c.logo,
    capas: [{ arquivo: c.capa1, posicao: c.capa1_pos }, { arquivo: c.capa2, posicao: c.capa2_pos }, { arquivo: c.capa3, posicao: c.capa3_pos }].filter((x) => x.arquivo),
    corPrimaria: c.cor_primaria,
    endereco: c.endereco,
    textoEntrega: c.texto_entrega,
    instagram: c.instagram,
    aberto: calcularAberto(c),
    horarios,
    whatsapp: CONFIG.whatsapp,
    aceitaPix: Boolean(CONFIG.chavePix),
  });
});

app.get("/api/cardapio", (req, res) => {
  const categorias = db.prepare("SELECT * FROM categorias ORDER BY ordem, id").all();
  const produtos = anexarFotos(db.prepare("SELECT * FROM produtos WHERE disponivel = 1 ORDER BY id").all());
  res.json(categorias.map((cat) => ({ ...cat, produtos: produtos.filter((p) => p.categoria_id === cat.id) })));
});

app.post("/api/pedidos", (req, res) => {
  try {
    const cliente_nome = texto(req.body.cliente_nome, 120);
    const cliente_telefone = texto(req.body.cliente_telefone, 40);
    const endereco = texto(req.body.endereco, 500);
    const forma_pagamento = validarFormaPagamento(req.body.forma_pagamento);
    if (!cliente_nome || !cliente_telefone || !forma_pagamento) return res.status(400).json({ erro: "Nome, telefone e forma de pagamento são obrigatórios." });

    const { itens, total } = obterItensConfiaveis(req.body.itens);
    const nomeLoja = db.prepare("SELECT nome FROM loja_config WHERE id = 1").get()?.nome || CONFIG.nomeLoja;

    const criarPedido = db.transaction(() => {
      const info = db.prepare(`INSERT INTO pedidos (cliente_nome, cliente_telefone, endereco, forma_pagamento, total, itens_json) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(cliente_nome, cliente_telefone, endereco, forma_pagamento, total, JSON.stringify(itens));
      const insertItem = db.prepare(`INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, preco_unitario, quantidade, subtotal) VALUES (?, ?, ?, ?, ?, ?)`);
      for (const item of itens) insertItem.run(info.lastInsertRowid, item.id, item.nome, item.preco, item.quantidade, item.subtotal);
      return info.lastInsertRowid;
    });
    const pedidoId = criarPedido();

    const linhas = itens.map((i) => `• ${i.quantidade}x ${i.nome} — R$ ${i.subtotal.toFixed(2)}`).join("\n");
    const mensagem = `*Novo pedido #${pedidoId} - ${nomeLoja}*\n\n${linhas}\n\n*Total: R$ ${total.toFixed(2)}*\nForma de pagamento: ${forma_pagamento}\n${endereco ? `Endereço: ${endereco}\n` : ""}Cliente: ${cliente_nome} (${cliente_telefone})`;
    const linkWhatsapp = CONFIG.whatsapp ? `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(mensagem)}` : null;
    res.status(201).json({ pedido_id: pedidoId, total, itens, link_whatsapp: linkWhatsapp });
  } catch (e) {
    console.error("Erro ao criar pedido:", e);
    res.status(400).json({ erro: e.message || "Não foi possível criar o pedido." });
  }
});

// Consulta pública por token não é implementada nesta V2; o ID sequencial não expõe mais o pedido.
app.get("/api/pedidos/:id", (req, res) => res.status(404).json({ erro: "Consulta pública de pedidos desativada. Use o link recebido no atendimento." }));

app.post("/api/pagamento/criar-preferencia", async (req, res) => {
  if (!CONFIG.mpAccessToken) return res.status(400).json({ erro: "Pagamento online não configurado." });
  try {
    const pedidoId = numeroInteiroPositivo(req.body.pedido_id);
    if (!pedidoId) return res.status(400).json({ erro: "pedido_id inválido." });
    const pedido = db.prepare("SELECT * FROM pedidos WHERE id = ?").get(pedidoId);
    if (!pedido) return res.status(404).json({ erro: "Pedido não encontrado." });
    const itens = JSON.parse(pedido.itens_json || "[]");
    const resposta = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${CONFIG.mpAccessToken}` },
      body: JSON.stringify({
        items: itens.map((i) => ({ title: i.nome, quantity: i.quantidade, unit_price: i.preco, currency_id: "BRL" })),
        external_reference: String(pedido.id),
      }),
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok || !dados.init_point) return res.status(502).json({ erro: "Mercado Pago não conseguiu criar o pagamento." });
    res.json({ checkout_url: dados.init_point });
  } catch (e) {
    console.error("Erro Mercado Pago:", e);
    res.status(500).json({ erro: "Falha ao criar pagamento." });
  }
});

// -------------------- Admin --------------------
app.post("/api/admin/login", (req, res) => {
  if (!loginPermitido(req)) return res.status(429).json({ erro: "Muitas tentativas. Tente novamente em 15 minutos." });
  const senha = req.body?.senha;
  if (!CONFIG.adminSenha || !compararSenha(senha, CONFIG.adminSenha)) {
    registrarFalhaLogin(req);
    return res.status(401).json({ erro: "Senha incorreta." });
  }
  limparFalhasLogin(req);
  criarSessao(res);
  res.json({ ok: true, expira_em_horas: CONFIG.sessionHours });
});

app.post("/api/admin/logout", (req, res) => { destruirSessao(req, res); res.json({ ok: true }); });
app.get("/api/admin/sessao", checarSessaoAdmin, (req, res) => res.json({ autenticado: true }));

app.get("/api/admin/pedidos", checarSessaoAdmin, (req, res) => {
  const pedidos = db.prepare("SELECT * FROM pedidos ORDER BY id DESC LIMIT 200").all();
  res.json(pedidos);
});

app.patch("/api/admin/pedidos/:id/status", checarSessaoAdmin, (req, res) => {
  const status = texto(req.body?.status, 30);
  const permitidos = new Set(["pendente", "confirmado", "em_producao", "pronto", "enviado", "entregue", "cancelado"]);
  if (!permitidos.has(status)) return res.status(400).json({ erro: "Status inválido." });
  const info = db.prepare("UPDATE pedidos SET status = ? WHERE id = ?").run(status, req.params.id);
  if (!info.changes) return res.status(404).json({ erro: "Pedido não encontrado." });
  res.json({ ok: true });
});

app.get("/api/admin/cardapio", checarSessaoAdmin, (req, res) => {
  const categorias = db.prepare("SELECT * FROM categorias ORDER BY ordem, id").all();
  const produtos = anexarFotos(db.prepare("SELECT * FROM produtos ORDER BY id").all());
  res.json(categorias.map((cat) => ({ ...cat, produtos: produtos.filter((p) => p.categoria_id === cat.id) })));
});

app.post("/api/admin/categorias", checarSessaoAdmin, (req, res) => {
  const nome = texto(req.body?.nome, 100);
  const icone = texto(req.body?.icone, 50) || null;
  if (!nome) return res.status(400).json({ erro: "Nome da categoria é obrigatório." });
  const ordemMax = db.prepare("SELECT COALESCE(MAX(ordem), 0) AS m FROM categorias").get().m;
  const info = db.prepare("INSERT INTO categorias (nome, ordem, icone) VALUES (?, ?, ?)").run(nome, ordemMax + 1, icone);
  res.status(201).json({ id: info.lastInsertRowid, nome, ordem: ordemMax + 1, icone });
});
app.put("/api/admin/categorias/:id", checarSessaoAdmin, (req, res) => {
  const atual = db.prepare("SELECT * FROM categorias WHERE id = ?").get(req.params.id);
  if (!atual) return res.status(404).json({ erro: "Categoria não encontrada." });
  const nome = req.body?.nome !== undefined ? texto(req.body.nome, 100) : atual.nome;
  if (!nome) return res.status(400).json({ erro: "Nome da categoria é obrigatório." });
  const icone = req.body?.icone !== undefined ? (texto(req.body.icone, 50) || null) : atual.icone;
  db.prepare("UPDATE categorias SET nome = ?, icone = ? WHERE id = ?").run(nome, icone, req.params.id);
  res.json({ ok: true });
});
app.delete("/api/admin/categorias/:id", checarSessaoAdmin, (req, res) => {
  const temProdutos = db.prepare("SELECT COUNT(*) AS c FROM produtos WHERE categoria_id = ?").get(req.params.id).c;
  if (temProdutos > 0) return res.status(400).json({ erro: "Remova ou mova os produtos dessa categoria antes de excluí-la." });
  const info = db.prepare("DELETE FROM categorias WHERE id = ?").run(req.params.id);
  if (!info.changes) return res.status(404).json({ erro: "Categoria não encontrada." });
  res.json({ ok: true });
});

app.post("/api/admin/produtos", checarSessaoAdmin, (req, res) => {
  const categoria_id = numeroInteiroPositivo(req.body?.categoria_id);
  const nome = texto(req.body?.nome, 150);
  const preco = precoValido(req.body?.preco);
  if (!categoria_id || !nome || preco === null) return res.status(400).json({ erro: "Categoria, nome e preço válidos são obrigatórios." });
  if (!db.prepare("SELECT 1 FROM categorias WHERE id = ?").get(categoria_id)) return res.status(400).json({ erro: "Categoria não encontrada." });
  const info = db.prepare(`INSERT INTO produtos (categoria_id, nome, descricao, preco, disponivel, tipo_entrega, prazo_producao) VALUES (?, ?, ?, ?, 1, ?, ?)`).run(
    categoria_id, nome, texto(req.body?.descricao, 2000), preco, texto(req.body?.tipo_entrega, 30) || "pronta", texto(req.body?.prazo_producao, 100)
  );
  res.status(201).json({ id: info.lastInsertRowid });
});
app.put("/api/admin/produtos/:id", checarSessaoAdmin, (req, res) => {
  const atual = db.prepare("SELECT * FROM produtos WHERE id = ?").get(req.params.id);
  if (!atual) return res.status(404).json({ erro: "Produto não encontrado." });
  const categoria_id = req.body?.categoria_id !== undefined ? numeroInteiroPositivo(req.body.categoria_id) : atual.categoria_id;
  const nome = req.body?.nome !== undefined ? texto(req.body.nome, 150) : atual.nome;
  const preco = req.body?.preco !== undefined ? precoValido(req.body.preco) : atual.preco;
  if (!categoria_id || !nome || preco === null) return res.status(400).json({ erro: "Dados do produto inválidos." });
  if (!db.prepare("SELECT 1 FROM categorias WHERE id = ?").get(categoria_id)) return res.status(400).json({ erro: "Categoria não encontrada." });
  db.prepare(`UPDATE produtos SET categoria_id=?, nome=?, descricao=?, preco=?, disponivel=?, imagem_pos=?, tipo_entrega=?, prazo_producao=? WHERE id=?`).run(
    categoria_id, nome, req.body?.descricao !== undefined ? texto(req.body.descricao, 2000) : atual.descricao,
    preco, req.body?.disponivel !== undefined ? (req.body.disponivel ? 1 : 0) : atual.disponivel,
    req.body?.imagem_pos !== undefined ? texto(req.body.imagem_pos, 50) : atual.imagem_pos,
    req.body?.tipo_entrega !== undefined ? texto(req.body.tipo_entrega, 30) : atual.tipo_entrega,
    req.body?.prazo_producao !== undefined ? texto(req.body.prazo_producao, 100) : atual.prazo_producao,
    req.params.id
  );
  res.json({ ok: true });
});
app.delete("/api/admin/produtos/:id", checarSessaoAdmin, (req, res) => {
  const fotos = db.prepare("SELECT arquivo FROM produto_fotos WHERE produto_id = ?").all(req.params.id);
  const produto = db.prepare("SELECT id FROM produtos WHERE id = ?").get(req.params.id);
  if (!produto) return res.status(404).json({ erro: "Produto não encontrado." });
  const removerProduto = db.transaction(() => {
    db.prepare("DELETE FROM produto_fotos WHERE produto_id = ?").run(req.params.id);
    db.prepare("DELETE FROM produtos WHERE id = ?").run(req.params.id);
  });
  removerProduto();
  for (const foto of fotos) removerArquivoSeguro(foto.arquivo);
  res.json({ ok: true });
});

app.post("/api/admin/produtos/:id/fotos", checarSessaoAdmin, upload.single("imagem"), otimizarImagemUpload, (req, res) => {
  if (!req.file) return res.status(400).json({ erro: "Nenhum arquivo válido enviado." });
  const produto = db.prepare("SELECT id FROM produtos WHERE id = ?").get(req.params.id);
  if (!produto) { removerArquivoSeguro(req.file.filename); return res.status(404).json({ erro: "Produto não encontrado." }); }
  const max = db.prepare("SELECT MAX(ordem) AS m FROM produto_fotos WHERE produto_id = ?").get(req.params.id).m;
  const ordem = max === null ? 0 : max + 1;
  const info = db.prepare("INSERT INTO produto_fotos (produto_id, arquivo, posicao, ordem) VALUES (?, ?, '50% 50%', ?)").run(req.params.id, req.file.filename, ordem);
  res.status(201).json({ id: info.lastInsertRowid, arquivo: req.file.filename, posicao: "50% 50%", ordem });
});
app.delete("/api/admin/produtos/:id/fotos/:fotoId", checarSessaoAdmin, (req, res) => {
  const foto = db.prepare("SELECT * FROM produto_fotos WHERE id = ? AND produto_id = ?").get(req.params.fotoId, req.params.id);
  if (!foto) return res.status(404).json({ erro: "Foto não encontrada." });
  db.prepare("DELETE FROM produto_fotos WHERE id = ?").run(req.params.fotoId);
  removerArquivoSeguro(foto.arquivo);
  res.json({ ok: true });
});
app.post("/api/admin/produtos/:id/fotos/:fotoId/tornar-capa", checarSessaoAdmin, (req, res) => {
  const foto = db.prepare("SELECT * FROM produto_fotos WHERE id = ? AND produto_id = ?").get(req.params.fotoId, req.params.id);
  if (!foto) return res.status(404).json({ erro: "Foto não encontrada." });
  const ordemMin = db.prepare("SELECT MIN(ordem) AS m FROM produto_fotos WHERE produto_id = ?").get(req.params.id).m;
  db.prepare("UPDATE produto_fotos SET ordem = ? WHERE id = ?").run((ordemMin ?? 0) - 1, req.params.fotoId);
  res.json({ ok: true });
});

app.get("/api/admin/loja", checarSessaoAdmin, (req, res) => res.json(db.prepare("SELECT * FROM loja_config WHERE id = 1").get()));
app.put("/api/admin/loja", checarSessaoAdmin, (req, res) => {
  const atual = db.prepare("SELECT * FROM loja_config WHERE id = 1").get();
  const nome = req.body?.nome !== undefined ? texto(req.body.nome, 120) : atual.nome;
  if (!nome) return res.status(400).json({ erro: "Nome da loja é obrigatório." });
  let horariosJson = atual.horarios_json;
  if (req.body?.horarios !== undefined) {
    if (typeof req.body.horarios !== "object" || Array.isArray(req.body.horarios)) return res.status(400).json({ erro: "Horários inválidos." });
    horariosJson = JSON.stringify(req.body.horarios);
  }
  const cor = req.body?.cor_primaria !== undefined ? texto(req.body.cor_primaria, 20) : atual.cor_primaria;
  if (!/^#[0-9a-f]{6}$/i.test(cor)) return res.status(400).json({ erro: "Cor primária inválida." });
  db.prepare(`UPDATE loja_config SET nome=?, tagline=?, cor_primaria=?, endereco=?, texto_entrega=?, instagram=?, sempre_aberto=?, horarios_json=? WHERE id=1`).run(
    nome,
    req.body?.tagline !== undefined ? texto(req.body.tagline, 300) : atual.tagline,
    cor,
    req.body?.endereco !== undefined ? texto(req.body.endereco, 500) : atual.endereco,
    req.body?.texto_entrega !== undefined ? texto(req.body.texto_entrega, 500) : atual.texto_entrega,
    req.body?.instagram !== undefined ? texto(req.body.instagram, 300) : atual.instagram,
    req.body?.sempre_aberto !== undefined ? (req.body.sempre_aberto ? 1 : 0) : atual.sempre_aberto,
    horariosJson
  );
  res.json({ ok: true });
});

app.post("/api/admin/loja/imagem/:campo", checarSessaoAdmin, (req, res, next) => {
  if (!["logo", "capa1", "capa2", "capa3"].includes(req.params.campo)) return res.status(400).json({ erro: "Campo de imagem inválido." });
  next();
}, uploadLoja.single("imagem"), otimizarImagemUpload, (req, res) => {
  if (!req.file) return res.status(400).json({ erro: "Nenhum arquivo válido enviado." });
  const campo = req.params.campo;
  const atual = db.prepare("SELECT * FROM loja_config WHERE id=1").get();
  if (atual[campo]) removerArquivoSeguro(atual[campo]);
  db.prepare(`UPDATE loja_config SET ${campo}=? WHERE id=1`).run(req.file.filename);
  res.json({ ok: true, imagem: req.file.filename });
});
app.put("/api/admin/loja/posicao/:campo", checarSessaoAdmin, (req, res) => {
  if (!["capa1", "capa2", "capa3"].includes(req.params.campo)) return res.status(400).json({ erro: "Campo inválido." });
  const posicao = texto(req.body?.posicao, 50);
  if (!posicao || !/^\s*\d{1,3}%\s+\d{1,3}%\s*$/.test(posicao)) return res.status(400).json({ erro: "Posição inválida." });
  db.prepare(`UPDATE loja_config SET ${req.params.campo}_pos=? WHERE id=1`).run(posicao);
  res.json({ ok: true });
});

app.get("/api/depoimentos", (req, res) => res.json(db.prepare("SELECT * FROM depoimentos ORDER BY ordem ASC, id ASC").all()));
app.get("/api/admin/depoimentos", checarSessaoAdmin, (req, res) => res.json(db.prepare("SELECT * FROM depoimentos ORDER BY ordem ASC, id ASC").all()));
app.post("/api/admin/depoimentos", checarSessaoAdmin, (req, res) => {
  const nome = texto(req.body?.nome_cliente, 120);
  if (!nome) return res.status(400).json({ erro: "Nome do cliente é obrigatório." });
  const ordem = db.prepare("SELECT COALESCE(MAX(ordem), -1) AS m FROM depoimentos").get().m + 1;
  const info = db.prepare("INSERT INTO depoimentos (nome_cliente, texto, ordem) VALUES (?, ?, ?)").run(nome, texto(req.body?.texto, 2000), ordem);
  res.status(201).json({ id: info.lastInsertRowid });
});
app.put("/api/admin/depoimentos/:id", checarSessaoAdmin, (req, res) => {
  const atual = db.prepare("SELECT * FROM depoimentos WHERE id=?").get(req.params.id);
  if (!atual) return res.status(404).json({ erro: "Depoimento não encontrado." });
  db.prepare("UPDATE depoimentos SET nome_cliente=?, texto=? WHERE id=?").run(req.body?.nome_cliente !== undefined ? texto(req.body.nome_cliente, 120) : atual.nome_cliente, req.body?.texto !== undefined ? texto(req.body.texto, 2000) : atual.texto, req.params.id);
  res.json({ ok: true });
});
app.delete("/api/admin/depoimentos/:id", checarSessaoAdmin, (req, res) => {
  const d = db.prepare("SELECT * FROM depoimentos WHERE id=?").get(req.params.id);
  if (!d) return res.status(404).json({ erro: "Depoimento não encontrado." });
  db.prepare("DELETE FROM depoimentos WHERE id=?").run(req.params.id);
  removerArquivoSeguro(d.foto);
  res.json({ ok: true });
});
app.post("/api/admin/depoimentos/:id/foto", checarSessaoAdmin, uploadDepoimento.single("imagem"), otimizarImagemUpload, (req, res) => {
  if (!req.file) return res.status(400).json({ erro: "Nenhum arquivo válido enviado." });
  const d = db.prepare("SELECT * FROM depoimentos WHERE id=?").get(req.params.id);
  if (!d) { removerArquivoSeguro(req.file.filename); return res.status(404).json({ erro: "Depoimento não encontrado." }); }
  removerArquivoSeguro(d.foto);
  db.prepare("UPDATE depoimentos SET foto=? WHERE id=?").run(req.file.filename, req.params.id);
  res.json({ ok: true, foto: req.file.filename });
});

app.get("/api/admin/visitas", checarSessaoAdmin, (req, res) => {
  const total = db.prepare("SELECT COUNT(*) AS c FROM visitas").get().c;
  const hoje = db.prepare("SELECT COUNT(*) AS c FROM visitas WHERE date(criado_em)=date('now','localtime')").get().c;
  const ultimos7dias = db.prepare(`SELECT date(criado_em) AS dia, COUNT(*) AS c FROM visitas WHERE criado_em >= datetime('now','-7 days','localtime') GROUP BY dia ORDER BY dia ASC`).all();
  res.json({ total, hoje, ultimos7dias });
});

app.use(uploadErrorHandler);
app.use((err, req, res, next) => {
  console.error("Erro não tratado:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ erro: "Erro interno do servidor." });
});

app.listen(PORT, () => console.log(`Backend V2.1 rodando em http://localhost:${PORT}`));
