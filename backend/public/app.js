const state = {
  loja: null,
  categorias: [],
  carrinho: {},
  busca: "",
  galeriaFotos: [],
  galeriaIndex: 0,
};

const fmt = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const emojiPorCategoria = {
  "lanches": "🍔", "pratos feitos": "🍛", "bebidas": "🥤", "sobremesas": "🍮",
  "café": "☕", "cafe": "☕", "cereais": "🌾", "mel": "🍯",
  "polpa de fruta": "🍓", "ovos caipiras": "🥚", "frutas congeladas": "🧊",
  "açaí na caixa": "🍇", "acai na caixa": "🍇", "combos": "🍱",
};

function emojiFor(categoria) {
  if (typeof categoria === "object" && categoria?.icone) return categoria.icone;
  const nome = typeof categoria === "string" ? categoria : categoria?.nome || "";
  return emojiPorCategoria[nome.toLowerCase()] || "🍽️";
}

const diasSemana = { dom: "Domingo", seg: "Segunda", ter: "Terça", qua: "Quarta", qui: "Quinta", sex: "Sexta", sab: "Sábado" };
const ordemDias = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];

async function init() {
  const [loja, cardapio, depoimentos] = await Promise.all([
    fetch("/api/loja").then((r) => r.json()),
    fetch("/api/cardapio").then((r) => r.json()),
    fetch("/api/depoimentos").then((r) => r.json()).catch(() => []),
  ]);

  state.loja = loja;
  document.title = loja.nome;
  document.documentElement.style.setProperty("--cor-primaria", loja.corPrimaria || "#2f6b3a");
  const themeMeta = document.getElementById("themeColorMeta");
  if (themeMeta) themeMeta.content = loja.corPrimaria || "#2f6b3a";
  configurarIconesApp(loja);

  renderCapa(loja);
  renderStoreCard(loja);
  renderDepoimentos(depoimentos);

  state.categorias = cardapio;
  renderNav(cardapio);
  renderMenu(cardapio);
  bindGlobalEvents();
}

function renderDepoimentos(depoimentos) {
  const section = document.getElementById("depoimentosSection");
  if (!depoimentos || !depoimentos.length) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  document.getElementById("depoimentosLista").innerHTML = depoimentos
    .map(
      (d) => `
    <div class="depoimento-card">
      ${d.foto ? `<img src="/img/${d.foto}" alt="Trabalho realizado" onerror="this.remove()" />` : `<div class="depoimento-sem-foto">🧵</div>`}
      <p class="depoimento-texto">${d.texto ? `"${d.texto}"` : ""}</p>
      <span class="depoimento-nome">— ${d.nome_cliente}</span>
    </div>
  `
    )
    .join("");
}

