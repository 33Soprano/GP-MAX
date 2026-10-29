/**
 * =============================================================================
 * SISTEMA DE GESTÃO DE PENDÊNCIAS - GP MAX
 * =============================================================================
 */

// =============================================================================
// 1. ESTADO GLOBAL
// =============================================================================
const state = {
  currentUser: null,
  currentView: "view-dashboard",
  selectedCategory: "cancelamento",
  requests: [],
  metrics: null,
  activeRequest: null,
  internalUsers: [],
  filters: {
    search: "",
    queue: "",
    category: "",
    status: "",
    consultant: "",
    assigned_to: "",
    date_from: "",
    date_to: ""
  }
};

// =============================================================================
// 2. UTILITÁRIOS E FEEDBACK VISUAL
// =============================================================================

function showToast(message, type = "success", duration = 4000) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  let iconSvg = "";
  if (type === "success") {
    iconSvg = `<svg class="toast-icon" width="20" height="20" fill="none" stroke="#16a34a" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`;
  } else if (type === "error") {
    iconSvg = `<svg class="toast-icon" width="20" height="20" fill="none" stroke="#dc2626" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>`;
  } else {
    iconSvg = `<svg class="toast-icon" width="20" height="20" fill="none" stroke="#d97706" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`;
  }

  toast.innerHTML = `${iconSvg}<div class="toast-message">${escapeHtml(message)}</div>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  if (!value) return "-";
  try {
    let date;
    if (value && typeof value.toDate === "function") {
      date = value.toDate();
    } else if (value && typeof value === "object" && value.seconds !== undefined) {
      date = new Date(value.seconds * 1000);
    } else {
      date = new Date(value);
    }
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  } catch (e) {
    return String(value);
  }
}

function formatDateOnly(dateString) {
  if (!dateString) return "-";
  if (typeof dateString !== "string") return "-";
  if (dateString.includes("T")) dateString = dateString.split("T")[0];
  const parts = dateString.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateString;
}

function getStatusBadgeClass(status) {
  switch (status) {
    case "Aberto": return "badge-open";
    case "Em análise": return "badge-analyzing";
    case "Aguardando informação": return "badge-waiting";
    case "Em andamento": return "badge-progress";
    case "Resolvido": return "badge-resolved";
    case "Cancelado": return "badge-cancelled";
    default: return "badge-open";
  }
}

function getQueueBadgeClass(queue) {
  if (queue === "CANCELAMENTOS") return "queue-cancelamentos";
  return "queue-entregas";
}

function getRoleBadgeClass(role) {
  if (role === "erp") return "badge-analyzing";
  if (role === "logistica") return "badge-resolved";
  if (role === "admin") return "badge-admin";
  return "badge-open";
}

function roleLabel(role) {
  if (role === "consultor") return "Consultor";
  if (role === "erp") return "ERP";
  if (role === "logistica") return "Logística";
  if (role === "admin") return "Administrador";
  return "Equipe Interna";
}

// =============================================================================
// 3. AUTENTICAÇÃO — FIREBASE AUTH + FIRESTORE
// =============================================================================

let authProfileLoadingUid = null;

async function initAuth() {
  const auth = window.gpFirebaseAuth;
  if (!auth) {
    showLoginScreen();
    showToast("Não foi possível carregar o Firebase. Atualize a página.", "error");
    return;
  }

  showLoginScreen();
  auth.onAuthStateChanged(async (firebaseUser) => {
    if (!firebaseUser) {
      authProfileLoadingUid = null;
      state.currentUser = null;
      showLoginScreen();
      return;
    }
    if (authProfileLoadingUid === firebaseUser.uid && state.currentUser) return;
    authProfileLoadingUid = firebaseUser.uid;
    await loadUserProfileFromFirebase(firebaseUser);
  });
}

async function loadUserProfileFromFirebase(firebaseUser) {
  const submitBtn = document.getElementById("btn-login-submit");
  try {
    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = "<span>Carregando perfil...</span>"; }

    if (typeof fsGetProfile !== "function") {
      throw new Error("firestore-service.js não foi carregado.");
    }

    let profile = await fsGetProfile(firebaseUser.uid);

    if (!profile) {
      const defaultName = firebaseUser.displayName || (firebaseUser.email || "Usuário").split("@")[0];
      profile = await fsCreateProfile({
        uid: firebaseUser.uid,
        email: firebaseUser.email || "",
        name: defaultName,
        department: "Vendas"
      });

      if (!profile) {
        await window.gpFirebaseAuth.signOut();
        showToast("Não foi possível criar seu perfil. Verifique as regras do Firestore.", "error", 7000);
        return;
      }
      showToast(`Bem-vindo(a), ${profile.name}! Acesso criado como Consultor.`, "success", 5000);
    }

    if (profile.pending_approval) {
      await window.gpFirebaseAuth.signOut();
      showToast("Seu acesso está aguardando aprovação da equipe responsável.", "warning", 6000);
      return;
    }

    state.currentUser = {
      id: profile.firebase_uid || firebaseUser.uid,
      firebase_uid: profile.firebase_uid || firebaseUser.uid,
      email: profile.email || firebaseUser.email || "",
      name: profile.name || firebaseUser.displayName || "Usuário",
      role: profile.role || "consultor",
      department: profile.department || "",
      avatar: profile.avatar || (profile.name || "GP").substring(0, 2).toUpperCase()
    };

    showToast(`Bem-vindo(a), ${state.currentUser.name}!`, "success");
    onUserAuthenticated();
  } catch (error) {
    console.error("Erro ao carregar perfil autenticado:", error);
    showToast(`Falha ao consultar perfil: ${error.message}`, "error", 7000);
    if (window.gpFirebaseAuth && window.gpFirebaseAuth.currentUser) {
      await window.gpFirebaseAuth.signOut().catch(() => { });
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Entrar no Sistema</span><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>`;
    }
  }
}

function showLoginScreen() {
  document.getElementById("auth-screen").style.display = "flex";
  document.getElementById("app-layout").style.display = "none";

  const loginBlock = document.getElementById("login-form-block");
  const registerBlock = document.getElementById("register-form-block");
  if (loginBlock && registerBlock) {
    loginBlock.style.display = "block";
    registerBlock.style.display = "none";
  }
}

