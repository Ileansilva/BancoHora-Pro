import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/+esm';
import { CONFIG } from './config.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const APP_VERSION = '2.1.0';

let supabase = null;
let session = null;
let user = null;
let membership = null;
let company = null;
let employees = [];
let entries = [];
let members = [];
let realtimeChannel = null;
let refreshTimer = null;
let authRouting = false;

const ui = {
  setup: $('#setupView'),
  auth: $('#authView'),
  onboarding: $('#onboardingView'),
  app: $('#appView'),
  modalBg: $('#modalBackdrop'),
  modal: $('#modal'),
  toast: $('#toast'),
};

const isConfigured = () =>
  CONFIG.SUPABASE_URL &&
  !CONFIG.SUPABASE_URL.includes('SEU-PROJETO') &&
  CONFIG.SUPABASE_PUBLISHABLE_KEY &&
  !CONFIG.SUPABASE_PUBLISHABLE_KEY.includes('SUA_CHAVE');

function showOnly(view) {
  [ui.setup, ui.auth, ui.onboarding, ui.app].forEach((v) => v.classList.add('hidden'));
  view.classList.remove('hidden');
}

function toast(message, type = 'success', duration = 4200) {
  ui.toast.textContent = message;
  ui.toast.className = `toast ${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => ui.toast.classList.add('hidden'), duration);
}

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
  }[m]));
}

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || 'BH';
}

function fmt(min = 0) {
  const n = Number(min) || 0;
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  const a = Math.abs(n);
  return `${sign}${Math.floor(a / 60)}h ${String(a % 60).padStart(2, '0')}m`;
}

function bclass(n) {
  return n > 0 ? 'good' : n < 0 ? 'bad' : 'zero';
}

function roleLabel(role) {
  return ({ owner: 'Proprietário', admin: 'Administrador', operator: 'Responsável' })[role] || role;
}

function canManageEmployees() {
  return ['owner', 'admin'].includes(membership?.role);
}

function canDeleteEmployees() {
  return membership?.role === 'owner';
}

function canManageTime() {
  return ['owner', 'admin', 'operator'].includes(membership?.role);
}

function canEditTime() {
  return ['owner', 'admin'].includes(membership?.role);
}

function canManageCompany() {
  return ['owner', 'admin'].includes(membership?.role);
}

function setBusy(btn, busy, text = 'Processando...') {
  if (!btn) return;
  if (busy) {
    btn.dataset.old = btn.textContent;
    btn.disabled = true;
    btn.textContent = text;
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.old || btn.textContent;
  }
}

function normalizePhone(phone = '') {
  let digits = String(phone).replace(/\D/g, '');
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) digits = `55${digits}`;
  return digits;
}

function friendlyError(error) {
  const message = error?.message || String(error || 'Erro inesperado.');
  if (/duplicate key|unique constraint/i.test(message) && /registration/i.test(message)) {
    return 'Essa matrícula já está cadastrada nesta empresa.';
  }
  if (/row-level security|violates row-level security/i.test(message)) {
    return 'Seu usuário não tem permissão para executar esta ação.';
  }
  if (/Failed to fetch|NetworkError|network/i.test(message)) {
    return 'Falha de conexão. Verifique a internet e tente novamente.';
  }
  return message;
}

function openModal(html) {
  ui.modal.innerHTML = html;
  ui.modalBg.classList.remove('hidden');
  setTimeout(() => ui.modal.querySelector('input:not([type="hidden"]), select, textarea')?.focus(), 30);
}

function closeModal() {
  ui.modalBg.classList.add('hidden');
  ui.modal.innerHTML = '';
}
window.closeModal = closeModal;

ui.modalBg.addEventListener('click', (e) => {
  if (e.target === ui.modalBg) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !ui.modalBg.classList.contains('hidden')) closeModal();
});

window.addEventListener('error', (e) => {
  console.error('Erro global:', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('Promessa rejeitada:', e.reason);
});

if (!isConfigured()) showOnly(ui.setup);
else boot();

async function boot() {
  supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  supabase.auth.onAuthStateChange((event, newSession) => {
    session = newSession;
    user = newSession?.user || null;

    if (event === 'PASSWORD_RECOVERY') {
      openRecoveryModal();
      return;
    }

    if (!user) {
      stopRealtime();
      clearState();
      showOnly(ui.auth);
      return;
    }

    setTimeout(() => routeAfterAuth(), 0);
  });

  const { data, error } = await supabase.auth.getSession();
  if (error) toast(friendlyError(error), 'error');
  session = data?.session || null;
  user = session?.user || null;

  if (user) await routeAfterAuth();
  else showOnly(ui.auth);
}

function clearState() {
  membership = null;
  company = null;
  employees = [];
  entries = [];
  members = [];
}

async function routeAfterAuth() {
  if (authRouting || !user) return;
  authRouting = true;
  try {
    const { data: memberRows, error } = await supabase
      .from('company_members')
      .select('id,company_id,user_id,role,full_name,active,companies(id,name,cnpj,phone,address,logo_path,owner_user_id)')
      .eq('user_id', user.id)
      .eq('active', true)
      .limit(1);

    if (error) throw error;
    if (!memberRows?.length) {
      stopRealtime();
      showOnly(ui.onboarding);
      return;
    }

    membership = memberRows[0];
    company = Array.isArray(membership.companies) ? membership.companies[0] : membership.companies;
    if (!company?.id) throw new Error('Não foi possível identificar a empresa do usuário.');

    showOnly(ui.app);
    applyIdentity();
    await loadAll();
    startRealtime();
  } catch (error) {
    console.error(error);
    toast(friendlyError(error), 'error');
  } finally {
    authRouting = false;
  }
}

// AUTH
$$('.auth-tab').forEach((btn) => {
  btn.onclick = () => {
    $$('.auth-tab').forEach((x) => x.classList.toggle('active', x === btn));
    $$('.auth-form').forEach((x) => x.classList.remove('active-form'));
    $(`#${btn.dataset.authTab}Form`).classList.add('active-form');
  };
});

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  const d = Object.fromEntries(new FormData(e.target));
  setBusy(btn, true, 'Entrando...');
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: d.email.trim(), password: d.password });
    if (error) throw error;
  } catch (error) {
    toast(friendlyError(error), 'error');
  } finally {
    setBusy(btn, false);
  }
});