function configurarIconesApp(loja) {
  if (!loja.logo) return;
  const logoUrl = `/img/${loja.logo}`;

  const favicon = document.createElement("link");
  favicon.rel = "icon";
  favicon.href = logoUrl;
  document.head.appendChild(favicon);

  const appleIcon = document.createElement("link");
  appleIcon.rel = "apple-touch-icon";
  appleIcon.href = logoUrl;
  document.head.appendChild(appleIcon);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

function renderCapa(loja) {
  const cover = document.getElementById("cover");
  if (loja.capas && loja.capas.length) {
    cover.innerHTML = loja.capas
      .map((c) => `<img src="/img/${c.arquivo}" style="object-position: ${c.posicao || "50% 50%"}" onerror="this.remove()" />`)
      .join("");
  } else {
    cover.innerHTML = `<div class="cover-placeholder">📷</div>`;
  }
}

function renderStoreCard(loja) {
  document.getElementById("storeName").textContent = loja.nome;
  document.getElementById("storeTagline").textContent = loja.tagline || "";

  const logo = document.getElementById("storeLogo");
  const fallback = document.getElementById("storeLogoFallback");
  if (loja.logo) {
    logo.onerror = () => { logo.hidden = true; fallback.hidden = false; };
    logo.src = `/img/${loja.logo}`;
    logo.hidden = false;
    fallback.hidden = true;
  } else {
    logo.hidden = true;
    fallback.hidden = false;
  }

  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const statusWrap = statusDot.closest(".store-status");
  if (loja.aberto) {
    statusDot.classList.remove("fechado");
    statusWrap.classList.remove("fechado");
    statusText.textContent = "Aberto agora";
  } else {
    statusDot.classList.add("fechado");
    statusWrap.classList.add("fechado");
    statusText.textContent = "Fechado no momento";
  }
  document.getElementById("storeDelivery").textContent = loja.textoEntrega || "";
}

function renderNav(categorias) {
  const nav = document.getElementById("catNav");
  nav.innerHTML = categorias
    .map(
      (cat, i) => `
      <button class="cat-item ${i === 0 ? "active" : ""}" data-target="cat-${cat.id}">
        <span class="cat-icon">${emojiFor(cat)}</span>
        <span class="cat-label">${cat.nome}</span>
      </button>`
    )
    .join("");

  nav.querySelectorAll(".cat-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      nav.querySelectorAll(".cat-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const el = document.getElementById(btn.dataset.target);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function produtosFiltrados(produtos) {
  if (!state.busca) return produtos;
  const termo = state.busca.toLowerCase();
  return produtos.filter((p) => p.nome.toLowerCase().includes(termo));
}

function renderMenu(categorias) {
  const menu = document.getElementById("menu");

  if (!categorias.length) {
    menu.innerHTML = `<p class="loading">Nenhum item no cardápio ainda.</p>`;
    return;
  }

  const blocos = categorias
    .map((cat) => {
      const produtos = produtosFiltrados(cat.produtos);
      if (!produtos.length) return "";
      return `
      <section class="cat-section" id="cat-${cat.id}">
        <h2 class="cat-title">${cat.nome}</h2>
        <div class="product-grid">
          ${produtos.map((p) => productCardHTML(p, cat)).join("")}
        </div>
      </section>`;
    })
    .join("");

  menu.innerHTML = blocos || `<p class="loading">Nenhum item encontrado para "${state.busca}".</p>`;

  menu.querySelectorAll("[data-add]").forEach((btn) => btn.addEventListener("click", () => addItem(btn.dataset.add)));
  menu.querySelectorAll("[data-inc]").forEach((btn) => btn.addEventListener("click", () => addItem(btn.dataset.inc)));
  menu.querySelectorAll("[data-dec]").forEach((btn) => btn.addEventListener("click", () => removeItem(btn.dataset.dec)));
  menu.querySelectorAll("[data-foto]").forEach((thumb) =>
    thumb.addEventListener("click", () => abrirFoto(thumb.dataset.foto))
  );
}

function abrirFoto(produtoId) {
  const produto = findProduto(produtoId);
  const fotos = produto?.fotos?.length ? produto.fotos : produto?.imagem ? [{ arquivo: produto.imagem }] : [];
  if (!fotos.length) return;

  state.galeriaFotos = fotos;
  state.galeriaIndex = 0;
  mostrarFotoGaleria();
  document.getElementById("modalFoto").hidden = false;
}

function mostrarFotoGaleria() {
  const fotos = state.galeriaFotos || [];
  const i = state.galeriaIndex || 0;
  if (!fotos[i]) return;
  document.getElementById("fotoAmpliada").src = `/img/${fotos[i].arquivo}`;

  const nav = document.getElementById("fotoNav");
  if (nav) nav.hidden = fotos.length < 2;
  const contador = document.getElementById("fotoContador");
  if (contador) contador.textContent = fotos.length > 1 ? `${i + 1} / ${fotos.length}` : "";
}

function fotoAnterior() {
  const fotos = state.galeriaFotos || [];
  if (!fotos.length) return;
  state.galeriaIndex = (state.galeriaIndex - 1 + fotos.length) % fotos.length;
  mostrarFotoGaleria();
}

function fotoProxima() {
  const fotos = state.galeriaFotos || [];
  if (!fotos.length) return;
  state.galeriaIndex = (state.galeriaIndex + 1) % fotos.length;
  mostrarFotoGaleria();
}

function fecharFoto() {
  document.getElementById("modalFoto").hidden = true;
}

function productCardHTML(produto, categoria) {
  const item = state.carrinho[produto.id];
  const qtd = item ? item.quantidade : 0;
  const capa = produto.fotos?.[0] || (produto.imagem ? { arquivo: produto.imagem, posicao: produto.imagem_pos } : null);
  const posicao = capa?.posicao || "50% 50%";

  const selo =
    produto.tipo_entrega === "encomenda"
      ? `<span class="selo-entrega encomenda">Sob encomenda${produto.prazo_producao ? ` · ${produto.prazo_producao}` : ""}</span>`
      : `<span class="selo-entrega pronta">Pronta entrega</span>`;

  return `
    <div class="product-card">
      <div class="product-thumb" ${capa ? `data-foto="${produto.id}"` : ""}>
        <span>${emojiFor(categoria)}</span>
        ${capa ? `<img class="thumb-img" src="/img/${capa.arquivo}" style="object-position: ${posicao}" onerror="this.remove()" />` : ""}
        ${produto.fotos?.length > 1 ? `<span class="thumb-multi-badge">${produto.fotos.length} 📷</span>` : ""}
      </div>
      <div class="product-info">
        ${selo}
        <h3>${produto.nome}</h3>
        <p>${produto.descricao || ""}</p>
        <div class="product-bottom">
          <span class="product-price">${fmt(produto.preco)}</span>
          ${
            qtd === 0
              ? `<button class="add-btn" data-add="${produto.id}">+</button>`
              : `<div class="qty-controls">
                  <button class="qty-btn remove" data-dec="${produto.id}">−</button>
                  <span class="qty-value">${qtd}</span>
                  <button class="qty-btn" data-inc="${produto.id}">+</button>
                 </div>`
          }
        </div>
      </div>
    </div>
  `;
}

function findProduto(id) {
  for (const cat of state.categorias) {
    const p = cat.produtos.find((p) => String(p.id) === String(id));
    if (p) return p;
  }
  return null;
}

function addItem(id) {
  const produto = findProduto(id);
  if (!produto) return;
  if (!state.carrinho[id]) state.carrinho[id] = { produto, quantidade: 0 };
  state.carrinho[id].quantidade += 1;
  refresh();
}

function removeItem(id) {
  if (!state.carrinho[id]) return;
  state.carrinho[id].quantidade -= 1;
  if (state.carrinho[id].quantidade <= 0) delete state.carrinho[id];
  refresh();
}

function cartTotal() {
  return Object.values(state.carrinho).reduce((soma, i) => soma + i.produto.preco * i.quantidade, 0);
}
function cartCount() {
  return Object.values(state.carrinho).reduce((soma, i) => soma + i.quantidade, 0);
}

function refresh() {
  renderMenu(state.categorias);
  renderTicket();

  const count = cartCount();
  const badge = document.getElementById("cartCount");
  badge.textContent = count;
  badge.hidden = count === 0;
}

function renderTicket() {
  const container = document.getElementById("ticketItems");
  const items = Object.entries(state.carrinho);

  if (!items.length) {
    container.innerHTML = `<p class="ticket-empty">Sua comanda está vazia.<br>Adicione itens do cardápio.</p>`;
  } else {
    container.innerHTML = items
      .map(
        ([id, item]) => `
        <div class="ticket-line">
          <div>
            <div class="ticket-line-name">${item.produto.nome}</div>
            <div>${fmt(item.produto.preco)} un.</div>
          </div>
          <div class="ticket-line-controls">
            <button class="qty-btn remove" data-dec="${id}">−</button>
            <span class="qty-value">${item.quantidade}</span>
            <button class="qty-btn" data-inc="${id}">+</button>
          </div>
        </div>`
      )
      .join("");

    container.querySelectorAll("[data-inc]").forEach((b) => b.addEventListener("click", () => addItem(b.dataset.inc)));
    container.querySelectorAll("[data-dec]").forEach((b) => b.addEventListener("click", () => removeItem(b.dataset.dec)));
  }

  document.getElementById("ticketTotal").textContent = fmt(cartTotal());
}

function openTicket() {
  document.getElementById("ticket").classList.add("open");
  setBottomActive("carrinho");
}
function closeTicketFn() {
  document.getElementById("ticket").classList.remove("open");
  setBottomActive("catalogo");
}

function setBottomActive(nome) {
  document.querySelectorAll(".bottom-item").forEach((b) => b.classList.toggle("active", b.dataset.nav === nome));
}

function abrirInfo() {
  const loja = state.loja;
  document.getElementById("infoTagline").textContent = loja.tagline || "";
  document.getElementById("infoEndereco").textContent = loja.endereco ? `📍 ${loja.endereco}` : "";
  document.getElementById("infoEntrega").textContent = loja.textoEntrega ? `🛵 ${loja.textoEntrega}` : "";

  const chaveDias = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
  const hojeChave = chaveDias[new Date().getDay()];

  const horariosEl = document.getElementById("infoHorarios");
  if (loja.horarios && Object.keys(loja.horarios).length) {
    horariosEl.innerHTML = ordemDias
      .map((d) => {
        const h = loja.horarios[d];
        const texto = h && h.aberto ? `${h.inicio} às ${h.fim}` : "Fechado";
        return `<div class="horario-row ${d === hojeChave ? "hoje" : ""}"><span>${diasSemana[d]}</span><span>${texto}</span></div>`;
      })
      .join("");
  } else {
    horariosEl.innerHTML = `<p>Consulte via WhatsApp.</p>`;
  }

  document.getElementById("modalInfo").hidden = false;
  setBottomActive("info");
}

function bindGlobalEvents() {
  document.getElementById("cartToggle").addEventListener("click", openTicket);
  document.getElementById("closeTicket").addEventListener("click", closeTicketFn);
  document.getElementById("ticketBackdrop").addEventListener("click", closeTicketFn);
  document.getElementById("fecharFoto").addEventListener("click", fecharFoto);
  document.getElementById("fotoBackdrop").addEventListener("click", fecharFoto);
  document.getElementById("fotoAnterior").addEventListener("click", fotoAnterior);
  document.getElementById("fotoProxima").addEventListener("click", fotoProxima);

  document.getElementById("searchInput").addEventListener("input", (e) => {
    state.busca = e.target.value.trim();
    renderMenu(state.categorias);
  });

  document.getElementById("btnWhats").addEventListener("click", () => {
    const numero = state.loja?.whatsapp || "";
    window.open(`https://wa.me/${numero}`, "_blank");
  });

  document.getElementById("btnRepetir").addEventListener("click", () => {
    const ultimo = JSON.parse(localStorage.getItem("ultimo_pedido") || "null");
    if (!ultimo || !ultimo.length) {
      alert("Você ainda não fez nenhum pedido por aqui.");
      return;
    }
    ultimo.forEach((item) => {
      for (let i = 0; i < item.quantidade; i++) addItem(String(item.id));
    });
    openTicket();
  });

  document.querySelectorAll(".bottom-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nav = btn.dataset.nav;
      if (nav === "catalogo") {
        closeTicketFn();
        document.getElementById("modalInfo").hidden = true;
        window.scrollTo({ top: 0, behavior: "smooth" });
        setBottomActive("catalogo");
      } else if (nav === "carrinho") {
        document.getElementById("modalInfo").hidden = true;
        openTicket();
      } else if (nav === "info") {
        closeTicketFn();
        abrirInfo();
      }
    });
  });

  document.getElementById("btnFecharInfo").addEventListener("click", () => {
    document.getElementById("modalInfo").hidden = true;
    setBottomActive("catalogo");
  });
  document.getElementById("infoBackdrop").addEventListener("click", () => {
    document.getElementById("modalInfo").hidden = true;
    setBottomActive("catalogo");
  });

  document.getElementById("checkoutForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = document.getElementById("btnConfirm");
    const itens = Object.entries(state.carrinho).map(([id, i]) => ({
      id,
      nome: i.produto.nome,
      preco: i.produto.preco,
      quantidade: i.quantidade,
    }));

    if (!itens.length) return;

    const payload = {
      cliente_nome: document.getElementById("clienteNome").value.trim(),
      cliente_telefone: document.getElementById("clienteTelefone").value.trim(),
      endereco: document.getElementById("clienteEndereco").value.trim(),
      forma_pagamento: document.getElementById("formaPagamento").value,
      itens,
    };

    btn.disabled = true;
    btn.textContent = "Enviando...";

    try {
      const resp = await fetch("/api/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.erro || "Erro ao enviar pedido");

      if (payload.forma_pagamento === "Pagamento online") {
        try {
          const pagResp = await fetch("/api/pagamento/criar-preferencia", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itens, pedido_id: data.pedido_id }),
          });
          const pagData = await pagResp.json();
          if (pagResp.ok && pagData.checkout_url) window.open(pagData.checkout_url, "_blank");
        } catch (err) {
          console.warn("Pagamento online indisponível:", err);
        }
      }

      localStorage.setItem("ultimo_pedido", JSON.stringify(itens));
      window.open(data.link_whatsapp, "_blank");

      state.carrinho = {};
      refresh();
      closeTicketFn();
      document.getElementById("checkoutForm").reset();
    } catch (err) {
      alert("Não foi possível enviar o pedido: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Enviar pedido pelo WhatsApp";
    }
  });
}

init();
