/**
 * =============================================================================
 * CONFIGURAÇÃO DO SUPABASE (BANCO DE DADOS OPERACIONAL) - GP MAX
 * =============================================================================
 */

const SUPABASE_URL = "https://dksxjcinpbswaejhxaas.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrc3hqY2lucGJzd2Flamh4YWFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyMDMwNDQsImV4cCI6MjEwODc3OTA0NH0.zk9kBZ11BGpwgSs5lEqzd_A-rCdBdkHelT9hyEp597k";

let supabaseClient = null;

function initSupabase() {
  if (supabaseClient) return supabaseClient;

  if (SUPABASE_URL.startsWith("SUBSTITUIR_")) {
    console.error(
      "[Supabase] ⚠️ Credenciais não configuradas!\n" +
      "Abra supabase-config.js e substitua SUBSTITUIR_... pelas credenciais reais."
    );
    return null;
  }

  try {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      accessToken: async () => {
        const auth = window.gpFirebaseAuth;
        const user = auth && auth.currentUser;
        if (!user) return null;
        try {
          return await user.getIdToken(true); // Força o refresh para evitar expiração
        } catch (err) {
          console.warn("[Supabase] Falha ao obter token Firebase:", err);
          return null;
        }
      }
    });
    console.log("[Supabase] ✅ Cliente inicializado.");
    return supabaseClient;
  } catch (error) {
    console.error("[Supabase] ❌ Erro na inicialização:", error.message);
    return null;
  }
}

// =============================================================================
// SOLICITAÇÕES (REQUESTS)
// =============================================================================

async function dbGetRequests(options = {}) {
  const db = initSupabase();
  if (!db) return [];

  let query = db.from("requests").select("*").order("created_at", { ascending: false });

  if (options.role === "consultor" && options.firebaseUid) {
    query = query.eq("created_by_id", options.firebaseUid);
  }

  if (options.filters) {
    const f = options.filters;
    if (f.queue) query = query.eq("queue", f.queue);
    if (f.status) query = query.eq("status", f.status);
    if (f.category) query = query.eq("category_id", f.category);
    if (f.assigned_to) query = query.eq("assigned_to_id", f.assigned_to);
    if (f.date_from) query = query.gte("created_at", f.date_from);
    if (f.date_to) query = query.lte("created_at", f.date_to + "T23:59:59Z");
    if (f.search) {
      query = query.or(
        `protocol.ilike.%${f.search}%,order_number.ilike.%${f.search}%,client_name.ilike.%${f.search}%`
      );
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error("[Supabase] Erro ao buscar solicitações:", error.message);
    return [];
  }
  return data || [];
}

async function dbGetRequestById(requestId) {
  const db = initSupabase();
  if (!db) return null;

  const { data: request, error } = await db
    .from("requests")
    .select("*")
    .eq("id", requestId)
    .single();

  if (error) {
    console.error("[Supabase] Erro ao buscar solicitação:", error.message);
    return null;
  }

  const { data: history, error: histError } = await db
    .from("request_history")
    .select("*")
    .eq("request_id", requestId)
    .order("created_at", { ascending: true });

  if (histError) {
    console.error("[Supabase] Erro ao buscar histórico:", histError.message);
  }

  request.history = history || [];
  return request;
}

async function dbCreateRequest(requestData) {
  const db = initSupabase();
  if (!db) return null;

  const { data: newRequest, error } = await db
    .from("requests")
    .insert({
      protocol: requestData.protocol || null,
      category_id: requestData.category_id,
      category_name: requestData.category_name,
      queue: requestData.queue,
      order_number: requestData.order_number,
      client_name: requestData.client_name,
      client_code: requestData.client_code || null,
      order_typed_date: requestData.order_typed_date || null,
      cancel_reason: requestData.cancel_reason || null,
      description: requestData.description || null,
      status: "Aberto",
      created_by_id: requestData.created_by_id,
      created_by_name: requestData.created_by_name,
      created_by_email: requestData.created_by_email
    })
    .select()
    .single();

  if (error) {
    console.error("[Supabase] Erro ao criar solicitação:", error.message);
    return null;
  }

  await db.from("request_history").insert({
    request_id: newRequest.id,
    protocol: newRequest.protocol,
    user_id: requestData.created_by_id,
    user_name: requestData.created_by_name,
    user_role: requestData.created_by_role || "consultor",
    old_status: null,
    new_status: "Aberto",
    action: "Abertura da solicitação",
    comment: `Solicitação aberta e encaminhada automaticamente para a fila ${newRequest.queue}.`
  });

  return newRequest;
}

async function dbUpdateRequest(requestId, updates, historyEntry) {
  const db = initSupabase();
  if (!db) return null;

  const { data: updatedRequest, error } = await db
    .from("requests")
    .update(updates)
    .eq("id", requestId)
    .select()
    .single();

  if (error) {
    console.error("[Supabase] Erro ao atualizar solicitação:", error.message);
    return null;
  }

  if (historyEntry) {
    const { error: histError } = await db.from("request_history").insert({
      request_id: requestId,
      protocol: updatedRequest.protocol,
      user_id: historyEntry.user_id,
      user_name: historyEntry.user_name,
      user_role: historyEntry.user_role,
      old_status: historyEntry.old_status,
      new_status: historyEntry.new_status,
      action: historyEntry.action,
      comment: historyEntry.comment || null
    });
    if (histError) {
      console.error("[Supabase] Erro ao registrar histórico:", histError.message);
    }
  }

  return updatedRequest;
}

async function dbCheckDuplicateRequest(orderNumber, categoryId) {
  const db = initSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from("requests")
    .select("id, protocol")
    .eq("order_number", orderNumber)
    .eq("category_id", categoryId)
    .not("status", "in", '("Resolvido","Cancelado")')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[Supabase] Erro ao verificar duplicidade:", error.message);
    return null;
  }
  return data;
}

async function dbGetDashboardMetrics() {
  const db = initSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from("requests")
    .select("id, status, queue, category_name, sla_limit");

  if (error) {
    console.error("[Supabase] Erro ao buscar métricas:", error.message);
    return null;
  }

  const reqs = data || [];
  const now = new Date();

  return {
    total: reqs.length,
    open: reqs.filter(r => r.status === "Aberto").length,
    inProgress: reqs.filter(r => ["Em análise", "Aguardando informação", "Em andamento"].includes(r.status)).length,
    resolved: reqs.filter(r => ["Resolvido", "Cancelado"].includes(r.status)).length,
    slaOverdue: reqs.filter(r => !["Resolvido", "Cancelado"].includes(r.status) && new Date(r.sla_limit) < now).length,
    byCancelQueue: reqs.filter(r => r.queue === "CANCELAMENTOS").length,
    byDeliveryQueue: reqs.filter(r => r.queue === "ENTREGAS / EXPEDIÇÃO").length,
    byCategory: reqs.reduce((acc, r) => {
      acc[r.category_name] = (acc[r.category_name] || 0) + 1;
      return acc;
    }, {})
  };
}

async function dbHealthCheck() {
  const db = initSupabase();
  if (!db) return false;
  try {
    const { error } = await db.from("requests").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}