$('#signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  const d = Object.fromEntries(new FormData(e.target));
  setBusy(btn, true, 'Criando conta...');
  try {
    const { data, error } = await supabase.auth.signUp({
      email: d.email.trim(),
      password: d.password,
      options: {
        data: { full_name: d.full_name.trim() },
        emailRedirectTo: location.origin + location.pathname,
      },
    });
    if (error) throw error;
    toast(data.session ? 'Conta criada e autenticada.' : 'Conta criada. Confirme seu e-mail antes de entrar.');
    if (!data.session) $$('[data-auth-tab="login"]')[0].click();
  } catch (error) {
    toast(friendlyError(error), 'error');
  } finally {
    setBusy(btn, false);
  }
});

$('#forgotPasswordBtn').onclick = () => openModal(`
  <h3>Recuperar senha</h3>
  <form id="resetRequestForm" class="form-stack">
    <label>E-mail<input name="email" type="email" required></label>
    <div class="modal-actions">
      <button type="button" class="btn ghost" onclick="closeModal()">Cancelar</button>
      <button type="submit" class="btn primary">Enviar link</button>
    </div>
  </form>
`);

function openRecoveryModal() {
  openModal(`
    <h3>Definir nova senha</h3>
    <form id="recoveryForm" class="form-stack">
      <label>Nova senha<input name="password" type="password" minlength="8" required></label>
      <label>Confirmar senha<input name="confirm" type="password" minlength="8" required></label>
      <div class="modal-actions"><button type="submit" class="btn primary">Atualizar senha</button></div>
    </form>
  `);
}

$('#onboardingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  const d = Object.fromEntries(new FormData(e.target));
  setBusy(btn, true, 'Criando empresa...');
  try {
    const { data: c, error: companyError } = await supabase
      .from('companies')
      .insert({
        name: d.name.trim(),
        cnpj: d.cnpj?.trim() || null,
        phone: d.phone?.trim() || null,
        address: d.address?.trim() || null,
        owner_user_id: user.id,
      })
      .select()
      .single();
    if (companyError) throw companyError;

    const { error: memberError } = await supabase.from('company_members').insert({
      company_id: c.id,
      user_id: user.id,
      role: 'owner',
      full_name: user.user_metadata?.full_name || user.email,
    });
    if (memberError) throw memberError;

    toast('Empresa criada com sucesso.');
    await routeAfterAuth();
  } catch (error) {
    toast(friendlyError(error), 'error');
  } finally {
    setBusy(btn, false);
  }
});

$('#onboardingLogout').onclick = () => supabase.auth.signOut();
$('#logoutBtn').onclick = () => supabase.auth.signOut();

// IDENTIDADE E CARGA
function applyIdentity() {
  $('#sidebarCompanyName').textContent = company.name;
  $('#userName').textContent = membership.full_name || user.user_metadata?.full_name || user.email;
  $('#userRole').textContent = roleLabel(membership.role);
  $('#userAvatar').textContent = initials($('#userName').textContent);
  renderLogo();

  $('#newEmployeeBtn').style.display = canManageEmployees() ? '' : 'none';
  $('#inviteUserBtn').style.display = membership.role === 'owner' ? '' : 'none';

  const usersNav = $('[data-page="users"]');
  if (usersNav) usersNav.style.display = ['owner', 'admin'].includes(membership.role) ? '' : 'none';
}

function renderLogo() {
  const targets = [$('#companyLogoMini'), $('#companyLogoPreview')];
  if (company.logo_path) {
    const { data } = supabase.storage.from('company-logos').getPublicUrl(company.logo_path);
    targets.forEach((t) => {
      t.innerHTML = `<img src="${esc(data.publicUrl)}?v=${Date.now()}" alt="Logo">`;
    });
  } else {
    targets.forEach((t) => {
      t.innerHTML = '';
      t.textContent = initials(company.name);
    });
  }
}

