import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc,
  query, where, orderBy, limit, getDocs, onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const AREAS = [
  { id: "fisico",       nome: "Físico",       icone: "💪" },
  { id: "mentalidade",  nome: "Mentalidade",  icone: "🧠" },
  { id: "estudos",      nome: "Estudos",      icone: "📚" },
  { id: "trabalho",     nome: "Trabalho",     icone: "💼" },
  { id: "objetivos",    nome: "Objetivos",    icone: "🎯" },
  { id: "investidor",   nome: "Investidor",   icone: "📈" },
];

const estado = {}; // { [areaId]: { valor, atualizadoEm, baseline30d } }
let areaSelecionada = null;
let unsubscribers = [];

function tier(v) {
  if (v >= 90) return { nome: "Lendário", classe: "tier-lendario" };
  if (v >= 80) return { nome: "Ouro", classe: "tier-ouro" };
  if (v >= 70) return { nome: "Prata", classe: "tier-prata" };
  return { nome: "Bronze", classe: "tier-bronze" };
}

function formatarData(timestamp) {
  if (!timestamp) return "";
  const d = timestamp.toDate ? timestamp.toDate() : timestamp;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// --- LOGIN ---
document.getElementById("btnEntrar").addEventListener("click", async () => {
  const email = document.getElementById("emailLogin").value.trim();
  const senha = document.getElementById("senhaLogin").value;
  const erro = document.getElementById("erroLogin");
  erro.classList.add("oculto");
  try {
    await signInWithEmailAndPassword(auth, email, senha);
  } catch (e) {
    erro.textContent = "E-mail ou senha incorretos.";
    erro.classList.remove("oculto");
  }
});

document.getElementById("btnSair").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user) {
    document.getElementById("telaLogin").classList.add("oculto");
    document.getElementById("painel").classList.remove("oculto");
    iniciarAreas();
  } else {
    document.getElementById("telaLogin").classList.remove("oculto");
    document.getElementById("painel").classList.add("oculto");
    unsubscribers.forEach((fn) => fn());
    unsubscribers = [];
  }
});

// --- MONTAGEM INICIAL DOS CARDS (esqueleto) ---
function montarEsqueletoCards() {
  const grade = document.getElementById("gradeCards");
  grade.innerHTML = AREAS.map((a) => `
    <div class="card-area tier-bronze" id="card-${a.id}" data-area="${a.id}">
      <div class="icone-area">${a.icone}</div>
      <div class="numero-area" id="numero-${a.id}">--</div>
      <div class="nome-area">${a.nome}</div>
      <div class="tier-label" id="tierlabel-${a.id}">--</div>
      <div class="delta neutro" id="delta-${a.id}">sem dados</div>
    </div>
  `).join("");

  AREAS.forEach((a) => {
    document.getElementById(`card-${a.id}`).addEventListener("click", () => abrirModal(a.id));
  });
}

async function iniciarAreas() {
  montarEsqueletoCards();

  for (const a of AREAS) {
    const ref = doc(db, "areas", a.id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { valor: 50, atualizadoEm: serverTimestamp() });
    }

    // baseline dos últimos 30 dias, pra calcular a seta de evolução
    await carregarBaseline(a.id);

    const unsub = onSnapshot(ref, (docSnap) => {
      const dados = docSnap.data() || { valor: 50 };
      estado[a.id] = { ...(estado[a.id] || {}), valor: dados.valor, atualizadoEm: dados.atualizadoEm };
      renderTudo();
    });
    unsubscribers.push(unsub);
  }
}

async function carregarBaseline(areaId) {
  try {
    const trintaDiasAtras = Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    const q = query(
      collection(db, "areas", areaId, "historico"),
      where("data", ">=", trintaDiasAtras),
      orderBy("data", "asc"),
      limit(1)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      estado[areaId] = { ...(estado[areaId] || {}), baseline30d: snap.docs[0].data().valor };
    }
  } catch (e) {
    // se ainda não existe histórico, não tem problema
  }
}

// --- RENDERIZAÇÃO ---
function renderTudo() {
  AREAS.forEach((a) => {
    const dados = estado[a.id];
    if (!dados || dados.valor === undefined) return;

    const t = tier(dados.valor);
    const card = document.getElementById(`card-${a.id}`);
    card.className = `card-area ${t.classe}`;
    document.getElementById(`numero-${a.id}`).textContent = dados.valor;
    document.getElementById(`tierlabel-${a.id}`).textContent = t.nome;

    const deltaEl = document.getElementById(`delta-${a.id}`);
    if (dados.baseline30d !== undefined) {
      const diff = dados.valor - dados.baseline30d;
      if (diff > 0) {
        deltaEl.textContent = `▲ +${diff} em 30 dias`;
        deltaEl.className = "delta positivo";
      } else if (diff < 0) {
        deltaEl.textContent = `▼ ${diff} em 30 dias`;
        deltaEl.className = "delta negativo";
      } else {
        deltaEl.textContent = "= estável em 30 dias";
        deltaEl.className = "delta neutro";
      }
    } else {
      deltaEl.textContent = "sem histórico ainda";
      deltaEl.className = "delta neutro";
    }
  });

  renderOverall();
}