function showRegisterForm() {
  const loginBlock = document.getElementById("login-form-block");
  const registerBlock = document.getElementById("register-form-block");
  if (loginBlock && registerBlock) {
    loginBlock.style.display = "none";
    registerBlock.style.display = "block";
    setTimeout(() => {
      const firstInput = document.getElementById("reg-name");
      if (firstInput) firstInput.focus();
    }, 50);
  }
}

function showLoginForm() {
  const loginBlock = document.getElementById("login-form-block");
  const registerBlock = document.getElementById("register-form-block");
  if (loginBlock && registerBlock) {
    registerBlock.style.display = "none";
    loginBlock.style.display = "block";
    setTimeout(() => {
      const firstInput = document.getElementById("login-email");
      if (firstInput) firstInput.focus();
    }, 50);
  }
}

async function handleLogin(email, password) {
  const submitBtn = document.getElementById("btn-login-submit");
  const auth = window.gpFirebaseAuth;
  if (!auth) {
    showToast("Firebase não está inicializado.", "error");
    return;
  }
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = "<span>Autenticando...</span>"; }

  try {
    await auth.signInWithEmailAndPassword(email.trim(), password);
  } catch (error) {
    console.error("Falha no login Firebase:", error);
    const messages = {
      "auth/invalid-email": "O e-mail informado é inválido.",
      "auth/user-not-found": "Não existe uma conta cadastrada com esse e-mail.",
      "auth/wrong-password": "Senha incorreta.",
      "auth/invalid-credential": "E-mail ou senha incorretos.",
      "auth/user-disabled": "Esta conta foi desativada.",
      "auth/too-many-requests": "Muitas tentativas. Aguarde e tente novamente.",
      "auth/network-request-failed": "Falha de conexão. Verifique sua internet."
    };
    showToast(messages[error.code] || "Não foi possível entrar. Verifique as credenciais.", "error");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Entrar no Sistema</span><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>`;
    }
  }
}

async function handleRegister(name, email, password, passwordConfirm) {
  const auth = window.gpFirebaseAuth;
  if (!auth) {
    showToast("Firebase não está inicializado.", "error");
    return;
  }

  if (!name || name.trim().length < 3) {
    showToast("Informe seu nome completo (mínimo 3 caracteres).", "error");
    return;
  }
  if (password.length < 6) {
    showToast("A senha precisa ter no mínimo 6 caracteres.", "error");
    return;
  }
  if (password !== passwordConfirm) {
    showToast("As senhas não conferem. Digite novamente.", "error");
    return;
  }

  const submitBtn = document.getElementById("btn-register-submit");
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = "<span>Criando conta...</span>"; }

  try {
    const cred = await auth.createUserWithEmailAndPassword(email.trim(), password);

    try {
      await cred.user.updateProfile({ displayName: name.trim() });
    } catch (e) {
      console.warn("Não foi possível salvar displayName:", e);
    }

    showToast(`Conta criada com sucesso! Bem-vindo(a), ${name.trim()}!`, "success", 5000);
  } catch (err) {
    console.error("Erro no cadastro Firebase:", err);
    const map = {
      "auth/email-already-in-use": "Este e-mail já está cadastrado. Use a tela de login ou recupere sua senha.",
      "auth/invalid-email": "O e-mail informado é inválido.",
      "auth/weak-password": "A senha é muito fraca. Use pelo menos 6 caracteres.",
      "auth/operation-not-allowed": "O cadastro por e-mail/senha não está habilitado no Firebase Console.",
      "auth/network-request-failed": "Falha de conexão. Verifique sua internet."
    };
    showToast(map[err.code] || "Não foi possível criar a conta. Tente novamente.", "error", 7000);
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Criar Conta</span><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>`;
    }
  }
}

async function handleForgotPassword() {
  const emailInput = document.getElementById("login-email");
  const email = (emailInput ? emailInput.value : "").trim();

  if (!email) {
    showToast("Digite seu e-mail no campo acima e clique em 'Esqueci minha senha' novamente.", "warning");
    if (emailInput) emailInput.focus();
    return;
  }

  try {
    await window.gpFirebaseAuth.sendPasswordResetEmail(email);
    showToast(`E-mail de redefinição enviado para ${email}. Verifique sua caixa de entrada.`, "success", 6000);
  } catch (err) {
    console.error("Erro ao enviar e-mail de reset:", err);
    const map = {
      "auth/invalid-email": "O e-mail informado é inválido.",
      "auth/user-not-found": "Não existe uma conta com esse e-mail.",
      "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos."
    };
    showToast(map[err.code] || "Não foi possível enviar o e-mail de redefinição.", "error");
  }
}

async function handleLogout() {
  state.currentUser = null;
  authProfileLoadingUid = null;
  if (window.gpFirebaseAuth) {
    try { await window.gpFirebaseAuth.signOut(); }
    catch (error) { console.error("Erro ao encerrar sessão Firebase:", error); }
  }
  showLoginScreen();
  showToast("Você encerrou a sessão com segurança.", "success");
}

function onUserAuthenticated() {
  document.getElementById("auth-screen").style.display = "none";
  document.getElementById("app-layout").style.display = "flex";

  const user = state.currentUser;
  document.getElementById("sidebar-user-name").textContent = user.name;
  document.getElementById("sidebar-user-avatar").textContent = user.avatar || user.name.substring(0, 2).toUpperCase();

  const roleBadge = document.getElementById("sidebar-user-role");
  if (user.role === "consultor") {
    roleBadge.textContent = "Consultor de Vendas";
    roleBadge.style.color = "#93c5fd";
  } else if (user.role === "erp") {
    roleBadge.textContent = "Equipe ERP / Faturamento";
    roleBadge.style.color = "#86efac";
  } else if (user.role === "logistica") {
    roleBadge.textContent = "Equipe Logística / Expedição";
    roleBadge.style.color = "#86efac";
  } else if (user.role === "admin") {
    roleBadge.textContent = "Administrador";
    roleBadge.style.color = "#fbbf24";
  }

  applyRoleVisibility();
  loadInternalUsers();

  if (user.role === "consultor") {
    navigate("view-consultant-list");
  } else {
    navigate("view-dashboard");
  }

  refreshData();
}

