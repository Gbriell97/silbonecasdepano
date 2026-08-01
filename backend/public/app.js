const state = {
  categorias: [],
  carrinho: {}, // { produtoId: { produto, quantidade } }
};

const fmt = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const emojiPorCategoria = {
  "lanches": "🍔",
  "pratos feitos": "🍛",
  "bebidas": "🥤",
  "sobremesas": "🍮",
};

function emojiFor(nomeCategoria) {
  return emojiPorCategoria[nomeCategoria.toLowerCase()] || "🍽️";
}

async function init() {
  const [config, cardapio] = await Promise.all([
    fetch("/api/config").then((r) => r.json()),
    fetch("/api/cardapio").then((r) => r.json()),
  ]);

  document.getElementById("nomeLoja").textContent = config.nomeLoja;
  document.title = config.nomeLoja + " · Cardápio";

  state.categorias = cardapio;
  renderNav(cardapio);
  renderMenu(cardapio);
  bindGlobalEvents();
}

function renderNav(categorias) {
  const nav = document.getElementById("catNav");
  nav.innerHTML = categorias
    .map(
      (cat, i) =>
        `<button class="cat-pill ${i === 0 ? "active" : ""}" data-target="cat-${cat.id}">${cat.nome}</button>`
    )
    .join("");

  nav.querySelectorAll(".cat-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      nav.querySelectorAll(".cat-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.target).scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderMenu(categorias) {
  const menu = document.getElementById("menu");

  if (!categorias.length) {
    menu.innerHTML = `<p class="loading">Nenhum item no cardápio ainda.</p>`;
    return;
  }

  menu.innerHTML = categorias
    .map(
      (cat) => `
      <section class="cat-section" id="cat-${cat.id}">
        <h2 class="cat-title">${cat.nome}</h2>
        ${cat.produtos.map((p) => productCardHTML(p, cat.nome)).join("")}
      </section>
    `
    )
    .join("");

  menu.querySelectorAll("[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => addItem(btn.dataset.add));
  });
  menu.querySelectorAll("[data-inc]").forEach((btn) => {
    btn.addEventListener("click", () => addItem(btn.dataset.inc));
  });
  menu.querySelectorAll("[data-dec]").forEach((btn) => {
    btn.addEventListener("click", () => removeItem(btn.dataset.dec));
  });
}

function productCardHTML(produto, nomeCategoria) {
  const item = state.carrinho[produto.id];
  const qtd = item ? item.quantidade : 0;

  return `
    <div class="product-card">
      <div class="product-thumb">
        <span class="thumb-emoji">${emojiFor(nomeCategoria)}</span>
        ${produto.imagem ? `<img class="thumb-img" src="/img/${produto.imagem}" onerror="this.remove()" />` : ""}
      </div>
      <div class="product-info">
        <h3>${produto.nome}</h3>
        <p>${produto.descricao || ""}</p>
        <div class="product-price">${fmt(produto.preco)}</div>
      </div>
      <div>
        ${
          qtd === 0
            ? `<button class="add-btn" data-add="${produto.id}">Adicionar</button>`
            : `<div class="qty-controls">
                <button class="qty-btn remove" data-dec="${produto.id}">−</button>
                <span class="qty-value">${qtd}</span>
                <button class="qty-btn" data-inc="${produto.id}">+</button>
               </div>`
        }
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
  if (!state.carrinho[id]) {
    state.carrinho[id] = { produto, quantidade: 0 };
  }
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
  document.getElementById("cartCount").textContent = count;
  document.getElementById("floatingCount").textContent = count;
  document.getElementById("floatingTotal").textContent = fmt(cartTotal());
  document.getElementById("floatingCart").classList.toggle("show", count > 0);
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
        </div>
      `
      )
      .join("");

    container.querySelectorAll("[data-inc]").forEach((b) => b.addEventListener("click", () => addItem(b.dataset.inc)));
    container.querySelectorAll("[data-dec]").forEach((b) => b.addEventListener("click", () => removeItem(b.dataset.dec)));
  }

  document.getElementById("ticketTotal").textContent = fmt(cartTotal());
}

function openTicket() {
  document.getElementById("ticket").classList.add("open");
}
function closeTicketFn() {
  document.getElementById("ticket").classList.remove("open");
}

function bindGlobalEvents() {
  document.getElementById("cartToggle").addEventListener("click", openTicket);
  document.getElementById("floatingCart").addEventListener("click", openTicket);
  document.getElementById("closeTicket").addEventListener("click", closeTicketFn);
  document.getElementById("ticketBackdrop").addEventListener("click", closeTicketFn);

  document.getElementById("checkoutForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = document.getElementById("btnConfirm");
    const itens = Object.values(state.carrinho).map((i) => ({
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

      // Se o cliente escolheu pagamento online, tenta criar preferência de pagamento
      if (payload.forma_pagamento === "Pagamento online") {
        try {
          const pagResp = await fetch("/api/pagamento/criar-preferencia", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itens, pedido_id: data.pedido_id }),
          });
          const pagData = await pagResp.json();
          if (pagResp.ok && pagData.checkout_url) {
            window.open(pagData.checkout_url, "_blank");
          }
        } catch (err) {
          console.warn("Pagamento online indisponível:", err);
        }
      }

      // Abre o WhatsApp com o pedido já formatado
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