function renderOverall() {
  const valores = AREAS
    .map((a) => estado[a.id]?.valor)
    .filter((v) => v !== undefined);

  if (valores.length < AREAS.length) return;

  const media = Math.round(valores.reduce((s, v) => s + v, 0) / valores.length);
  const t = tier(media);

  document.getElementById("overallNumero").textContent = media;
  document.getElementById("overallTier").textContent = t.nome.toUpperCase();

  let melhor = AREAS[0], pior = AREAS[0];
  AREAS.forEach((a) => {
    if (estado[a.id].valor > estado[melhor.id]?.valor) melhor = a;
    if (estado[a.id].valor < estado[pior.id]?.valor) pior = a;
  });

  document.getElementById("overallDestaque").textContent =
    `Ponto forte: ${melhor.nome} (${estado[melhor.id].valor}) · Ponto fraco: ${pior.nome} (${estado[pior.id].valor})`;
}

// --- MODAL: ATUALIZAR ÁREA ---
function abrirModal(areaId) {
  areaSelecionada = areaId;
  const a = AREAS.find((x) => x.id === areaId);
  const dados = estado[areaId] || { valor: 50 };

  document.getElementById("modalIcone").textContent = a.icone;
  document.getElementById("modalNome").textContent = a.nome;
  document.getElementById("modalValorAtual").textContent = dados.valor;
  document.getElementById("modalSlider").value = dados.valor;
  document.getElementById("modalNumero").value = dados.valor;
  document.getElementById("modalNota").value = "";

  document.getElementById("modalFundo").classList.remove("oculto");
}

document.getElementById("modalFechar").addEventListener("click", () => {
  document.getElementById("modalFundo").classList.add("oculto");
});

const slider = document.getElementById("modalSlider");
const numero = document.getElementById("modalNumero");
slider.addEventListener("input", () => { numero.value = slider.value; });
numero.addEventListener("input", () => {
  let v = Math.min(100, Math.max(0, Number(numero.value) || 0));
  numero.value = v;
  slider.value = v;
});

document.getElementById("modalSalvar").addEventListener("click", async () => {
  if (!areaSelecionada) return;
  const novoValor = Number(numero.value);
  const nota = document.getElementById("modalNota").value.trim();

  const ref = doc(db, "areas", areaSelecionada);
  await updateDoc(ref, { valor: novoValor, atualizadoEm: serverTimestamp() });
  await addDoc(collection(db, "areas", areaSelecionada, "historico"), {
    valor: novoValor,
    nota: nota || "",
    data: serverTimestamp(),
  });

  document.getElementById("modalFundo").classList.add("oculto");
});

// --- MODAL: HISTÓRICO ---
document.getElementById("modalVerHistorico").addEventListener("click", async () => {
  if (!areaSelecionada) return;
  const a = AREAS.find((x) => x.id === areaSelecionada);
  document.getElementById("historicoNome").textContent = a.nome;

  const q = query(
    collection(db, "areas", areaSelecionada, "historico"),
    orderBy("data", "desc"),
    limit(20)
  );
  const snap = await getDocs(q);
  const itens = snap.docs.map((d) => d.data());

  const lista = document.getElementById("historicoLista");
  if (itens.length === 0) {
    lista.innerHTML = `<p style="color:#5c6b73; font-size:13px;">Ainda não há registros. Cada vez que você salvar uma evolução, ela aparece aqui.</p>`;
  } else {
    lista.innerHTML = itens.map((it) => `
      <div class="historico-item">
        <div>
          <span class="hist-data">${formatarData(it.data)}</span>
          ${it.nota ? `<span class="hist-nota">${it.nota}</span>` : ""}
        </div>
        <div class="hist-valor">${it.valor}</div>
      </div>
    `).join("");
  }

  desenharGrafico(itens.slice().reverse().map((it) => it.valor));

  document.getElementById("modalFundo").classList.add("oculto");
  document.getElementById("modalHistoricoFundo").classList.remove("oculto");
});

document.getElementById("historicoFechar").addEventListener("click", () => {
  document.getElementById("modalHistoricoFundo").classList.add("oculto");
});

function desenharGrafico(valores) {
  const canvas = document.getElementById("historicoGrafico");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (valores.length < 2) {
    ctx.fillStyle = "#5c6b73";
    ctx.font = "13px sans-serif";
    ctx.fillText("Registre mais evoluções pra ver o gráfico", 14, canvas.height / 2);
    return;
  }

  const pad = 16;
  const w = canvas.width - pad * 2;
  const h = canvas.height - pad * 2;
  const passo = w / (valores.length - 1);

  ctx.strokeStyle = "#1a4d6d";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  valores.forEach((v, i) => {
    const x = pad + i * passo;
    const y = pad + h - (v / 100) * h;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = "#1a4d6d";
  valores.forEach((v, i) => {
    const x = pad + i * passo;
    const y = pad + h - (v / 100) * h;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
}