function applyRoleVisibility() {
  const role = state.currentUser.role;
  const isConsultor = role === "consultor";
  const isAdmin = role === "admin";

  document.querySelectorAll(".internal-only").forEach(el => {
    el.style.display = isConsultor ? "none" : "";
  });
  document.querySelectorAll(".consultant-only").forEach(el => {
    el.style.display = isConsultor ? "" : "none";
  });
  document.querySelectorAll(".role-erp-only").forEach(el => {
    el.style.display = (role === "erp" || isAdmin) ? "" : "none";
  });
  document.querySelectorAll(".role-logistica-only").forEach(el => {
    el.style.display = (role === "logistica" || isAdmin) ? "" : "none";
  });
  document.querySelectorAll(".role-admin-only").forEach(el => {
    el.style.display = isAdmin ? "" : "none";
  });
}

// =============================================================================
// 4. NAVEGAÇÃO SPA
// =============================================================================

function navigate(viewId) {
  if (state.currentUser) {
    const role = state.currentUser.role;
    const isAdmin = role === "admin";

    // Consultor só acessa telas de consultor
    if (role === "consultor" &&
      ["view-dashboard", "view-internal-list", "view-queue-cancel", "view-queue-delivery", "view-admin-users"].includes(viewId)) {
      showToast("Acesso restrito à equipe interna de ERP e Logística.", "warning");
      viewId = "view-consultant-list";
    }

    // ERP e Logística acessam a fila deles (e o Admin acessa tudo)
    if (viewId === "view-queue-cancel" && role !== "erp" && !isAdmin) {
      showToast("Apenas a equipe ERP acessa essa fila.", "warning");
      viewId = "view-dashboard";
    }
    if (viewId === "view-queue-delivery" && role !== "logistica" && !isAdmin) {
      showToast("Apenas a equipe de Logística acessa essa fila.", "warning");
      viewId = "view-dashboard";
    }
  }

  // Traduzir viewId de fila para a tela real e aplicar filtro
  let targetView = viewId;
  if (viewId === "view-queue-cancel") {
    targetView = "view-internal-list";
    document.getElementById("filter-queue").value = "CANCELAMENTOS";
    state.filters.queue = "CANCELAMENTOS";
  } else if (viewId === "view-queue-delivery") {
    targetView = "view-internal-list";
    document.getElementById("filter-queue").value = "ENTREGAS / EXPEDIÇÃO";
    state.filters.queue = "ENTREGAS / EXPEDIÇÃO";
  } else if (viewId === "view-internal-list" || viewId === "view-dashboard") {
    // Se for acessado pelo menu principal (e não por fila), reseta o filtro visual de fila
    // (Opcional: limpar o filtro para ver tudo)
    if (viewId === "view-internal-list") {
      // Se o filtro estava setado por causa de uma fila, limpamos para ver tudo
      if (state.filters.queue) {
        document.getElementById("filter-queue").value = "";
        state.filters.queue = "";
      }
    }
  }

  state.currentView = targetView;

  document.querySelectorAll(".app-view").forEach(el => { el.style.display = "none"; });
  document.getElementById(targetView).style.display = "block";

  document.querySelectorAll(".nav-item").forEach(el => {
    el.classList.toggle("active", el.getAttribute("data-view") === viewId);
  });

  updateTopbarTitle(targetView);

  const sidebar = document.getElementById("sidebar");
  if (sidebar && sidebar.classList.contains("open")) sidebar.classList.remove("open");

  refreshData();
}

function navigateBack() {
  if (state.currentUser.role === "consultor") {
    navigate("view-consultant-list");
  } else {
    navigate("view-dashboard");
  }
}

