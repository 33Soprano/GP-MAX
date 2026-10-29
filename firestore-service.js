/**
 * =============================================================================
 * FIRESTORE — PERFIS DE USUÁRIO (fonte única para auth e role)
 * Arquivo: firestore-service.js
 *
 * Roles: consultor | erp | logistica | admin
 * =============================================================================
 */

function initFirestore() {
    if (!window.gpFirestore && window.firebase && window.firebase.firestore) {
        window.gpFirestore = firebase.firestore();
    }
    return window.gpFirestore;
}

async function fsGetProfile(uid) {
    const db = initFirestore();
    if (!db) return null;
    try {
        const snap = await db.collection("users").doc(uid).get();
        if (!snap.exists) return null;
        return { id: snap.id, ...snap.data() };
    } catch (err) {
        console.error("[Firestore] Erro ao buscar perfil:", err);
        return null;
    }
}

async function fsCreateProfile({ uid, email, name, department = "Vendas" }) {
    const db = initFirestore();
    if (!db) return null;
    try {
        const data = {
            firebase_uid: uid,
            email,
            name,
            role: "consultor",
            department,
            avatar: (name || "GP").substring(0, 2).toUpperCase(),
            pending_approval: false,
            created_at: firebase.firestore.FieldValue.serverTimestamp()
        };
        await db.collection("users").doc(uid).set(data);
        return { id: uid, ...data };
    } catch (err) {
        console.error("[Firestore] Erro ao criar perfil:", err);
        return null;
    }
}

async function fsUpdateOwnProfile(uid, updates) {
    const db = initFirestore();
    if (!db) return null;
    delete updates.role;
    try {
        await db.collection("users").doc(uid).update(updates);
        return await fsGetProfile(uid);
    } catch (err) {
        console.error("[Firestore] Erro ao atualizar perfil:", err);
        return null;
    }
}

async function fsGetInternalUsers() {
    const db = initFirestore();
    if (!db) return [];
    try {
        const [erpSnap, logSnap, admSnap] = await Promise.all([
            db.collection("users").where("role", "==", "erp").get(),
            db.collection("users").where("role", "==", "logistica").get(),
            db.collection("users").where("role", "==", "admin").get()
        ]);
        return [
            ...erpSnap.docs.map(d => ({ firebase_uid: d.id, id: d.id, ...d.data() })),
            ...logSnap.docs.map(d => ({ firebase_uid: d.id, id: d.id, ...d.data() })),
            ...admSnap.docs.map(d => ({ firebase_uid: d.id, id: d.id, ...d.data() }))
        ].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } catch (err) {
        console.error("[Firestore] Erro ao listar internos:", err);
        return [];
    }
}

async function fsGetAllConsultants() {
    const db = initFirestore();
    if (!db) return [];
    try {
        const snap = await db.collection("users").where("role", "==", "consultor").get();
        return snap.docs
            .map(d => ({ firebase_uid: d.id, id: d.id, ...d.data() }))
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } catch (err) {
        console.error("[Firestore] Erro ao listar consultores:", err);
        return [];
    }
}

async function fsGetAllUsers() {
    const db = initFirestore();
    if (!db) return [];
    try {
        const snap = await db.collection("users").get();
        return snap.docs
            .map(d => ({ firebase_uid: d.id, id: d.id, ...d.data() }))
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } catch (err) {
        console.error("[Firestore] Erro ao listar usuários:", err);
        return [];
    }
}

async function fsUpdateUserRole(uid, newRole) {
    const db = initFirestore();
    if (!db) return null;

    const validRoles = ["consultor", "erp", "logistica", "admin"];
    if (!validRoles.includes(newRole)) {
        console.error("[Firestore] Papel inválido:", newRole);
        return null;
    }

    try {
        await db.collection("users").doc(uid).update({ role: newRole });
        return await fsGetProfile(uid);
    } catch (err) {
        console.error("[Firestore] Erro ao atualizar papel:", err);
        return null;
    }
}