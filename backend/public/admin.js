const state = {
  senha: sessionStorage.getItem("admin_senha") || "",
  categorias: [],
  editandoId: null, // null = criando novo produto
};

function fmt(v) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function configurarIconesApp(logo) {
  if (!logo) return;
  const logoUrl = `/img/${logo}`;

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

// ---------- Navegação por abas ----------

const PAINEIS = {
  cardapio: "painelCardapio",
  pedidos: "painelPedidos",
  depoimentos: "painelDepoimentos",
  aparencia: "painelAparencia",
};

document.querySelectorAll("#adminTabs .admin-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    const aba = btn.dataset.tab;

    document.querySelectorAll("#adminTabs .admin-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    Object.entries(PAINEIS).forEach(([nome, id]) => {
      document.getElementById(id).hidden = nome !== aba;
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

// ---------- Carregar dados ----------

async function carregarTudo() {
  await Promise.all([carregarCardapio(), carregarPedidos(), carregarLoja(), carregarDepoimentosAdmin()]);
}

// ---------- Recorte de imagem (usado em logo, capas e fotos de produto) ----------

let cropperInstance = null;
let cropOnConfirm = null;

function abrirRecorte(arquivo, aspectRatio, onConfirmar) {
  const modalEl = document.getElementById("modalCrop");
  const img = document.getElementById("cropImage");
  const reader = new FileReader();

  reader.onload = (e) => {
    img.src = e.target.result;
    modalEl.hidden = false;

    if (cropperInstance) cropperInstance.destroy();
    cropperInstance = new Cropper(img, {
      aspectRatio,
      viewMode: 1,
      autoCropArea: 1,
      background: false,
      responsive: true,
    });

    // Marca o botão de formato correspondente como ativo (ou "Livre", se não bater com nenhum)
    const chips = document.querySelectorAll("#cropFormatos .formato-chip");
    chips.forEach((chip) => {
      const valor = chip.dataset.ratio === "livre" ? NaN : parseFloat(chip.dataset.ratio);
      const bate = isNaN(aspectRatio) ? isNaN(valor) : Math.abs(valor - aspectRatio) < 0.01;
      chip.classList.toggle("active", bate);
    });
  };
  reader.readAsDataURL(arquivo);
  cropOnConfirm = onConfirmar;
}

document.querySelectorAll("#cropFormatos .formato-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    if (!cropperInstance) return;
    const valor = chip.dataset.ratio === "livre" ? NaN : parseFloat(chip.dataset.ratio);
    cropperInstance.setAspectRatio(valor);
    document.querySelectorAll("#cropFormatos .formato-chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
  });
});

function fecharRecorte() {
  document.getElementById("modalCrop").hidden = true;
  if (cropperInstance) {
    cropperInstance.destroy();
    cropperInstance = null;
  }
  cropOnConfirm = null;
}

document.getElementById("btnCropCancelar").addEventListener("click", fecharRecorte);
document.getElementById("cropBackdrop").addEventListener("click", fecharRecorte);

document.getElementById("btnCropConfirmar").addEventListener("click", () => {
  if (!cropperInstance || !cropOnConfirm) return;
  const callback = cropOnConfirm;
  cropperInstance.getCroppedCanvas({ maxWidth: 1400, maxHeight: 1400 }).toBlob(
    (blob) => {
      fecharRecorte();
      callback(blob);
    },
    "image/jpeg",
    0.9
  );
});

// ---------- Aparência da loja ----------

const ordemDias = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];
const diasSemana = { seg: "Segunda", ter: "Terça", qua: "Quarta", qui: "Quinta", sex: "Sexta", sab: "Sábado", dom: "Domingo" };