function updateTopbarTitle(viewId) {
  const titleEl = document.getElementById("current-view-title");
  const subEl = document.getElementById("current-view-subtitle");

  switch (viewId) {
    case "view-dashboard":
      titleEl.textContent = "Dashboard de Gestão Operacional";
      subEl.textContent = "Métricas em tempo real, controle de SLAs e distribuição de filas.";
      break;
    case "view-internal-list":
      titleEl.textContent = "Central de Demandas Recebidas";
      subEl.textContent = "Acompanhamento geral de todas as solicitações de vendas.";
      break;
    case "view-consultant-list":
      titleEl.textContent = "Minhas Solicitações";
      subEl.textContent = "Visualize o status de seus chamados e os retornos da equipe interna.";
      break;
    case "view-new-request":
      titleEl.textContent = "Abertura de Nova Demanda";
      subEl.textContent = "Envie uma solicitação classificada automaticamente para a fila correta.";
      break;
    case "view-admin-users":
      titleEl.textContent = "Gestão de Usuários e Permissões";
      subEl.textContent = "Defina o tipo de acesso de cada usuário cadastrado no sistema.";
      break;
    default:
      titleEl.textContent = "GP MAX";
      subEl.textContent = "Integração Vendas, ERP e Logística.";
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (sidebar) sidebar.classList.toggle("open");
}

function filterByQueueNav(queueName) {
  const role = state.currentUser.role;
  const isAdmin = role === "admin";
  if (queueName === "CANCELAMENTOS" && role !== "erp" && !isAdmin) {
    showToast("Apenas a equipe ERP acessa essa fila.", "warning");
    return;
  }
  if (queueName === "ENTREGAS / EXPEDIÇÃO" && role !== "logistica" && !isAdmin) {
    showToast("Apenas a equipe de Logística acessa essa fila.", "warning");
    return;
  }

  // Define o filtro
  document.getElementById("filter-queue").value = queueName;
  state.filters.queue = queueName;

  // Muda para a tela de listagem
  const targetView = "view-internal-list";
  state.currentView = targetView;

  document.querySelectorAll(".app-view").forEach(el => { el.style.display = "none"; });
  document.getElementById(targetView).style.display = "block";

  // Ativa o botão do menu correto
  const navId = queueName === "CANCELAMENTOS" ? "view-queue-cancel" : "view-queue-delivery";
  document.querySelectorAll(".nav-item").forEach(el => {
    el.classList.toggle("active", el.getAttribute("data-view") === navId);
  });

  updateTopbarTitle(targetView);

  const sidebar = document.getElementById("sidebar");
  if (sidebar && sidebar.classList.contains("open")) sidebar.classList.remove("open");

  loadInternalRequests();
}

// =============================================================================
// 5. FORMULÁRIO DE NOVA SOLICITAÇÃO
// =============================================================================

function selectCategory(catId) {
  state.selectedCategory = catId;

  document.getElementById("card-cat-cancel").classList.toggle("active", catId === "cancelamento");
  document.getElementById("card-cat-delivery").classList.toggle("active", catId === "consulta_entrega");
  document.getElementById("card-cat-route").classList.toggle("active", catId === "verificacao_rota");

  const groupCancel = document.getElementById("group-cancel-reason");
  const groupDate = document.getElementById("group-order-date");
  const noticeEl = document.getElementById("auto-route-notice");

  if (catId === "cancelamento") {
    groupCancel.style.display = "block";
    groupDate.style.display = "none";
    noticeEl.innerHTML = `Esta solicitação será direcionada automaticamente para a fila <strong>CANCELAMENTOS</strong> (ERP / Faturamento).`;
  } else if (catId === "consulta_entrega") {
    groupCancel.style.display = "none";
    groupDate.style.display = "block";
    noticeEl.innerHTML = `Esta solicitação será direcionada automaticamente para a fila <strong>ENTREGAS / EXPEDIÇÃO</strong> para apuração de prazos e trânsito.`;
  } else if (catId === "verificacao_rota") {
    groupCancel.style.display = "none";
    groupDate.style.display = "block";
    noticeEl.innerHTML = `Esta solicitação será direcionada automaticamente para a fila <strong>ENTREGAS / EXPEDIÇÃO</strong> para conferência real de veículo em trânsito.`;
  }
}

async function handleCreateRequest(e) {
  e.preventDefault();

  const submitBtn = document.getElementById("btn-submit-request");
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span>Processando...</span>`;

  const orderNumber = document.getElementById("req-order-number").value.trim();
  const clientName = document.getElementById("req-client-name").value.trim();
  const clientCode = document.getElementById("req-client-code").value.trim();
  const description = document.getElementById("req-description").value.trim();
  const cancelReason = document.getElementById("req-cancel-reason").value;
  const orderTypedDate = document.getElementById("req-order-typed-date").value;

  if (!orderNumber) {
    showToast("Informe o número do pedido.", "error");
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Registrar Solicitação</span>`;
    return;
  }
  if (!clientName) {
    showToast("Informe a razão social ou nome do cliente.", "error");
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Registrar Solicitação</span>`;
    return;
  }
  if (state.selectedCategory === "cancelamento" && !cancelReason) {
    showToast("Selecione o motivo do cancelamento.", "error");
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Registrar Solicitação</span>`;
    return;
  }
  if ((state.selectedCategory === "consulta_entrega" || state.selectedCategory === "verificacao_rota") && !orderTypedDate) {
    showToast("A data de digitação do pedido é obrigatória.", "error");
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Registrar Solicitação</span>`;
    return;
  }

  const dup = await dbCheckDuplicateRequest(orderNumber, state.selectedCategory);
  if (dup) {
    showToast(`Já existe um chamado em aberto para o Pedido #${orderNumber} (${dup.protocol}).`, "warning");
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Registrar Solicitação</span>`;
    return;
  }

  const queue = state.selectedCategory === "cancelamento" ? "CANCELAMENTOS" : "ENTREGAS / EXPEDIÇÃO";
  const catName = state.selectedCategory === "cancelamento" ? "Cancelamento de pedido"
    : (state.selectedCategory === "consulta_entrega" ? "Consulta de entrega ou atraso" : "Verificação de pedido em rota");

  const created = await dbCreateRequest({
    category_id: state.selectedCategory,
    category_name: catName,
    queue,
    order_number: orderNumber,
    client_name: clientName,
    client_code: clientCode || null,
    order_typed_date: state.selectedCategory !== "cancelamento" ? orderTypedDate : null,
    cancel_reason: state.selectedCategory === "cancelamento" ? cancelReason : null,
    description: description || null,
    created_by_id: state.currentUser.firebase_uid,
    created_by_name: state.currentUser.name,
    created_by_email: state.currentUser.email,
    created_by_role: state.currentUser.role
  });

  if (!created) {
    showToast("Erro ao registrar a solicitação no banco.", "error");
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Registrar Solicitação</span>`;
    return;
  }

  showToast(`Solicitação ${created.protocol} registrada na fila ${queue}!`, "success");

  document.getElementById("new-request-form").reset();
  selectCategory("cancelamento");

  if (state.currentUser.role === "consultor") navigate("view-consultant-list");
  else navigate("view-dashboard");

  submitBtn.disabled = false;
  submitBtn.innerHTML = `<span>Registrar Solicitação</span><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`;
}

// =============================================================================
// 6. CARREGAMENTO E RENDERIZAÇÃO
// =============================================================================

async function refreshData() {
  if (!state.currentUser) return;

  if (state.currentUser.role === "consultor") {
    loadConsultantRequests();
  } else {
    loadDashboardMetrics();
    loadInternalRequests();
  }

  if (state.currentView === "view-admin-users" && state.currentUser.role === "admin") {
    loadAdminUsers();
  }
}

async function loadDashboardMetrics() {
  const metrics = await dbGetDashboardMetrics();
  if (!metrics) {
    showToast("Erro ao carregar métricas.", "error");
    return;
  }
  state.metrics = metrics;

  document.getElementById("kpi-total-val").textContent = metrics.total;
  document.getElementById("kpi-waiting-val").textContent = metrics.open;
  document.getElementById("kpi-progress-val").textContent = metrics.inProgress;
  document.getElementById("kpi-concluded-val").textContent = metrics.resolved;
  document.getElementById("kpi-sla-val").textContent = metrics.slaOverdue;

  document.getElementById("badge-queue-cancel").textContent = metrics.byCancelQueue;
  document.getElementById("badge-queue-delivery").textContent = metrics.byDeliveryQueue;
  document.getElementById("badge-total-requests").textContent = metrics.total;

  const baseTotal = metrics.total || 1;
  const cancelPct = Math.round((metrics.byCancelQueue / baseTotal) * 100);
  const deliveryPct = Math.round((metrics.byDeliveryQueue / baseTotal) * 100);

  document.getElementById("queues-progress-group").innerHTML = `
    <div>
      <div class="progress-item-label">
        <span>Cancelamentos (ERP)</span>
        <span>${metrics.byCancelQueue} (${cancelPct}%)</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill fill-cancelamentos" style="width:${cancelPct}%;"></div>
      </div>
    </div>
    <div>
      <div class="progress-item-label">
        <span>Entregas / Expedição (Logística)</span>
        <span>${metrics.byDeliveryQueue} (${deliveryPct}%)</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill fill-entregas" style="width:${deliveryPct}%;"></div>
      </div>
    </div>
  `;

  let catHtml = "";
  for (const [catName, count] of Object.entries(metrics.byCategory)) {
    const pct = Math.round((count / baseTotal) * 100);
    let fillClass = "fill-rota";
    if (catName.includes("Cancelamento")) fillClass = "fill-cancelamentos";
    if (catName.includes("Consulta")) fillClass = "fill-entregas";
    catHtml += `
      <div>
        <div class="progress-item-label">
          <span>${escapeHtml(catName)}</span>
          <span>${count} (${pct}%)</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill ${fillClass}" style="width:${pct}%;"></div>
        </div>
      </div>
    `;
  }
  document.getElementById("categories-progress-group").innerHTML =
    catHtml || `<p style="font-size:0.8rem; color:#64748b;">Nenhuma demanda registrada.</p>`;
}

