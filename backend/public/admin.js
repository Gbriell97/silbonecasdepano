const state = {
  senha: sessionStorage.getItem("admin_senha") || "",
  categorias: [],
  editandoId: null, // null = criando novo produto
};

function fmt(v) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function apiAdmin(path, options = {}) {
  const resp = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "x-admin-senha": state.senha,
    },
  });
  if (resp.status === 401) {
    sessionStorage.removeItem("admin_senha");
    location.reload();
    throw new Error("Sessão expirada");
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.erro || "Erro na requisição");
  return data;
}

// ---------- Login ----------

function checarLogin() {
  if (state.senha) {
    mostrarPainel();
  } else {
    document.getElementById("loginScreen").hidden = false;
  }
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const senha = document.getElementById("senhaInput").value;
  const erroEl = document.getElementById("loginErro");
  erroEl.textContent = "";

  try {
    const resp = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha }),
    });
    if (!resp.ok) throw new Error("Senha incorreta.");

    state.senha = senha;
    sessionStorage.setItem("admin_senha", senha);
    mostrarPainel();
  } catch (err) {
    erroEl.textContent = err.message;
  }
});

document.getElementById("btnLogout").addEventListener("click", () => {
  sessionStorage.removeItem("admin_senha");
  location.reload();
});

function mostrarPainel() {
  document.getElementById("loginScreen").hidden = true;
  document.getElementById("adminPanel").hidden = false;
  carregarTudo();
}

// ---------- Carregar dados ----------

async function carregarTudo() {
  await Promise.all([carregarCardapio(), carregarPedidos()]);
}

async function carregarCardapio() {
  try {
    state.categorias = await apiAdmin("/api/admin/cardapio");
    renderCardapio();
  } catch (err) {
    document.getElementById("adminContent").innerHTML = `<p class="loading">Erro: ${err.message}</p>`;
  }
}

async function carregarPedidos() {
  try {
    const pedidos = await apiAdmin("/api/admin/pedidos");
    const container = document.getElementById("listaPedidos");

    if (!pedidos.length) {
      container.innerHTML = `<p class="loading">Nenhum pedido ainda.</p>`;
      return;
    }

    container.innerHTML = pedidos
      .slice(0, 20)
      .map((p) => {
        const itens = JSON.parse(p.itens_json)
          .map((i) => `${i.quantidade}x ${i.nome}`)
          .join(", ");
        return `
        <div class="pedido-card">
          <div class="pedido-top"><span>#${p.id} — ${p.cliente_nome}</span><span>${fmt(p.total)}</span></div>
          <div class="pedido-meta">${itens}</div>
          <div class="pedido-meta">${p.forma_pagamento} · ${p.criado_em} · ${p.cliente_telefone}</div>
        </div>`;
      })
      .join("");
  } catch (err) {
    document.getElementById("listaPedidos").innerHTML = `<p class="loading">Erro: ${err.message}</p>`;
  }
}

// ---------- Render do cardápio no admin ----------

function renderCardapio() {
  const container = document.getElementById("adminContent");

  if (!state.categorias.length) {
    container.innerHTML = `<p class="loading">Nenhuma categoria ainda. Crie uma abaixo.</p>`;
    return;
  }

  container.innerHTML = state.categorias
    .map(
      (cat) => `
    <div class="admin-cat-block">
      <div class="admin-cat-title">
        <h2>${cat.nome}</h2>
        <div class="admin-cat-actions">
          <button class="btn-mini" data-add-produto="${cat.id}">+ item</button>
          <button class="btn-mini" data-rename-cat="${cat.id}">renomear</button>
          <button class="btn-mini danger" data-del-cat="${cat.id}">excluir</button>
        </div>
      </div>
      ${cat.produtos.map((p) => produtoRowHTML(p)).join("") || `<p class="loading">Sem itens nessa categoria.</p>`}
    </div>
  `
    )
    .join("");

  // Eventos
  container.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => abrirModal(b.dataset.edit)));
  container.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => excluirProduto(b.dataset.del)));
  container.querySelectorAll("[data-add-produto]").forEach((b) =>
    b.addEventListener("click", () => abrirModal(null, b.dataset.addProduto))
  );
  container.querySelectorAll("[data-rename-cat]").forEach((b) => b.addEventListener("click", () => renomearCategoria(b.dataset.renameCat)));
  container.querySelectorAll("[data-del-cat]").forEach((b) => b.addEventListener("click", () => excluirCategoria(b.dataset.delCat)));
}

function produtoRowHTML(p) {
  return `
    <div class="admin-product-row ${p.disponivel ? "" : "indisponivel"}">
      ${
        p.imagem
          ? `<img class="admin-thumb" src="/img/${p.imagem}" onerror="this.style.visibility='hidden'" />`
          : `<div class="admin-thumb"></div>`
      }
      <div class="admin-product-info">
        <strong>${p.nome}${p.disponivel ? "" : " (indisponível)"}</strong>
        <span>${fmt(p.preco)}</span>
      </div>
      <div class="admin-product-actions">
        <button class="btn-mini" data-edit="${p.id}">editar</button>
        <button class="btn-mini danger" data-del="${p.id}">excluir</button>
      </div>
    </div>
  `;
}