async function carregarLoja() {
  try {
    const loja = await apiAdmin("/api/admin/loja");
    state.loja = loja;

    document.getElementById("lojaNome").value = loja.nome || "";
    document.getElementById("lojaTagline").value = loja.tagline || "";
    document.getElementById("lojaEndereco").value = loja.endereco || "";
    document.getElementById("lojaEntrega").value = loja.texto_entrega || "";
    document.getElementById("lojaCor").value = loja.cor_primaria || "#2f6b3a";
    document.getElementById("lojaSempreAberto").checked = !!loja.sempre_aberto;

    if (loja.logo) {
      document.getElementById("previewLogo").src = `/img/${loja.logo}`;
      document.getElementById("previewLogo").hidden = false;
      document.getElementById("previewLogoFallback").hidden = true;
      configurarIconesApp(loja.logo);
    }
    ["capa1", "capa2", "capa3"].forEach((campo, i) => {
      if (loja[campo]) {
        const img = document.getElementById(`previewCapa${i + 1}`);
        img.src = `/img/${loja[campo]}`;
        img.style.objectPosition = loja[`${campo}_pos`] || "50% 50%";
        img.hidden = false;
      }
    });

    let horarios = {};
    try {
      horarios = JSON.parse(loja.horarios_json || "{}");
    } catch {}
    renderHorarios(horarios);
    atualizarVisibilidadeHorarios();
  } catch (err) {
    console.error("Erro ao carregar loja:", err);
  }
}

function renderHorarios(horarios) {
  const container = document.getElementById("horariosLista");
  container.innerHTML = ordemDias
    .map((d) => {
      const h = horarios[d] || { aberto: true, inicio: "09:00", fim: "22:00" };
      return `
      <div class="horario-item ${h.aberto ? "" : "desabilitado"}" data-dia="${d}">
        <span>${diasSemana[d]}</span>
        <input type="checkbox" class="horario-aberto" ${h.aberto ? "checked" : ""} />
        <input type="time" class="horario-inicio" value="${h.inicio || "09:00"}" ${h.aberto ? "" : "disabled"} />
        <input type="time" class="horario-fim" value="${h.fim || "22:00"}" ${h.aberto ? "" : "disabled"} />
      </div>`;
    })
    .join("");

  container.querySelectorAll(".horario-aberto").forEach((chk) => {
    chk.addEventListener("change", (e) => {
      const row = e.target.closest(".horario-item");
      const aberto = e.target.checked;
      row.classList.toggle("desabilitado", !aberto);
      row.querySelectorAll('input[type="time"]').forEach((inp) => (inp.disabled = !aberto));
    });
  });
}

function coletarHorarios() {
  const horarios = {};
  document.querySelectorAll("#horariosLista .horario-item").forEach((row) => {
    const dia = row.dataset.dia;
    horarios[dia] = {
      aberto: row.querySelector(".horario-aberto").checked,
      inicio: row.querySelector(".horario-inicio").value,
      fim: row.querySelector(".horario-fim").value,
    };
  });
  return horarios;
}

function atualizarVisibilidadeHorarios() {
  const bloco = document.getElementById("horariosBlock");
  bloco.style.opacity = document.getElementById("lojaSempreAberto").checked ? "0.4" : "1";
}
document.getElementById("lojaSempreAberto").addEventListener("change", atualizarVisibilidadeHorarios);

document.getElementById("formLoja").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Salvando...";

  try {
    await apiAdmin("/api/admin/loja", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: document.getElementById("lojaNome").value.trim(),
        tagline: document.getElementById("lojaTagline").value.trim(),
        endereco: document.getElementById("lojaEndereco").value.trim(),
        texto_entrega: document.getElementById("lojaEntrega").value.trim(),
        cor_primaria: document.getElementById("lojaCor").value,
        sempre_aberto: document.getElementById("lojaSempreAberto").checked,
        horarios: coletarHorarios(),
      }),
    });
    btn.textContent = "Salvo! ✓";
  } catch (err) {
    alert("Erro ao salvar: " + err.message);
    btn.textContent = "Salvar aparência";
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = "Salvar aparência";
    }, 1500);
  }
});