async function loadAll() {
  if (!company?.id) return;
  const [employeeResult, memberResult] = await Promise.allSettled([
    loadEmployeesAndEntries(),
    loadMembers(),
  ]);

  const rejected = [employeeResult, memberResult].find((r) => r.status === 'rejected');
  if (rejected) throw rejected.reason;
  renderAll();
}

async function loadEmployeesAndEntries() {
  const [{ data: employeeData, error: employeeError }, { data: timeData, error: timeError }] = await Promise.all([
    supabase.from('employees').select('*').eq('company_id', company.id).order('full_name'),
    supabase.from('time_entries').select('*').eq('company_id', company.id).order('created_at', { ascending: false }),
  ]);

  if (employeeError) throw employeeError;
  if (timeError) throw timeError;

  entries = timeData || [];
  employees = (employeeData || []).map((emp) => ({
    ...emp,
    balance_minutes: entries
      .filter((x) => x.employee_id === emp.id)
      .reduce((sum, x) => sum + (x.entry_type === 'credit' ? x.minutes : -x.minutes), 0),
  }));
}

async function loadMembers() {
  const { data, error } = await supabase
    .from('company_members')
    .select('*')
    .eq('company_id', company.id)
    .order('created_at');
  if (error) throw error;
  members = data || [];
}

function renderAll() {
  renderDashboard();
  renderEmployees();
  renderReports();
  renderUsers();
  fillCompany();
}

function renderDashboard() {
  const active = employees.filter((e) => e.active);
  const pos = active.filter((e) => e.balance_minutes > 0).reduce((s, e) => s + e.balance_minutes, 0);
  const neg = active.filter((e) => e.balance_minutes < 0).reduce((s, e) => s + e.balance_minutes, 0);

  $('#kpiEmployees').textContent = active.length;
  $('#kpiPositive').textContent = fmt(pos);
  $('#kpiNegative').textContent = fmt(neg);
  $('#kpiNet').textContent = fmt(pos + neg);

  $('#featuredEmployees').innerHTML = active
    .slice()
    .sort((a, b) => Math.abs(b.balance_minutes) - Math.abs(a.balance_minutes))
    .slice(0, 5)
    .map((e) => `
      <div class="employee-row">
        <div><b>${esc(e.full_name)}</b><small>${esc(e.role_title || 'Sem cargo')} • ${esc(e.department || 'Sem setor')}</small></div>
        <div class="balance ${bclass(e.balance_minutes)}">${fmt(e.balance_minutes)}</div>
      </div>
    `).join('') || '<div class="muted">Cadastre o primeiro funcionário.</div>';

  $('#activityList').innerHTML = entries.slice(0, 6).map((x) => {
    const emp = employees.find((e) => e.id === x.employee_id);
    return `
      <div class="activity-row">
        <div class="activity-icon">${x.entry_type === 'credit' ? '+' : '−'}</div>
        <div class="activity-main"><b>${esc(emp?.full_name || 'Funcionário')}</b><small>${esc(x.reason)} • ${formatDate(x.occurred_on)}</small></div>
        <div class="balance ${x.entry_type === 'credit' ? 'good' : 'bad'}">${x.entry_type === 'credit' ? '+' : '-'}${fmt(x.minutes).replace(/[+-]/, '')}</div>
      </div>
    `;
  }).join('') || '<div class="muted">Nenhum lançamento realizado.</div>';
}

function renderEmployees() {
  const q = $('#searchEmployee').value.toLowerCase().trim();
  const balanceFilter = $('#filterBalance').value;
  const statusFilter = $('#filterStatus').value;

  let list = employees.filter((e) =>
    `${e.full_name} ${e.registration || ''} ${e.cpf || ''} ${e.role_title || ''} ${e.department || ''}`.toLowerCase().includes(q)
  );

  if (statusFilter !== 'all') list = list.filter((e) => statusFilter === 'active' ? e.active : !e.active);
  if (balanceFilter !== 'all') {
    list = list.filter((e) => balanceFilter === 'positive' ? e.balance_minutes > 0 : balanceFilter === 'negative' ? e.balance_minutes < 0 : e.balance_minutes === 0);
  }

  $('#employeeGrid').innerHTML = list.map((e) => `
    <article class="employee-card ${e.active ? '' : 'inactive'}">
      <div class="status-dot"></div>
      <div class="employee-top">
        <div class="emp-avatar">${initials(e.full_name)}</div>
        <div>
          <h4>${esc(e.full_name)}</h4>
          <p>Matrícula ${esc(e.registration || '-')} • ${esc(e.role_title || 'Sem cargo')}</p>
          <p>${esc(e.department || 'Sem setor')}${e.cpf ? ` • CPF ${esc(e.cpf)}` : ''}</p>
        </div>
      </div>
      <div class="employee-balance ${bclass(e.balance_minutes)}">${fmt(e.balance_minutes)}</div>
      <div class="employee-label">${e.balance_minutes > 0 ? 'Crédito do funcionário' : e.balance_minutes < 0 ? 'Horas a compensar' : 'Saldo zerado'}</div>
      <div class="employee-actions">
        ${canManageTime() && e.active ? `
          <button class="btn primary" onclick="openEntry('${e.id}','credit')">+ Adicionar</button>
          <button class="btn ghost" onclick="openEntry('${e.id}','debit')">− Descontar</button>
        ` : ''}
        <button class="btn ghost" onclick="openHistory('${e.id}')">Histórico</button>
        <button class="btn ghost" onclick="sendEmployeeWhatsApp('${e.id}')">WhatsApp</button>
        ${canManageEmployees() ? `
          <button class="btn ghost" onclick="openEditEmployee('${e.id}')">Editar</button>
          <button class="btn ${e.active ? 'danger' : 'ghost'}" onclick="toggleEmployee('${e.id}')">${e.active ? 'Inativar' : 'Reativar'}</button>
        ` : ''}
        ${canDeleteEmployees() ? `<button class="btn danger full-action" onclick="deleteEmployee('${e.id}')">Excluir definitivamente</button>` : ''}
      </div>
    </article>
  `).join('') || '<div class="panel muted">Nenhum funcionário encontrado.</div>';
}