async function loadInternalRequests() {
  const tbody = document.getElementById("internal-requests-tbody");
  tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding: 2rem;">Carregando dados...</td></tr>`;

  if (state.currentUser.role === "consultor") {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding: 2rem;">Acesso negado.</td></tr>`;
    return;
  }

  const allRequests = await dbGetRequests();
  let list = allRequests || [];
  const f = state.filters;

  if (f.search) {
    const s = f.search.toLowerCase();
    list = list.filter(r =>
      (r.order_number || "").toLowerCase().includes(s) ||
      (r.client_name || "").toLowerCase().includes(s) ||
      (r.client_code && r.client_code.toLowerCase().includes(s)) ||
      (r.protocol || "").toLowerCase().includes(s)
    );
  }
  if (f.queue) list = list.filter(r => r.queue === f.queue);
  if (f.category) list = list.filter(r => r.category_id === f.category);
  if (f.status) list = list.filter(r => r.status === f.status);
  if (f.consultant) list = list.filter(r => r.created_by_id === f.consultant);
  if (f.assigned_to) {
    if (f.assigned_to === "unassigned") list = list.filter(r => !r.assigned_to_id);
    else list = list.filter(r => r.assigned_to_id === f.assigned_to);
  }
  if (f.date_from) {
    const fromTime = new Date(f.date_from + "T00:00:00Z").getTime();
    list = list.filter(r => new Date(r.created_at).getTime() >= fromTime);
  }
  if (f.date_to) {
    const toTime = new Date(f.date_to + "T23:59:59Z").getTime();
    list = list.filter(r => new Date(r.created_at).getTime() <= toTime);
  }

  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  state.requests = list;

  document.getElementById("table-results-counter").textContent = `${list.length} resultado(s)`;
  renderInternalRequestsTable(list);
}