async function enviarImagemLoja(campo, arquivo) {
  const formData = new FormData();
  formData.append("imagem", arquivo, arquivo.name || "foto.jpg");
  return apiAdmin(`/api/admin/loja/imagem/${campo}`, { method: "POST", body: formData });
}

document.getElementById("inputLogo").addEventListener("change", (e) => {
  const arquivo = e.target.files[0];
  if (!arquivo) return;
  abrirRecorte(arquivo, 1, async (blob) => {
    try {
      await enviarImagemLoja("logo", blob);
      document.getElementById("previewLogo").src = URL.createObjectURL(blob);
      document.getElementById("previewLogo").hidden = false;
      document.getElementById("previewLogoFallback").hidden = true;
    } catch (err) {
      alert("Erro ao enviar logo: " + err.message);
    } finally {
      e.target.value = "";
    }
  });
});

["capa1", "capa2", "capa3"].forEach((campo, i) => {
  document.getElementById(`input${campo[0].toUpperCase()}${campo.slice(1)}`).addEventListener("change", (e) => {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    abrirRecorte(arquivo, 4 / 3, async (blob) => {
      try {
        await enviarImagemLoja(campo, blob);
        const img = document.getElementById(`previewCapa${i + 1}`);
        img.src = URL.createObjectURL(blob);
        img.style.objectPosition = "50% 50%";
        img.hidden = false;
      } catch (err) {
        alert("Erro ao enviar foto de capa: " + err.message);
      } finally {
        e.target.value = "";
      }
    });
  });

  // Clique na prévia da capa ainda permite ajustar o foco fino, se precisar
  const previewImg = document.getElementById(`previewCapa${i + 1}`);
  previewImg.addEventListener("click", async (e) => {
    const rect = previewImg.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
    const posicao = `${x}% ${y}%`;
    previewImg.style.objectPosition = posicao;
    try {
      await apiAdmin(`/api/admin/loja/posicao/${campo}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posicao }),
      });
    } catch (err) {
      alert("Erro ao salvar enquadramento: " + err.message);
    }
  });
});

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

// ---------- Depoimentos / Galeria de trabalhos ----------

async function carregarDepoimentosAdmin() {
  try {
    const depoimentos = await apiAdmin("/api/admin/depoimentos");
    const container = document.getElementById("depoimentosAdminLista");

    if (!depoimentos.length) {
      container.innerHTML = `<p class="loading">Nenhum depoimento cadastrado ainda.</p>`;
      return;
    }

    container.innerHTML = depoimentos
      .map(
        (d) => `
      <div class="depoimento-admin-card">
        <div class="depoimento-admin-foto">
          ${d.foto ? `<img src="/img/${d.foto}" />` : `<div class="depoimento-admin-sem-foto">🧵</div>`}
          <input type="file" accept="image/*" data-foto-depo="${d.id}" hidden />
          <button type="button" class="btn-mini" data-trocar-foto-depo="${d.id}">Foto</button>
        </div>
        <div class="depoimento-admin-info">
          <strong>${d.nome_cliente}</strong>
          <p>${d.texto || ""}</p>
        </div>
        <button type="button" class="btn-mini danger" data-remover-depo="${d.id}">Excluir</button>
      </div>
    `
      )
      .join("");

    container.querySelectorAll("[data-trocar-foto-depo]").forEach((btn) => {
      btn.addEventListener("click", () => {
        container.querySelector(`[data-foto-depo="${btn.dataset.trocarFotoDepo}"]`).click();
      });
    });
    container.querySelectorAll("[data-foto-depo]").forEach((input) => {
      input.addEventListener("change", (e) => {
        const arquivo = e.target.files[0];
        if (!arquivo) return;
        const id = input.dataset.fotoDepo;
        abrirRecorte(arquivo, NaN, async (blob) => {
          try {
            const formData = new FormData();
            formData.append("imagem", blob, "foto.jpg");
            await apiAdmin(`/api/admin/depoimentos/${id}/foto`, { method: "POST", body: formData });
            await carregarDepoimentosAdmin();
          } catch (err) {
            alert("Erro ao enviar foto: " + err.message);
          } finally {
            e.target.value = "";
          }
        });
      });
    });
    container.querySelectorAll("[data-remover-depo]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Excluir este depoimento?")) return;
        try {
          await apiAdmin(`/api/admin/depoimentos/${btn.dataset.removerDepo}`, { method: "DELETE" });
          await carregarDepoimentosAdmin();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  } catch (err) {
    document.getElementById("depoimentosAdminLista").innerHTML = `<p class="loading">Erro: ${err.message}</p>`;
  }
}

document.getElementById("formNovoDepoimento").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = document.getElementById("depoNomeCliente").value.trim();
  const texto = document.getElementById("depoTexto").value.trim();
  if (!nome) return;

  try {
    await apiAdmin("/api/admin/depoimentos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome_cliente: nome, texto }),
    });
    document.getElementById("formNovoDepoimento").reset();
    await carregarDepoimentosAdmin();
  } catch (err) {
    alert("Erro ao adicionar: " + err.message);
  }
});

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
        <h2>${cat.icone ? cat.icone + " " : ""}${cat.nome}</h2>
        <div class="admin-cat-actions">
          <button class="btn-mini" data-add-produto="${cat.id}">+ item</button>
          <button class="btn-mini" data-edit-cat="${cat.id}">editar</button>
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
  container.querySelectorAll("[data-edit-cat]").forEach((b) => b.addEventListener("click", () => abrirModalCategoria(b.dataset.editCat)));
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

const EMOJI_SUGESTOES = [
  // Comidas salgadas
  "🍔","🍕","🍟","🌭","🥪","🍗","🍖","🥩","🍛","🍜","🍝","🍲","🥘","🍱","🍣","🍤","🥗","🌮","🌯","🥙","🥟","🍳","🥚","🧀","🥐","🍞","🥖","🥨","🫓","🍚","🍙","🍘",
  // Doces e sobremesas
  "🧁","🍰","🎂","🍮","🍨","🍦","🍩","🍪","🍫","🍬","🍭","🥧","🍯",
  // Bebidas
  "☕","🧃","🧋","🍺","🍷","🍹","🍸","🍾","🥤","🧊","🍵","🥛",
  // Frutas e hortifruti
  "🍇","🍓","🍉","🍎","🍏","🍌","🥭","🍍","🥥","🍑","🍒","🍋","🍊","🥝","🥑","🍆","🥕","🌽","🥦","🥬","🥒","🌶️","🧄","🧅","🌾",
  // Carnes e proteínas
  "🐔","🐟","🥓",
  // Artesanato, costura e bonecas
  "🧵","🧶","🪡","🧸","🪆","👗","👘","🎀","🧦","🧤","🧣","👒","👜","👛","🎩","🩱","👶","🍼",
  // Roupas e moda
  "👕","👖","🩳","🥻","👔","👚","🩴","👟","👠","👞","💍","💄","💅",
  // Casa e decoração
  "🏠","🕯️","🪴","🖼️","🪑","🛋️","🧺","🧹","🧴","🧼","🪞","🛁","🔑",
  // Papelaria e presentes
  "🎁","🎈","📚","✏️","🖊️","📔","🎨","✂️",
  // Pets
  "🐶","🐱","🐰","🐾",
  // Tecnologia e diversos
  "📱","💻","⌚","🔋","🧰","🔧","🪛","🚗","🚲",
  // Saúde e beleza
  "💆","🧴","🧖","🌸","🌺","🌻","🌷","💐",
  // Genéricos úteis
  "⭐","🔥","✨","🆕","💯","🛍️","📦","🚀",
];

document.getElementById("emojiSugestoes").innerHTML = EMOJI_SUGESTOES.map(
  (e) => `<button type="button" class="emoji-chip" data-emoji="${e}">${e}</button>`
).join("");

document.getElementById("emojiSugestoes").addEventListener("click", (e) => {
  const chip = e.target.closest(".emoji-chip");
  if (!chip) return;
  document.getElementById("categoriaIcone").value = chip.dataset.emoji;
});

let categoriaEditandoId = null;

document.getElementById("btnNovaCategoria").addEventListener("click", () => abrirModalCategoria(null));

function abrirModalCategoria(id) {
  categoriaEditandoId = id;
  const modal = document.getElementById("modalCategoria");
  const titulo = document.getElementById("modalCategoriaTitulo");
  const nomeInput = document.getElementById("categoriaNome");
  const iconeInput = document.getElementById("categoriaIcone");

  if (id) {
    const cat = state.categorias.find((c) => String(c.id) === String(id));
    titulo.textContent = "Editar categoria";
    nomeInput.value = cat?.nome || "";
    iconeInput.value = cat?.icone || "";
  } else {
    titulo.textContent = "Nova categoria";
    nomeInput.value = "";
    iconeInput.value = "";
  }

  modal.hidden = false;
  nomeInput.focus();
}

function fecharModalCategoria() {
  document.getElementById("modalCategoria").hidden = true;
}

document.getElementById("btnCancelarCategoria").addEventListener("click", fecharModalCategoria);
document.getElementById("modalCategoriaBackdrop").addEventListener("click", fecharModalCategoria);

document.getElementById("formCategoria").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = document.getElementById("categoriaNome").value.trim();
  const icone = document.getElementById("categoriaIcone").value.trim();
  if (!nome) return;

  try {
    if (categoriaEditandoId) {
      await apiAdmin(`/api/admin/categorias/${categoriaEditandoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, icone }),
      });
    } else {
      await apiAdmin("/api/admin/categorias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, icone }),
      });
    }
    fecharModalCategoria();
    carregarCardapio();
  } catch (err) {
    alert(err.message);
  }
});

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

  if (produtoId) {
    const produto = state.categorias.flatMap((c) => c.produtos).find((p) => String(p.id) === String(produtoId));
    document.getElementById("modalTitulo").textContent = "Editar item";
    document.getElementById("campoNome").value = produto.nome;
    document.getElementById("campoDescricao").value = produto.descricao || "";
    document.getElementById("campoPreco").value = produto.preco;
    document.getElementById("campoDisponivel").checked = !!produto.disponivel;
    document.getElementById("campoTipoEntrega").value = produto.tipo_entrega || "pronta";
    document.getElementById("campoPrazo").value = produto.prazo_producao || "";
    atualizarVisibilidadePrazo();
    preencherSelectCategorias(produto.categoria_id);
    renderFotosGaleria(produto.fotos || []);
    document.getElementById("btnAddFoto").hidden = false;
    document.getElementById("hintSalveAntes").hidden = true;
  } else {
    document.getElementById("modalTitulo").textContent = "Novo item";
    document.getElementById("campoNome").value = "";
    document.getElementById("campoDescricao").value = "";
    document.getElementById("campoPreco").value = "";
    document.getElementById("campoDisponivel").checked = true;
    document.getElementById("campoTipoEntrega").value = "pronta";
    document.getElementById("campoPrazo").value = "";
    atualizarVisibilidadePrazo();
    preencherSelectCategorias(categoriaIdPadrao);
    renderFotosGaleria([]);
    document.getElementById("btnAddFoto").hidden = true;
    document.getElementById("hintSalveAntes").hidden = false;
  }

  modal.hidden = false;
}