$('#searchEmployee').oninput = renderEmployees;
$('#filterBalance').onchange = renderEmployees;
$('#filterStatus').onchange = renderEmployees;

$('#newEmployeeBtn').onclick = () => openEmployeeModal();

function openEmployeeModal(emp = null) {
  openModal(`
    <h3>${emp ? 'Editar funcionário' : 'Novo funcionário'}</h3>
    <form id="employeeForm" class="form-grid">
      <input type="hidden" name="id" value="${emp?.id || ''}">
      <label>Nome completo<input name="full_name" value="${esc(emp?.full_name || '')}" required maxlength="120"></label>
      <label>Matrícula<input name="registration" value="${esc(emp?.registration || '')}" required maxlength="50"></label>
      <label>CPF<input name="cpf" value="${esc(emp?.cpf || '')}" inputmode="numeric" maxlength="14" placeholder="000.000.000-00"></label>
      <label>Cargo<input name="role_title" value="${esc(emp?.role_title || '')}" maxlength="80"></label>
      <label>Setor<input name="department" value="${esc(emp?.department || '')}" maxlength="80"></label>
      <label>WhatsApp<input name="phone" value="${esc(emp?.phone || '')}" inputmode="tel" placeholder="(82) 99999-9999"></label>
      <label>E-mail<input name="email" type="email" value="${esc(emp?.email || '')}"></label>
      <label>Data de admissão<input name="admission_date" type="date" value="${emp?.admission_date || ''}"></label>
      ${emp ? '' : `
        <label>Saldo inicial — horas<input name="initial_hours" type="number" min="0" max="1666" step="1" value="0" inputmode="numeric"></label>
        <label>Saldo inicial — minutos<input name="initial_minutes" type="number" min="0" max="59" step="1" value="0" inputmode="numeric"></label>
        <label>Tipo do saldo inicial<select name="initial_type"><option value="credit">Positivo</option><option value="debit">Negativo</option></select></label>
      `}
      <div class="modal-actions full">
        <button type="button" class="btn ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn primary">Salvar funcionário</button>
      </div>
    </form>
  `);
}

window.openEditEmployee = (id) => openEmployeeModal(employees.find((e) => e.id === id));

window.toggleEmployee = async (id) => {
  const emp = employees.find((x) => x.id === id);
  if (!emp || !canManageEmployees()) return;
  if (!confirm(`${emp.active ? 'Inativar' : 'Reativar'} ${emp.full_name}?`)) return;

  try {
    const { error } = await supabase.from('employees').update({ active: !emp.active }).eq('id', id).eq('company_id', company.id);
    if (error) throw error;
    await loadAll();
    toast(`Funcionário ${emp.active ? 'inativado' : 'reativado'}.`);
  } catch (error) {
    toast(friendlyError(error), 'error');
  }
};

window.deleteEmployee = async (id) => {
  const emp = employees.find((x) => x.id === id);
  if (!emp || !canDeleteEmployees()) return;
  const ok = confirm(`Excluir DEFINITIVAMENTE ${emp.full_name}?\n\nIsso também apagará todos os lançamentos de horas desse funcionário. Se você só quer afastá-lo, use Inativar.`);
  if (!ok) return;

  try {
    const { error } = await supabase.from('employees').delete().eq('id', id).eq('company_id', company.id);
    if (error) throw error;
    await loadAll();
    toast('Funcionário excluído definitivamente.');
  } catch (error) {
    toast(friendlyError(error), 'error');
  }
};

