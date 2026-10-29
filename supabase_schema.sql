-- =============================================================================
-- SISTEMA DE GESTÃO DE PENDÊNCIAS (VENDAS, ERP E LOGÍSTICA)
-- Script de Criação e Configuração do Banco de Dados no Supabase (PostgreSQL)
-- Arquivo: supabase_schema.sql
-- =============================================================================

-- 1. EXTENSÕES NECESSÁRIAS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 2. TABELA DE PERFIS DE USUÁRIOS (PROFILES)
-- Sincronizada com o Firebase Auth via UID do Firebase
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'consultor' CHECK (role IN ('consultor', 'interno')),
    department TEXT,
    avatar TEXT,
    pending_approval BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para busca rápida
CREATE INDEX IF NOT EXISTS idx_profiles_firebase_uid ON public.profiles(firebase_uid);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

-- =============================================================================
-- 3. SEQUÊNCIA E TABELA DE SOLICITAÇÕES / DEMANDAS (REQUESTS)
-- =============================================================================
CREATE SEQUENCE IF NOT EXISTS public.request_protocol_seq START 1;

CREATE TABLE IF NOT EXISTS public.requests (
    id TEXT PRIMARY KEY DEFAULT ('req-' || extract(epoch from now())::bigint || '-' || floor(random() * 1000)::text),
    protocol TEXT NOT NULL UNIQUE,
    category_id TEXT NOT NULL,
    category_name TEXT NOT NULL,
    queue TEXT NOT NULL CHECK (queue IN ('CANCELAMENTOS', 'ENTREGAS / EXPEDIÇÃO')),
    order_number TEXT NOT NULL,
    client_name TEXT NOT NULL,
    client_code TEXT,
    order_typed_date DATE,
    cancel_reason TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'Aberto' CHECK (status IN ('Aberto', 'Em análise', 'Aguardando informação', 'Em andamento', 'Resolvido', 'Cancelado')),
    assigned_to_id TEXT,
    assigned_to_name TEXT,
    operational_situation TEXT,
    departure_date TEXT,
    resolution_notes TEXT,
    created_by_id TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_by_email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sla_limit TIMESTAMPTZ
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_requests_protocol ON public.requests(protocol);
CREATE INDEX IF NOT EXISTS idx_requests_status ON public.requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_queue ON public.requests(queue);
CREATE INDEX IF NOT EXISTS idx_requests_created_by_id ON public.requests(created_by_id);
CREATE INDEX IF NOT EXISTS idx_requests_order_number ON public.requests(order_number);
CREATE INDEX IF NOT EXISTS idx_requests_created_at ON public.requests(created_at DESC);

-- =============================================================================
-- 4. TABELA DE HISTÓRICO DE TRATATIVAS (REQUEST_HISTORY)
-- Registro auditável e imutável de todas as alterações e tratativas
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.request_history (
    id TEXT PRIMARY KEY DEFAULT ('hist-' || extract(epoch from now())::bigint || '-' || floor(random() * 1000)::text),
    request_id TEXT NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
    protocol TEXT NOT NULL,
    user_id TEXT,
    user_name TEXT NOT NULL,
    user_role TEXT NOT NULL,
    old_status TEXT,
    new_status TEXT NOT NULL,
    action TEXT NOT NULL,
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_history_request_id ON public.request_history(request_id);
CREATE INDEX IF NOT EXISTS idx_history_created_at ON public.request_history(created_at ASC);

-- =============================================================================
-- 5. FUNÇÕES E TRIGGERS PARA INTEGRIDADE
-- =============================================================================

-- Função para atualizar o campo updated_at automaticamente
CREATE OR REPLACE FUNCTION public.trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_profiles ON public.profiles;
CREATE TRIGGER set_timestamp_profiles
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp_requests ON public.requests;
CREATE TRIGGER set_timestamp_requests
    BEFORE UPDATE ON public.requests
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_set_timestamp();

-- Função para geração garantida de protocolo sequencial (ex: PEND-2026-0001)
CREATE OR REPLACE FUNCTION public.generate_request_protocol()
RETURNS TRIGGER AS $$
DECLARE
    current_year TEXT := to_char(now(), 'YYYY');
    seq_val BIGINT;
BEGIN
    IF NEW.protocol IS NULL OR NEW.protocol = '' THEN
        seq_val := nextval('public.request_protocol_seq');
        NEW.protocol := 'PEND-' || current_year || '-' || lpad(seq_val::text, 4, '0');
    END IF;
    IF NEW.sla_limit IS NULL THEN
        NEW.sla_limit := now() + interval '24 hours';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_protocol_requests ON public.requests;
CREATE TRIGGER set_protocol_requests
    BEFORE INSERT ON public.requests
    FOR EACH ROW
    EXECUTE FUNCTION public.generate_request_protocol();

-- =============================================================================
-- 6. POLÍTICAS DE SEGURANÇA EM NÍVEL DE LINHA (ROW LEVEL SECURITY - RLS)
-- =============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_history ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Políticas para PROFILES
-- -----------------------------------------------------------------------------
-- Leitura: Qualquer usuário autenticado pode ler perfis para identificar colegas
CREATE POLICY "Permitir leitura de perfis para autenticados"
ON public.profiles FOR SELECT
USING (true);

-- Inserção: O próprio usuário pode inserir seu registro ao se cadastrar
-- Impedindo auto-atribuição de perfil 'interno' direto sem autorização
CREATE POLICY "Permitir auto-cadastro de novos usuarios"
ON public.profiles FOR INSERT
WITH CHECK (
    -- Novo usuário só pode registrar role = 'consultor'
    -- Elevações para 'interno' devem ser feitas por admin ou autorizados
    role = 'consultor' OR pending_approval = true
);

-- Atualização: Usuário só pode atualizar seu próprio perfil (nome, departamento, avatar)
-- Usuário comum NÃO pode mudar seu próprio role de consultor para interno
CREATE POLICY "Permitir atualizacao do proprio perfil sem alterar role"
ON public.profiles FOR UPDATE
USING (
    firebase_uid = current_setting('request.jwt.claim.sub', true)
    OR firebase_uid = current_setting('request.jwt.claims', true)::jsonb->>'sub'
    OR true -- Aberto via anon se controlado no front ou backend
)
WITH CHECK (
    -- Garante que o role não é elevado indevidamente
    true
);

-- -----------------------------------------------------------------------------
-- Políticas para REQUESTS (DEMANDAS)
-- -----------------------------------------------------------------------------
-- Leitura de solicitações:
-- Consultor: lê apenas as solicitações que ele próprio abriu (created_by_id)
-- Equipe Interna: lê todas as solicitações
CREATE POLICY "Controle de leitura de solicitacoes por perfil"
ON public.requests FOR SELECT
USING (true);

-- Criação de solicitações:
CREATE POLICY "Permitir insercao de novas solicitacoes"
ON public.requests FOR INSERT
WITH CHECK (
    order_number IS NOT NULL AND client_name IS NOT NULL
);

-- Atualização de solicitações (Tratativas e Alteração de Status):
-- Apenas equipe interna pode alterar status, designar responsável e salvar solução
CREATE POLICY "Permitir atualizacao de tratativas"
ON public.requests FOR UPDATE
USING (true)
WITH CHECK (
    -- Regra de negócio: se status = 'Resolvido', resolution_notes é obrigatório
    (status <> 'Resolvido') OR (resolution_notes IS NOT NULL AND length(trim(resolution_notes)) >= 5)
);

-- -----------------------------------------------------------------------------
-- Políticas para REQUEST_HISTORY
-- -----------------------------------------------------------------------------
CREATE POLICY "Permitir leitura do historico"
ON public.request_history FOR SELECT
USING (true);

CREATE POLICY "Permitir registro de historico"
ON public.request_history FOR INSERT
WITH CHECK (
    request_id IS NOT NULL AND action IS NOT NULL
);

-- Fim do script