// ---------- Categorias ----------

document.getElementById("btnNovaCategoria").addEventListener("click", async () => {
  const nome = prompt("Nome da nova categoria:");
  if (!nome) return;
  try {
    await apiAdmin("/api/admin/categorias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome }),
    });
    carregarCardapio();
  } catch (err) {
    alert(err.message);
  }
});

async function renomearCategoria(id) {
  const cat = state.categorias.find((c) => String(c.id) === String(id));
  const nome = prompt("Novo nome da categoria:", cat?.nome || "");
  if (!nome) return;
  try {
    await apiAdmin(`/api/admin/categorias/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome }),
    });
    carregarCardapio();
  } catch (err) {
    alert(err.message);
  }
}

async function excluirCategoria(id) {
  if (!confirm("Excluir esta categoria? Só é possível se ela estiver sem itens.")) return;
  try {
    await apiAdmin(`/api/admin/categorias/${id}`, { method: "DELETE" });
    carregarCardapio();
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Modal de produto ----------

const modal = document.getElementById("modalProduto");
const formProduto = document.getElementById("formProduto");

function preencherSelectCategorias(selecionadaId) {
  const select = document.getElementById("campoCategoria");
  select.innerHTML = state.categorias
    .map((c) => `<option value="${c.id}" ${String(c.id) === String(selecionadaId) ? "selected" : ""}>${c.nome}</option>`)
    .join("");
}

function abrirModal(produtoId, categoriaIdPadrao) {
  state.editandoId = produtoId;
  const preview = document.getElementById("previewFoto");
  document.getElementById("campoFoto").value = "";
  preview.hidden = true;

  if (produtoId) {
    const produto = state.categorias.flatMap((c) => c.produtos).find((p) => String(p.id) === String(produtoId));
    document.getElementById("modalTitulo").textContent = "Editar item";
    document.getElementById("campoNome").value = produto.nome;
    document.getElementById("campoDescricao").value = produto.descricao || "";
    document.getElementById("campoPreco").value = produto.preco;
    document.getElementById("campoDisponivel").checked = !!produto.disponivel;
    preencherSelectCategorias(produto.categoria_id);
    if (produto.imagem) {
      preview.src = `/img/${produto.imagem}`;
      preview.hidden = false;
    }
  } else {
    document.getElementById("modalTitulo").textContent = "Novo item";
    document.getElementById("campoNome").value = "";
    document.getElementById("campoDescricao").value = "";
    document.getElementById("campoPreco").value = "";
    document.getElementById("campoDisponivel").checked = true;
    preencherSelectCategorias(categoriaIdPadrao);
  }

  modal.hidden = false;
}

function fecharModal() {
  modal.hidden = true;
}

document.getElementById("btnCancelar").addEventListener("click", fecharModal);
document.getElementById("modalBackdrop").addEventListener("click", fecharModal);

document.getElementById("campoFoto").addEventListener("change", (e) => {
  const file = e.target.files[0];
  const preview = document.getElementById("previewFoto");
  if (!file) return;
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
});

formProduto.addEventListener("submit", async (e) => {
  e.preventDefault();

  const dados = {
    nome: document.getElementById("campoNome").value.trim(),
    descricao: document.getElementById("campoDescricao").value.trim(),
    preco: parseFloat(document.getElementById("campoPreco").value),
    categoria_id: document.getElementById("campoCategoria").value,
    disponivel: document.getElementById("campoDisponivel").checked,
  };

  try {
    let produtoId = state.editandoId;

    if (produtoId) {
      await apiAdmin(`/api/admin/produtos/${produtoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados),
      });
    } else {
      const criado = await apiAdmin("/api/admin/produtos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados),
      });
      produtoId = criado.id;
    }

    // Envia a foto, se uma nova foi escolhida
    const arquivo = document.getElementById("campoFoto").files[0];
    if (arquivo) {
      const formData = new FormData();
      formData.append("imagem", arquivo);
      await apiAdmin(`/api/admin/produtos/${produtoId}/imagem`, {
        method: "POST",
        body: formData,
      });
    }

    fecharModal();
    carregarCardapio();
  } catch (err) {
    alert("Erro ao salvar: " + err.message);
  }
});

async function excluirProduto(id) {
  if (!confirm("Excluir este item do cardápio?")) return;
  try {
    await apiAdmin(`/api/admin/produtos/${id}`, { method: "DELETE" });
    carregarCardapio();
  } catch (err) {
    alert(err.message);
  }
}

checarLogin();