window.openEntry = (id, type) => {
  const emp = employees.find((x) => x.id === id);
  if (!emp || !canManageTime()) return;
  openModal(`
    <h3>${type === 'credit' ? 'Adicionar horas' : 'Descontar horas'} — ${esc(emp.full_name)}</h3>
    <form id="entryForm" class="form-grid">
      <input type="hidden" name="employee_id" value="${id}">
      <input type="hidden" name="entry_type" value="${type}">
      <label>Horas<input name="hours" type="number" min="0" max="1666" step="1" value="1" inputmode="numeric"></label>
      <label>Minutos<input name="minutes" type="number" min="0" max="59" step="1" value="0" inputmode="numeric"></label>
      <label>Data<input name="occurred_on" type="date" value="${todayLocal()}" required></label>
      <label>Motivo<input name="reason" value="${type === 'credit' ? 'Hora extra' : 'Compensação'}" required maxlength="120"></label>
      <label class="full">Observação<textarea name="notes" rows="3" maxlength="500"></textarea></label>
      <div class="modal-actions full">
        <button type="button" class="btn ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn primary">Confirmar lançamento</button>
      </div>
    </form>
  `);
};

window.openHistory = (id) => {
  const emp = employees.find((e) => e.id === id);
  if (!emp) return;
  const hist = entries.filter((x) => x.employee_id === id);
  openModal(`
    <h3>Histórico — ${esc(emp.full_name)}</h3>
    <div class="balance ${bclass(emp.balance_minutes)} history-balance">${fmt(emp.balance_minutes)}</div>
    <div class="history-list">
      ${hist.map((x) => `
        <div class="history-item">
          <div class="history-line">
            <div>
              <b class="${x.entry_type === 'credit' ? 'good' : 'bad'}">${x.entry_type === 'credit' ? '+' : '-'}${fmt(x.minutes).replace(/[+-]/, '')} • ${esc(x.reason)}</b>
              <small>${formatDate(x.occurred_on)} • ${esc(x.notes || 'Sem observação')}</small>
            </div>
            ${canEditTime() ? `<div class="entry-actions"><button class="btn ghost" type="button" onclick="openEditEntry('${x.id}')">Editar</button><button class="btn danger" type="button" onclick="deleteEntry('${x.id}')">Excluir</button></div>` : ''}
          </div>
        </div>
      `).join('') || '<div class="muted">Sem lançamentos.</div>'}
    </div>
    <div class="modal-actions"><button type="button" class="btn ghost" onclick="closeModal()">Fechar</button></div>
  `);
};

window.openEditEntry = (id) => {
  const item = entries.find((x) => x.id === id);
  if (!item || !canEditTime()) return;
  const h = Math.floor(item.minutes / 60);
  const m = item.minutes % 60;
  openModal(`
    <h3>Editar lançamento</h3>
    <form id="editEntryForm" class="form-grid">
      <input type="hidden" name="id" value="${item.id}">
      <label>Tipo<select name="entry_type"><option value="credit" ${item.entry_type === 'credit' ? 'selected' : ''}>Crédito</option><option value="debit" ${item.entry_type === 'debit' ? 'selected' : ''}>Débito</option></select></label>
      <label>Data<input name="occurred_on" type="date" value="${item.occurred_on}" required></label>
      <label>Horas<input name="hours" type="number" min="0" max="1666" step="1" value="${h}"></label>
      <label>Minutos<input name="minutes" type="number" min="0" max="59" step="1" value="${m}"></label>
      <label class="full">Motivo<input name="reason" value="${esc(item.reason)}" required maxlength="120"></label>
      <label class="full">Observação<textarea name="notes" rows="3" maxlength="500">${esc(item.notes || '')}</textarea></label>
      <div class="modal-actions full">
        <button type="button" class="btn ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn primary">Salvar alteração</button>
      </div>
    </form>
  `);
};

window.deleteEntry = async (id) => {
  const item = entries.find((x) => x.id === id);
  if (!item || !canEditTime()) return;
  if (!confirm('Excluir este lançamento de horas? O saldo do funcionário será recalculado automaticamente.')) return;

  try {
    const employeeId = item.employee_id;
    const { error } = await supabase.from('time_entries').delete().eq('id', id).eq('company_id', company.id);
    if (error) throw error;
    await loadAll();
    toast('Lançamento excluído.');
    window.openHistory(employeeId);
  } catch (error) {
    toast(friendlyError(error), 'error');
  }
};

window.sendEmployeeWhatsApp = (id) => {
  const emp = employees.find((x) => x.id === id);
  if (!emp) return;
  const phone = normalizePhone(emp.phone);
  const situation = emp.balance_minutes > 0 ? 'saldo positivo' : emp.balance_minutes < 0 ? 'saldo negativo / horas a compensar' : 'saldo zerado';
  const msg = `Olá, ${emp.full_name}. Seu ${situation} no banco de horas da ${company.name} é ${fmt(emp.balance_minutes)}. Atualizado em ${new Date().toLocaleDateString('pt-BR')}.`;
  if (!phone) return toast('Cadastre o WhatsApp do funcionário.', 'error');
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
};