function renderInternalRequestsTable(requests) {
  const tbody = document.getElementById("internal-requests-tbody");
  if (!requests.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11">
          <div class="empty-state">
            <div class="empty-state-icon">
              <svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            </div>
            <h3>Nenhuma solicitação encontrada</h3>
            <p>Nenhuma demanda corresponde aos filtros aplicados.</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = requests.map(r => {
    const isOverdue = r.status !== "Resolvido" && r.status !== "Cancelado" && new Date(r.sla_limit) < new Date();
    const slaHtml = isOverdue
      ? `<span class="sla-tag overdue" title="Prazo padrão de 24h excedido!">SLA Vencido</span>`
      : `<span class="sla-tag normal">${formatDate(r.updated_at)}</span>`;

    return `
      <tr>
        <td><a href="javascript:void(0)" class="protocol-link" onclick="openDetailsModal('${r.id}')">${escapeHtml(r.protocol)}</a></td>
        <td>${formatDate(r.created_at)}</td>
        <td><strong>${escapeHtml(r.created_by_name)}</strong></td>
        <td>
          <div class="client-name-cell" title="${escapeHtml(r.client_name)}">${escapeHtml(r.client_name)}</div>
          ${r.client_code ? `<span class="client-code-sub">${escapeHtml(r.client_code)}</span>` : ""}
        </td>
        <td><span class="order-badge">#${escapeHtml(r.order_number)}</span></td>
        <td style="font-weight: 500;">${escapeHtml(r.category_name)}</td>
        <td><span class="queue-badge ${getQueueBadgeClass(r.queue)}">${escapeHtml(r.queue)}</span></td>
        <td><span class="badge ${getStatusBadgeClass(r.status)}">${escapeHtml(r.status)}</span></td>
        <td>
          ${r.assigned_to_name
        ? `<span style="font-weight:600; color:#334155;">${escapeHtml(r.assigned_to_name)}</span>`
        : `<span style="color:#94a3b8; font-style:italic;">Não atribuído</span>`}
        </td>
        <td>${slaHtml}</td>
        <td>
          <button type="button" class="btn btn-outline btn-sm" onclick="openDetailsModal('${r.id}')">
            <span>Tratar / Detalhes</span>
          </button>
        </td>
      </tr>`;
  }).join("");
}

async function loadConsultantRequests() {
  const tbody = document.getElementById("consultant-requests-tbody");
  tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 2rem;">Carregando suas solicitações...</td></tr>`;

  const myRequests = await dbGetRequests({
    role: "consultor",
    firebaseUid: state.currentUser.firebase_uid
  });

  const sorted = (myRequests || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  state.requests = sorted;

  document.getElementById("consultant-welcome-title").textContent = `Minhas Solicitações - ${state.currentUser.name}`;
  document.getElementById("badge-my-requests").textContent = sorted.length;
  document.getElementById("consultant-counter").textContent = `${sorted.length} solicitações registradas`;

  renderConsultantTable(sorted);
}

function renderConsultantTable(requests) {
  const tbody = document.getElementById("consultant-requests-tbody");
  if (!requests.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9">
          <div class="empty-state">
            <div class="empty-state-icon">
              <svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </div>
            <h3>Você ainda não possui solicitações abertas</h3>
            <p>Precisa de suporte em algum pedido? Abra uma nova solicitação agora mesmo.</p>
            <button type="button" class="btn btn-primary btn-sm" onclick="navigate('view-new-request')">+ Nova Solicitação</button>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = requests.map(r => {
    const tratativaPreview = r.resolution_notes
      ? `<span style="color:#15803d; font-weight:600;" title="${escapeHtml(r.resolution_notes)}">${escapeHtml(r.resolution_notes.substring(0, 45))}...</span>`
      : `<span style="color:#94a3b8; font-style:italic;">Aguardando retorno da equipe interna</span>`;

    return `
      <tr>
        <td><a href="javascript:void(0)" class="protocol-link" onclick="openDetailsModal('${r.id}')">${escapeHtml(r.protocol)}</a></td>
        <td>${formatDate(r.created_at)}</td>
        <td><span class="order-badge">#${escapeHtml(r.order_number)}</span></td>
        <td><div class="client-name-cell" title="${escapeHtml(r.client_name)}">${escapeHtml(r.client_name)}</div></td>
        <td style="font-weight: 500;">${escapeHtml(r.category_name)}</td>
        <td><span class="queue-badge ${getQueueBadgeClass(r.queue)}">${escapeHtml(r.queue)}</span></td>
        <td><span class="badge ${getStatusBadgeClass(r.status)}">${escapeHtml(r.status)}</span></td>
        <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${tratativaPreview}</td>
        <td>
          <button type="button" class="btn btn-outline btn-sm" onclick="openDetailsModal('${r.id}')">
            <span>Visualizar</span>
          </button>
        </td>
      </tr>`;
  }).join("");
}

function handleConsultantSearch() {
  const query = (document.getElementById("consultant-search-input").value || "").toLowerCase().trim();
  const statusFilter = document.getElementById("consultant-status-filter").value;

  const filtered = state.requests.filter(r => {
    const matchText = !query ||
      (r.order_number || "").toLowerCase().includes(query) ||
      (r.client_name || "").toLowerCase().includes(query) ||
      (r.protocol || "").toLowerCase().includes(query);
    const matchStatus = !statusFilter || r.status === statusFilter;
    return matchText && matchStatus;
  });

  document.getElementById("consultant-counter").textContent = `${filtered.length} de ${state.requests.length} solicitações`;
  renderConsultantTable(filtered);
}

// =============================================================================
// 6b. ADMIN — GESTÃO DE USUÁRIOS
// =============================================================================

async function loadAdminUsers() {
  if (!state.currentUser || state.currentUser.role !== "admin") {
    showToast("Apenas administradores acessam esta área.", "error");
    return;
  }

  const tbody = document.getElementById("admin-users-tbody");
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem;">Carregando usuários...</td></tr>`;

  const users = await fsGetAllUsers();
  document.getElementById("admin-users-counter").textContent = `${users.length} usuário(s)`;

  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem;">Nenhum usuário cadastrado ainda.</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map(u => {
    const uid = u.firebase_uid || u.id;
    const isSelf = uid === state.currentUser.firebase_uid;
    const role = u.role || "consultor";

    const selectOrNote = isSelf
      ? `<span style="color:#94a3b8; font-style:italic; font-size:0.85rem;">Você mesmo</span>`
      : `<select class="form-control form-control-sm" onchange="handleRoleChange('${uid}', this.value, '${escapeHtml(u.name || "")}', '${role}')">
          <option value="consultor" ${role === "consultor" ? "selected" : ""}>Consultor de Vendas</option>
          <option value="erp" ${role === "erp" ? "selected" : ""}>ERP / Faturamento</option>
          <option value="logistica" ${role === "logistica" ? "selected" : ""}>Logística / Expedição</option>
          <option value="admin" ${role === "admin" ? "selected" : ""}>Administrador</option>
        </select>`;

    return `
      <tr>
        <td>
          <strong>${escapeHtml(u.name || "-")}</strong>
          ${isSelf ? ' <span style="color:#2563eb; font-size:0.75rem; font-weight:600;">(você)</span>' : ""}
        </td>
        <td>${escapeHtml(u.email || "-")}</td>
        <td>${escapeHtml(u.department || "-")}</td>
        <td>${formatDate(u.created_at)}</td>
        <td><span class="badge ${getRoleBadgeClass(role)}">${escapeHtml(roleLabel(role))}</span></td>
        <td style="min-width:200px;">${selectOrNote}</td>
      </tr>
    `;
  }).join("");
}

async function handleRoleChange(uid, newRole, userName, oldRole) {
  if (newRole === oldRole) return;

  const confirmed = confirm(
    `Alterar o papel de "${userName}" de "${roleLabel(oldRole)}" para "${roleLabel(newRole)}"?\n\n` +
    `O usuário precisará deslogar e logar novamente para as permissões atualizarem.`
  );

  if (!confirmed) {
    loadAdminUsers();
    return;
  }

  const updated = await fsUpdateUserRole(uid, newRole);
  if (updated) {
    showToast(`Permissão de ${userName} atualizada para ${roleLabel(newRole)}.`, "success");
  } else {
    showToast("Não foi possível atualizar a permissão. Verifique se você é admin.", "error");
  }
  loadAdminUsers();
}

// =============================================================================
// 7. FILTROS AVANÇADOS
// =============================================================================

function applyFilters() {
  state.filters.search = document.getElementById("filter-search").value.trim();
  state.filters.queue = document.getElementById("filter-queue").value;
  state.filters.category = document.getElementById("filter-category").value;
  state.filters.status = document.getElementById("filter-status").value;
  state.filters.consultant = document.getElementById("filter-consultant").value;
  state.filters.assigned_to = document.getElementById("filter-assigned").value;
  state.filters.date_from = document.getElementById("filter-date-from").value;
  state.filters.date_to = document.getElementById("filter-date-to").value;

  loadInternalRequests();
}

function clearFilters() {
  document.getElementById("filter-search").value = "";
  document.getElementById("filter-queue").value = "";
  document.getElementById("filter-category").value = "";
  document.getElementById("filter-status").value = "";
  document.getElementById("filter-consultant").value = "";
  document.getElementById("filter-assigned").value = "";
  document.getElementById("filter-date-from").value = "";
  document.getElementById("filter-date-to").value = "";

  state.filters = {
    search: "", queue: "", category: "", status: "",
    consultant: "", assigned_to: "", date_from: "", date_to: ""
  };

  loadInternalRequests();
}

function exportToCSV() {
  if (!state.requests.length) {
    showToast("Nenhum dado disponível para exportação.", "warning");
    return;
  }

  const headers = ["Protocolo", "Abertura", "Consultor", "Cliente", "Pedido", "Categoria", "Fila", "Status", "Responsavel", "Tratativa"];
  const rows = state.requests.map(r => [
    r.protocol,
    r.created_at,
    `"${(r.created_by_name || "").replace(/"/g, '""')}"`,
    `"${(r.client_name || "").replace(/"/g, '""')}"`,
    r.order_number,
    `"${(r.category_name || "").replace(/"/g, '""')}"`,
    r.queue,
    r.status,
    `"${(r.assigned_to_name || "Nao atribuido").replace(/"/g, '""')}"`,
    `"${(r.resolution_notes || "").replace(/"/g, '""')}"`
  ]);

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `demandas_pendencias_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("Planilha CSV gerada com sucesso!", "success");
}

// =============================================================================
// 8. MODAL DE DETALHES / TRATATIVA / HISTÓRICO
// =============================================================================

async function openDetailsModal(requestId) {
  const req = await dbGetRequestById(requestId);
  if (!req) { showToast("Solicitação não encontrada.", "error"); return; }

  const role = state.currentUser.role;
  const uid = state.currentUser.firebase_uid;

  if (role === "consultor" && req.created_by_id !== uid) {
    showToast("Você não possui permissão para visualizar esta solicitação.", "error");
    return;
  }

  state.activeRequest = req;

  document.getElementById("modal-protocol").textContent = req.protocol;
  const statusBadge = document.getElementById("modal-status-badge");
  statusBadge.textContent = req.status;
  statusBadge.className = `badge ${getStatusBadgeClass(req.status)}`;
  const queueBadge = document.getElementById("modal-queue-badge");
  queueBadge.textContent = req.queue;
  queueBadge.className = `queue-badge ${getQueueBadgeClass(req.queue)}`;

  document.getElementById("modal-consultant-name").textContent = `${req.created_by_name} (${req.created_by_email})`;
  document.getElementById("modal-created-at").textContent = formatDate(req.created_at);
  document.getElementById("modal-order-number").textContent = `#${req.order_number}`;
  document.getElementById("modal-assigned-name").textContent = req.assigned_to_name || "Não atribuído";
  document.getElementById("modal-client-info").textContent = `${req.client_name} ${req.client_code ? `(${req.client_code})` : ""}`;
  document.getElementById("modal-description").textContent = req.description || "Nenhuma observação complementar.";

  const extraBox = document.getElementById("modal-extra-field-box");
  const extraLabel = document.getElementById("modal-extra-label");
  const extraVal = document.getElementById("modal-extra-value");
  if (req.category_id === "cancelamento") {
    extraLabel.textContent = "Motivo do Cancelamento:";
    extraVal.textContent = req.cancel_reason || "-";
    extraBox.style.display = "block";
  } else if (req.order_typed_date) {
    extraLabel.textContent = "Data de Digitação do Pedido:";
    extraVal.textContent = formatDateOnly(req.order_typed_date);
    extraBox.style.display = "block";
  } else {
    extraBox.style.display = "none";
  }

  const canTreat =
    role === "admin" ||
    (role === "erp" && req.queue === "CANCELAMENTOS") ||
    (role === "logistica" && req.queue === "ENTREGAS / EXPEDIÇÃO");

  const internalPanel = document.getElementById("internal-action-panel");
  const consultantResDisplay = document.getElementById("consultant-resolution-display");
  const resText = document.getElementById("consultant-resolution-text");

  if (canTreat) {
    internalPanel.style.display = "block";
    consultantResDisplay.style.display = "none";

    document.getElementById("trat-status").value = req.status;
    document.getElementById("trat-assigned").value = req.assigned_to_id || "";
    document.getElementById("trat-resolution-notes").value = req.resolution_notes || "";
    document.getElementById("trat-comment").value = "";

    const logFields = document.getElementById("trat-logistics-fields");
    if (req.queue === "ENTREGAS / EXPEDIÇÃO") {
      logFields.style.display = "block";
      document.getElementById("trat-situation").value = req.operational_situation || "";
      document.getElementById("trat-departure-date").value = req.departure_date || "";
    } else {
      logFields.style.display = "none";
    }
    handleTratativaStatusChange();

  } else if (role === "consultor") {
    internalPanel.style.display = "none";
    consultantResDisplay.style.display = "block";

    if (req.resolution_notes) {
      resText.innerHTML = `
        <strong>Tratativa Conclusiva:</strong><br>${escapeHtml(req.resolution_notes)}
        ${req.operational_situation ? `<br><br><span style="font-size:0.85rem; color:#15803d;"><strong>Situação Física:</strong> ${escapeHtml(req.operational_situation)} ${req.departure_date ? `| Saída: ${escapeHtml(req.departure_date)}` : ''}</span>` : ''}
      `;
    } else {
      resText.innerHTML = `<em>Solicitação em andamento com a equipe interna.</em>`;
    }

  } else {
    internalPanel.style.display = "none";
    consultantResDisplay.style.display = "block";
    const owner = req.queue === "CANCELAMENTOS" ? "ERP / Faturamento" : "Logística / Expedição";

    resText.innerHTML = `
      <div style="background:#fef3c7; border:1px solid #fcd34d; padding:0.75rem; border-radius:6px; margin-bottom:0.75rem;">
        <strong>⚠️ Solicitação da fila ${escapeHtml(req.queue)}</strong><br>
        <span style="font-size:0.85rem;">Pertence à equipe <strong>${owner}</strong>. Você pode visualizar mas não alterar.</span>
      </div>
      ${req.resolution_notes
        ? `<strong>Tratativa Registrada:</strong><br>${escapeHtml(req.resolution_notes)}`
        : `<em>Sem tratativa conclusiva registrada ainda.</em>`}
    `;
  }

  renderTimeline(req.history || []);
  document.getElementById("modal-request-details").classList.add("active");
}

function closeDetailsModal() {
  document.getElementById("modal-request-details").classList.remove("active");
  state.activeRequest = null;
}

function handleModalBackdropClick(e) {
  if (e.target.id === "modal-request-details") closeDetailsModal();
}

function handleTratativaStatusChange() {
  const status = document.getElementById("trat-status").value;
  const resNotesReq = document.getElementById("res-notes-required");
  if (status === "Resolvido") resNotesReq.style.display = "inline";
  else resNotesReq.style.display = "none";
}

function assignToMe() {
  if (state.currentUser && state.currentUser.role !== "consultor") {
    document.getElementById("trat-assigned").value = state.currentUser.firebase_uid;
    showToast(`Chamado atribuído a você (${state.currentUser.name}).`, "success");
  }
}

async function handleSaveTratativa(e) {
  e.preventDefault();
  if (!state.activeRequest) return;

  const role = state.currentUser.role;
  const req = state.activeRequest;

  const canTreat =
    role === "admin" ||
    (role === "erp" && req.queue === "CANCELAMENTOS") ||
    (role === "logistica" && req.queue === "ENTREGAS / EXPEDIÇÃO");

  if (!canTreat) {
    showToast("Você não tem permissão para tratar solicitações desta fila.", "error");
    return;
  }

  const saveBtn = document.getElementById("btn-save-tratativa");
  saveBtn.disabled = true;
  saveBtn.textContent = "Salvando...";

  const newStatus = document.getElementById("trat-status").value;
  const assignedToId = document.getElementById("trat-assigned").value;
  const resolutionNotes = document.getElementById("trat-resolution-notes").value.trim();
  const comment = document.getElementById("trat-comment").value.trim();
  const situation = document.getElementById("trat-situation") ? document.getElementById("trat-situation").value : null;
  const departureDate = document.getElementById("trat-departure-date") ? document.getElementById("trat-departure-date").value.trim() : null;

  if (newStatus === "Resolvido" && (!resolutionNotes || resolutionNotes.length < 5)) {
    showToast("Ao resolver, a tratativa conclusiva é obrigatória.", "error");
    saveBtn.disabled = false;
    saveBtn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg><span>Salvar Atualização</span>`;
    return;
  }

  const oldStatus = req.status;
  const oldAssigned = req.assigned_to_id;

  let assignedName = null;
  if (assignedToId) {
    const profiles = state.internalUsers.length ? state.internalUsers : await fsGetInternalUsers();
    const u = profiles.find(x => x.firebase_uid === assignedToId);
    assignedName = u ? u.name : "Equipe Interna";
  }

  const updates = {
    status: newStatus,
    assigned_to_id: assignedToId || null,
    assigned_to_name: assignedName,
    resolution_notes: resolutionNotes || null,
    operational_situation: situation || null,
    departure_date: departureDate || null,
    updated_at: new Date().toISOString()
  };

  let actionDesc = "Atualização de status";
  if (newStatus !== oldStatus) actionDesc = `Status alterado de '${oldStatus}' para '${newStatus}'`;
  else if (assignedToId !== oldAssigned) actionDesc = `Atribuído a ${assignedName || "Nenhum"}`;
  else if (resolutionNotes) actionDesc = "Registro de tratativa conclusiva";

  const historyEntry = {
    user_id: state.currentUser.firebase_uid,
    user_name: state.currentUser.name,
    user_role: state.currentUser.role,
    old_status: oldStatus,
    new_status: newStatus,
    action: actionDesc,
    comment: comment || resolutionNotes || "Atualização realizada pela equipe interna."
  };

  const updated = await dbUpdateRequest(req.id, updates, historyEntry);
  if (!updated) {
    showToast("Erro ao salvar a atualização.", "error");
    saveBtn.disabled = false;
    saveBtn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg><span>Salvar Atualização</span>`;
    return;
  }

  showToast(`Solicitação ${updated.protocol} atualizada!`, "success");
  await openDetailsModal(updated.id);
  refreshData();

  saveBtn.disabled = false;
  saveBtn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg><span>Salvar Atualização</span>`;
}

function renderTimeline(historyList) {
  const container = document.getElementById("modal-timeline");
  if (!historyList || !historyList.length) {
    container.innerHTML = `<p style="font-size:0.85rem; color:#64748b;">Nenhum registro histórico localizado.</p>`;
    return;
  }

  container.innerHTML = historyList.map(h => {
    return `
      <div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <div class="timeline-header">
            <div>
              <span class="timeline-user">${escapeHtml(h.user_name)}</span>
              <span class="timeline-badge">${escapeHtml(roleLabel(h.user_role))}</span>
            </div>
            <span class="timeline-time">${formatDate(h.created_at || h.timestamp)}</span>
          </div>
          <div style="font-size:0.8rem; font-weight:600; color:#1e293b; margin-bottom:0.25rem;">
            ${escapeHtml(h.action)}
            ${h.new_status ? ` &rarr; <span class="badge ${getStatusBadgeClass(h.new_status)}" style="font-size:0.7rem; padding:0.1rem 0.4rem;">${escapeHtml(h.new_status)}</span>` : ""}
          </div>
          ${h.comment ? `<div class="timeline-comment">${escapeHtml(h.comment)}</div>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

async function loadInternalUsers() {
  const internals = await fsGetInternalUsers();
  const consultants = await fsGetAllConsultants();
  state.internalUsers = internals;

  const select = document.getElementById("trat-assigned");
  if (select) {
    select.innerHTML = `<option value="">Não atribuído</option>` +
      internals.map(u => {
        const label = u.role === "erp" ? "ERP" : (u.role === "logistica" ? "Logística" : "Admin");
        return `<option value="${u.firebase_uid}">${escapeHtml(u.name)} (${label})</option>`;
      }).join("");
  }

  const filterAssigned = document.getElementById("filter-assigned");
  if (filterAssigned) {
    filterAssigned.innerHTML = `
      <option value="">Todos os Responsáveis</option>
      <option value="unassigned">Sem Responsável (Aberto)</option>
      ${internals.map(u => `<option value="${u.firebase_uid}">${escapeHtml(u.name)}</option>`).join("")}
    `;
  }

  const filterConsultant = document.getElementById("filter-consultant");
  if (filterConsultant) {
    filterConsultant.innerHTML = `<option value="">Todos os Consultores</option>` +
      consultants.map(u => `<option value="${u.firebase_uid}">${escapeHtml(u.name)}</option>`).join("");
  }
}

// =============================================================================
// 9. RECARREGAR DADOS
// =============================================================================

async function resetDefaultData() {
  if (!confirm("Recarregar os dados do Supabase agora?")) return;
  await loadInternalUsers();
  await refreshData();
  showToast("Dados recarregados.", "success");
}

// =============================================================================
// 10. INICIALIZAÇÃO
// =============================================================================
window.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = document.getElementById("login-email").value.trim();
      const pwd = document.getElementById("login-password").value;
      handleLogin(email, pwd);
    });
  }

  const registerForm = document.getElementById("register-form");
  if (registerForm) {
    registerForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = document.getElementById("reg-name").value.trim();
      const email = document.getElementById("reg-email").value.trim();
      const password = document.getElementById("reg-password").value;
      const confirm = document.getElementById("reg-password-confirm").value;
      handleRegister(name, email, password, confirm);
    });
  }

  const searchInput = document.getElementById("filter-search");
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => applyFilters(), 350);
    });
  }

  initAuth();
});