function atualizarVisibilidadePrazo() {
  const ehEncomenda = document.getElementById("campoTipoEntrega").value === "encomenda";
  document.getElementById("campoPrazoWrapper").hidden = !ehEncomenda;
}
document.getElementById("campoTipoEntrega").addEventListener("change", atualizarVisibilidadePrazo);

function fecharModal() {
  modal.hidden = true;
}

document.getElementById("btnCancelar").addEventListener("click", fecharModal);
document.getElementById("modalBackdrop").addEventListener("click", fecharModal);

// ---------- Galeria de fotos do produto ----------

function renderFotosGaleria(fotos) {
  const container = document.getElementById("fotosGaleria");
  if (!fotos.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = fotos
    .map(
      (f, i) => `
    <div class="foto-item">
      ${i === 0 ? `<span class="foto-item-capa-badge">Capa</span>` : ""}
      <img src="/img/${f.arquivo}" style="object-position: ${f.posicao || "50% 50%"}" />
      <div class="foto-item-acoes">
        ${i !== 0 ? `<button type="button" data-tornar-capa="${f.id}">Capa</button>` : ""}
        <button type="button" class="remover" data-remover-foto="${f.id}">Excluir</button>
      </div>
    </div>
  `
    )
    .join("");

  container.querySelectorAll("[data-tornar-capa]").forEach((b) =>
    b.addEventListener("click", () => tornarFotoCapa(b.dataset.tornarCapa))
  );
  container.querySelectorAll("[data-remover-foto]").forEach((b) =>
    b.addEventListener("click", () => removerFotoProduto(b.dataset.removerFoto))
  );
}

async function recarregarGaleriaAtual() {
  await carregarCardapio();
  const produto = state.categorias.flatMap((c) => c.produtos).find((p) => String(p.id) === String(state.editandoId));
  renderFotosGaleria(produto?.fotos || []);
}

document.getElementById("btnAddFoto").addEventListener("click", () => {
  if (!state.editandoId) return;
  document.getElementById("inputNovaFoto").click();
});

document.getElementById("inputNovaFoto").addEventListener("change", (e) => {
  const arquivo = e.target.files[0];
  if (!arquivo || !state.editandoId) return;

  abrirRecorte(arquivo, NaN, async (blob) => {
    try {
      const formData = new FormData();
      formData.append("imagem", blob, "foto.jpg");
      await apiAdmin(`/api/admin/produtos/${state.editandoId}/fotos`, { method: "POST", body: formData });
      await recarregarGaleriaAtual();
    } catch (err) {
      alert("Erro ao enviar foto: " + err.message);
    } finally {
      e.target.value = "";
    }
  });
});

async function tornarFotoCapa(fotoId) {
  try {
    await apiAdmin(`/api/admin/produtos/${state.editandoId}/fotos/${fotoId}/tornar-capa`, { method: "POST" });
    await recarregarGaleriaAtual();
  } catch (err) {
    alert(err.message);
  }
}

async function removerFotoProduto(fotoId) {
  if (!confirm("Excluir essa foto?")) return;
  try {
    await apiAdmin(`/api/admin/produtos/${state.editandoId}/fotos/${fotoId}`, { method: "DELETE" });
    await recarregarGaleriaAtual();
  } catch (err) {
    alert(err.message);
  }
}

formProduto.addEventListener("submit", async (e) => {
  e.preventDefault();

  const dados = {
    nome: document.getElementById("campoNome").value.trim(),
    descricao: document.getElementById("campoDescricao").value.trim(),
    preco: parseFloat(document.getElementById("campoPreco").value),
    categoria_id: document.getElementById("campoCategoria").value,
    disponivel: document.getElementById("campoDisponivel").checked,
    tipo_entrega: document.getElementById("campoTipoEntrega").value,
    prazo_producao: document.getElementById("campoPrazo").value.trim(),
  };

  try {
    if (state.editandoId) {
      await apiAdmin(`/api/admin/produtos/${state.editandoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados),
      });
      fecharModal();
      carregarCardapio();
    } else {
      // Cria o item primeiro; mantém o modal aberto pra já permitir adicionar fotos
      const criado = await apiAdmin("/api/admin/produtos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados),
      });
      state.editandoId = criado.id;
      document.getElementById("modalTitulo").textContent = "Editar item — agora adicione fotos!";
      document.getElementById("btnAddFoto").hidden = false;
      document.getElementById("hintSalveAntes").hidden = true;
      await carregarCardapio();
    }
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