$('#sendAllBtn').onclick = () => {
  const active = employees.filter((e) => e.active);
  if (!active.length) return toast('Cadastre ao menos um funcionário.', 'error');
  const lines = active.map((e) => `• ${e.full_name}: ${fmt(e.balance_minutes)}`).join('\n');
  const msg = `Resumo do banco de horas — ${company.name}\n\n${lines}\n\nAtualizado em ${new Date().toLocaleDateString('pt-BR')}.`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
};

// RELATÓRIOS
function renderReports() {
  const sectors = [...new Set(employees.map((e) => e.department).filter(Boolean))].sort();
  const old = $('#reportSector').value;
  $('#reportSector').innerHTML = '<option value="all">Todos</option>' + sectors.map((s) => `<option>${esc(s)}</option>`).join('');
  if (sectors.includes(old)) $('#reportSector').value = old;
  updateReport();
}

function updateReport() {
  const start = $('#reportStart').value;
  const end = $('#reportEnd').value;
  const sector = $('#reportSector').value;
  const balanceFilter = $('#reportBalance').value;

  let list = employees.filter((e) => e.active);
  if (sector !== 'all') list = list.filter((e) => e.department === sector);
  if (balanceFilter !== 'all') {
    list = list.filter((e) => balanceFilter === 'positive' ? e.balance_minutes > 0 : balanceFilter === 'negative' ? e.balance_minutes < 0 : e.balance_minutes === 0);
  }

  const visibleEmployeeIds = new Set(list.map((e) => e.id));
  const periodEntries = entries.filter((x) =>
    visibleEmployeeIds.has(x.employee_id) &&
    (!start || x.occurred_on >= start) &&
    (!end || x.occurred_on <= end)
  );

  const credit = periodEntries.filter((x) => x.entry_type === 'credit').reduce((s, x) => s + x.minutes, 0);
  const debit = periodEntries.filter((x) => x.entry_type === 'debit').reduce((s, x) => s + x.minutes, 0);

  $('#reportSummary').innerHTML = `
    <div class="mini-kpi"><span>Créditos no período</span><strong class="good">${fmt(credit)}</strong></div>
    <div class="mini-kpi"><span>Débitos no período</span><strong class="bad">-${fmt(debit).replace(/[+-]/, '')}</strong></div>
    <div class="mini-kpi"><span>Movimento líquido</span><strong class="${bclass(credit - debit)}">${fmt(credit - debit)}</strong></div>
  `;

  $('#reportTableWrap').innerHTML = `
    <table class="report-table">
      <thead><tr><th>Funcionário</th><th>Matrícula</th><th>Setor</th><th>Créditos período</th><th>Débitos período</th><th>Saldo atual</th></tr></thead>
      <tbody>
        ${list.map((e) => {
          const pe = periodEntries.filter((x) => x.employee_id === e.id);
          const pc = pe.filter((x) => x.entry_type === 'credit').reduce((s, x) => s + x.minutes, 0);
          const pd = pe.filter((x) => x.entry_type === 'debit').reduce((s, x) => s + x.minutes, 0);
          return `<tr><td>${esc(e.full_name)}</td><td>${esc(e.registration)}</td><td>${esc(e.department || '-')}</td><td class="good">${fmt(pc)}</td><td class="bad">-${fmt(pd).replace(/[+-]/, '')}</td><td class="${bclass(e.balance_minutes)}">${fmt(e.balance_minutes)}</td></tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

['reportStart', 'reportEnd', 'reportSector', 'reportBalance'].forEach((id) => $(`#${id}`).onchange = updateReport);
$('#printReportBtn').onclick = () => window.print();

// USUÁRIOS
function renderUsers() {
  $('#usersList').innerHTML = members.map((m) => `
    <div class="user-row">
      <div><b>${esc(m.full_name || 'Usuário')}</b><small>${m.user_id === user.id ? 'Seu acesso' : 'Usuário convidado'} • ${m.active ? 'Ativo' : 'Inativo'}</small></div>
      <span class="role-pill">${roleLabel(m.role)}</span>
    </div>
  `).join('') || '<div class="muted">Nenhum usuário.</div>';
}

$('#inviteUserBtn').onclick = () => openModal(`
  <h3>Convidar usuário</h3>
  <form id="inviteForm" class="form-grid">
    <label>Nome<input name="full_name" required maxlength="120"></label>
    <label>E-mail<input name="email" type="email" required></label>
    <label>Perfil<select name="role"><option value="operator">Responsável pelas horas</option><option value="admin">Administrador</option></select></label>
    <div class="modal-actions full">
      <button type="button" class="btn ghost" onclick="closeModal()">Cancelar</button>
      <button type="submit" class="btn primary">Enviar convite</button>
    </div>
  </form>
`);

// EMPRESA
function fillCompany() {
  $('#companyName').value = company.name || '';
  $('#companyCnpj').value = company.cnpj || '';
  $('#companyPhone').value = company.phone || '';
  $('#companyAddress').value = company.address || '';
  $('#companyForm').querySelector('button').disabled = !canManageCompany();
  $('#companyLogoInput').disabled = !canManageCompany();
}

$('#companyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!canManageCompany()) return;
  const btn = e.submitter;
  setBusy(btn, true, 'Salvando...');
  try {
    const payload = {
      name: $('#companyName').value.trim(),
      cnpj: $('#companyCnpj').value.trim() || null,
      phone: $('#companyPhone').value.trim() || null,
      address: $('#companyAddress').value.trim() || null,
    };
    const { data, error } = await supabase.from('companies').update(payload).eq('id', company.id).select().single();
    if (error) throw error;
    company = { ...company, ...data };
    applyIdentity();
    toast('Empresa atualizada.');
  } catch (error) {
    toast(friendlyError(error), 'error');
  } finally {
    setBusy(btn, false);
  }
});

$('#companyLogoInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file || !canManageCompany()) return;
  if (file.size > 2 * 1024 * 1024) return toast('A logo deve ter no máximo 2 MB.', 'error');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast('Use uma imagem PNG, JPG ou WEBP.', 'error');

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${company.id}/logo.${ext}`;
  toast('Enviando logo...');

  try {
    const { error } = await supabase.storage.from('company-logos').upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw error;
    const { data, error: updateError } = await supabase.from('companies').update({ logo_path: path }).eq('id', company.id).select().single();
    if (updateError) throw updateError;
    company = { ...company, ...data };
    renderLogo();
    toast('Logo atualizada.');
  } catch (error) {
    toast(friendlyError(error), 'error');
  } finally {
    e.target.value = '';
  }
});

// FORMULÁRIOS DINÂMICOS — um único roteador evita handlers duplicados
const dynamicForms = new Set(['resetRequestForm', 'recoveryForm', 'employeeForm', 'entryForm', 'editEntryForm', 'inviteForm']);
document.addEventListener('submit', async (e) => {
  if (!dynamicForms.has(e.target.id)) return;
  e.preventDefault();

  const form = e.target;
  const btn = e.submitter || form.querySelector('button[type="submit"]');
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  try {
    switch (form.id) {
      case 'resetRequestForm':
        await handleResetRequest(form, btn);
        break;
      case 'recoveryForm':
        await handleRecovery(form, btn);
        break;
      case 'employeeForm':
        await handleEmployeeForm(form, btn);
        break;
      case 'entryForm':
        await handleEntryForm(form, btn);
        break;
      case 'editEntryForm':
        await handleEditEntryForm(form, btn);
        break;
      case 'inviteForm':
        await handleInviteForm(form, btn);
        break;
    }
  } catch (error) {
    console.error(error);
    toast(friendlyError(error), 'error');
    setBusy(btn, false);
  }
});

async function handleResetRequest(form, btn) {
  const { email } = Object.fromEntries(new FormData(form));
  setBusy(btn, true, 'Enviando...');
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname });
    if (error) throw error;
    closeModal();
    toast('Link de recuperação enviado.');
  } finally {
    setBusy(btn, false);
  }
}

async function handleRecovery(form, btn) {
  const d = Object.fromEntries(new FormData(form));
  if (d.password !== d.confirm) return toast('As senhas não coincidem.', 'error');
  setBusy(btn, true, 'Atualizando...');
  try {
    const { error } = await supabase.auth.updateUser({ password: d.password });
    if (error) throw error;
    closeModal();
    toast('Senha atualizada.');
  } finally {
    setBusy(btn, false);
  }
}

async function handleEmployeeForm(form, btn) {
  if (!company?.id || !canManageEmployees()) throw new Error('Seu usuário não pode cadastrar funcionários.');
  const d = Object.fromEntries(new FormData(form));
  const fullName = d.full_name.trim();
  const registration = d.registration.trim();
  if (!fullName || !registration) throw new Error('Informe o nome e a matrícula.');

  setBusy(btn, true, 'Salvando...');
  try {
    const common = {
      company_id: company.id,
      full_name: fullName,
      registration,
      cpf: d.cpf?.trim() || null,
      role_title: d.role_title?.trim() || null,
      department: d.department?.trim() || null,
      phone: d.phone?.trim() || null,
      email: d.email?.trim() || null,
      admission_date: d.admission_date || null,
    };

    if (d.id) {
      const { error } = await supabase.from('employees').update(common).eq('id', d.id).eq('company_id', company.id);
      if (error) throw error;
    } else {
      const hours = Number(d.initial_hours || 0);
      const minutes = Number(d.initial_minutes || 0);
      if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || minutes < 0 || minutes > 59) {
        throw new Error('Informe o saldo inicial em horas inteiras e minutos de 0 a 59.');
      }
      const initialMinutes = hours * 60 + minutes;

      const { error } = await supabase.rpc('create_employee_with_initial_balance', {
        p_company_id: company.id,
        p_full_name: fullName,
        p_registration: registration,
        p_cpf: common.cpf,
        p_role_title: common.role_title,
        p_department: common.department,
        p_phone: common.phone,
        p_email: common.email,
        p_admission_date: common.admission_date,
        p_initial_minutes: initialMinutes,
        p_initial_type: d.initial_type || 'credit',
      });
      if (error) throw error;
    }

    closeModal();
    await loadAll();
    goPage('employees');
    toast('Funcionário salvo e lista atualizada.');
  } finally {
    setBusy(btn, false);
  }
}

async function handleEntryForm(form, btn) {
  if (!canManageTime()) throw new Error('Seu usuário não pode lançar horas.');
  const d = Object.fromEntries(new FormData(form));
  const mins = Number(d.hours || 0) * 60 + Number(d.minutes || 0);
  if (!Number.isInteger(mins) || mins <= 0) throw new Error('Informe pelo menos 1 minuto.');

  setBusy(btn, true, 'Registrando...');
  try {
    const { error } = await supabase.from('time_entries').insert({
      company_id: company.id,
      employee_id: d.employee_id,
      entry_type: d.entry_type,
      minutes: mins,
      occurred_on: d.occurred_on,
      reason: d.reason.trim(),
      notes: d.notes?.trim() || null,
      created_by: user.id,
    });
    if (error) throw error;

    closeModal();
    await loadAll();
    toast('Lançamento registrado e saldo atualizado.');
  } finally {
    setBusy(btn, false);
  }
}

async function handleEditEntryForm(form, btn) {
  if (!canEditTime()) throw new Error('Seu usuário não pode editar lançamentos.');
  const d = Object.fromEntries(new FormData(form));
  const mins = Number(d.hours || 0) * 60 + Number(d.minutes || 0);
  if (!Number.isInteger(mins) || mins <= 0) throw new Error('Informe pelo menos 1 minuto.');

  setBusy(btn, true, 'Salvando...');
  try {
    const { error } = await supabase.from('time_entries').update({
      entry_type: d.entry_type,
      minutes: mins,
      occurred_on: d.occurred_on,
      reason: d.reason.trim(),
      notes: d.notes?.trim() || null,
    }).eq('id', d.id).eq('company_id', company.id);
    if (error) throw error;

    closeModal();
    await loadAll();
    toast('Lançamento atualizado e saldo recalculado.');
  } finally {
    setBusy(btn, false);
  }
}

async function handleInviteForm(form, btn) {
  if (membership?.role !== 'owner') throw new Error('Somente o proprietário pode convidar usuários.');
  const d = Object.fromEntries(new FormData(form));
  setBusy(btn, true, 'Enviando convite...');
  try {
    const { data, error } = await supabase.functions.invoke('invite-company-user', {
      body: {
        companyId: company.id,
        email: d.email.trim(),
        fullName: d.full_name.trim(),
        role: d.role,
      },
    });
    if (error || data?.error) throw new Error(data?.error || error.message);
    closeModal();
    await loadMembers();
    renderUsers();
    toast('Convite enviado por e-mail.');
  } finally {
    setBusy(btn, false);
  }
}

// NAVEGAÇÃO
$$('.nav-item').forEach((btn) => btn.onclick = () => goPage(btn.dataset.page));
$$('[data-goto]').forEach((btn) => btn.onclick = () => goPage(btn.dataset.goto));

function goPage(id) {
  $$('.nav-item').forEach((x) => x.classList.toggle('active', x.dataset.page === id));
  $$('.page').forEach((x) => x.classList.toggle('active-page', x.id === id));
  $('#pageTitle').textContent = ({ dashboard: 'Visão geral', employees: 'Funcionários', reports: 'Relatórios', users: 'Usuários', company: 'Empresa' })[id] || 'BancoHora Pro';
  if (id === 'reports') renderReports();
}
window.goPage = goPage;

$('#refreshBtn')?.addEventListener('click', async () => {
  const btn = $('#refreshBtn');
  setBusy(btn, true, 'Atualizando...');
  try {
    await loadAll();
    toast('Dados atualizados.');
  } catch (error) {
    toast(friendlyError(error), 'error');
  } finally {
    setBusy(btn, false);
  }
});

// REALTIME: se outro responsável alterar dados, a tela é atualizada automaticamente.
function startRealtime() {
  stopRealtime();
  if (!company?.id) return;

  realtimeChannel = supabase
    .channel(`bancohora:${company.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'employees', filter: `company_id=eq.${company.id}` }, scheduleRealtimeRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries', filter: `company_id=eq.${company.id}` }, scheduleRealtimeRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'company_members', filter: `company_id=eq.${company.id}` }, scheduleRealtimeRefresh)
    .subscribe();
}

function stopRealtime() {
  if (realtimeChannel && supabase) supabase.removeChannel(realtimeChannel);
  realtimeChannel = null;
}

function scheduleRealtimeRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      await loadAll();
    } catch (error) {
      console.error('Falha ao sincronizar em tempo real:', error);
    }
  }, 250);
}

function todayLocal() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function formatDate(date) {
  if (!date) return '-';
  return new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR');
}

console.info(`BancoHora Pro ${APP_VERSION} carregado.`);
