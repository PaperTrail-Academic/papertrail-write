const { createClient } = supabase;
// Publishable key — safe to be public, security enforced via RLS
const SUPABASE_URL = 'https://papertrail-write.supabase.co';
const SUPABASE_ANON = 'sb_publishable_NZYgi5bfsdWaFaNZ44JSeQ_HNhw2bVp';
const db = createClient(SUPABASE_URL, SUPABASE_ANON);
const STATE = {
  teacher: null, teacherProfile: null,
  submissionId: null, sessionId: null, assignmentId: null, assignmentTitle: null,
  assignmentPromptText: null, assignmentPromptType: 'essay', assignmentAllowSpellcheck: false,
  timeLimitSeconds: 0, studentName: null, period: null, startedAt: null,
  timerInterval: null, autosaveInterval: null, processLog: [], isSubmitted: false,
  firstKeystrokeLogged: false, _blurStartTime: null,
  lastInputTime: null, lastTextLength: 0, lastWordCount: 0,
  _visibilityHandler: null, _blurHandler: null, _focusHandler: null, _beforeUnloadHandler: null,
  selectedAssignmentId: null, allSubmissions: [], expandedSubId: null,
  _expandedAssignments: new Set(),
  selectedSessionId: null,
  _archiveOpen: false,
  _newAssignmentOpen: true,
  _joinCodeValidated: false,
  realtimeChannel: null,
  _realtimePollInterval: null,
  pauseCountdownInterval: null,
  frozenRemaining: null,
  _sessionPollInterval: null,
  _lastKnownSessionExtra: null,
  studentPaused: false,
  isPreview: false,
  editingAssignmentId: null,
  selectedPromptType: 'essay',
  idleLogged: false,
  _pendingResume: null,
  // Sources
  formSources: [],         // [{id, label, type, text_content, storage_path, storage_url, _file, _uploading}] in teacher form
  studentSources: [],      // Loaded at join time for student rendering
};

// ── JOIN CODE PROJECTOR — opens in new window ──
function projectJoinCode(code, title) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Join Code — ${code}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #1a2235; color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    min-height: 100vh; padding: 2rem;
    overflow: hidden;
  }
  .title {
    font-size: clamp(0.9rem, 2.5vw, 1.4rem);
    font-weight: 500; color: rgba(255,255,255,0.45);
    margin-bottom: 1.5rem; letter-spacing: 0.04em;
    text-align: center;
  }
  .code {
    font-family: 'SF Mono', 'Fira Mono', 'Consolas', 'Menlo', monospace;
    font-weight: 600; color: #fff;
    letter-spacing: 0.06em; line-height: 1;
    text-align: center; white-space: nowrap;
    width: 100%;
  }
  .hint {
    margin-top: 2.5rem;
    font-size: clamp(0.75rem, 1.6vw, 1rem);
    color: rgba(255,255,255,0.28);
    letter-spacing: 0.03em; text-align: center;
  }
  .hint strong { color: rgba(255,255,255,0.45); }
</style>
</head>
<body>
  <div class="title">${title.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
  <div class="code" id="code">${code}</div>
  <div class="hint">Students go to <strong>write.papertrailacademic.com</strong> and enter this code</div>
  <script>
    function fitCode() {
      const el = document.getElementById('code');
      const chars = el.textContent.length || 1;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Monospace chars are ~0.6x the font size wide, plus letter-spacing of 0.06em
      // So each char takes ~0.66 * fontSize px. Solve for fontSize:
      // chars * 0.66 * fontSize = vw * 0.88 → fontSize = vw * 0.88 / (chars * 0.66)
      let size = Math.floor(vw * 0.88 / (chars * 0.66));
      // Also cap at 55% of viewport height so it doesn't overflow vertically
      size = Math.min(size, Math.floor(vh * 0.55));
      el.style.fontSize = size + 'px';
    }
    fitCode();
    window.addEventListener('resize', fitCode);
  <\/script>
</body>
</html>`;
  const w = window.open('', '_blank', 'width=1024,height=768');
  if (!w) { toast('Pop-up blocked — please allow pop-ups for this site', 'warning', 5000); return; }
  w.document.write(html);
  w.document.close();
}

// ── BOOT ──
async function boot() {
  const hash = window.location.hash;
  const params = new URLSearchParams(window.location.search);

  // Handle password recovery / invite links
  if (hash.includes('type=recovery') || hash.includes('type=invite')) {
    const { data, error } = await db.auth.getSessionFromUrl();
    window.history.replaceState(null, '', window.location.pathname);
    if (!error && data?.session) { showScreen('new-password'); return; }
    showScreen('teacher-login'); return;
  }

  // Handle Google OAuth PKCE callback (?code=...)
  if (params.get('code')) {
    // Supabase JS v2 exchanges the code automatically via getSession()
    // Clean the URL first so a refresh doesn't re-trigger
    window.history.replaceState(null, '', window.location.pathname);
  }

  const { data: { session } } = await db.auth.getSession();
  if (session) {
    STATE.teacher = session.user;
    // Ensure teacher profile row exists (first Google sign-in won't have one yet)
    await ensureTeacherProfile(session.user);
    await loadDashboard();
    showScreen('dashboard');
    return;
  }
  showScreen('landing');
}

db.auth.onAuthStateChange(async (event, session) => {
  if (event === 'PASSWORD_RECOVERY') { showScreen('new-password'); }
  // Google OAuth redirect lands here as SIGNED_IN after the code exchange
  if (event === 'SIGNED_IN' && session && !STATE.teacher) {
    STATE.teacher = session.user;
    await ensureTeacherProfile(session.user);
    await loadDashboard();
    showScreen('dashboard');
  }
});

// ── SCREEN ROUTER ──
// ── TOOLTIPS ──
function showHelpPopover(btn) {
  // Toggle — close if already open
  if (document.querySelector('.pt-help-popover')) {
    document.querySelector('.pt-help-popover').remove();
    return;
  }
  const popover = document.createElement('div');
  popover.className = 'pt-help-popover';
  popover.innerHTML = `
    <div class="pt-help-title">PaperTrail Write — Help</div>
    <div class="pt-help-body">New to PaperTrail Write? The tutorial video walks through creating a class, opening a session, and reading the process log.</div>
    <a href="https://youtu.be/Ev3NKk-BX_g" target="_blank" rel="noopener" class="pt-help-video-link">▶ Watch tutorial video</a>
  `;
  document.body.appendChild(popover);
  const rect = btn.getBoundingClientRect();
  popover.style.position = 'fixed';
  popover.style.top = (rect.bottom + 8) + 'px';
  popover.style.right = (window.innerWidth - rect.right) + 'px';
  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!popover.contains(e.target) && e.target !== btn) {
        popover.remove();
        document.removeEventListener('click', handler);
      }
    });
  }, 0);
}
function showTooltip(btn, text) {
  // Close any open tooltip first
  document.querySelectorAll('.pt-tooltip-popover').forEach(el => el.remove());
  const popover = document.createElement('div');
  popover.className = 'pt-tooltip-popover';
  popover.textContent = text;
  document.body.appendChild(popover);
  const rect = btn.getBoundingClientRect();
  const scrollY = window.scrollY || 0;
  const scrollX = window.scrollX || 0;
  // Position below the button, clamped to viewport
  let top = rect.bottom + scrollY + 6;
  let left = rect.left + scrollX;
  popover.style.position = 'absolute';
  popover.style.top = top + 'px';
  popover.style.left = left + 'px';
  // After paint, clamp right edge
  requestAnimationFrame(() => {
    const pw = popover.offsetWidth;
    const vw = window.innerWidth;
    if (left + pw > vw - 12) {
      popover.style.left = Math.max(8, vw - pw - 12) + 'px';
    }
  });
  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!popover.contains(e.target) && e.target !== btn) {
        popover.remove();
        document.removeEventListener('click', handler);
      }
    });
  }, 0);
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const t = document.getElementById('screen-' + name);
  if (t) t.classList.add('active');
  // Reset student login state when returning to that screen
  if (name === 'student-login') {
    STATE._joinCodeValidated = false;
    const nameSection = document.getElementById('s-name-section');
    const nameGroup = document.getElementById('s-name-group');
    const statusEl = document.getElementById('s-status');
    if (nameSection) nameSection.style.display = 'none';
    if (nameGroup) nameGroup.innerHTML = `<label>Your Name</label><input class="form-input" id="s-name" type="text" placeholder="e.g. Jordan M." autocomplete="off">`;
    if (statusEl) { statusEl.className = 'status-msg'; statusEl.textContent = ''; }
    const btn = document.getElementById('s-login-btn');
    if (btn) btn.textContent = 'Continue →';
    const code = document.getElementById('s-password');
    if (code) code.value = '';
  }
}

// ── TOAST ──
function toast(msg, type = 'default', ms = 3000) {
  const icons = { success: '✓', error: '✕', warning: '⚠', default: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]||'ℹ'}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.style.transition='opacity 300ms'; el.style.opacity='0'; setTimeout(()=>el.remove(),300); }, ms);
}

// ── MODAL ──
function openModal(html) { document.getElementById('modal-box').innerHTML=html; document.getElementById('modal-overlay').classList.add('visible'); }
function closeModal() { document.getElementById('modal-overlay').classList.remove('visible'); }
document.getElementById('modal-overlay').addEventListener('click', e => { if(e.target===e.currentTarget) closeModal(); });
document.addEventListener('keydown', e => { if(e.key==='Escape') closeModal(); });

// ── HELPERS ──
function countWords(t) { return t.trim() ? t.trim().split(/\s+/).length : 0; }
// Compact join code generator — used only by doOpenSession at session-open time
const _JC_A=['AMBER','AZURE','BOLD','BRAVE','BRIGHT','CALM','CEDAR','CLEAR','CORAL','CRISP','DAWN','DEEP','EAGLE','EARLY','EMBER','FAIR','FALCON','FIELD','FLEET','FROST','GOLD','GRAND','GROVE','HAWK','IRON','JADE','KEEN','LANCE','LIGHT','MAPLE','NOBLE','NORTH','OAK','OCEAN','PEAK','PINE','PRIME','PROUD','RAPID','RAVEN','REEF','RIDGE','RIVER','ROYAL','SAGE','SHARP','SILVER','SLATE','SOLAR','SPARK','SPRING','STEEL','STORM','SWIFT','TIMBER','TRUE','VALOR','VIVID','WARM','WILD','WISE'];
const _JC_N=['ARROW','ATLAS','BEACON','BLADE','BLOOM','BOLT','BROOK','CAPE','CLIFF','COMET','COVE','CRANE','CREEK','CREST','DART','DELTA','DOVE','DRUM','DUNE','FAWN','FERN','FINCH','FLARE','FLINT','FORGE','FORT','GLEN','HELM','HERON','HILL','HULL','ISLE','KEEL','LARK','LEDGE','LENS','LOCH','LOFT','LYNX','MAST','MESA','MILL','MIST','MOON','MOOR','MOOSE','MOUNT','REEF','RIDGE','SPARK','TERN'];
function _mkCode(){return _JC_A[Math.floor(Math.random()*_JC_A.length)]+_JC_N[Math.floor(Math.random()*_JC_N.length)];}

// Returns true if the action is blocked (limit reached), false if allowed.
// Shows appropriate toast/modal on block.
async function checkPlanLimit(resource, teacherId) {
  try {
    // Get the session token — try getSession first, fall back to getUser
    const { data: sessionData } = await db.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      console.warn('checkPlanLimit: no access token found, failing open');
      return false;
    }
    const resp = await fetch(
      `${SUPABASE_URL}/functions/v1/check-plan-limits`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': SUPABASE_ANON,
        },
        body: JSON.stringify({ resource, teacher_id: teacherId }),
      }
    );
    const result = await resp.json();
    if (result.ok) return false;
    const msg = result.message || 'Plan limit reached.';
    openUpgradeModal(msg);
    return true;
  } catch(err) {
    console.warn('check-plan-limits unreachable, failing open:', err.message);
    return false;
  }
}
function openUpgradeModal(msg) {
  const defaultMsg = "You've reached the limit of the free trial (3 sessions).";
  openModal(`
    <div class="modal-header">
      <h3>Upgrade to PaperTrail Write Pro</h3>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <p style="color:var(--pt-muted);margin-bottom:var(--space-md)">${esc(msg||defaultMsg)}</p>
      <div style="background:var(--pt-write-pale);border:1.5px solid rgba(123,94,167,0.2);border-radius:var(--radius-md);padding:var(--space-md) var(--space-lg);margin-bottom:var(--space-md)">
        <div style="display:flex;align-items:baseline;gap:0.4rem;margin-bottom:var(--space-sm)">
          <span style="font-size:1.75rem;font-weight:700;color:var(--pt-write)">$49</span>
          <span style="color:var(--pt-muted);font-size:var(--text-sm)">/year</span>
        </div>
        <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:0.4rem">
          <li style="font-size:var(--text-sm);color:var(--pt-ink)">✓ &nbsp;Unlimited sessions</li>
          <li style="font-size:var(--text-sm);color:var(--pt-ink)">✓ &nbsp;All assignment types (Essay, Document-Based, Source-Based)</li>
          <li style="font-size:var(--text-sm);color:var(--pt-ink)">✓ &nbsp;Class rosters &amp; time accommodations</li>
          <li style="font-size:var(--text-sm);color:var(--pt-ink)">✓ &nbsp;Live session monitoring &amp; ZIP export</li>
          <li style="font-size:var(--text-sm);color:var(--pt-ink)">✓ &nbsp;Google Drive source materials</li>
        </ul>
      </div>
      <p style="font-size:var(--text-xs);color:var(--pt-muted)">Billed annually. Cancel anytime. Secure checkout via Lemon Squeezy.</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Not now</button>
      <a href="https://papertrailacademic.lemonsqueezy.com/checkout/buy/e38d85aa-ca1b-4a9d-afe7-73e4bb80ef2f" target="_blank" class="btn btn-primary" onclick="closeModal()" style="text-decoration:none">Upgrade to Pro →</a>
    </div>`);
}

function elapsedSeconds() { if(!STATE.startedAt) return 0; return Math.floor((Date.now()-new Date(STATE.startedAt).getTime())/1000); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function formatTime(iso) { if(!iso) return '—'; try { return new Date(iso).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); } catch { return iso; } }
function formatElapsed(secs) { if(secs==null) return '—'; const m=Math.floor(secs/60),s=secs%60; return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }

// ── ENSURE TEACHER PROFILE (Google OAuth first sign-in) ──
// Creates a teachers row if one doesn't exist yet.
// For email/password sign-up, Supabase triggers insert the row via DB hook.
// For Google OAuth, we do it here on first boot.
async function ensureTeacherProfile(user) {
  try {
    const { data } = await db.from('teachers').select('id').eq('id', user.id).maybeSingle();
    if (!data) {
      // First Google sign-in — create the profile row
      const displayName = user.user_metadata?.full_name || user.user_metadata?.name || null;
      await db.from('teachers').insert({ id: user.id, display_name: displayName });
    }
  } catch(err) {
    console.warn('ensureTeacherProfile error (non-fatal):', err.message);
  }
}

// ── TEACHER SIGN UP ──
async function teacherSignUp() {
  const name=document.getElementById('su-name').value.trim();
  const school=document.getElementById('su-school').value.trim();
  const email=document.getElementById('su-email').value.trim();
  const pw=document.getElementById('su-password').value;
  const status=document.getElementById('su-status');
  const btn=document.getElementById('su-btn');
  status.className='status-msg';
  if(!email||!pw){status.className='status-msg error';status.textContent='Email and password are required.';return;}
  if(pw.length<8){status.className='status-msg error';status.textContent='Password must be at least 8 characters.';return;}
  btn.disabled=true; btn.textContent='Creating account…';
  status.className='status-msg'; status.textContent='Creating your account — this may take a moment…';
  try {
    const {data,error} = await db.auth.signUp({email,password:pw});
    if(error) throw error;
    if(data.user) {
      await db.from('teachers').update({display_name:name||null,school_name:school||null}).eq('id',data.user.id);
    }
    status.className='status-msg'; status.textContent='';
    document.getElementById('confirm-email-display').textContent=email;
    showScreen('check-email');
  } catch(err) {
    status.className='status-msg error';
    status.textContent=err.message||'Sign up failed.';
  } finally { btn.disabled=false; btn.textContent='Create account →'; }
}

// ── TEACHER SIGN IN ──
async function teacherLogin() {
  const email=document.getElementById('t-email').value.trim();
  const pw=document.getElementById('t-password').value;
  const status=document.getElementById('t-status');
  const btn=document.getElementById('t-login-btn');
  status.className='status-msg';
  if(!email||!pw){status.className='status-msg error';status.textContent='Please enter your email and password.';return;}
  btn.disabled=true; btn.textContent='Signing in…';
  try {
    const {data,error}=await db.auth.signInWithPassword({email,password:pw});
    if(error) throw error;
    STATE.teacher=data.user;
    document.getElementById('t-password').value='';
    status.className='status-msg';
    await loadDashboard();
    showScreen('dashboard');
  } catch(err) {
    status.className='status-msg error';
    status.textContent=err.message==='Invalid login credentials'?'Incorrect email or password.':err.message||'Sign in failed.';
  } finally { btn.disabled=false; btn.textContent='Sign in →'; }
}

// ── TEACHER SIGN OUT ──
async function teacherLogout() {
  await db.auth.signOut();
  STATE.teacher=null; STATE.selectedAssignmentId=null; STATE.allSubmissions=[];
  showScreen('landing'); toast('Signed out','default',2000);
}

// ── ACCOUNT MENU ──
function toggleAccountMenu(btn) {
  const dropdown = document.getElementById('account-menu-dropdown');
  if (!dropdown) return;
  if (dropdown.style.display !== 'none') {
    dropdown.style.display = 'none';
    return;
  }
  const plan = STATE._teacherPlan || 'trial';
  const name = STATE._teacherDisplayName || '';
  // Fix: fall back to STATE.teacher.email if _teacherEmail not yet set (race on slow connections)
  const email = STATE._teacherEmail || STATE.teacher?.email || '';
  const planLabel = plan === 'pro' ? 'Pro' : plan === 'school' ? 'School' : 'Trial';
  const lsPortalUrl = 'https://papertrailacademic.lemonsqueezy.com/billing';
  dropdown.innerHTML = `
    <div class="account-dropdown-header">
      ${name ? `<div class="account-dropdown-name">${esc(name)}</div>` : ''}
      <div class="account-dropdown-email">${esc(email)}</div>
      <span class="account-plan-badge ${plan}">${planLabel}</span>
    </div>
    ${plan !== 'trial' ? `
      <a class="account-dropdown-item" href="${lsPortalUrl}" target="_blank" rel="noopener" onclick="closeAccountMenu()">Manage subscription →</a>
      <div class="account-dropdown-divider"></div>
    ` : `
      <button class="account-dropdown-item" onclick="closeAccountMenu();openUpgradeModal('Upgrade to unlock unlimited sessions and classes.')">Upgrade to Pro</button>
      <div class="account-dropdown-divider"></div>
    `}
    <button class="account-dropdown-item" onclick="closeAccountMenu();teacherLogout()">Sign out</button>
    <button class="account-dropdown-item danger" onclick="closeAccountMenu();showDeleteAccountModal()">Delete account…</button>
  `;
  dropdown.style.display = 'block';
  // Fix: use { once: true } so listener never accumulates across multiple opens
  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!dropdown.contains(e.target) && e.target !== btn) {
        dropdown.style.display = 'none';
      }
    }, { once: true });
  }, 0);
}
function closeAccountMenu() {
  const dropdown = document.getElementById('account-menu-dropdown');
  if (dropdown) dropdown.style.display = 'none';
}

function showDeleteAccountModal() {
  // Fix 5: warn if active/paused sessions exist
  const activeSessions = Object.values(STATE._lastSessions || {}).filter(s =>
    s && (s.status === 'active' || s.status === 'paused')
  );
  const sessionWarning = activeSessions.length > 0
    ? `<div style="background:#fef2f2;border:1.5px solid #fca5a5;border-radius:var(--radius-sm);padding:0.65rem 0.85rem;margin-bottom:var(--space-md);font-size:var(--text-sm);color:#991b1b">
        <strong>⚠ You have ${activeSessions.length} active or paused session${activeSessions.length > 1 ? 's' : ''}.</strong>
        Students may currently be writing. End all sessions before deleting your account.
       </div>`
    : '';
  // Fix 8: only show subscription copy for paid plans
  const plan = STATE._teacherPlan || 'trial';
  const subWarning = plan !== 'trial'
    ? `<p style="margin-bottom:var(--space-md);font-size:var(--text-sm);color:var(--pt-muted)">Cancel your Pro subscription first via <a href="https://papertrailacademic.lemonsqueezy.com/billing" target="_blank" rel="noopener" style="color:var(--pt-write)">Manage subscription</a> to avoid future charges.</p>`
    : '';
  openModal(`
    <div class="modal-header">
      <h3 style="color:var(--danger)">Delete account</h3>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      ${sessionWarning}
      <p style="margin-bottom:var(--space-sm)">This will permanently delete your account and all associated data — assignments, classes, and sessions. This cannot be undone.</p>
      ${subWarning}
      <div class="form-group">
        <label style="font-size:var(--text-sm)">Type <strong>DELETE</strong> to confirm</label>
        <input class="form-input" id="delete-confirm-input" type="text" placeholder="DELETE" autocomplete="off"
          oninput="document.getElementById('delete-account-btn').disabled = this.value !== 'DELETE'">
      </div>
      <div id="delete-account-status" class="status-msg"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" id="delete-account-btn" disabled onclick="doDeleteAccount()">Delete my account</button>
    </div>
  `);
  setTimeout(() => document.getElementById('delete-confirm-input')?.focus(), 50);
}

async function doDeleteAccount() {
  const btn = document.getElementById('delete-account-btn');
  const statusEl = document.getElementById('delete-account-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
  if (statusEl) { statusEl.className = 'status-msg'; statusEl.textContent = ''; }
  try {
    const { data: sessionData } = await db.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Not authenticated');
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON,
      },
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Delete failed');
    closeModal();
    await db.auth.signOut();
    STATE.teacher = null;
    showScreen('landing');
    toast('Account deleted. Sorry to see you go.', 'default', 5000);
  } catch(err) {
    if (statusEl) { statusEl.className = 'status-msg error'; statusEl.textContent = err.message; }
    if (btn) { btn.disabled = false; btn.textContent = 'Delete my account'; }
  }
}


// ── GOOGLE OAUTH SIGN IN ──
async function signInWithGoogle() {
  try {
    const { error } = await db.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        scopes: 'openid email profile',
      }
    });
    if (error) throw error;
    // Supabase redirects the browser — no further action needed here
  } catch(err) {
    toast(err.message || 'Google sign-in failed.', 'error', 4000);
  }
}

// ── GOOGLE DRIVE PICKER ──

// Returns true if the signed-in teacher authenticated via Google OAuth
function isGoogleUser() {
  if (!STATE.teacher) return false;
  const identities = STATE.teacher.identities || [];
  return identities.some(i => i.provider === 'google');
}

// Returns the Google OAuth access token from the current Supabase session
async function getGoogleAccessToken() {
  const { data } = await db.auth.getSession();
  return data?.session?.provider_token || null;
}

// Load gapi picker library once, then open picker for the given source index
let _gapiPickerReady = false;

function _loadGapiPicker(callback) {
  if (_gapiPickerReady) { callback(); return; }
  if (typeof gapi === 'undefined') {
    toast('Google API not loaded yet — try again in a moment.', 'warning');
    return;
  }
  gapi.load('picker', () => { _gapiPickerReady = true; callback(); });
}

// Triggers incremental Google OAuth to add drive.file scope
async function requestDriveScope() {
  try {
    const { error } = await db.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        scopes: 'openid email profile https://www.googleapis.com/auth/drive.file',
        queryParams: { access_type: 'offline', prompt: 'consent' },
      }
    });
    if (error) throw error;
    // Browser will redirect — user returns with Drive token in session
  } catch(err) {
    toast(err.message || 'Could not request Drive access.', 'error', 4000);
  }
}

// Returns true if the current session's provider_token has drive scope
// We verify by checking sessionStorage flag set after a successful Drive auth
async function hasDriveScope() {
  if (sessionStorage.getItem('pt_drive_granted') === '1') return true;
  // Try a lightweight Drive API call to verify scope
  const token = await getGoogleAccessToken();
  if (!token) return false;
  try {
    const resp = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (resp.ok) {
      sessionStorage.setItem('pt_drive_granted', '1');
      return true;
    }
  } catch(e) {}
  return false;
}

async function openDrivePicker(idx) {
  const token = await getGoogleAccessToken();
  if (!token || !(await hasDriveScope())) {
    // No Drive scope yet — trigger incremental auth
    if (confirm('PaperTrail Write needs access to your Google Drive to import files.\n\nClick OK to grant access — you\'ll be redirected to Google and brought right back.')) {
      await requestDriveScope();
    }
    return;
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });

  _loadGapiPicker(() => {
    const mimeFilter = [
      'application/pdf',
      'image/jpeg','image/png','image/webp','image/gif',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.google-apps.document',
    ].join(',');

    // My Drive tab — files owned by the user
    const myDriveView = new google.picker.DocsView()
      .setLabel('My Drive')
      .setOwnedByMe(true)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setMode(google.picker.DocsViewMode.LIST)
      .setMimeTypes(mimeFilter);

    // Shared with me tab — files shared by others
    const sharedView = new google.picker.DocsView()
      .setLabel('Shared with me')
      .setOwnedByMe(false)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setMode(google.picker.DocsViewMode.LIST)
      .setMimeTypes(mimeFilter);

    // Shared drives tab — must be separate, cannot combine with setOwnedByMe or setParent
    const sharedDrivesView = new google.picker.DocsView()
      .setLabel('Shared drives')
      .setEnableDrives(true)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setMode(google.picker.DocsViewMode.LIST)
      .setMimeTypes(mimeFilter);

    const picker = new google.picker.PickerBuilder()
      .addView(myDriveView)
      .addView(sharedView)
      .addView(sharedDrivesView)
      .setOAuthToken(token)
      .setOrigin(window.location.origin)
      .setAppId('18964593029')
      .setDeveloperKey('AIzaSyCUPSZI633zWMh_4EdZ9Ih7_MnDxvtBNis')
      .setCallback((data) => _onDriveFilePicked(idx, data, token))
      .build();

    picker.setVisible(true);
  });
}

async function _onDriveFilePicked(idx, data, token) {
  if (data.action !== google.picker.Action.PICKED) return;
  const doc = data.docs[0];
  if (!doc) return;

  // Guard: folders and shortcuts are not downloadable
  const nonDownloadable = [
    'application/vnd.google-apps.folder',
    'application/vnd.google-apps.shortcut',
  ];
  if (nonDownloadable.includes(doc.mimeType)) {
    toast('Please select a file, not a folder.', 'warning', 3000);
    return;
  }

  const name = doc.name || doc.id;
  toast(`Downloading "${name}" from Drive…`, 'default', 3000);

  // Google Workspace native types that need export, not alt=media
  const exportMap = {
    'application/vnd.google-apps.document':
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.google-apps.spreadsheet':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.google-apps.presentation':
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };

  try {
    let url, contentType, fileName;
    const exportMime = exportMap[doc.mimeType];

    if (exportMime) {
      // Google Workspace file — export as Office format
      url = `https://www.googleapis.com/drive/v3/files/${doc.id}/export?mimeType=${encodeURIComponent(exportMime)}&supportsAllDrives=true`;
      contentType = exportMime;
      const ext = exportMime.includes('wordprocessing') ? '.docx'
                : exportMime.includes('spreadsheet') ? '.xlsx'
                : '.pptx';
      fileName = name.endsWith(ext) ? name : name + ext;
    } else {
      // Native file (PDF, image, DOCX etc) — download directly
      url = `https://www.googleapis.com/drive/v3/files/${doc.id}?alt=media&supportsAllDrives=true`;
      contentType = doc.mimeType;
      fileName = name;
    }

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) throw new Error(`Drive download failed (${resp.status})`);

    const blob = await resp.blob();
    const file = new File([blob], fileName, { type: contentType });

    handleSourceFileSelect(idx, file);
  } catch(err) {
    toast(`Drive import failed: ${err.message}`, 'error', 5000);
  }
}

// ── PASSWORD RESET ──
async function requestReset() {
  const email=document.getElementById('reset-email').value.trim();
  const status=document.getElementById('reset-status');
  const btn=document.getElementById('reset-btn');
  status.className='status-msg';
  if(!email){status.className='status-msg error';status.textContent='Please enter your email address.';return;}
  btn.disabled=true; btn.textContent='Sending…';
  try {
    const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin});
    if(error) throw error;
    status.className='status-msg success'; status.textContent='Reset link sent — check your email.';
  } catch(err) {
    status.className='status-msg error'; status.textContent=err.message||'Failed to send reset link.';
  } finally { btn.disabled=false; btn.textContent='Send reset link →'; }
}

// ── SET NEW PASSWORD ──
async function setNewPassword() {
  const pw=document.getElementById('new-password').value;
  const confirm=document.getElementById('new-password-confirm').value;
  const status=document.getElementById('newpw-status');
  const btn=document.getElementById('newpw-btn');
  status.className='status-msg';
  if(!pw||!confirm){status.className='status-msg error';status.textContent='Please enter and confirm your new password.';return;}
  if(pw.length<8){status.className='status-msg error';status.textContent='Password must be at least 8 characters.';return;}
  if(pw!==confirm){status.className='status-msg error';status.textContent='Passwords do not match.';return;}
  btn.disabled=true; btn.textContent='Saving…';
  try {
    const {error}=await db.auth.updateUser({password:pw});
    if(error) throw error;
    toast('Password updated — please sign in.','success',4000);
    showScreen('teacher-login');
  } catch(err) {
    status.className='status-msg error'; status.textContent=err.message||'Failed to set password.';
  } finally { btn.disabled=false; btn.textContent='Set password →'; }
}

// ── STUDENT LOGIN ──

// Reset name section when join code is edited
function onJoinCodeInput() {
  const nameSection = document.getElementById('s-name-section');
  const nameGroup = document.getElementById('s-name-group');
  const statusEl = document.getElementById('s-status');
  // Reset back to text input if user changes the code
  nameGroup.innerHTML = `<label>Your Name</label>
    <input class="form-input" id="s-name" type="text" placeholder="e.g. Jordan M." autocomplete="off">`;
  nameSection.style.display = 'none';
  statusEl.className = 'status-msg';
  statusEl.textContent = '';
  STATE._joinCodeValidated = false;
}

// Two-step: first press validates code + reveals name field; second press submits
async function studentLoginStep() {
  const joinCode = document.getElementById('s-password')?.value.trim().toUpperCase();
  const statusEl = document.getElementById('s-status');
  const btn = document.getElementById('s-login-btn');
  const nameSection = document.getElementById('s-name-section');

  // Step 1 — validate code and reveal name field
  if (!STATE._joinCodeValidated) {
    if (!joinCode || joinCode.length < 3) {
      statusEl.className = 'status-msg error';
      statusEl.textContent = 'Please enter a join code.';
      return;
    }
    btn.disabled = true; btn.textContent = 'Checking…';
    statusEl.className = 'status-msg'; statusEl.textContent = '';
    try {
      // Validate code
      const {data:sessions, error:sErr} = await db.from('sessions').select('id, assignment_id').eq('join_code', joinCode).eq('status', 'active');
      if (sErr) throw sErr;
      if (!sessions?.length) {
        statusEl.className = 'status-msg error';
        statusEl.textContent = 'No active session found with that join code. Ask your teacher to check.';
        btn.disabled = false; btn.textContent = 'Continue →';
        return;
      }

      // Fetch roster using the session's class_id (not the assignment's)
      await prefetchRosterForCode(sessions[0].id);

      nameSection.style.display = 'block';
      STATE._joinCodeValidated = true;
      btn.disabled = false;
      btn.textContent = 'Join Session →';
      setTimeout(() => document.getElementById('s-name')?.focus(), 50);
    } catch(err) {
      statusEl.className = 'status-msg error';
      statusEl.textContent = 'Something went wrong: ' + err.message;
      btn.disabled = false; btn.textContent = 'Continue →';
    }
    return;
  }

  // Step 2 — submit with name
  studentLogin();
}

// Fetches roster for a known sessionId and swaps name field to dropdown if available
async function prefetchRosterForCode(sessionId) {
  const nameGroup = document.getElementById('s-name-group');
  if (!nameGroup) return;
  try {
    const {data:sess} = await db.from('sessions').select('class_id').eq('id', sessionId).single();
    if (!sess?.class_id) return;

    const {data:cls} = await db.from('classes').select('student_roster').eq('id', sess.class_id).single();
    const roster = cls?.student_roster || [];
    if (!roster.length) return;

    const names = roster.map(s => typeof s === 'string' ? s : s.name).filter(Boolean).sort();
    if (!names.length) return;

    nameGroup.innerHTML = `<label>Your Name</label>
      <select class="form-input form-select" id="s-name">
        <option value="">— Select your name —</option>
        ${names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}
      </select>
      <div class="form-hint">Don't see your name? Ask your teacher.</div>`;
  } catch(e) {
    console.warn('prefetchRoster failed:', e.message);
    // Silently fail — student can still type their name
  }
}


async function studentLogin() {
  const name=document.getElementById('s-name').value.trim();
  const period=document.getElementById('s-period').value.trim();
  const joinCode=document.getElementById('s-password').value.trim().toUpperCase();
  const statusEl=document.getElementById('s-status');
  const btn=document.getElementById('s-login-btn');
  statusEl.className='status-msg';
  if(!name||!joinCode){statusEl.className='status-msg error';statusEl.textContent='Please enter both a join code and your name.';return;}
  btn.disabled=true; btn.textContent='Checking…';
  try {
    // Look up active session by join code
    const {data:sessions,error:sessErr}=await db.from('sessions').select('*').eq('join_code',joinCode).in('status',['active','paused']);
    if(sessErr) throw sessErr;
    if(!sessions||!sessions.length){statusEl.className='status-msg error';statusEl.textContent='No active session found with that join code. Ask your teacher to check.';return;}
    const session=sessions[0];

    // Fetch assignment + class roster in parallel
    // Class comes from the SESSION (not the assignment) so each run can use a different class
    const [{data:assignment,error:aErr},{data:classRow}] = await Promise.all([
      db.from('assignments').select('*').eq('id',session.assignment_id).single(),
      session.class_id
        ? db.from('classes').select('student_roster').eq('id',session.class_id).single()
        : Promise.resolve({data: null}),
    ]);
    if(aErr) throw aErr;

    // Compute effective time limit — base + any accommodation for this student
    const baseMins = assignment.time_limit_minutes || 0;
    let effectiveMins = baseMins;
    if (baseMins && classRow?.student_roster?.length) {
      const entry = classRow.student_roster.find(s => {
        const entryName = typeof s === 'string' ? s : s.name;
        return entryName.toLowerCase() === name.toLowerCase();
      });
      if (entry && typeof entry === 'object' && entry.extended_minutes) {
        effectiveMins = baseMins + entry.extended_minutes;
      }
    }
    // Also add any global extra time the teacher has already granted this session
    const sessionExtraMins = session.extra_minutes || 0;
    const effectiveSeconds = (effectiveMins + sessionExtraMins) * 60;

    // Check for existing submission in this session
    const {data:existing,error:sErr}=await db.from('submissions').select('*').eq('session_id',session.id).eq('student_display_name',name).maybeSingle();
    if(sErr) throw sErr;
    STATE.sessionId=session.id;
    if(existing) {
      if(existing.is_submitted){loadSubmittedScreen(existing);showScreen('submitted');return;}

      // Collision check — if this submission has content or was started >60s ago,
      // it may belong to a different student with the same name. Warn before resuming.
      const ageSeconds = Math.floor((Date.now() - new Date(existing.started_at).getTime()) / 1000);
      const hasContent = (existing.essay_text||'').length > 0 || (existing.word_count||0) > 0;
      if (hasContent || ageSeconds > 60) {
        // Store everything needed to resume if they confirm identity
        STATE._pendingResume = { existing, assignment, effectiveSeconds, name, period, session };
        statusEl.className = 'status-msg warning';
        statusEl.innerHTML = `<strong>Someone is already writing under this name.</strong><br>
          If that's you on another device, tap <em>Continue as ${esc(name)}</em>.<br>
          If you're a different student, please go back and use a slightly different name (e.g. "${esc(name)} 2").`;
        btn.textContent = `Continue as ${esc(name)} →`;
        btn.disabled = false;
        btn.onclick = () => resumeAfterCollisionConfirm();
        return;
      }

      // No collision risk — resume normally
      applyResumeState(existing, assignment, effectiveSeconds, name, period);
    } else {
      const {data:newSub,error:nErr}=await db.from('submissions').insert({
        session_id:session.id,
        assignment_id:assignment.id,
        teacher_id:assignment.teacher_id,
        student_display_name:name,class_period:period,
        essay_text:'',word_count:0,process_log:[],is_submitted:false,
      }).select().single();
      if(nErr) throw nErr;
      STATE.submissionId=newSub.id; STATE.assignmentId=assignment.id;
      STATE.assignmentTitle=assignment.title; STATE.timeLimitSeconds=effectiveSeconds;
      STATE.assignmentPromptText=assignment.prompt_text||'';
      STATE.assignmentPromptType=assignment.prompt_type||'essay';
      STATE.assignmentAllowSpellcheck=assignment.allow_spellcheck||false;
      STATE.studentName=name; STATE.period=period;
      // Use the DB-returned started_at as the authoritative timestamp — avoids client clock skew
      STATE.startedAt=newSub.started_at||newSub.created_at;
      STATE.processLog=[]; STATE.isSubmitted=false;
    }
    // Load sources for this assignment
    await loadSources(assignment.id);
    showScreen('transparency');
  } catch(err) {
    statusEl.className='status-msg error'; statusEl.textContent='Something went wrong: '+err.message;
  } finally { btn.disabled=false; btn.textContent='Continue →'; }
}

// Applies a resume-from-existing-submission state to STATE (shared by normal resume and collision-confirmed resume)
function applyResumeState(existing, assignment, effectiveSeconds, name, period) {
  STATE.submissionId=existing.id; STATE.assignmentId=assignment.id;
  STATE.assignmentTitle=assignment.title;
  STATE.timeLimitSeconds = effectiveSeconds + ((existing.extra_minutes||0) * 60);
  STATE.assignmentPromptText=assignment.prompt_text||'';
  STATE.assignmentPromptType=assignment.prompt_type||'essay';
  STATE.assignmentAllowSpellcheck=assignment.allow_spellcheck||false;
  STATE.studentName=name; STATE.period=period; STATE.startedAt=existing.started_at;
  STATE.processLog=existing.process_log||[]; STATE.isSubmitted=false;
  STATE._resumeText=existing.essay_text||'';
}

// Called when student confirms they are the same person despite the collision warning
async function resumeAfterCollisionConfirm() {
  const p = STATE._pendingResume;
  if (!p) return;
  STATE._pendingResume = null;
  const statusEl = document.getElementById('s-status');
  const btn = document.getElementById('s-login-btn');
  btn.disabled = true; btn.textContent = 'Loading…';
  // Restore normal onclick
  btn.onclick = () => studentLoginStep();
  try {
    applyResumeState(p.existing, p.assignment, p.effectiveSeconds, p.name, p.period);
    STATE.sessionId = p.session.id;
    await loadSources(p.assignment.id);
    showScreen('transparency');
  } catch(err) {
    if(statusEl){statusEl.className='status-msg error';statusEl.textContent='Something went wrong: '+err.message;}
  } finally { btn.disabled=false; btn.textContent='Continue →'; }
}

function beginWriting() {
  enterWritingMode(STATE._resumeText||'');
  STATE._resumeText = null;
  if (STATE.sessionId && !STATE.isPreview) {
    subscribeToSessionPause();
    subscribeToSubmissionTime();
  }
}

// ── WRITING MODE ──
function enterWritingMode(savedText) {
  document.getElementById('writing-title').textContent=STATE.assignmentTitle;
  document.getElementById('writing-student').textContent=STATE.period?`${STATE.studentName} · ${STATE.period}`:STATE.studentName;

  // Render prompt panel
  const promptText = STATE.assignmentPromptText;
  const promptPanel = document.getElementById('prompt-panel');
  if (promptText && promptText.trim()) {
    const typeLabels = {essay:'Assignment Prompt', document_based:'Document-Based Prompt', source_analysis:'Source-Based Prompt'};
    document.getElementById('prompt-type-label').textContent = typeLabels[STATE.assignmentPromptType] || 'Assignment Prompt';
    document.getElementById('prompt-body').textContent = promptText;
    promptPanel.style.display = 'block';
  } else {
    promptPanel.style.display = 'none';
  }

  STATE.lastTextLength=(savedText||'').length; STATE.firstKeystrokeLogged=false;
  updateWordCountDisplay(); showScreen('writing');

  // Render source panel — may replace/restructure the DOM around the textarea
  renderSourcePanel();

  // Re-acquire editor reference after potential DOM restructure by renderSourcePanel
  const editor = document.getElementById('essay-textarea');
  if (!editor) return;
  editor.value = savedText || '';
  editor.disabled = false;
  const sc2 = STATE.isPreview ? false : (STATE.assignmentAllowSpellcheck || false);
  editor.spellcheck = sc2;
  editor.setAttribute('autocorrect', sc2 ? 'on' : 'off');
  editor.setAttribute('autocapitalize', sc2 ? 'sentences' : 'off');
  editor.setAttribute('autocomplete', sc2 ? 'on' : 'off');
  editor.setAttribute('data-gramm', sc2 ? 'true' : 'false');
  editor.setAttribute('data-gramm_editor', sc2 ? 'true' : 'false');
  editor.setAttribute('data-enable-grammarly', sc2 ? 'true' : 'false');
  STATE.lastTextLength = (savedText||'').length;

  if (STATE.isPreview) {
    document.getElementById('timer-display').textContent = STATE.timeLimitSeconds ? formatElapsed(STATE.timeLimitSeconds) : '∞';
    document.getElementById('submit-btn').disabled = true;
    document.getElementById('submit-btn').title = 'Preview mode — submit disabled';
    editor.disabled = true;
    editor.placeholder = '(Preview mode — student will write here)';
    return;
  }

  const remaining=STATE.timeLimitSeconds ? STATE.timeLimitSeconds-elapsedSeconds() : Infinity;
  if(STATE.timeLimitSeconds && remaining<=0){autoSubmit('Time had already elapsed. Your essay has been submitted automatically.');return;}
  if(STATE.timeLimitSeconds) startTimer();
  else document.getElementById('timer-display').textContent = '∞';
  STATE.autosaveInterval=setInterval(autosave,30000);
  setInterval(checkBurstAndIdle,3000);
  // Realtime fallback: poll session status every 30s in case Realtime drops on student side
  STATE._lastKnownSessionExtra = null;
  if (STATE.sessionId && !STATE.isPreview) STATE._sessionPollInterval = setInterval(pollSessionStatus, 30000);
  attachProcessListeners(editor);
  STATE._visibilityHandler=()=>{
    if(document.hidden){STATE._blurStartTime=Date.now();logEventImmediate('window_blur',{content_preview:'Window left focus'});}
    else if(STATE._blurStartTime){const s=Math.round((Date.now()-STATE._blurStartTime)/1000);logEventImmediate('window_focus',{char_count:s,content_preview:`Window returned — ${s}s away`});STATE._blurStartTime=null;STATE._lastFocusReturnTime=Date.now();}
  };
  document.addEventListener('visibilitychange',STATE._visibilityHandler);
  STATE._blurHandler=()=>{if(!document.hidden){STATE._blurStartTime=Date.now();logEventImmediate('window_blur',{content_preview:'Window left focus'});}};
  STATE._focusHandler=()=>{if(STATE._blurStartTime){const s=Math.round((Date.now()-STATE._blurStartTime)/1000);logEventImmediate('window_focus',{char_count:s,content_preview:`Window returned — ${s}s away`});STATE._blurStartTime=null;STATE._lastFocusReturnTime=Date.now();}};
  window.addEventListener('blur',STATE._blurHandler);
  window.addEventListener('focus',STATE._focusHandler);

  // Warn student if they try to close/navigate away without submitting
  STATE._beforeUnloadHandler = (e) => {
    e.preventDefault();
    e.returnValue = 'Your essay has been saved, but you have not submitted. Leave anyway?';
  };
  window.addEventListener('beforeunload', STATE._beforeUnloadHandler);

  setTimeout(()=>{const ta=document.getElementById('essay-textarea');if(ta)ta.focus();},100);
}

function togglePromptPanel() {
  const body=document.getElementById('prompt-body');
  const toggle=document.getElementById('prompt-toggle');
  const chevron=document.getElementById('prompt-chevron');
  const isOpen=body.classList.contains('open');
  body.classList.toggle('open',!isOpen);
  toggle.classList.toggle('open',!isOpen);
  chevron.classList.toggle('open',!isOpen);
}

// ── SESSION PAUSE (STUDENT SIDE — REALTIME) ──
// ── TEACHER NOTE (student side) ──
function showTeacherNote(note) {
  const banner = document.getElementById('teacher-note-banner');
  const text = document.getElementById('teacher-note-text');
  if (!banner || !text) return;
  text.textContent = note;
  banner.style.display = 'flex';
  logEvent('teacher_note_received', {content_preview: note.slice(0, 80)});
}
function hideTeacherNote() {
  const banner = document.getElementById('teacher-note-banner');
  if (banner) banner.style.display = 'none';
}
async function dismissTeacherNote() {
  hideTeacherNote();
  logEvent('teacher_note_dismissed', {});
  if (!STATE.submissionId) return;
  await db.from('submissions').update({teacher_note: null}).eq('id', STATE.submissionId);
}

// ── HAND RAISE (student side) ──
async function toggleHandRaise() {
  if (!STATE.submissionId) return;
  const btn = document.getElementById('call-teacher-btn');
  const isRaised = btn && btn.classList.contains('raised');
  if (isRaised) {
    await lowerHandRaise(true);
  } else {
    await db.from('submissions').update({student_hand_raised: true}).eq('id', STATE.submissionId);
    if (btn) { btn.classList.add('raised'); btn.textContent = '🖐 Calling…'; }
    logEvent('hand_raised', {});
  }
}
async function lowerHandRaise(logIt) {
  if (!STATE.submissionId) return;
  await db.from('submissions').update({student_hand_raised: false}).eq('id', STATE.submissionId);
  const btn = document.getElementById('call-teacher-btn');
  if (btn) { btn.classList.remove('raised'); btn.textContent = '🖐 Call Teacher'; }
  if (logIt) logEvent('hand_lowered', {});
}

function subscribeToSessionPause() {
  const ch = db.channel('session-status-' + STATE.sessionId)
    .on('postgres_changes', {event:'UPDATE', schema:'public', table:'sessions', filter:`id=eq.${STATE.sessionId}`}, (payload) => {
      const newStatus = payload.new?.status;
      if (newStatus === 'paused') {
        // Freeze the timer at its current remaining value
        if (STATE.timerInterval) {
          clearInterval(STATE.timerInterval);
          STATE.timerInterval = null;
          STATE.frozenRemaining = STATE.timeLimitSeconds
            ? Math.max(0, STATE.timeLimitSeconds - elapsedSeconds())
            : null;
        }
        triggerPauseBanner();
      } else if (newStatus === 'active') {
        // Teacher unpaused — resume timer from frozen point and unlock UI
        resumeFromPause();
      }
      // Handle global extra time added by teacher
      const newExtra = payload.new?.extra_minutes;
      const oldExtra = payload.old?.extra_minutes;
      if (STATE.timeLimitSeconds && newExtra != null && newExtra !== oldExtra) {
        const addedSecs = (newExtra - (oldExtra || 0)) * 60;
        if (addedSecs > 0) applyExtraTime(addedSecs);
      }
    })
    .subscribe();
  STATE._sessionChannel = ch;
}

function subscribeToSubmissionTime() {
  if (!STATE.submissionId) return;
  const ch = db.channel('submission-time-' + STATE.submissionId)
    .on('postgres_changes', {event:'UPDATE', schema:'public', table:'submissions', filter:`id=eq.${STATE.submissionId}`}, (payload) => {
      // Per-student extra time
      const newExtra = payload.new?.extra_minutes;
      const oldExtra = payload.old?.extra_minutes;
      if (newExtra != null && newExtra !== oldExtra) {
        const addedSecs = (newExtra - (oldExtra || 0)) * 60;
        if (addedSecs > 0) applyExtraTime(addedSecs);
      }
      // Teacher note
      const newNote = payload.new?.teacher_note;
      const oldNote = payload.old?.teacher_note;
      if (newNote !== oldNote) {
        if (newNote) showTeacherNote(newNote);
        else hideTeacherNote();
      }
      // Hand raise cleared by teacher
      const newRaised = payload.new?.student_hand_raised;
      const oldRaised = payload.old?.student_hand_raised;
      if (oldRaised && !newRaised) lowerHandRaise(false);
      // Per-student pause/unpause
      const newPausedAt = payload.new?.student_paused_at;
      const oldPausedAt = payload.old?.student_paused_at;
      if (newPausedAt !== oldPausedAt) {
        if (newPausedAt && !STATE.studentPaused) {
          STATE.studentPaused = true;
          if (STATE.timerInterval) {
            clearInterval(STATE.timerInterval);
            STATE.timerInterval = null;
            STATE.frozenRemaining = STATE.timeLimitSeconds
              ? Math.max(0, STATE.timeLimitSeconds - elapsedSeconds())
              : null;
          }
          triggerPauseBanner();
        } else if (!newPausedAt && STATE.studentPaused) {
          STATE.studentPaused = false;
          const sess = STATE._lastSessions && STATE._lastSessions[STATE.selectedAssignmentId];
          if (!sess || sess.status !== 'paused') {
            resumeFromPause();
          }
        }
      }
    })
    .subscribe();
  STATE._submissionTimeChannel = ch;
}

// ── STUDENT-SIDE SESSION POLL FALLBACK ──
// Runs every 30s as a safety net in case Supabase Realtime drops on the student side.
// Checks session status and global extra_minutes — acts only if something has changed.
async function pollSessionStatus() {
  if (!STATE.sessionId || STATE.isSubmitted) return;
  try {
    const {data:sess} = await db.from('sessions')
      .select('status, extra_minutes')
      .eq('id', STATE.sessionId)
      .maybeSingle();
    if (!sess) return; // session ended or deleted — autosave will handle gracefully

    // Initialise baseline on first poll
    if (STATE._lastKnownSessionExtra === null) {
      STATE._lastKnownSessionExtra = sess.extra_minutes || 0;
    }

    // Pause fallback — if session is paused but banner isn't showing, trigger it
    const banner = document.getElementById('pause-banner');
    const bannerVisible = banner && banner.classList.contains('visible');
    if (sess.status === 'paused' && !bannerVisible && !STATE.studentPaused) {
      // Freeze timer if still running
      if (STATE.timerInterval) {
        clearInterval(STATE.timerInterval);
        STATE.timerInterval = null;
        STATE.frozenRemaining = STATE.timeLimitSeconds
          ? Math.max(0, STATE.timeLimitSeconds - elapsedSeconds())
          : null;
      }
      triggerPauseBanner();
    }

    // Unpause fallback — if session is active but banner is still showing (missed unpause event)
    if (sess.status === 'active' && bannerVisible && !STATE.studentPaused) {
      resumeFromPause();
    }

    // Extra time fallback — if global extra_minutes changed and Realtime missed it
    if (STATE.timeLimitSeconds) {
      const knownExtra = STATE._lastKnownSessionExtra;
      const freshExtra = sess.extra_minutes || 0;
      if (freshExtra > knownExtra) {
        const addedSecs = (freshExtra - knownExtra) * 60;
        STATE._lastKnownSessionExtra = freshExtra;
        applyExtraTime(addedSecs);
      }
    }
  } catch(err) {
    // Fail silently — this is a fallback, not the primary path
  }
}

function applyExtraTime(addedSecs) {
  // Extend timeLimitSeconds and shift startedAt backward so elapsedSeconds() stays accurate
  STATE.timeLimitSeconds += addedSecs;
  // If timer is frozen (session paused), just extend frozenRemaining
  if (STATE.frozenRemaining !== null) {
    STATE.frozenRemaining += addedSecs;
    updateTimerDisplay(STATE.frozenRemaining);
  } else {
    // Running — restart timer with new limit (startedAt is already correct reference point)
    if (STATE.timerInterval) { clearInterval(STATE.timerInterval); STATE.timerInterval = null; }
    startTimer();
  }
  toast('Your teacher added extra time', 'success', 4000);
}

function triggerPauseBanner() {
  const banner = document.getElementById('pause-banner');
  const countdownEl = document.getElementById('pause-countdown');
  if (!banner || !countdownEl) return;

  // Freeze timer display at current remaining time
  if (STATE.frozenRemaining !== null) {
    updateTimerDisplay(STATE.frozenRemaining);
  }

  let t = 60;
  countdownEl.textContent = t;
  banner.classList.add('visible');
  if (STATE.pauseCountdownInterval) clearInterval(STATE.pauseCountdownInterval);
  STATE.pauseCountdownInterval = setInterval(async () => {
    t--;
    countdownEl.textContent = t;
    if (t <= 0) {
      clearInterval(STATE.pauseCountdownInterval);
      STATE.pauseCountdownInterval = null;
      const ta = document.getElementById('essay-textarea');
      if (ta) ta.disabled = true;
      document.getElementById('submit-btn').disabled = true;
      banner.textContent = 'This session has been paused by your teacher. Your work has been saved.';
      await autosave();
    }
  }, 1000);
}

function resumeFromPause() {
  // Hide the pause banner
  const banner = document.getElementById('pause-banner');
  if (banner) banner.classList.remove('visible');

  // Stop the countdown if still running
  if (STATE.pauseCountdownInterval) {
    clearInterval(STATE.pauseCountdownInterval);
    STATE.pauseCountdownInterval = null;
  }

  // Re-enable textarea and submit button
  const ta = document.getElementById('essay-textarea');
  if (ta) ta.disabled = false;
  const submitBtn = document.getElementById('submit-btn');
  if (submitBtn) submitBtn.disabled = false;

  // Resume timer from frozen remaining, or fall back to normal calculation
  if (STATE.timeLimitSeconds) {
    if (STATE.frozenRemaining !== null) {
      // Adjust startedAt forward by the duration of the pause so elapsedSeconds() stays accurate
      const elapsed = STATE.timeLimitSeconds - STATE.frozenRemaining;
      STATE.startedAt = new Date(Date.now() - elapsed * 1000).toISOString();
      STATE.frozenRemaining = null;
    }
    startTimer();
  }
}


function startTimer() {
  if(STATE.timerInterval) clearInterval(STATE.timerInterval);
  updateTimerDisplay(STATE.timeLimitSeconds - elapsedSeconds());
  STATE.timerInterval=setInterval(()=>{
    const r=STATE.timeLimitSeconds-elapsedSeconds();
    updateTimerDisplay(r);
    if(r<=0){clearInterval(STATE.timerInterval);autoSubmit('Time is up. Your essay has been submitted automatically.');}
  },1000);
}
function updateTimerDisplay(ro) {
  const el=document.getElementById('timer-display'); if(!el) return;
  const r=ro!==undefined?ro:STATE.timeLimitSeconds-elapsedSeconds();
  const s=Math.max(0,r),m=Math.floor(s/60),sec=s%60;
  el.textContent=`${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  el.classList.remove('warning','danger');
  if(s<=180) el.classList.add('danger'); else if(s<=600) el.classList.add('warning');
}
function updateWordCountDisplay() {
  const ta=document.getElementById('essay-textarea'); if(!ta) return;
  document.getElementById('word-count').textContent=countWords(ta.value);
}

// ── AUTOSAVE ──
async function autosave() {
  if(!STATE.submissionId||STATE.isSubmitted) return;
  const ta=document.getElementById('essay-textarea'); if(!ta) return;
  const text=ta.value, wc=countWords(text);
  if(STATE.lastWordCount>50&&(STATE.lastWordCount-wc)>=50) logEvent('word_drop',{char_count:STATE.lastWordCount-wc,content_preview:`Word count dropped from ${STATE.lastWordCount} to ${wc}`});
  STATE.lastWordCount=wc;
  const ind=document.getElementById('autosave-indicator');
  if(ind){ind.className='autosave-indicator saving';ind.textContent='Saving…';}
  try {
    await db.from('submissions').update({essay_text:text,word_count:wc,process_log:STATE.processLog,last_saved_at:new Date().toISOString()}).eq('id',STATE.submissionId);
    if(ind){ind.className='autosave-indicator saved';ind.textContent='Saved ✓';setTimeout(()=>{if(ind){ind.className='autosave-indicator';ind.textContent='Autosave active';}},2000);}
  } catch(err) {
    console.error('Autosave failed:',err);
    if(ind){ind.className='autosave-indicator error';ind.textContent='⚠ Not saved — check connection';}
  }
}
async function manualSave(){await autosave();toast('Saved','success',1500);}

// ── PROCESS LOGGING ──
function attachProcessListeners(editor) {
  editor.addEventListener('keydown',()=>{
    if(!STATE.firstKeystrokeLogged){
      STATE.firstKeystrokeLogged=true;
      logEventImmediate('first_keystroke',{content_preview:`Writing began at ${formatElapsed(elapsedSeconds())}`});
    }
  });
  editor.addEventListener('paste',(e)=>{
    const p=(e.clipboardData||window.clipboardData).getData('text')||'';
    if(!p.length) return;
    const trimmed=p.trim();
    const isInternal = trimmed.length > 0 && editor.value.includes(trimmed);
    // Check if the last logged event was a window blur or return-from-blur (within 60s)
    const lastEvent = STATE.processLog.length ? STATE.processLog[STATE.processLog.length-1] : null;
    const lastEventAge = lastEvent ? (Date.now() - new Date(lastEvent.timestamp).getTime()) / 1000 : Infinity;
    const afterBlur = lastEvent && (lastEvent.type==='window_blur'||lastEvent.type==='tab_hidden'||lastEvent.type==='window_focus') && lastEventAge < 60;
    logEventImmediate('paste',{char_count:p.length,content_preview:p.slice(0,80),paste_origin:isInternal?'internal':'external',after_blur:afterBlur});
    if(p.length>200) logEventImmediate('large_paste',{char_count:p.length,paste_origin:isInternal?'internal':'external',after_blur:afterBlur});
    const cap=editor.value.length+p.length;
    setTimeout(()=>checkPasteThenDelete(cap),90000);
  });
  editor.addEventListener('input',(ev)=>{
    const now=Date.now(),cur=editor.value.length,d=cur-STATE.lastTextLength;
    // Catch external text replacement (e.g. Grammarly desktop) — inputType is never
    // 'insertReplacementText' during normal typing or paste (paste fires its own event)
    const itype = ev.inputType||'';
    if(itype==='insertReplacementText'||itype==='insertFromDrop') {
      const preview = editor.value.slice(Math.max(0, editor.selectionStart-80), editor.selectionStart);
      logEventImmediate('replacement_text',{char_count:Math.abs(d),content_preview:preview.slice(-80)});
    }
    STATE.lastInputTime=now; STATE.lastTextLength=cur; updateWordCountDisplay();
  });
}
function checkPasteThenDelete(cap) {
  const ta=document.getElementById('essay-textarea'); if(!ta||STATE.isSubmitted) return;
  const del=cap-ta.value.length;
  if(del>=100) logEvent('paste_then_delete',{char_count:del,content_preview:'Content removed shortly after paste'});
}
function checkBurstAndIdle() {
  if(STATE.isSubmitted) return;
  const now=Date.now(),ssi=STATE.lastInputTime?(now-STATE.lastInputTime)/1000:Infinity;
  // Idle: only log if student previously left and returned (context-aware)
  const returnedRecently = STATE._lastFocusReturnTime && (now - STATE._lastFocusReturnTime) < 600000; // within 10 min
  if(ssi>120&&!STATE.idleLogged&&STATE.lastInputTime&&returnedRecently){
    logEvent('idle',{content_preview:`Gap of ~${Math.round(ssi/60)} minute(s) after returning to window`});
    STATE.idleLogged=true;
  }
  if(ssi<30&&STATE.idleLogged) STATE.idleLogged=false;
}
function logEvent(type,extras={}) {
  STATE.processLog.push({type,timestamp:new Date().toISOString(),elapsed_seconds:elapsedSeconds(),char_count:extras.char_count||0,content_preview:extras.content_preview||''});
}

// Logs event AND immediately writes process_log to DB — used for high-signal events
// so the teacher sees paste/blur in real time without waiting for autosave
async function logEventImmediate(type, extras={}) {
  logEvent(type, extras);
  if (!STATE.submissionId || STATE.isSubmitted) return;
  try {
    await db.from('submissions').update({
      process_log: STATE.processLog,
      last_active_at: new Date().toISOString(),
    }).eq('id', STATE.submissionId);
  } catch(err) {
    // Fail silently — autosave will sync on next cycle
    console.warn('Immediate event write failed:', err.message);
  }
}

// ── SUBMIT ──
function confirmSubmit() {
  openModal(`<div class="modal-header"><h3>Submit your essay?</h3><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body">Once you submit, you <strong>cannot edit</strong> your essay.</div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Keep Writing</button><button class="btn btn-primary" onclick="closeModal();submitEssay()">Submit →</button></div>`);
}
async function autoSubmit(message){toast(message,'warning',6000);await submitEssay(true);}
async function submitEssay(isAuto=false) {
  if(STATE.isSubmitted) return;
  STATE.isSubmitted=true;
  clearInterval(STATE.timerInterval); clearInterval(STATE.autosaveInterval);
  if(STATE._sessionPollInterval){clearInterval(STATE._sessionPollInterval);STATE._sessionPollInterval=null;}
  STATE.idleLogged = false;
  STATE._lastFocusReturnTime = null;
  if(STATE._visibilityHandler) document.removeEventListener('visibilitychange',STATE._visibilityHandler);
  if(STATE._blurHandler) window.removeEventListener('blur',STATE._blurHandler);
  if(STATE._focusHandler) window.removeEventListener('focus',STATE._focusHandler);
  if(STATE._beforeUnloadHandler) { window.removeEventListener('beforeunload',STATE._beforeUnloadHandler); STATE._beforeUnloadHandler=null; }
  const ta=document.getElementById('essay-textarea');
  const finalText=ta?ta.value:''; if(ta) ta.disabled=true;
  try {
    logEvent('submitted',{content_preview:isAuto?'Auto-submitted (time expired)':'Student submitted manually'});
    await db.from('submissions').update({essay_text:finalText,word_count:countWords(finalText),process_log:STATE.processLog,submitted_at:new Date().toISOString(),is_submitted:true,last_saved_at:new Date().toISOString()}).eq('id',STATE.submissionId);
    showSubmittedScreen(finalText);
  } catch(err) {
    console.error('Submit failed:',err); STATE.isSubmitted=false;
    toast('Submission failed. Please try again: '+err.message,'error',8000);
  }
}
function showSubmittedScreen(text) {
  renderProcessSummary(STATE.processLog);
  document.getElementById('submitted-essay').value=text||'';
  showScreen('submitted'); copyToClipboard(true);
}
function loadSubmittedScreen(sub) {
  renderProcessSummary(sub.process_log||[]);
  document.getElementById('submitted-essay').value=sub.essay_text||'';
}
function renderProcessSummary(log) {
  const el=document.getElementById('process-summary'); if(!el) return;
  const pastes=log.filter(e=>e.type==='paste'),blurs=log.filter(e=>e.type==='window_blur');
  el.innerHTML=`<h3>Your Writing Process</h3><div class="process-summary-items"><div class="ps-item"><strong>${pastes.length}</strong> paste event${pastes.length!==1?'s':''}</div><div class="ps-item"><strong>${blurs.length}</strong> time${blurs.length!==1?'s':''} window left focus</div></div>`;
}
async function copyToClipboard(silent=false) {
  const ta=document.getElementById('submitted-essay'); if(!ta) return;
  try{await navigator.clipboard.writeText(ta.value);if(!silent) toast('Essay copied to clipboard','success');}
  catch(e){ta.select();document.execCommand('copy');if(!silent) toast('Essay copied','success');}
}
function downloadStudentEssay() {
  const ta=document.getElementById('submitted-essay'); if(!ta) return;
  const text=ta.value; if(!text.trim()){toast('No essay text to download','warning');return;}
  const title=STATE.assignmentTitle||'Assignment';
  const name=STATE.studentName||'Student';
  const now=new Date().toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});
  const divider='─'.repeat(40);
  const content=`PaperTrail Write — Submitted Essay\nAssignment: ${title}\nStudent: ${name}\nSubmitted: ${now}\n\n${divider}\n\n${text}\n\n${divider}\n\nNote: This data will be deleted from PaperTrail's servers within 24 hours of your session ending. Save this file for your records.`;
  const slug=title.replace(/[^a-z0-9]+/gi,'-').toLowerCase().slice(0,40);
  const blob=new Blob([content],{type:'text/plain'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=`papertrail-${slug}.txt`; a.click();
  URL.revokeObjectURL(url);
  toast('Essay downloaded','success');
}

// ── TEACHER DASHBOARD ──
async function loadDashboard() {
  try {
    const {data:{user}}=await db.auth.getUser();
    if(!user){showScreen('teacher-login');return;}
    const [
      {data:assignments,error:aErr},
      {data:sessions,error:sErr},
      {data:classes,error:cErr},
      {data:teacherRow},
    ] = await Promise.all([
      db.from('assignments').select('*').eq('teacher_id',user.id).order('created_at',{ascending:false}),
      db.from('sessions').select('*').eq('teacher_id',user.id), // fetch ALL including ended
      db.from('classes').select('*').eq('teacher_id',user.id).order('name',{ascending:true}),
      db.from('teachers').select('display_name, plan').eq('id',user.id).maybeSingle(),
    ]);
    STATE._teacherDisplayName = teacherRow?.display_name || null;
    STATE._teacherPlan = teacherRow?.plan || 'trial';
    STATE._teacherEmail = user.email || '';
    // (dash-user-email span removed — account info lives in Account menu)
    if(aErr) throw aErr;
    if(sErr) throw sErr;
    STATE._classes = classes||[];
    STATE._assignments = assignments||[];
    const sessionsByAssignment={};
    const hasEverRun={};
    const hasEndedOnly={};
    (sessions||[]).forEach(s=>{
      hasEverRun[s.assignment_id]=true;
      if(s.status!=='ended') sessionsByAssignment[s.assignment_id]=s;
      else hasEndedOnly[s.assignment_id]=true;
    });
    STATE._lastSessions=sessionsByAssignment;
    const merged=(assignments||[]).map(a=>({
      ...a,
      _session: sessionsByAssignment[a.id]||null,
      _status: sessionsByAssignment[a.id]?.status||(hasEndedOnly[a.id]&&!sessionsByAssignment[a.id]?'ended':hasEverRun[a.id]?'inactive':'draft'),
      _hasEverRun: hasEverRun[a.id]||false,
      _joinCode: sessionsByAssignment[a.id]?.join_code||a.join_code||'—',
    }));
    renderAssignmentList(merged);
    renderSessionTabs();
    renderClassList(classes||[], 'class-list', false);
    refreshClassSelector(classes||[]);
    if(STATE.selectedAssignmentId) {
      loadSubmissions(STATE.selectedAssignmentId);
      const activeSession=sessionsByAssignment[STATE.selectedAssignmentId];
      if(activeSession&&(activeSession.status==='active'||activeSession.status==='paused')&&!STATE.realtimeChannel){
        subscribeToLiveSession(activeSession.id);
      } else if(!activeSession) {
        unsubscribeLiveSession();
      }
    }
  } catch(err) { toast('Failed to load assignments: '+err.message,'error'); }
}
function refreshDashboard(){loadDashboard();toast('Refreshed','default',1500);}

function refreshClassSelector(classes) {
  const sel = document.getElementById('a-class');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— No class —</option>' +
    (classes||[]).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if (current) sel.value = current; // restore selection if editing
}

// ── CLASS & ROSTER MANAGEMENT ──

// Render class list — used in both dashboard widget and T5 screen
// mode: false = dashboard widget (compact), true = roster screen (selectable)
function renderClassList(classes, containerId, rosterMode) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!classes.length) {
    el.innerHTML = '<div class="empty-panel">No classes yet.</div>';
    return;
  }
  el.innerHTML = classes.map(c => {
    const count = (c.student_roster||[]).length;
    const isSelected = rosterMode && STATE._selectedClassId === c.id;
    return `<div class="class-item ${isSelected?'selected':''}" onclick="${rosterMode?`selectClass('${c.id}')`:`openRosterScreen('${c.id}')`}">
      <div>
        <div class="class-item-name">${esc(c.name)}</div>
        <div class="class-item-meta">${count} student${count!==1?'s':''}</div>
      </div>
      <div class="class-item-actions">
        <button class="btn btn-ghost" style="font-size:0.65rem;padding:0.2rem 0.5rem" onclick="event.stopPropagation();showEditClassModal('${c.id}','${esc(c.name)}')">Edit</button>
      </div>
    </div>`;
  }).join('');
}

async function openRosterScreen(classId) {
  showScreen('roster');
  await loadRosterScreen(classId);
}

async function loadRosterScreen(classId) {
  const {data:{user}} = await db.auth.getUser();
  if (!user) return;
  const {data:classes} = await db.from('classes').select('*').eq('teacher_id',user.id).order('name',{ascending:true});
  STATE._classes = classes||[];
  STATE._selectedClassId = classId;
  renderClassList(classes||[], 'roster-class-list', true);
  if (classId) selectClass(classId);
}

function selectClass(classId) {
  STATE._selectedClassId = classId;
  // Re-render class list to update selected state
  renderClassList(STATE._classes||[], 'roster-class-list', true);
  const cls = (STATE._classes||[]).find(c => c.id === classId);
  if (!cls) return;
  document.getElementById('roster-class-name').textContent = cls.name;
  document.getElementById('roster-actions').style.display = 'flex';
  renderRosterBody(cls);
}

function renderRosterBody(cls) {
  const el = document.getElementById('roster-body');
  if (!el) return;
  const roster = cls.student_roster || [];

  const addRow = `
    <div class="roster-toolbar">
      <div class="roster-add-form">
        <input class="roster-add-input" id="roster-add-name" type="text"
          placeholder="First L.  (e.g. Jordan M.)"
          onkeydown="if(event.key==='Enter') addRosterStudent('${cls.id}')">
        <button class="btn btn-primary" style="padding:0.45rem 0.9rem;font-size:var(--text-sm)" onclick="addRosterStudent('${cls.id}')">Add</button>
      </div>
    </div>`;

  if (!roster.length) {
    el.innerHTML = addRow + '<div class="empty-panel" style="padding:2rem">No students yet. Add names above or import a CSV.</div>';
    return;
  }

  const rows = roster.map((s, i) => {
    const name = typeof s === 'string' ? s : s.name;
    const ext = typeof s === 'object' ? (s.extended_minutes||'') : '';
    return `<tr>
      <td>${esc(name)}</td>
      <td>
        <input class="accommodation-input" type="number" min="0" max="120"
          value="${ext}" placeholder="—"
          title="Extra minutes for this student"
          onchange="updateAccommodation('${cls.id}', ${i}, this.value)">
        <span style="font-size:var(--text-xs);color:var(--pt-muted);margin-left:0.35rem">min</span>
      </td>
      <td><button class="roster-remove-btn" onclick="removeRosterStudent('${cls.id}', ${i})">✕</button></td>
    </tr>`;
  }).join('');

  el.innerHTML = addRow + `
    <table class="roster-table">
      <thead><tr>
        <th>Name</th>
        <th title="Extra time accommodation in minutes">Extra Time</th>
        <th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="csv-hint">Extra time: enter additional minutes for students with accommodations. A student with 45 min base + 15 min extra gets 60 min total.</div>`;
}

// Validate "First L." format — flexible: allows multi-word first names, single initial
function validateRosterName(name) {
  return name.trim().length >= 2;
}

async function addRosterStudent(classId) {
  const input = document.getElementById('roster-add-name');
  const name = input.value.trim();
  if (!name) return;
  if (!validateRosterName(name)) { toast('Please enter a name (at least 2 characters)','warning'); return; }
  const cls = (STATE._classes||[]).find(c => c.id === classId);
  if (!cls) return;
  const roster = [...(cls.student_roster||[])];
  const exists = roster.some(s => (typeof s==='string'?s:s.name).toLowerCase() === name.toLowerCase());
  if (exists) { toast('That name is already in the roster','warning'); return; }
  const btn = input.nextElementSibling;
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
  roster.push({name, extended_minutes: null});
  await saveRoster(classId, roster);
  if (btn) { btn.disabled = false; btn.textContent = 'Add'; }
  input.value = '';
  input.focus();
}

async function removeRosterStudent(classId, idx) {
  const cls = (STATE._classes||[]).find(c => c.id === classId);
  if (!cls) return;
  const roster = [...(cls.student_roster||[])];
  roster.splice(idx, 1);
  await saveRoster(classId, roster);
}

async function updateAccommodation(classId, idx, value) {
  const cls = (STATE._classes||[]).find(c => c.id === classId);
  if (!cls) return;
  const roster = [...(cls.student_roster||[])];
  const entry = roster[idx];
  const mins = parseInt(value)||null;
  if (typeof entry === 'string') {
    roster[idx] = {name: entry, extended_minutes: mins};
  } else {
    roster[idx] = {...entry, extended_minutes: mins};
  }
  await saveRoster(classId, roster);
}

async function saveRoster(classId, roster) {
  try {
    const {error} = await db.from('classes').update({student_roster: roster}).eq('id', classId);
    if (error) throw error;
    // Update local cache
    const cls = (STATE._classes||[]).find(c => c.id === classId);
    if (cls) { cls.student_roster = roster; renderRosterBody(cls); }
    // Refresh dashboard class widget if visible
    renderClassList(STATE._classes||[], 'class-list', false);
  } catch(err) { toast('Failed to save roster: '+err.message,'error'); }
}

async function deleteSelectedClass() {
  const classId = STATE._selectedClassId;
  if (!classId) return;
  const cls = (STATE._classes||[]).find(c => c.id === classId);
  openModal(`<div class="modal-header"><h3>Delete class?</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">Delete <strong>${esc(cls?.name||'this class')}</strong>? The class and its roster will be permanently removed. Assignments linked to this class are not affected.</div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="closeModal();doDeleteClass('${classId}')">Delete</button>
    </div>`);
}

async function doDeleteClass(classId) {
  try {
    const {error} = await db.from('classes').delete().eq('id', classId);
    if (error) throw error;
    STATE._selectedClassId = null;
    STATE._classes = (STATE._classes||[]).filter(c => c.id !== classId);
    renderClassList(STATE._classes, 'roster-class-list', true);
    renderClassList(STATE._classes, 'class-list', false);
    document.getElementById('roster-class-name').textContent = 'Select a class';
    document.getElementById('roster-actions').style.display = 'none';
    document.getElementById('roster-body').innerHTML = '<div class="empty-panel" style="padding:3rem">Select a class on the left to manage its roster.</div>';
    toast('Class deleted','success');
  } catch(err) { toast('Delete failed: '+err.message,'error'); }
}

function showAddClassModal() {
  openModal(`<div class="modal-header"><h3>New class</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>Class Name</label>
        <input class="form-input" id="new-class-name" type="text" placeholder="e.g. English 10 — Period 3"
          onkeydown="if(event.key==='Enter') doAddClass()">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="add-class-confirm-btn" onclick="doAddClass()">Create Class</button>
    </div>`);
  setTimeout(()=>document.getElementById('new-class-name')?.focus(), 50);
}

function showAddClassFromForm() {
  openModal(`<div class="modal-header"><h3>New class</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>Class Name</label>
        <input class="form-input" id="new-class-name" type="text" placeholder="e.g. English 10 — Period 3"
          onkeydown="if(event.key==='Enter') doAddClassFromForm()">
        <div class="form-hint">You can import a roster into this class later from the Classes panel.</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="add-class-form-confirm-btn" onclick="doAddClassFromForm()">Create Class</button>
    </div>`);
  setTimeout(()=>document.getElementById('new-class-name')?.focus(), 50);
}

async function doAddClassFromForm() {
  const {data:{user}} = await db.auth.getUser(); if (!user) return;
  const name = document.getElementById('new-class-name')?.value.trim();
  if (!name) { toast('Please enter a class name','warning'); return; }
  const btn = document.getElementById('add-class-form-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
  const limited = await checkPlanLimit('class', user.id);
  if (limited) { if (btn) { btn.disabled = false; btn.textContent = 'Create Class'; } return; }
  try {
    const {data:cls,error} = await db.from('classes').insert({teacher_id:user.id, name, student_roster:[]}).select().single();
    if (error) throw error;
    closeModal();
    STATE._classes = [...(STATE._classes||[]), cls].sort((a,b)=>a.name.localeCompare(b.name));
    renderClassList(STATE._classes, 'class-list', false);
    renderClassList(STATE._classes, 'roster-class-list', true);
    refreshClassSelector(STATE._classes);
    const sel = document.getElementById('a-class');
    if (sel) sel.value = cls.id;
    toast(`Class "${name}" created and selected`, 'success');
  } catch(err) {
    toast('Failed to create class: '+err.message,'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Create Class'; }
  }
}

function showEditClassModal(classId, currentName) {
  openModal(`<div class="modal-header"><h3>Rename class</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>Class Name</label>
        <input class="form-input" id="edit-class-name" type="text" value="${esc(currentName)}"
          onkeydown="if(event.key==='Enter') doEditClass('${classId}')">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="doEditClass('${classId}')">Save</button>
    </div>`);
  setTimeout(()=>{ const el=document.getElementById('edit-class-name'); if(el){el.focus();el.select();} }, 50);
}

async function doAddClass() {
  const {data:{user}} = await db.auth.getUser(); if (!user) return;
  const name = document.getElementById('new-class-name')?.value.trim();
  if (!name) { toast('Please enter a class name','warning'); return; }
  const btn = document.getElementById('add-class-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
  const limited = await checkPlanLimit('class', user.id);
  if (limited) { if (btn) { btn.disabled = false; btn.textContent = 'Create Class'; } return; }
  try {
    const {data:cls,error} = await db.from('classes').insert({teacher_id:user.id, name, student_roster:[]}).select().single();
    if (error) throw error;
    closeModal();
    STATE._classes = [...(STATE._classes||[]), cls].sort((a,b)=>a.name.localeCompare(b.name));
    renderClassList(STATE._classes, 'class-list', false);
    renderClassList(STATE._classes, 'roster-class-list', true);
    toast(`Class "${name}" created`,'success');
  } catch(err) {
    toast('Failed to create class: '+err.message,'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Create Class'; }
  }
}

async function doEditClass(classId) {
  const name = document.getElementById('edit-class-name')?.value.trim();
  if (!name) { toast('Please enter a class name','warning'); return; }
  try {
    const {error} = await db.from('classes').update({name}).eq('id', classId);
    if (error) throw error;
    closeModal();
    const cls = (STATE._classes||[]).find(c => c.id === classId);
    if (cls) { cls.name = name; }
    STATE._classes = (STATE._classes||[]).sort((a,b)=>a.name.localeCompare(b.name));
    renderClassList(STATE._classes, 'class-list', false);
    renderClassList(STATE._classes, 'roster-class-list', true);
    if (STATE._selectedClassId === classId) document.getElementById('roster-class-name').textContent = name;
    toast('Class renamed','success');
  } catch(err) { toast('Failed to rename: '+err.message,'error'); }
}

// CSV Import
function showCsvImportModal() {
  openModal(`<div class="modal-header"><h3>Import from CSV</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <p style="margin-bottom:var(--space-sm);color:var(--pt-muted);font-size:var(--text-sm)">One name per row. Names will be added to the current roster — existing names are not removed.</p>
      <p style="margin-bottom:var(--space-md);font-size:var(--text-xs);color:var(--pt-muted);background:var(--pt-light);border-radius:var(--radius-sm);padding:0.4rem 0.6rem;line-height:1.5">CSV format: one column only — first and last name together in a single field. No headers required. Example: Maya Patel &nbsp;·&nbsp; <a href="#" onclick="event.preventDefault();downloadSampleCsv()" style="color:var(--pt-write);text-decoration:underline">↓ Download sample CSV</a></p>
      <div class="source-drop-zone" style="margin-bottom:var(--space-sm)" id="csv-drop-zone"
        ondragover="event.preventDefault();this.classList.add('drag-over')"
        ondragleave="this.classList.remove('drag-over')"
        ondrop="event.preventDefault();this.classList.remove('drag-over');handleCsvFile(event.dataTransfer.files[0])">
        <input type="file" accept=".csv,.txt" onchange="handleCsvFile(this.files[0])" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%">
        <div class="source-drop-zone-label"><strong>Choose CSV file</strong> or drag and drop</div>
      </div>
      <div id="csv-preview"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="csv-import-btn" disabled onclick="doImportCsv()">Import</button>
    </div>`);
}

let _csvParsed = [];
function handleCsvFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    _csvParsed = lines;
    const preview = document.getElementById('csv-preview');
    const btn = document.getElementById('csv-import-btn');
    if (!lines.length) { preview.innerHTML='<p style="color:var(--pt-muted);font-size:var(--text-sm)">No names found.</p>'; btn.disabled=true; return; }
    preview.innerHTML = `<p style="font-size:var(--text-sm);color:var(--pt-muted);margin-bottom:0.5rem">${lines.length} name${lines.length!==1?'s':''} found:</p>
      <div style="max-height:140px;overflow-y:auto;background:var(--pt-light);border-radius:var(--radius-sm);padding:0.5rem 0.75rem;font-size:var(--text-sm)">${lines.map(l=>`<div>${esc(l)}</div>`).join('')}</div>`;
    btn.disabled = false;
  };
  reader.readAsText(file);
}

function downloadSampleCsv() {
  const sample = "Maya Patel\nJordan Smith\nAlex Johnson\nSamira Haddad\nLiam O'Brien";
  const blob = new Blob([sample], {type: 'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'sample-roster.csv'; a.click();
  URL.revokeObjectURL(url);
}

async function doImportCsv() {
  const classId = STATE._selectedClassId;
  if (!classId || !_csvParsed.length) return;
  const cls = (STATE._classes||[]).find(c => c.id === classId);
  if (!cls) return;
  const existing = new Set((cls.student_roster||[]).map(s=>(typeof s==='string'?s:s.name).toLowerCase()));
  const toAdd = _csvParsed.filter(n => !existing.has(n.toLowerCase())).map(name => ({name, extended_minutes: null}));
  const roster = [...(cls.student_roster||[]), ...toAdd];
  await saveRoster(classId, roster);
  closeModal();
  _csvParsed = [];
  toast(`${toAdd.length} student${toAdd.length!==1?'s':''} added`,'success');
}



function renderAssignmentList(assignments) {
  const el=document.getElementById('assignment-list');
  if(!assignments.length){
    const hasClasses = (STATE._classes||[]).length > 0;
    el.innerHTML=`<div class="onboarding-card">
      <div class="onboarding-title">Welcome to PaperTrail Write</div>
      <div class="onboarding-step ${hasClasses?'onboarding-step-done':''}">
        <div class="onboarding-step-num">${hasClasses?'✓':'1'}</div>
        <div class="onboarding-step-body">
          <div class="onboarding-step-label">Create a class</div>
          <div class="onboarding-step-desc">Add your students so they can join by name. You can also let students type their name freely — but a roster gives you cleaner reports.</div>
          ${!hasClasses?'<button class="btn btn-secondary" style="margin-top:0.6rem;font-size:var(--text-sm)" onclick="showScreen(\'roster\')">Go to Classes →</button>':'' }
        </div>
      </div>
      <div class="onboarding-step ${!hasClasses?'onboarding-step-disabled':''}">
        <div class="onboarding-step-num">2</div>
        <div class="onboarding-step-body">
          <div class="onboarding-step-label">Create your first assignment</div>
          <div class="onboarding-step-desc">Set a title, choose a prompt type, and set a time limit. You'll get a join code when you open a session.</div>
        </div>
      </div>
      <a href="https://youtu.be/Ev3NKk-BX_g" target="_blank" rel="noopener" class="onboarding-video-link">▶ Watch the tutorial video</a>
    </div>`;
    return;
  }
  const ptLabels={essay:'Open Writing', document_based:'Document-Based', source_analysis:'Source-Based'};

  const active = assignments.filter(a => !a.archived);
  const archived = assignments.filter(a => a.archived);

  // Auto-expand active/paused assignments; leave others at their current state
  // (collapsed by default for assignments that have never been expanded)
  assignments.forEach(a => {
    if (a._status === 'active' || a._status === 'paused') {
      STATE._expandedAssignments.add(a.id);
    }
  });

  const renderCard = (a) => {
    const isActive=a._status==='active';
    const isPaused=a._status==='paused';
    const isInactive=a._status==='inactive';
    const isEnded=a._status==='ended';
    const sessionId=a._session?.id||null;
    const isExpanded = STATE._expandedAssignments.has(a.id);
    const isSelected = STATE.selectedAssignmentId===a.id;

    const statusPill=isActive
      ?`<span class="pill pill-active">Active</span>`
      :isPaused
        ?`<span class="pill" style="background:#fff8e1;color:var(--warning);border-color:#f0c040">Paused</span>`
        :a.archived
          ?`<span class="pill" style="background:var(--pt-light);color:var(--pt-muted);border-color:var(--pt-border)">Archived</span>`
          :isEnded
            ?`<span class="pill" style="background:#fef2f2;color:#991b1b;border-color:#fca5a5">Ended</span>`
            :isInactive
              ?`<span class="pill" style="background:var(--pt-light);color:var(--pt-muted);border-color:var(--pt-border)">Inactive</span>`
              :`<span class="pill pill-inactive">Draft</span>`;
    const ptLabel=ptLabels[a.prompt_type]||'Essay';
    const className = a.class_id ? ((STATE._classes||[]).find(c=>c.id===a.class_id)?.name||'') : '';
    const classPart = className ? ` · ${esc(className)}` : '';

    // Join code pill (shown in both collapsed and expanded)
    const joinCodePill = (isActive||isPaused)
      ? `<span style="font-family:'DM Mono',monospace;font-size:var(--text-xs);font-weight:600;color:var(--pt-write);background:var(--pt-write-pale);border:1px solid var(--pt-write-l);border-radius:var(--radius-sm);padding:0.15rem 0.5rem;letter-spacing:0.06em">${esc(a._joinCode)}</span><button class="pt-tooltip-btn" onclick="event.stopPropagation();showTooltip(this,'This is your session\'s unique join code. Students go to write.papertrailacademic.com, enter this code, and they\'re in. A new code is generated every time you open a session.')" title="About join codes">?</button>`
      : '';
    const projectorBtn = isActive
      ? `<button onclick="event.stopPropagation();projectJoinCode('${esc(a._joinCode)}','${esc(a.title)}')" title="Project join code in new window" style="background:none;border:none;padding:0.1rem 0.2rem;cursor:pointer;color:var(--pt-muted);font-size:0.9rem;line-height:1;border-radius:3px" onmouseover="this.style.color='var(--pt-write)'" onmouseout="this.style.color='var(--pt-muted)'">⛶</button>`
      : '';

    // ── Collapsed header (always visible) ──
    const subParts = [className].filter(Boolean);
    const collapsedHeader = `<div class="asgn-collapsed-header" onclick="toggleAssignmentExpand('${a.id}')">
      <div class="asgn-collapsed-top">
        <span class="asgn-chevron ${isExpanded?'asgn-chevron-open':''}">&#9654;</span>
        <div class="asgn-collapsed-titles">
          <span class="asgn-collapsed-title">${esc(a.title)}</span>
          ${subParts.length?`<span class="asgn-collapsed-meta">${esc(subParts.join(' · '))}</span>`:''}
        </div>
      </div>
      ${isExpanded&&(isActive||isPaused||isEnded)?`<div class="asgn-header-status" onclick="event.stopPropagation()">${statusPill}${(isActive||isPaused)?joinCodePill+projectorBtn:''}</div>`:''}
    </div>`;

    if (!isExpanded) {
      return `<div class="assignment-item ${isActive?'active-assignment':''} ${isSelected?'selected':''} ${a.archived?'archived-assignment':''} asgn-collapsed">
        ${collapsedHeader}
      </div>`;
    }

    // ── Expanded body ──
    let purgeWarning = '';
    if ((isActive || isPaused) && a._session?.last_active_at) {
      const lastActive = new Date(a._session.last_active_at).getTime();
      const cutoffDays = a.time_limit_minutes ? 7 : 30;
      const cutoffMs = cutoffDays * 86400 * 1000;
      const ageMs = Date.now() - lastActive;
      const daysLeft = Math.ceil((cutoffMs - ageMs) / 86400000);
      if (daysLeft <= 3 && daysLeft > 0) {
        purgeWarning = `<div style="margin-top:0.35rem;font-size:var(--text-xs);color:#b45309;background:#fff8e1;border:1px solid #f0c040;border-radius:var(--radius-sm);padding:0.2rem 0.5rem;display:inline-flex;align-items:center;gap:0.4rem">⚠ Session data expires in ${daysLeft} day${daysLeft!==1?'s':''} — download report or end session<button class="pt-tooltip-btn" onclick="event.stopPropagation();showTooltip(this,'Student submission data is stored temporarily. Download the session report before the deadline to preserve it. Ending the session also removes the data immediately.')" title="About data storage">?</button></div>`;
      } else if (daysLeft <= 0) {
        purgeWarning = `<div style="margin-top:0.35rem;font-size:var(--text-xs);color:#991b1b;background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--radius-sm);padding:0.2rem 0.5rem;display:inline-flex;align-items:center;gap:0.4rem">⚠ Session data will be purged tonight — download report now<button class="pt-tooltip-btn" onclick="event.stopPropagation();showTooltip(this,'Student submission data is stored temporarily. Download the session report before the deadline to preserve it. Ending the session also removes the data immediately.')" title="About data storage">?</button></div>`;
      }
    }
    const sessionActions = a.archived ? '' : isActive
      ?`<div class="assignment-actions-row assignment-actions-primary">
          <button class="btn btn-ghost" onclick="pauseSession('${a.id}','${sessionId}')">⏸ Pause</button>
          <button class="btn btn-danger" onclick="endAssignment('${a.id}','${sessionId}','${esc(a.title)}')">End Session</button>
        </div>`
      :isPaused
        ?`<div class="assignment-actions-row assignment-actions-primary">
            <button class="btn btn-success" onclick="reopenSession('${a.id}','${sessionId}')">▶ Reopen</button>
            <button class="btn btn-danger" onclick="endAssignment('${a.id}','${sessionId}','${esc(a.title)}')">End Session</button>
          </div>`
        :isEnded
          ?'' 
          :`<div class="assignment-actions-row assignment-actions-primary">
              <button class="btn btn-success" onclick="openSession('${a.id}')">${isInactive?'Open New Session':'Open Session'}</button>
              <button class="btn btn-danger" onclick="deleteAssignment('${a.id}','${esc(a.title)}')">Delete</button>
            </div>`;
    const editPreviewActions = a.archived
      ?`<div class="assignment-actions-row assignment-actions-secondary">
          <button class="btn btn-secondary" onclick="event.stopPropagation();unarchiveAssignment('${a.id}')">↩ Unarchive</button>
          <button class="btn btn-ghost" onclick="event.stopPropagation();duplicateAssignment('${a.id}')">Duplicate & Edit</button>
          <button class="btn btn-ghost" style="color:var(--pt-muted)" onclick="event.stopPropagation();deleteAssignment('${a.id}','${esc(a.title)}')">Delete</button>
        </div>`
      :isEnded
        ?`<div class="assignment-actions-row assignment-actions-secondary">
            <button class="btn btn-ghost" onclick="event.stopPropagation();duplicateAssignment('${a.id}')">Duplicate & Edit</button>
            <button class="btn btn-ghost" style="color:var(--pt-muted)" onclick="event.stopPropagation();archiveAssignment('${a.id}','${esc(a.title)}')">Archive</button>
            <button class="btn btn-ghost" style="color:var(--pt-muted)" onclick="event.stopPropagation();deleteAssignment('${a.id}','${esc(a.title)}')">Delete</button>
          </div>`
      :a._hasEverRun
        ?`<div class="assignment-actions-row assignment-actions-secondary">
            <button class="btn btn-ghost" onclick="event.stopPropagation();previewAssignment('${a.id}')">Preview</button>
            <button class="btn btn-ghost" onclick="event.stopPropagation();duplicateAssignment('${a.id}')">Duplicate & Edit</button>
            <button class="btn btn-ghost" style="color:var(--pt-muted)" onclick="event.stopPropagation();archiveAssignment('${a.id}','${esc(a.title)}')">Archive</button>
          </div>`
        :`<div class="assignment-actions-row assignment-actions-secondary">
            <button class="btn btn-ghost" onclick="event.stopPropagation();editAssignment('${a.id}')">Edit</button>
            <button class="btn btn-ghost" onclick="event.stopPropagation();previewAssignment('${a.id}')">Preview</button>
            <button class="btn btn-ghost" onclick="event.stopPropagation();duplicateAssignment('${a.id}')">Duplicate</button>
            <button class="btn btn-ghost" style="color:var(--pt-muted)" onclick="event.stopPropagation();archiveAssignment('${a.id}','${esc(a.title)}')">Archive</button>
          </div>`;

    return `<div class="assignment-item ${isActive?'active-assignment':''} ${isSelected?'selected':''} ${a.archived?'archived-assignment':''}" onclick="selectAssignment('${a.id}')">
      ${collapsedHeader}
      <div class="asgn-body">
        <div class="asgn-body-meta">${ptLabel} · ${a.time_limit_minutes?a.time_limit_minutes+' min':'No limit'}</div>
        ${purgeWarning}
        <div class="assignment-item-actions" onclick="event.stopPropagation()">${sessionActions}${editPreviewActions}</div>
      </div>
    </div>`;
  };

  let html = active.map(renderCard).join('');

  if (archived.length) {
    const archiveOpen = STATE._archiveOpen || false;
    html += `<div style="margin-top:0.5rem">
      <button onclick="toggleArchivePanel()" style="width:100%;text-align:left;padding:0.5rem 0.75rem;background:none;border:none;border-top:1px solid var(--pt-border);cursor:pointer;font-family:'DM Sans',sans-serif;font-size:var(--text-xs);font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:var(--pt-muted);display:flex;align-items:center;justify-content:space-between">
        <span>Archived (${archived.length})</span>
        <span>${archiveOpen?'▲':'▼'}</span>
      </button>
      ${archiveOpen ? `<div>${archived.map(renderCard).join('')}</div>` : ''}
    </div>`;
  }

  if (!active.length && !archived.length) {
    html = '<div class="empty-panel">No assignments yet. Create one above.</div>';
  } else if (!active.length) {
    html = '<div class="empty-panel" style="padding:0.75rem">All assignments archived.</div>' + html;
  }

  el.innerHTML = html;
}

function toggleAssignmentExpand(assignmentId) {
  if (STATE._expandedAssignments.has(assignmentId)) {
    STATE._expandedAssignments.delete(assignmentId);
  } else {
    STATE._expandedAssignments.add(assignmentId);
    // Also select this assignment so the report panel loads
    selectAssignment(assignmentId);
  }
  // Re-render without a full dashboard reload
  const assignments = STATE._assignments || [];
  const sessionsByAssignment = STATE._lastSessions || {};
  const hasEverRun = {};
  assignments.forEach(a => { if (sessionsByAssignment[a.id]) hasEverRun[a.id] = true; });
  const ptLabels2={essay:'Open Writing', document_based:'Document-Based', source_analysis:'Source-Based'};
  const merged = assignments.map(a => ({
    ...a,
    _status: sessionsByAssignment[a.id]?.status||(hasEverRun[a.id]?'inactive':'draft'),
    _session: sessionsByAssignment[a.id]||null,
    _joinCode: sessionsByAssignment[a.id]?.join_code||'',
    _hasEverRun: !!hasEverRun[a.id],
  }));
  renderAssignmentList(merged);
}

function toggleArchivePanel() {
  STATE._archiveOpen = !STATE._archiveOpen;
  loadDashboard();
}

function toggleNewAssignmentPanel() {
  STATE._newAssignmentOpen = !STATE._newAssignmentOpen;
  const body = document.getElementById('new-assignment-body');
  const chevron = document.getElementById('new-assignment-chevron');
  if (body) body.style.display = STATE._newAssignmentOpen ? '' : 'none';
  if (chevron) chevron.style.transform = STATE._newAssignmentOpen ? '' : 'rotate(180deg)';
}

async function archiveAssignment(id, title) {
  try {
    const {error} = await db.from('assignments').update({archived: true}).eq('id', id);
    if (error) throw error;
    if (STATE.selectedAssignmentId === id) {
      unsubscribeLiveSession();
      STATE.selectedAssignmentId = null; STATE.allSubmissions = [];
      document.getElementById('submissions-table-wrap').innerHTML = '<div class="empty-panel" style="padding:3rem">Select an assignment on the left to view its session report.</div>';
      document.getElementById('sub-count').textContent = 'Select an assignment to view its session report.';
      document.getElementById('export-btn').disabled = true;
    document.getElementById('print-full-btn').disabled = true;
      if (STATE._lastSessions) delete STATE._lastSessions[id];
      renderSessionTabs();
    }
    toast(`"${title}" archived`, 'success');
    loadDashboard();
  } catch(err) { toast('Archive failed: '+err.message, 'error'); }
}

async function unarchiveAssignment(id) {
  try {
    const {error} = await db.from('assignments').update({archived: false}).eq('id', id);
    if (error) throw error;
    toast('Assignment restored', 'success');
    loadDashboard();
  } catch(err) { toast('Restore failed: '+err.message, 'error'); }
}

async function duplicateAssignment(id) {
  const {data:{user}} = await db.auth.getUser();
  if (!user) return;
  const limited = await checkPlanLimit('assignment', user.id);
  if (limited) return;
  const {data:orig, error:aErr} = await db.from('assignments').select('title').eq('id', id).single();
  if (aErr) { toast('Could not load assignment', 'error'); return; }
  openModal(`
    <div class="modal-header">
      <h3>Duplicate Assignment</h3>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <p style="font-size:var(--text-sm);color:var(--pt-muted);margin-bottom:var(--space-md)">Give the copy a new title. You can edit all other details after.</p>
      <div class="form-group">
        <label>Title</label>
        <input class="form-input" id="dup-title-input" type="text" value="${esc('Copy of ' + orig.title)}"
          onkeydown="if(event.key==='Enter') confirmDuplicate('${id}')">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="dup-confirm-btn" onclick="confirmDuplicate('${id}')">Duplicate & Edit →</button>
    </div>`);
  setTimeout(() => { const inp = document.getElementById('dup-title-input'); if (inp) { inp.focus(); inp.select(); } }, 50);
}

async function confirmDuplicate(id) {
  const newTitle = document.getElementById('dup-title-input')?.value.trim();
  if (!newTitle) { toast('Please enter a title', 'warning'); return; }
  const btn = document.getElementById('dup-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Duplicating…'; }
  const {data:{user}} = await db.auth.getUser();
  if (!user) return;
  try {
    const {data:orig, error:aErr} = await db.from('assignments').select('*').eq('id', id).single();
    if (aErr) throw aErr;
    const {data:origSources} = await db.from('sources').select('*').eq('assignment_id', id).order('sort_order', {ascending: true});
    const {data:newA, error:nErr} = await db.from('assignments').insert({
      teacher_id: user.id,
      title: newTitle,
      prompt_type: orig.prompt_type,
      prompt_text: orig.prompt_text,
      time_limit_minutes: orig.time_limit_minutes,
      allow_spellcheck: orig.allow_spellcheck,
      // class_id intentionally omitted — teacher picks fresh at session open
      archived: false,
    }).select().single();
    if (nErr) throw nErr;
    if (origSources && origSources.length) {
      const sourceRows = origSources.map((s, i) => ({
        assignment_id: newA.id,
        teacher_id: user.id,
        source_type: s.source_type,
        label: s.label,
        sort_order: i,
        text_content: s.text_content || null,
        storage_path: s.storage_path || null,
      }));
      const {error:sErr} = await db.from('sources').insert(sourceRows);
      if (sErr) console.warn('Source copy failed:', sErr.message);
    }
    closeModal();
    toast(`"${newTitle}" created — editing now`, 'success', 4000);
    await loadDashboard();
    editAssignment(newA.id);
  } catch(err) {
    toast('Duplicate failed: ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Duplicate & Edit →'; }
  }
}



// ── ASSIGNMENT FORM HELPERS ──
function selectPromptType(btn) {
  document.querySelectorAll('#a-prompt-type-ctrl .seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  STATE.selectedPromptType = btn.dataset.val;
  const needsSources = ['document_based','source_analysis'].includes(STATE.selectedPromptType);
  document.getElementById('a-sources-group').style.display = needsSources ? 'block' : 'none';
  // Enforce source limit per type
  const maxSources = STATE.selectedPromptType === 'document_based' ? 1 : 8;
  // Trim sources if switching to document-based with more than 1
  if (STATE.selectedPromptType === 'document_based' && STATE.formSources.length > 1) {
    STATE.formSources = STATE.formSources.slice(0, 1);
    toast('Document-Based uses one source. Extra sources removed.', 'default', 3000);
  }
  // Update the add button hint
  const hint = document.getElementById('a-source-max-hint');
  if (hint) {
    hint.textContent = STATE.selectedPromptType === 'document_based' ? '1 source maximum' : 'Up to 8 sources';
    const docHint = document.getElementById('a-source-docbased-hint');
    if (docHint) docHint.style.display = STATE.selectedPromptType === 'document_based' ? 'block' : 'none';
  }
  renderFormSources();
  updateAddSourceBtn();
}

function updateAddSourceBtn() {
  const btn = document.getElementById('a-add-source-btn');
  if (!btn) return;
  if (STATE.selectedPromptType === 'document_based') {
    btn.style.display = STATE.formSources.length >= 1 ? 'none' : '';
    btn.disabled = false;
    btn.title = '';
  } else {
    btn.style.display = '';
    btn.disabled = STATE.formSources.length >= 8;
    btn.title = STATE.formSources.length >= 8 ? 'Maximum 8 sources reached' : '';
  }
}

function cancelEditAssignment() {
  STATE.editingAssignmentId = null;
  STATE.selectedPromptType = 'essay';
  STATE.formSources = [];
  document.getElementById('a-title').value = '';
  document.getElementById('a-prompt').value = '';
  document.getElementById('a-time').value = '';
  document.getElementById('a-spellcheck').checked = false;
  const classSel = document.getElementById('a-class');
  if (classSel) classSel.value = '';
  document.querySelectorAll('#a-prompt-type-ctrl .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.val==='essay'));
  document.getElementById('a-sources-group').style.display = 'none';
  renderFormSources();
  document.getElementById('assignment-form-title').textContent = 'New Assignment';
  document.getElementById('create-assignment-btn').textContent = 'Create Assignment';
  document.getElementById('cancel-edit-btn').style.display = 'none';
}

function loadAssignmentIntoForm(a, sources=[]) {
  STATE.editingAssignmentId = a.id;
  STATE.selectedPromptType = a.prompt_type || 'essay';
  // Populate formSources from DB rows
  STATE.formSources = sources.map(s => ({...s, _file: null, _uploading: false}));
  document.getElementById('a-title').value = a.title || '';
  document.getElementById('a-prompt').value = a.prompt_text || '';
  document.getElementById('a-time').value = a.time_limit_minutes || '';
  document.getElementById('a-spellcheck').checked = a.allow_spellcheck || false;
  const classSel = document.getElementById('a-class');
  if (classSel) classSel.value = a.class_id || '';
  document.querySelectorAll('#a-prompt-type-ctrl .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.val===STATE.selectedPromptType));
  const needsSources = ['document_based','source_analysis'].includes(STATE.selectedPromptType);
  document.getElementById('a-sources-group').style.display = needsSources ? 'block' : 'none';
  renderFormSources();
  document.getElementById('assignment-form-title').textContent = 'Edit Assignment';
  const saveBtn = document.getElementById('create-assignment-btn');
  saveBtn.textContent = 'Save Changes';
  saveBtn.disabled = false;
  document.getElementById('cancel-edit-btn').style.display = 'block';
  if (!STATE._newAssignmentOpen) {
    STATE._newAssignmentOpen = true;
    const body = document.getElementById('new-assignment-body');
    const chevron = document.getElementById('new-assignment-chevron');
    if (body) body.style.display = '';
    if (chevron) chevron.style.transform = '';
  }
  document.getElementById('a-title').scrollIntoView({behavior:'smooth', block:'nearest'});
}

async function createAssignment() {
  const {data:{user}}=await db.auth.getUser();
  if(!user){toast('Please sign in again.','error');return;}
  const title=document.getElementById('a-title').value.trim();
  const promptText=document.getElementById('a-prompt').value.trim();
  const minutesRaw=document.getElementById('a-time').value.trim();
  const minutes=minutesRaw?parseInt(minutesRaw):null;
  const allowSpellcheck=document.getElementById('a-spellcheck').checked;
  const promptType=STATE.selectedPromptType||'essay';
  const classId=document.getElementById('a-class')?.value||null;
  if(!title){toast('Please enter an assignment title','warning');return;}
  if(minutes!==null&&(minutes<5||minutes>300)){toast('Time must be between 5 and 300 minutes (or leave blank for no limit)','warning');return;}
  const btn=document.getElementById('create-assignment-btn');
  btn.disabled=true;
  btn.textContent = STATE.editingAssignmentId ? 'Save Changes' : 'Create Assignment';
  // Check plan limits for new assignments (not edits)
  if (!STATE.editingAssignmentId) {
    const limited = await checkPlanLimit('assignment', user.id);
    if (limited) { btn.disabled=false; return; }
  }
  // Only include columns that have values — prevents 400 if optional columns don't exist in live DB
  const payload={
    teacher_id:user.id, title,
    prompt_type:promptType, prompt_text:promptText||null,
    time_limit_minutes:minutes,
  };
  if (classId) payload.class_id = classId;
  if (allowSpellcheck) payload.allow_spellcheck = allowSpellcheck;
  try {
    let assignmentId = STATE.editingAssignmentId;
    if(assignmentId) {
      const {error}=await db.from('assignments').update(payload).eq('id',assignmentId);
      if(error) throw error;
      toast(`"${title}" updated`,'success');
    } else {
      const {data:newA,error}=await db.from('assignments').insert(payload).select().single();
      if(error) throw error;
      assignmentId = newA.id;
      toast(`"${title}" created`,'success');
    }
    // Save sources (upload pending files, sync rows)
    await saveSourcesForAssignment(assignmentId, user.id);
    cancelEditAssignment();
    loadDashboard();
  } catch(err){console.error('Save error:',JSON.stringify(err));toast('Save failed: '+err.message+' (code: '+(err.code||'?')+')','error',8000);}
  finally{btn.disabled=false;}
}

// ── SOURCES — TEACHER FORM ──

function renderFormSources() {
  const list = document.getElementById('a-sources-list');
  if (!list) return;
  const max = STATE.selectedPromptType === 'document_based' ? 1 : 8;
  const countEl = document.getElementById('a-source-count');
  if (countEl) countEl.textContent = `${STATE.formSources.length} / ${max}`;
  updateAddSourceBtn();

  if (!STATE.formSources.length) {
    list.innerHTML = '<div style="padding:0.75rem 1rem;font-size:var(--text-xs);color:var(--pt-muted)">No sources yet. Click "+ Add Source" to add one.</div>';
    return;
  }

  list.innerHTML = STATE.formSources.map((src, idx) => {
    const hasFile = src.storage_path || src._file;
    const fileName = src._file ? src._file.name : (src.storage_path ? src.storage_path.split('/').pop() : '');
    const fileSize = src._file ? formatBytes(src._file.size) : '';

    // Drive button — enabled for all users
    const driveBtn = true
      ? `<button class="btn-drive-picker" onclick="openDrivePicker(${idx})" title="Import from Google Drive">
          <svg width="14" height="14" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>
          From Google Drive
        </button>`
      : `<button class="btn-drive-picker btn-drive-coming-soon" title="Google Drive import coming soon" disabled>
          <svg width="14" height="14" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;opacity:0.4"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>
          From Google Drive <span class="drive-coming-soon-badge">Coming soon</span>
        </button>`;

    return `<div class="source-card" id="source-card-${idx}">
      <div class="source-card-header">
        <span class="source-drag-handle">⠿</span>
        <input class="source-label-input" type="text" value="${esc(src.label||'')}"
          placeholder="Label (e.g. Document A)"
          oninput="STATE.formSources[${idx}].label=this.value">
        <button class="source-remove-btn" onclick="removeSource(${idx})" title="Remove source">✕</button>
      </div>
      <div class="source-body">
        <textarea class="source-text-input" placeholder="Paste or type source text…"
          oninput="STATE.formSources[${idx}].text_content=this.value">${esc(src.text_content||'')}</textarea>
        <div class="source-file-divider"><span>or attach a file</span></div>
        <div class="source-drop-zone ${src._uploading?'drag-over':''}" id="drop-zone-${idx}"
          ondragover="event.preventDefault();this.classList.add('drag-over')"
          ondragleave="this.classList.remove('drag-over')"
          ondrop="event.preventDefault();this.classList.remove('drag-over');handleSourceFileSelect(${idx},event.dataTransfer.files[0])">
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.docx" onchange="handleSourceFileSelect(${idx},this.files[0])">
          <div class="source-drop-zone-label">
            ${src._uploading
              ? '<span style="color:var(--pt-write)">Uploading…</span>'
              : '<strong>Choose file</strong> or drag and drop here'}
          </div>
        </div>
        ${driveBtn}
        <div class="source-file-hint">Accepted: PDF, Word (.docx), Images (JPG, PNG, WEBP)</div>
        ${hasFile ? `<div class="source-file-pill">
          <span class="source-file-pill-name">${esc(fileName)}</span>
          ${fileSize ? `<span class="source-file-pill-size">${fileSize}</span>` : ''}
          <button class="source-file-remove" onclick="clearSourceFile(${idx})" title="Remove file">✕</button>
        </div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function addSource() {
  if (STATE.formSources.length >= 8) return;
  const n = STATE.formSources.length + 1;
  const defaultLabel = STATE.selectedPromptType === 'document_based' ? 'Title of Document' : `Source ${n}`;
  STATE.formSources.push({
    id: null, label: defaultLabel, type: 'text',
    text_content: '', storage_path: null, storage_url: null,
    _file: null, _uploading: false,
  });
  renderFormSources();
}

function removeSource(idx) {
  STATE.formSources.splice(idx, 1);
  renderFormSources();
}

function inferSourceType(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['jpg','jpeg','png','webp','gif'].includes(ext)) return 'image';
  if (ext === 'docx') return 'docx';
  // fallback: check MIME
  if (file.type.startsWith('image/')) return 'image';
  if (file.type === 'application/pdf') return 'pdf';
  return 'docx'; // best guess for unknown
}

function handleSourceFileSelect(idx, file) {
  if (!file) return;
  const src = STATE.formSources[idx];
  const maxBytes = 20 * 1024 * 1024; // 20MB
  if (file.size > maxBytes) { toast('File must be under 20MB','warning'); return; }
  // Auto-detect type from file extension — no need for teacher to declare it
  const inferredType = inferSourceType(file);
  if (!['pdf','image','docx'].includes(src.type) || src.type === 'text') {
    src.type = inferredType;
  } else {
    src.type = inferredType; // always override with actual file type
  }
  src._file = file;
  src.storage_path = null; // will be set after upload
  renderFormSources();
}

function clearSourceFile(idx) {
  STATE.formSources[idx]._file = null;
  STATE.formSources[idx].storage_path = null;
  STATE.formSources[idx].storage_url = null;
  renderFormSources();
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/(1024*1024)).toFixed(1) + ' MB';
}

async function saveSourcesForAssignment(assignmentId, teacherId) {
  // 1. Delete removed sources (those that had a DB id but were removed from the form)
  // Already spliced out — we track deletions by comparing to what's in DB
  // Simpler: delete all existing source rows for this assignment, re-insert current set
  // BUT we need to avoid re-uploading files that are already in Storage.
  // Strategy: delete only rows whose ids are NOT in the current formSources list.
  const existingIds = STATE.formSources.filter(s => s.id).map(s => s.id);

  // Delete sources that were removed (not in existingIds)
  if (STATE.editingAssignmentId) {
    const {data: dbSources} = await db.from('sources').select('id').eq('assignment_id', assignmentId);
    const toDelete = (dbSources||[]).filter(s => !existingIds.includes(s.id)).map(s => s.id);
    if (toDelete.length) {
      await db.from('sources').delete().in('id', toDelete);
    }
  }

  // 2. Upload new files and upsert each source row
  for (let i = 0; i < STATE.formSources.length; i++) {
    const src = STATE.formSources[i];
    let storagePath = src.storage_path;

    // Upload file if one was selected
    if (src._file) {
      src._uploading = true;
      renderFormSources();
      const ext = src._file.name.split('.').pop().toLowerCase();
      const path = `${teacherId}/${assignmentId}/${Date.now()}-${i}.${ext}`;
      const { error: upErr } = await db.storage
        .from('assignment-sources')
        .upload(path, src._file, { upsert: true, contentType: src._file.type });
      if (upErr) { toast(`Source ${i+1} upload failed: ${upErr.message}`, 'error'); src._uploading = false; continue; }
      storagePath = path;
      src.storage_path = path;
      src._file = null;
      src._uploading = false;
    }

    const row = {
      assignment_id: assignmentId,
      teacher_id: teacherId,
      source_type: src.type,
      label: src.label || `Source ${i+1}`,
      sort_order: i,
      text_content: src.type === 'text' ? (src.text_content||'') : null,
      storage_path: storagePath || null,
    };

    if (src.id) {
      await db.from('sources').update(row).eq('id', src.id);
    } else {
      const { data: newRow } = await db.from('sources').insert(row).select().single();
      if (newRow) src.id = newRow.id;
    }
  }
  renderFormSources();
}

// ── SOURCES — STUDENT SIDE ──

async function loadSources(assignmentId) {
  STATE.studentSources = [];
  try {
    const { data: sources, error } = await db.from('sources')
      .select('*')
      .eq('assignment_id', assignmentId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    if (!sources || !sources.length) return;

    // Generate fresh signed URLs for file-based sources
    for (const src of sources) {
      if (src.storage_path) {
        try {
          const { data: urlData, error: urlErr } = await db.storage
            .from('assignment-sources')
            .createSignedUrl(src.storage_path, 3600);
          if (urlErr) {
            console.warn('Signed URL failed for', src.storage_path, urlErr.message);
            src.storage_url = null;
          } else {
            src.storage_url = urlData?.signedUrl || null;
          }
        } catch(urlEx) {
          console.warn('Signed URL exception:', urlEx.message);
          src.storage_url = null;
        }
      }
    }
    STATE.studentSources = sources;
  } catch(err) {
    console.error('Failed to load sources:', err);
  }
}

function renderSourcePanel() {
  const sources = STATE.studentSources;
  const promptType = STATE.assignmentPromptType;
  const container = document.getElementById('source-panel-container');
  const defaultMain = document.getElementById('writing-main-default');
  const textarea = document.getElementById('essay-textarea');

  if (!sources.length || !['document_based','source_analysis'].includes(promptType)) {
    container.classList.remove('active');
    defaultMain.style.display = 'flex';
    return;
  }

  container.classList.add('active');

  if (promptType === 'document_based') {
    // Split layout: source pane left, resize handle, essay pane right
    defaultMain.style.display = 'none';
    container.innerHTML = `
      <div class="writing-split" id="writing-split">
        <div class="source-pane" id="source-pane">
          <div class="source-pane-header">
            <span class="source-pane-title">Source</span>
            <span style="font-size:var(--text-xs);color:rgba(255,255,255,0.35)">Read only</span>
          </div>
          <div class="source-pane-body" id="source-pane-body"></div>
        </div>
        <div class="split-resize-handle" id="split-resize-handle" title="Drag to resize"></div>
        <div class="essay-pane">
          <textarea id="essay-textarea" placeholder="Begin writing here…"
            spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off"
            data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false"></textarea>
        </div>
      </div>`;

    // Render the single source (document-based only ever has 1)
    const paneBody = document.getElementById('source-pane-body');
    const src = sources[0];
    renderSourceContent(src, paneBody);
    disableSourcePaneRightClick(paneBody);
    initResizeHandle();

  } else {
    // Source Analysis: split layout (sources left with tabs, essay right)
    defaultMain.style.display = 'none';
    const tabs = sources.map((src, i) =>
      `<button class="source-tab-btn ${i===0?'active':''}" onclick="switchSourceTab(${i})">${esc(src.label||`Source ${i+1}`)}</button>`
    ).join('');
    const panels = sources.map((src, i) =>
      `<div class="source-tab-panel ${i===0?'active':''}" id="source-tab-panel-${i}"></div>`
    ).join('');

    container.innerHTML = `
      <div class="writing-split" id="writing-split">
        <div class="source-pane" id="source-pane">
          <div class="source-pane-header source-pane-header--tabs">
            <div class="source-tabs-bar" id="source-tabs-bar">${tabs}</div>
            <span class="source-pane-readonly-badge">Read only</span>
          </div>
          <div class="source-pane-body" id="source-pane-body">
            <div id="source-tabs-content">${panels}</div>
          </div>
        </div>
        <div class="split-resize-handle" id="split-resize-handle" title="Drag to resize"></div>
        <div class="essay-pane">
          <textarea id="essay-textarea" placeholder="Begin writing here…"
            spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off"
            data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false"></textarea>
        </div>
      </div>`;

    // Render content into each panel
    sources.forEach((src, i) => {
      const panel = document.getElementById(`source-tab-panel-${i}`);
      if (panel) renderSourceContent(src, panel);
    });
    disableSourcePaneRightClick(document.getElementById('source-tabs-content'));
    initResizeHandle();
  }

  // Apply spellcheck settings to essay textarea for both split layouts
  if (['document_based', 'source_analysis'].includes(promptType)) {
    const essayTA = document.getElementById('essay-textarea');
    if (essayTA) {
      const sc = STATE.assignmentAllowSpellcheck;
      essayTA.spellcheck = sc;
      essayTA.setAttribute('autocorrect', sc ? 'on' : 'off');
      essayTA.setAttribute('autocapitalize', sc ? 'sentences' : 'off');
      essayTA.setAttribute('autocomplete', sc ? 'on' : 'off');
      essayTA.setAttribute('data-gramm', sc ? 'true' : 'false');
      essayTA.setAttribute('data-gramm_editor', sc ? 'true' : 'false');
      essayTA.setAttribute('data-enable-grammarly', sc ? 'true' : 'false');
    }
  }
}

function switchSourceTab(idx) {
  document.querySelectorAll('.source-tab-btn').forEach((b,i) => b.classList.toggle('active', i===idx));
  document.querySelectorAll('.source-tab-panel').forEach((p,i) => p.classList.toggle('active', i===idx));
}

function disableSourcePaneRightClick(el) {
  if (!el) return;
  el.addEventListener('contextmenu', e => e.preventDefault());
}

function initResizeHandle() {
  const handle = document.getElementById('split-resize-handle');
  const split = document.getElementById('writing-split');
  const pane = document.getElementById('source-pane');
  if (!handle || !split || !pane) return;

  // Use flex-basis for resizing — works correctly in flex layouts
  let dragging = false;
  let startX, startBasis;

  const startDrag = (clientX) => {
    dragging = true;
    startX = clientX;
    startBasis = pane.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    // Prevent iframe/canvas from eating mousemove events
    const overlay = document.createElement('div');
    overlay.id = 'resize-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize';
    document.body.appendChild(overlay);
  };

  const doDrag = (clientX) => {
    if (!dragging) return;
    const delta = clientX - startX;
    const splitWidth = split.offsetWidth;
    const newBasis = Math.min(Math.max(startBasis + delta, 200), splitWidth - 320);
    pane.style.flexBasis = newBasis + 'px';
    pane.style.width = newBasis + 'px';
    pane.style.maxWidth = 'none';
  };

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.getElementById('resize-overlay')?.remove();
  };

  handle.addEventListener('mousedown', (e) => { startDrag(e.clientX); e.preventDefault(); });
  document.addEventListener('mousemove', (e) => doDrag(e.clientX));
  document.addEventListener('mouseup', endDrag);

  handle.addEventListener('touchstart', (e) => { startDrag(e.touches[0].clientX); e.preventDefault(); }, {passive:false});
  document.addEventListener('touchmove', (e) => { if(dragging) doDrag(e.touches[0].clientX); }, {passive:true});
  document.addEventListener('touchend', endDrag);
}

async function renderSourceContent(src, container) {
  if (src.source_type === 'text') {
    const div = document.createElement('div');
    div.className = 'source-rendered-text';
    div.textContent = src.text_content || '';
    container.appendChild(div);

  } else if (src.source_type === 'image') {
    if (!src.storage_url) { container.innerHTML += '<p style="color:var(--pt-muted);font-size:var(--text-sm)">Image unavailable.</p>'; return; }
    const img = document.createElement('img');
    img.src = src.storage_url;
    img.alt = src.label || 'Source image';
    img.style.maxWidth = '100%';
    container.appendChild(img);

  } else if (src.source_type === 'pdf') {
    if (!src.storage_url) { container.innerHTML += '<p style="color:var(--pt-muted);font-size:var(--text-sm)">PDF unavailable.</p>'; return; }
    await renderPdfSource(src.storage_url, container);

  } else if (src.source_type === 'docx') {
    if (!src.storage_url) { container.innerHTML += '<p style="color:var(--pt-muted);font-size:var(--text-sm)">Document unavailable.</p>'; return; }
    await renderDocxSource(src.storage_url, container);
  }
}

async function renderPdfSource(url, container) {
  // Try PDF.js first; fall back to <iframe> if unavailable
  if (typeof pdfjsLib === 'undefined') {
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.cssText = 'width:100%;height:500px;border:none;border-radius:4px';
    container.appendChild(iframe);
    return;
  }
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const loadingMsg = document.createElement('div');
    loadingMsg.style.cssText = 'font-size:var(--text-xs);color:var(--pt-muted);padding:0.5rem 0';
    loadingMsg.textContent = 'Loading PDF…';
    container.appendChild(loadingMsg);

    const pdf = await pdfjsLib.getDocument(url).promise;
    loadingMsg.remove();
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.4 });
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'width:100%;border-radius:4px;margin-bottom:8px;display:block';
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      container.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
  } catch(err) {
    container.innerHTML += `<p style="color:var(--pt-muted);font-size:var(--text-sm)">Could not render PDF. <a href="${url}" target="_blank" style="color:var(--pt-write)">Open in new tab</a></p>`;
  }
}

async function renderDocxSource(url, container) {
  if (typeof mammoth === 'undefined') {
    container.innerHTML += `<p style="color:var(--pt-muted);font-size:var(--text-sm)">Document renderer unavailable. <a href="${url}" target="_blank" style="color:var(--pt-write)">Download</a></p>`;
    return;
  }
  try {
    const loadingMsg = document.createElement('div');
    loadingMsg.style.cssText = 'font-size:var(--text-xs);color:var(--pt-muted);padding:0.5rem 0';
    loadingMsg.textContent = 'Loading document…';
    container.appendChild(loadingMsg);

    const resp = await fetch(url);
    const arrayBuffer = await resp.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    loadingMsg.remove();
    const div = document.createElement('div');
    div.className = 'source-rendered-html';
    div.innerHTML = result.value;
    container.appendChild(div);
  } catch(err) {
    container.innerHTML += `<p style="color:var(--pt-muted);font-size:var(--text-sm)">Could not render document. <a href="${url}" target="_blank" style="color:var(--pt-write)">Download</a></p>`;
  }
}

async function openSession(assignmentId) {
  const {data:{user}}=await db.auth.getUser(); if(!user) return;
  const {data:asgn}=await db.from('assignments').select('join_code,class_id,title').eq('id',assignmentId).single();
  const classOptions = (STATE._classes||[]).map(c=>
    `<option value="${c.id}" ${c.id===asgn?.class_id?'selected':''}>${esc(c.name)}</option>`
  ).join('');
  openModal(`
    <div class="modal-header">
      <h3>Open Session</h3>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <p style="margin-bottom:var(--space-md);font-size:var(--text-sm);color:var(--pt-muted)"><strong>${esc(asgn?.title||'')}</strong></p>
      <div class="form-group">
        <label>Class <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label>
        <select class="form-input form-select" id="open-session-class">
          <option value="">— No class —</option>
          ${classOptions}
        </select>
        <div class="form-hint">Sets the student name dropdown and time accommodations for this run.</div>
      </div>
      <div class="form-group">
        <label>Session Label <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label>
        <input class="form-input" id="open-session-label" type="text" placeholder="e.g. Period 3 · March 19">
        <div class="form-hint">Helps identify this run in the session history.</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="open-session-confirm-btn" onclick="doOpenSession('${assignmentId}')">Open Session →</button>
    </div>`);
}

async function doOpenSession(assignmentId) {
  const {data:{user}}=await db.auth.getUser(); if(!user) return;
  const btn = document.getElementById('open-session-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Opening…'; }
  const classId = document.getElementById('open-session-class')?.value||null;
  const label = document.getElementById('open-session-label')?.value.trim()||null;
  try {
    let code = _mkCode();
    const payload = {
      assignment_id:assignmentId, teacher_id:user.id,
      status:'active', join_code:code,
      last_active_at:new Date().toISOString(),
    };
    if (classId) payload.class_id = classId;
    if (label) payload.session_label = label;
    let result=await db.from('sessions').insert(payload);
    if(result.error && result.error.code==='23505') {
      code = _mkCode();
      payload.join_code = code;
      result=await db.from('sessions').insert(payload);
    }
    if(result.error) throw result.error;
    closeModal();
    toast(`Session opened — join code: ${code}`,'success',5000);
    STATE.selectedAssignmentId = assignmentId;
    await loadDashboard();
  } catch(err){
    toast('Failed to open session: '+err.message,'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Open Session →'; }
  }
}

async function pauseSession(assignmentId,sessionId) {
  try {
    const {error}=await db.from('sessions').update({status:'paused',paused_at:new Date().toISOString()}).eq('id',sessionId);
    if(error) throw error;
    toast('Session paused','success'); loadDashboard();
  } catch(err){toast('Failed to pause: '+err.message,'error');}
}

async function editAssignment(id) {
  const [{data:a,error:ae},{data:sources,error:se}] = await Promise.all([
    db.from('assignments').select('*').eq('id',id).single(),
    db.from('sources').select('*').eq('assignment_id',id).order('sort_order',{ascending:true}),
  ]);
  if(ae){toast('Failed to load assignment','error');return;}
  loadAssignmentIntoForm(a, sources||[]);
}

async function previewAssignment(id) {
  const {data:a,error}=await db.from('assignments').select('*').eq('id',id).single();
  if(error){toast('Failed to load assignment','error');return;}
  STATE.isPreview=true;
  STATE.assignmentId=a.id;
  STATE.assignmentTitle=a.title;
  STATE.assignmentPromptText=a.prompt_text||'';
  STATE.assignmentPromptType=a.prompt_type||'essay';
  STATE.assignmentAllowSpellcheck=false;
  STATE.timeLimitSeconds=(a.time_limit_minutes||0)*60;
  STATE.studentName='Preview';
  STATE.period='';
  STATE.startedAt=new Date().toISOString();
  STATE.processLog=[];
  STATE.isSubmitted=false;
  STATE._resumeText='';
  await loadSources(a.id);
  enterWritingMode('');
  // Show a preview notice banner
  const bar=document.querySelector('.transparency-bar');
  if(bar){bar.style.background='rgba(74,111,165,0.15)';bar.style.borderBottomColor='rgba(74,111,165,0.3)';bar.style.color='#4A6FA5';bar.innerHTML='<span style="font-weight:600">Preview mode</span> — This is what students see. No signals are captured. <button onclick="exitPreview()" style="margin-left:1rem;font-size:var(--text-xs);padding:0.3rem 0.75rem;background:#4A6FA5;color:#fff;border:none;border-radius:4px;cursor:pointer;font-family:\'DM Sans\',sans-serif;font-weight:600">Exit Preview</button>';}
}

function exitPreview() {
  STATE.isPreview=false;
  // Restore transparency bar
  const bar=document.querySelector('.transparency-bar');
  if(bar){bar.style.background='';bar.style.borderBottomColor='';bar.style.color='';bar.innerHTML='<div class="transparency-bar-dot"></div>This session is being documented';}
  showScreen('dashboard');
}

// ── REALTIME — LIVE SESSION VIEW ──
function subscribeToLiveSession(sessionId) {
  if(STATE.realtimeChannel) {
    db.removeChannel(STATE.realtimeChannel);
    STATE.realtimeChannel=null;
  }
  // Clear any existing poll interval
  if(STATE._realtimePollInterval) { clearInterval(STATE._realtimePollInterval); STATE._realtimePollInterval=null; }

  document.getElementById('realtime-badge').style.display='inline-flex';

  const doSubscribe = () => {
    if(STATE.realtimeChannel) { db.removeChannel(STATE.realtimeChannel); STATE.realtimeChannel=null; }
    const ch=db.channel('live-session-'+sessionId+'-'+Date.now())
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'submissions',filter:`session_id=eq.${sessionId}`},()=>{ loadSubmissions(STATE.selectedAssignmentId); })
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'submissions',filter:`session_id=eq.${sessionId}`},(payload)=>{
        if(STATE.allSubmissions&&STATE.allSubmissions.length){
          const idx=STATE.allSubmissions.findIndex(s=>s.id===payload.new.id);
          if(idx>=0){STATE.allSubmissions[idx]={...STATE.allSubmissions[idx],...payload.new};renderSubmissionsTable(STATE.allSubmissions, true);}
          else{loadSubmissions(STATE.selectedAssignmentId);}
        }
      })
      .subscribe((status)=>{
        if(status==='SUBSCRIBED') {
          document.getElementById('realtime-badge').style.display='inline-flex';
        }
        if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED') {
          // Reconnect after 3s
          setTimeout(()=>{ if(STATE.selectedAssignmentId) doSubscribe(); }, 3000);
        }
      });
    STATE.realtimeChannel=ch;
  };

  doSubscribe();

  // Polling fallback: re-fetch submissions every 15s regardless of realtime status
  // This ensures the teacher always sees current data even if realtime drops.
  // Also refreshes the session row in _lastSessions so paused_seconds/paused_at stay accurate
  // for the Time Left column (avoids stale values between loadDashboard() calls).
  STATE._realtimePollInterval = setInterval(async ()=>{
    if(!STATE.selectedAssignmentId) return;
    // Refresh session row for the current assignment into _lastSessions
    const liveSess = STATE._lastSessions && STATE._lastSessions[STATE.selectedAssignmentId];
    if(liveSess && liveSess.id) {
      const {data:freshSess} = await db.from('sessions')
        .select('id, status, join_code, started_at, ended_at, class_id, session_label, paused_seconds, paused_at, extra_minutes, last_active_at')
        .eq('id', liveSess.id)
        .maybeSingle();
      if(freshSess) STATE._lastSessions[STATE.selectedAssignmentId] = freshSess;
    }
    loadSubmissions(STATE.selectedAssignmentId, true);
  }, 15000);
}

function unsubscribeLiveSession() {
  if(STATE.realtimeChannel){db.removeChannel(STATE.realtimeChannel);STATE.realtimeChannel=null;}
  if(STATE._realtimePollInterval){clearInterval(STATE._realtimePollInterval);STATE._realtimePollInterval=null;}
  document.getElementById('realtime-badge').style.display='none';
}


// ── ADD TIME ──

function openAddTimeModal() {
  const sess = STATE._lastSessions && STATE._lastSessions[STATE.selectedAssignmentId];
  if (!sess) { toast('No active session', 'warning'); return; }
  openModal(`
    <div class="modal-header">
      <h3>Add time — all students</h3>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <p style="font-size:var(--text-sm);color:var(--pt-muted);margin-bottom:var(--space-md)">Adds minutes to every student currently in the session. Students will see their timer extend immediately.</p>
      <div class="form-group">
        <label>Minutes to add</label>
        <input class="form-input" id="add-time-minutes" type="number" min="1" max="120" step="1" value="5" style="width:120px">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmAddTimeGlobal('${sess.id}')">Add Time for All</button>
    </div>`);
  setTimeout(() => document.getElementById('add-time-minutes')?.focus(), 50);
}

async function confirmAddTimeGlobal(sessionId) {
  const mins = parseInt(document.getElementById('add-time-minutes')?.value || '0', 10);
  if (!mins || mins < 1) { toast('Enter a valid number of minutes', 'warning'); return; }
  closeModal();
  try {
    // Read current extra_minutes then add to it
    const { data: sess, error: sErr } = await db.from('sessions').select('extra_minutes').eq('id', sessionId).single();
    if (sErr) throw sErr;
    const newExtra = (sess.extra_minutes || 0) + mins;
    const { error } = await db.from('sessions').update({ extra_minutes: newExtra }).eq('id', sessionId);
    if (error) throw error;
    toast(`＋${mins} min added for all students`, 'success', 3000);
  } catch(err) { toast('Failed to add time: ' + err.message, 'error'); }
}

function openAddTimePerStudent(subId, displayName) {
  openModal(`
    <div class="modal-header">
      <h3>Add time — ${esc(displayName)}</h3>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <p style="font-size:var(--text-sm);color:var(--pt-muted);margin-bottom:var(--space-md)">Adds extra minutes for this student only. Stacks on top of any global time already added. Their timer extends immediately.</p>
      <div class="form-group">
        <label>Minutes to add</label>
        <input class="form-input" id="add-time-per-minutes" type="number" min="1" max="120" step="1" value="5" style="width:120px">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmAddTimePerStudent('${subId}')">Add Time</button>
    </div>`);
  setTimeout(() => document.getElementById('add-time-per-minutes')?.focus(), 50);
}

async function confirmAddTimePerStudent(subId) {
  const mins = parseInt(document.getElementById('add-time-per-minutes')?.value || '0', 10);
  if (!mins || mins < 1) { toast('Enter a valid number of minutes', 'warning'); return; }
  closeModal();
  try {
    const { data: sub, error: sErr } = await db.from('submissions').select('extra_minutes').eq('id', subId).single();
    if (sErr) throw sErr;
    const newExtra = (sub.extra_minutes || 0) + mins;
    const { error } = await db.from('submissions').update({ extra_minutes: newExtra }).eq('id', subId);
    if (error) throw error;
    toast(`＋${mins} min added for student`, 'success', 3000);
  } catch(err) { toast('Failed to add time: ' + err.message, 'error'); }
}

async function pauseStudent(subId, displayName) {
  openModal(`
    <div class="modal-header">
      <h3>Pause — ${esc(displayName)}</h3>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <p style="font-size:var(--text-sm);color:var(--pt-muted)">This student's timer will freeze immediately. They'll see a pause notice and their work will be saved. You can resume them at any time.</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="closeModal();confirmPauseStudent('${subId}')">Pause Student</button>
    </div>`);
}

async function confirmPauseStudent(subId) {
  try {
    const { error } = await db.from('submissions').update({ student_paused_at: new Date().toISOString() }).eq('id', subId);
    if (error) throw error;
    toast('Student paused — their timer is frozen', 'success', 3000);
    const { data: subs } = await db.from('submissions').select('*').eq('session_id', STATE.selectedSessionId);
    if (subs) { STATE.allSubmissions = subs; renderSubmissionsTable(subs); }
  } catch(err) { toast('Failed to pause student: ' + err.message, 'error'); }
}

async function unpauseStudent(subId, displayName) {
  try {
    const { error } = await db.from('submissions').update({ student_paused_at: null }).eq('id', subId);
    if (error) throw error;
    toast(`${displayName} resumed`, 'success', 3000);
    const { data: subs } = await db.from('submissions').select('*').eq('session_id', STATE.selectedSessionId);
    if (subs) { STATE.allSubmissions = subs; renderSubmissionsTable(subs); }
  } catch(err) { toast('Failed to resume student: ' + err.message, 'error'); }
}

async function reopenSession(assignmentId,sessionId) {
  try {
    // Accumulate pause duration into paused_seconds before clearing paused_at
    const {data:sess, error:sErr} = await db.from('sessions').select('paused_at, paused_seconds').eq('id',sessionId).single();
    if(sErr) throw sErr;
    const addedPauseSecs = sess.paused_at
      ? Math.round((Date.now() - new Date(sess.paused_at).getTime()) / 1000)
      : 0;
    const newPausedSeconds = (sess.paused_seconds || 0) + addedPauseSecs;
    const {error}=await db.from('sessions').update({status:'active', paused_at:null, paused_seconds: newPausedSeconds}).eq('id',sessionId);
    if(error) throw error;
    toast('Session reopened','success',3000); loadDashboard();
  } catch(err){toast('Failed to reopen: '+err.message,'error');}
}

async function endAssignment(assignmentId,sessionId,title) {
  // Load submissions for the report before showing modal
  const {data:subs}=await db.from('submissions').select('*').eq('session_id',sessionId).order('started_at',{ascending:true});
  const {data:asgn}=await db.from('assignments').select('title,prompt_type,join_code').eq('id',assignmentId).single();
  const {data:sess}=await db.from('sessions').select('started_at,ended_at,join_code').eq('id',sessionId).single();
  const reportData={session:{assignment_title:asgn?.title,prompt_type:asgn?.prompt_type,join_code:sess?.join_code,started_at:sess?.started_at},submissions:(subs||[])};
  openModal(`
    <div class="modal-header"><h3>End session</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <p style="margin-bottom:var(--space-sm)"><strong>${esc(title)}</strong></p>
      <div class="disclaimer" style="margin-bottom:var(--space-md)">
        <strong>Before ending:</strong><br>
        1. Download the session report below — student submission data will be permanently deleted once the session ends.<br><br>
        2. Make sure students have saved their work somewhere (Google Doc, Word, etc.) to submit to you directly.
      </div>
      <button class="btn btn-secondary btn-block" id="download-report-btn" onclick="downloadReportZip(${JSON.stringify(reportData).replace(/"/g,'&quot;')})">↓ Download Session Report</button>
      <div style="margin-top:var(--space-lg)">
        <label style="display:flex;gap:0.75rem;align-items:flex-start;cursor:pointer;font-size:var(--text-sm)">
          <input type="checkbox" id="end-confirm-check" onchange="document.getElementById('do-end-btn').disabled=!this.checked" style="margin-top:3px;accent-color:var(--pt-write)">
          <span>I understand that student data will be permanently deleted when this session ends.</span>
        </label>
        <button class="btn btn-danger btn-block" style="margin-top:var(--space-md)" id="do-end-btn" disabled onclick="closeModal();doEndAssignment('${assignmentId}','${sessionId}')">End Session</button>
      </div>
    </div>`);
}

async function downloadReportZip(reportData) {
  const btn=document.getElementById('download-report-btn');
  if(btn){btn.disabled=true;btn.textContent='Generating…';}
  try {
    const zip=new JSZip();
    // JSON report
    zip.file('session-report.json',JSON.stringify(reportData,null,2));
    // TSV report
    const headers=['Student Name','Period','Word Count','Submitted','Submitted At','Paste Events','Large Pastes (200+)','Times Window Left Focus','Total Time Away (seconds)','Time to First Keystroke (seconds)','Essay Text'];
    const rows=(reportData.submissions||[]).map(s=>{
      const log=s.process_log||[];
      const pastes=log.filter(e=>e.type==='paste'),largePaste=log.filter(e=>e.type==='large_paste'),blurs=log.filter(e=>e.type==='window_blur'||e.type==='tab_hidden'),focuses=log.filter(e=>e.type==='window_focus'),totalAway=focuses.reduce((sum,e)=>sum+(e.char_count||0),0),firstKey=log.find(e=>e.type==='first_keystroke');
      return [s.student_display_name,s.class_period||'',s.word_count||0,s.is_submitted?'Yes':'No',s.submitted_at?formatTime(s.submitted_at):'',pastes.length,largePaste.length,blurs.length,totalAway,firstKey?firstKey.elapsed_seconds:'',(s.essay_text||'').replace(/\t/g,' ').replace(/\n/g,' ↵ ')].join('\t');
    });
    zip.file('session-report.tsv',[headers.join('\t'),...rows].join('\n'));
    const blob=await zip.generateAsync({type:'blob'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    const slug=(reportData.session?.assignment_title||'report').replace(/[^a-z0-9]+/gi,'-').toLowerCase().replace(/^-+|-+$/g,'');
    a.download=`${slug}.zip`;
    a.click(); URL.revokeObjectURL(url);
    if(btn){btn.textContent='↓ Downloaded ✓';btn.className='btn btn-success btn-block';}
  } catch(err){
    toast('Report generation failed: '+err.message,'error');
    if(btn){btn.disabled=false;btn.textContent='↓ Download Session Report';}
  }
}

async function doEndAssignment(assignmentId,sessionId) {
  try {
    await db.from('submissions').delete().eq('session_id',sessionId);
    await db.from('sessions').update({status:'ended',ended_at:new Date().toISOString()}).eq('id',sessionId);
    // Clear selected session so loadSubmissions picks the next best one
    if (STATE.selectedSessionId === sessionId) STATE.selectedSessionId = null;
    unsubscribeLiveSession();
    // Eagerly remove from _lastSessions so the tab disappears immediately (before loadDashboard round-trip)
    if(STATE._lastSessions) delete STATE._lastSessions[assignmentId];
    renderSessionTabs();
    toast('Session ended — student data deleted','success');
    loadDashboard();
    // Reload submissions panel to show remaining sessions
    if (STATE.selectedAssignmentId === assignmentId) loadSubmissions(assignmentId);
  } catch(err){toast('Failed to end session: '+err.message,'error');}
}

async function deleteAssignment(id,title) {
  openModal(`<div class="modal-header"><h3>Delete assignment?</h3><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body">This will permanently delete <strong>${esc(title)}</strong> and cannot be undone.</div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-danger" onclick="closeModal();doDeleteAssignment('${id}')">Delete Permanently</button></div>`);
}
async function doDeleteAssignment(id) {
  try {
    // Kill live monitoring immediately so badge and tab disappear before loadDashboard re-renders
    if(STATE.selectedAssignmentId===id) unsubscribeLiveSession();
    await db.from('assignments').delete().eq('id',id);
    if(STATE.selectedAssignmentId===id){STATE.selectedAssignmentId=null;STATE.allSubmissions=[];document.getElementById('submissions-table-wrap').innerHTML='<div class="empty-panel" style="padding:3rem">Select an assignment on the left.</div>';document.getElementById('sub-count').textContent='Select an assignment to view its session report.';document.getElementById('export-btn').disabled=true;document.getElementById('print-full-btn').disabled=true;}
    // Scrub from _lastSessions so renderSessionTabs() sees it gone immediately
    if(STATE._lastSessions) delete STATE._lastSessions[id];
    renderSessionTabs();
    toast('Assignment deleted','success'); loadDashboard();
  } catch(err){toast('Delete failed: '+err.message,'error');}
}

// ── SUBMISSIONS ──
function selectAssignment(id){
  if(STATE.selectedAssignmentId!==id) unsubscribeLiveSession();
  STATE.selectedAssignmentId=id;STATE.expandedSubId=null;
  loadSubmissions(id).then(()=>{
    // Start Realtime if the selected assignment has an active session
    const activeSession=STATE._lastSessions&&STATE._lastSessions[id];
    if(activeSession&&(activeSession.status==='active'||activeSession.status==='paused')){
      subscribeToLiveSession(activeSession.id);
    }
  });
  loadDashboard();
}

async function loadSubmissions(assignmentId, _fromLiveRefresh) {
  if (!_fromLiveRefresh) document.getElementById('submissions-table-wrap').innerHTML='<div class="empty-panel" style="padding:2rem">Loading…</div>';
  try {
    // Fetch ALL sessions for this assignment, newest first
    const {data:sessions, error:sErr} = await db.from('sessions')
      .select('id, status, join_code, started_at, ended_at, class_id, session_label, paused_seconds, paused_at, extra_minutes')
      .eq('assignment_id', assignmentId)
      .order('started_at', {ascending: false});
    if (sErr) throw sErr;

    if (!sessions || !sessions.length) {
      STATE.allSubmissions = [];
      document.getElementById('submissions-table-wrap').innerHTML = '<div class="empty-panel" style="padding:3rem">No sessions yet for this assignment.</div>';
      document.getElementById('sub-count').textContent = 'No session data.';
      document.getElementById('export-btn').disabled = true;
    document.getElementById('print-full-btn').disabled = true;
      return;
    }

    // Pick session to show: prefer the one in STATE.selectedSessionId if it belongs to this assignment,
    // otherwise default to the most recent non-ended, or most recent overall
    const activeSess = sessions.find(s => s.status === 'active' || s.status === 'paused');
    const targetSession = sessions.find(s => s.id === STATE.selectedSessionId)
      || activeSess
      || sessions[0];
    STATE.selectedSessionId = targetSession.id;

    // Update panel title with assignment name
    const panelAssignment = (STATE._assignments||[]).find(a => a.id === assignmentId);
    const titleEl = document.getElementById('submissions-panel-title');
    if (titleEl) titleEl.textContent = panelAssignment ? panelAssignment.title : 'Session Report';

    // Load submissions for target session
    const {data, error} = await db.from('submissions').select('*')
      .eq('session_id', targetSession.id)
      .order('started_at', {ascending: true});
    if (error) throw error;
    STATE.allSubmissions = data || [];
    renderSubmissionsTable(data || [], _fromLiveRefresh);
    document.getElementById('export-btn').disabled = !data || !data.length;
    document.getElementById('print-full-btn').disabled = !data || !data.length;
  } catch(err) { toast('Failed to load session report: '+err.message,'error'); }
}

// ── SESSION TABS ──
// Renders one tab per live (active/paused) session across ALL assignments.
// Called after loadDashboard updates _lastSessions and _assignments.
function renderSessionTabs() {
  const wrap = document.getElementById('session-tabs-wrap');
  if (!wrap) return;

  // Gather all live sessions across all assignments
  const liveSessions = [];
  const sessions = STATE._lastSessions || {};
  const assignments = STATE._assignments || [];
  for (const [assignmentId, sess] of Object.entries(sessions)) {
    if (sess && (sess.status === 'active' || sess.status === 'paused')) {
      const asgn = assignments.find(a => a.id === assignmentId);
      liveSessions.push({ sess, assignmentId, asgn });
    }
  }

  // Always show tabs container; hide if nothing live
  if (!liveSessions.length) {
    wrap.innerHTML = '';
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'flex';

  const tabs = liveSessions.map(({ sess, assignmentId, asgn }) => {
    const cls = (STATE._classes||[]).find(c => c.id === sess.class_id);
    const classLabel = cls ? cls.name : '';
    const title = asgn ? asgn.title : 'Session';
    const label = classLabel ? `${title} — ${classLabel}` : title;
    const isActive = STATE.selectedAssignmentId === assignmentId;
    const isPaused = sess.status === 'paused';
    const statusDot = isPaused
      ? `<span style="color:#b45309;font-size:10px;margin-left:4px">⏸</span>`
      : `<span style="display:inline-block;width:7px;height:7px;background:#2a7a3b;border-radius:50%;margin-left:5px;vertical-align:middle"></span>`;
    return `<button class="session-tab ${isActive ? 'session-tab-active' : ''}"
      onclick="selectAssignment('${assignmentId}')"
      title="${isPaused ? 'Paused' : 'Live'} · ${label}"
    >${label}${statusDot}</button>`;
  }).join('');

  wrap.innerHTML = tabs;
}


async function switchSession(assignmentId, sessionId) {
  STATE.selectedSessionId = sessionId;
  STATE.expandedSubId = null;
  // Re-subscribe Realtime if switching to an active session
  unsubscribeLiveSession();
  const {data:sess} = await db.from('sessions').select('status').eq('id',sessionId).single();
  if (sess && (sess.status==='active'||sess.status==='paused')) {
    subscribeToLiveSession(sessionId);
  }
  const {data, error} = await db.from('submissions').select('*')
    .eq('session_id', sessionId).order('started_at', {ascending:true});
  if (error) { toast('Failed to load session','error'); return; }
  STATE.allSubmissions = data||[];
  renderSubmissionsTable(data||[]);
  document.getElementById('export-btn').disabled = !data||!data.length;
  document.getElementById('print-full-btn').disabled = !data||!data.length;
}

// Compute time remaining (seconds) for a student from the teacher dashboard perspective.
// Returns null if no time limit, or the student has submitted.
function calcStudentTimeRemaining(sub, sess, timeLimitMinutes) {
  if (!timeLimitMinutes || sub.is_submitted) return null;
  const totalSecs = (timeLimitMinutes * 60)
    + ((sess.extra_minutes || 0) * 60)
    + ((sub.extra_minutes || 0) * 60);
  const joinedAt = new Date(sub.started_at || sub.created_at).getTime();
  const elapsedSecs = Math.floor((Date.now() - joinedAt) / 1000);
  // paused_seconds = total past pause wall-time (already committed)
  let pauseOffset = sess.paused_seconds || 0;
  // If session is currently paused, add time since paused_at
  if (sess.status === 'paused' && sess.paused_at) {
    pauseOffset += Math.floor((Date.now() - new Date(sess.paused_at).getTime()) / 1000);
  }
  // If student is individually paused, add time since student_paused_at
  if (sub.student_paused_at) {
    pauseOffset += Math.floor((Date.now() - new Date(sub.student_paused_at).getTime()) / 1000);
  }
  return Math.max(0, totalSecs - elapsedSecs + pauseOffset);
}

function formatTimeRemaining(secs) {
  if (secs === null) return '∞';
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function renderSubmissionsTable(submissions, _fromLiveRefresh) {
  // If a row is expanded and this is a background refresh, just buffer data and bail
  if (_fromLiveRefresh && STATE.expandedSubId) {
    STATE.allSubmissions = submissions;
    return;
  }
  const countEl=document.getElementById('sub-count'),wrapEl=document.getElementById('submissions-table-wrap');
  if(!submissions.length){countEl.textContent='No submissions yet.';wrapEl.innerHTML='<div class="empty-panel" style="padding:3rem">No submissions yet for this session.</div>';return;}
  const submitted=submissions.filter(s=>s.is_submitted).length;
  const inProgress=submissions.length-submitted;
  countEl.innerHTML=`<span style="font-weight:600">${submissions.length} student${submissions.length!==1?'s':''}</span> &nbsp;·&nbsp; <span style="color:var(--pt-write);font-weight:600">${inProgress} writing</span> &nbsp;·&nbsp; <span style="color:#2a7a3b;font-weight:600">${submitted} submitted</span>`;
  // Build a set of names that appear more than once — used to flag duplicate rows
  const nameCounts={};
  submissions.forEach(s=>{ const n=s.student_display_name||''; nameCounts[n]=(nameCounts[n]||0)+1; });
  const duplicateNames=new Set(Object.keys(nameCounts).filter(n=>nameCounts[n]>1));
  const rows=submissions.map(s=>{
    const log=s.process_log||[];
    const pastes=log.filter(e=>e.type==='paste'),blurs=log.filter(e=>e.type==='window_blur'||e.type==='tab_hidden'),wordDrops=log.filter(e=>e.type==='word_drop');
    const largePaste=log.some(e=>e.type==='large_paste'),focuses=log.filter(e=>e.type==='window_focus'),totalAway=focuses.reduce((sum,e)=>sum+(e.char_count||0),0);
    const extPastes=pastes.filter(e=>e.paste_origin!=='internal'),intPastes=pastes.filter(e=>e.paste_origin==='internal');
    const blurPastes=pastes.filter(e=>e.after_blur);
    const pasteLabel=extPastes.length>0&&intPastes.length>0
      ?`<span style="color:var(--warning)">paste ×${extPastes.length} external${blurPastes.length>0?` (${blurPastes.length} after window blur)`:''}</span> <span style="color:var(--pt-muted)">+${intPastes.length} internal</span>`
      :extPastes.length>0?`<span style="color:var(--warning)">paste ×${extPastes.length} external${blurPastes.length>0?` (${blurPastes.length} after window blur)`:''}</span>`
      :intPastes.length>0?`<span style="color:var(--pt-muted)">paste ×${intPastes.length} internal</span>`
      :pastes.length>0?`<span style="color:var(--warning)">paste ×${pastes.length}</span>`:'';
    const notable=[pasteLabel,largePaste?`<span style="color:var(--warning)">large paste</span>`:'',blurs.length>0?`<span style="color:var(--pt-muted)">left window ×${blurs.length}</span>`:'',wordDrops.length>0?`<span style="color:var(--pt-muted)">word drop</span>`:''].filter(Boolean).join(' &nbsp;');
    const resubmitCell = s.is_submitted
      ? `<td onclick="event.stopPropagation()"><button style="font-size:var(--text-xs);padding:0.2rem 0.6rem;border-radius:var(--radius-sm);border:1.5px solid #2a7a3b;background:#e8f5e9;color:#2a7a3b;font-family:'DM Sans',sans-serif;font-weight:600;cursor:pointer;white-space:nowrap" onclick="unsubmitStudent('${s.id}','${esc(s.student_display_name)}')">↩ Return</button></td>`
      : `<td><span style="font-size:var(--text-xs);color:var(--pt-border)">—</span></td>`;
    // Per-student add time — only show for in-progress students when session is live
    const sess2 = STATE._lastSessions && STATE._lastSessions[STATE.selectedAssignmentId];
    const liveSession = sess2 && (sess2.status === 'active' || sess2.status === 'paused');
    const perStudentTimeCell = (liveSession && !s.is_submitted)
      ? `<td onclick="event.stopPropagation()"><button style="font-size:var(--text-xs);padding:0.2rem 0.6rem;border-radius:var(--radius-sm);border:1.5px solid var(--pt-write);background:var(--pt-write-pale);color:var(--pt-write);font-family:'DM Sans',sans-serif;font-weight:600;cursor:pointer;white-space:nowrap" onclick="openAddTimePerStudent('${s.id}','${esc(s.student_display_name)}')">＋ Time</button></td>`
      : `<td></td>`;
    const isStudentPaused = !!s.student_paused_at;
    const perStudentPauseCell = (liveSession && !s.is_submitted)
      ? isStudentPaused
        ? `<td onclick="event.stopPropagation()"><button style="font-size:var(--text-xs);padding:0.2rem 0.6rem;border-radius:var(--radius-sm);border:1.5px solid #b45309;background:#fff8f0;color:#b45309;font-family:'DM Sans',sans-serif;font-weight:600;cursor:pointer;white-space:nowrap" onclick="unpauseStudent('${s.id}','${esc(s.student_display_name)}')">▶ Resume</button></td>`
        : `<td onclick="event.stopPropagation()"><button style="font-size:var(--text-xs);padding:0.2rem 0.6rem;border-radius:var(--radius-sm);border:1.5px solid var(--pt-muted);background:var(--pt-bg);color:var(--pt-text);font-family:'DM Sans',sans-serif;font-weight:600;cursor:pointer;white-space:nowrap" onclick="pauseStudent('${s.id}','${esc(s.student_display_name)}')">⏸ Pause</button></td>`
      : `<td></td>`;
    const perStudentNoteCell = (liveSession && !s.is_submitted)
      ? `<td onclick="event.stopPropagation()"><button style="font-size:var(--text-xs);padding:0.2rem 0.6rem;border-radius:var(--radius-sm);border:1.5px solid ${s.teacher_note?'#7B5EA7':'var(--pt-muted)'};background:${s.teacher_note?'#f3eeff':'var(--pt-bg)'};color:${s.teacher_note?'#7B5EA7':'var(--pt-muted)'};font-family:'DM Sans',sans-serif;font-weight:600;cursor:pointer;white-space:nowrap" onclick="openSendNoteModal('${s.id}','${esc(s.student_display_name)}')">${s.teacher_note?'✉ Noted':'✉ Note'}</button></td>`
      : `<td></td>`;
    // Time remaining cell
    const sessForTime = STATE._lastSessions && STATE._lastSessions[STATE.selectedAssignmentId];
    const assignmentForTime = STATE._assignments && STATE._assignments.find(a => a.id === STATE.selectedAssignmentId);
    const timeLimitMins = assignmentForTime ? assignmentForTime.time_limit_minutes : null;
    let timeRemainingCell = '<td></td>';
    if (sessForTime && timeLimitMins && !s.is_submitted) {
      const remSecs = calcStudentTimeRemaining(s, sessForTime, timeLimitMins);
      const remStr = formatTimeRemaining(remSecs);
      const colorStyle = remSecs <= 180 ? 'color:#c0392b;font-weight:600' : remSecs <= 600 ? 'color:#b45309;font-weight:600' : 'color:var(--pt-ink)';
      timeRemainingCell = `<td style="font-family:'DM Mono',monospace;font-size:var(--text-xs);${colorStyle}">${remStr}</td>`;
    } else if (s.is_submitted) {
      timeRemainingCell = `<td style="font-size:var(--text-xs);color:var(--pt-muted)">—</td>`;
    } else if (!timeLimitMins) {
      timeRemainingCell = `<td style="font-size:var(--text-xs);color:var(--pt-muted)">∞</td>`;
    }
    const dupBadge = duplicateNames.has(s.student_display_name||'') ? ' <span style="font-size:10px;font-weight:600;color:#b45309;background:#fff8e1;border:1px solid #f0c040;border-radius:3px;padding:0.1rem 0.35rem;vertical-align:middle">⚠ duplicate name</span>' : '';
    const notableDot = hasNotableEvent(log) ? '<span title="Notable event recorded — expand row to view process log" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#b45309;margin-right:0.4rem;vertical-align:middle"></span>' : '';
    const handBadge = s.student_hand_raised ? `<span class="hand-raise-badge" onclick="event.stopPropagation();teacherDismissHand('${s.id}','${esc(s.student_display_name)}')">🖐 Calling</span>` : '';
    return `<tr onclick="toggleSubmissionDetail('${s.id}')"><td>${notableDot}<strong>${esc(s.student_display_name)}</strong>${dupBadge}${handBadge}</td><td>${esc(s.class_period||'—')}</td><td style="font-family:'DM Mono',monospace">${s.word_count||0}</td><td>${s.is_submitted?`<span class="submitted-yes">✓ Submitted</span>`:`<span class="submitted-no">In progress</span>`}</td><td style="font-size:var(--text-xs);color:var(--pt-muted)">${s.submitted_at?formatTime(s.submitted_at):'—'}</td><td style="font-size:var(--text-xs)">${notable||'<span style="color:var(--pt-muted)">—</span>'}</td><td style="color:var(--pt-muted);font-size:var(--text-xs);font-family:'DM Mono',monospace">${totalAway>0?totalAway+'s':'—'}</td>${timeRemainingCell}${resubmitCell}${perStudentTimeCell}${perStudentPauseCell}${perStudentNoteCell}</tr>${STATE.expandedSubId===s.id?renderDetailRow(s):''}`;
  }).join('');
  // Show Add Time button in toolbar only when session is active or paused
  const sess = STATE._lastSessions && STATE._lastSessions[STATE.selectedAssignmentId];
  const sessIsLive = sess && (sess.status === 'active' || sess.status === 'paused');
  const addTimeBtn = sessIsLive
    ? `<button class="btn btn-ghost" style="font-size:var(--text-xs);padding:0.45rem 0.8rem" onclick="openAddTimeModal()">＋ Add Time</button>`
    : '';
  // Universal pause/resume button — shown only when session is live
  const sessStatus = sess ? sess.status : null;
  const pauseResumeBtn = sessIsLive
    ? sessStatus === 'paused'
      ? `<button class="btn btn-ghost" style="font-size:var(--text-xs);padding:0.45rem 0.8rem;border-color:#b45309;color:#b45309" onclick="reopenSession('${STATE.selectedAssignmentId}','${sess && sess.id}')">▶ Resume All</button>`
      : `<button class="btn btn-ghost" style="font-size:var(--text-xs);padding:0.45rem 0.8rem" onclick="pauseSession('${STATE.selectedAssignmentId}','${sess && sess.id}')">⏸ Pause All</button>`
    : '';
  const toolbar = document.getElementById('sub-toolbar');
  // Remove old injected buttons then re-insert
  document.getElementById('add-time-global-btn-wrap')?.remove();
  document.getElementById('pause-resume-global-btn-wrap')?.remove();
  if (toolbar) {
    const exportBtn = toolbar.querySelector('#export-btn');
    if (pauseResumeBtn) {
      const wrap = document.createElement('span');
      wrap.id = 'pause-resume-global-btn-wrap';
      wrap.innerHTML = pauseResumeBtn;
      toolbar.insertBefore(wrap, exportBtn);
    }
    if (addTimeBtn) {
      const wrap = document.createElement('span');
      wrap.id = 'add-time-global-btn-wrap';
      wrap.innerHTML = addTimeBtn;
      toolbar.insertBefore(wrap, exportBtn);
    }
  }
    const _scrollTop = wrapEl.scrollTop;
  wrapEl.innerHTML=`<table><thead><tr><th>Student</th><th>Period</th><th>Words</th><th>Status</th><th>Submitted</th><th>Notable Events <button class="pt-tooltip-btn" onclick="showTooltip(this,'Notable events are: paste events (text pasted into the essay), focus loss (student left the window or switched tabs), and first keystroke timing. All are shown in the process log.')" title="About notable events">?</button></th><th>Time Away</th><th>Time Left</th><th></th><th></th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  wrapEl.scrollTop = _scrollTop;
}

function toggleSubmissionDetail(subId){STATE.expandedSubId=(STATE.expandedSubId===subId)?null:subId;renderSubmissionsTable(STATE.allSubmissions);}

function renderDetailRow(sub) {
  const log=sub.process_log||[];
  const logHtml=log.length?log.map(e=>`<div class="log-entry ${e.type}"><span class="log-type">${labelForEvent(e.type, e)}</span><span class="log-time"><span class="log-wall">${formatTime(e.timestamp)}</span><span class="log-elapsed">${formatElapsed(e.elapsed_seconds)} into session</span></span><span class="log-detail">${esc(getLogDetail(e))}</span></div>`).join(''):'<div style="color:var(--pt-muted);font-size:var(--text-sm);padding:0.5rem">No events logged.</div>';
  const pastes=log.filter(e=>e.type==='paste'),largePaste=log.some(e=>e.type==='large_paste'),blurs=log.filter(e=>e.type==='window_blur'||e.type==='tab_hidden'),wordDrops=log.filter(e=>e.type==='word_drop');
  const extPastes=pastes.filter(e=>e.paste_origin!=='internal'),intPastes=pastes.filter(e=>e.paste_origin==='internal');
  const pasteFlag=extPastes.length>0&&intPastes.length>0?`${extPastes.length} external paste${extPastes.length>1?'s':''} · ${intPastes.length} internal`
    :extPastes.length>0?`${extPastes.length} external paste${extPastes.length>1?'s':''}`
    :intPastes.length>0?`${intPastes.length} internal paste${intPastes.length>1?'s':''}`
    :pastes.length>0?`${pastes.length} paste event${pastes.length>1?'s':''}`  :'';
  const flagText=[pasteFlag,(largePaste?'paste over 200 chars':''),blurs.length>0?`left window ${blurs.length}×`:'',wordDrops.length>0?'notable word count drop':''].filter(Boolean).join(' · ');
  return `<tr class="detail-row"><td class="detail-cell" colspan="11"><div class="detail-header"><div><strong>${esc(sub.student_display_name)}</strong><span style="color:var(--pt-muted);font-size:var(--text-xs);margin-left:0.5rem">${sub.word_count||0} words · Started ${formatTime(sub.started_at)}</span></div><div style="font-size:var(--text-xs);color:var(--pt-muted)">${flagText||'No notable events'}</div></div><div class="detail-essay">${esc(sub.essay_text||'(no essay text)')}</div><div class="process-log-title">Process Log <button class=\"pt-tooltip-btn\" onclick=\"showTooltip(this,'The process log records every behavioural event with a timestamp — when the student started typing, any paste events, and any time they left the writing window.');\" title=\"About the process log\">?</button></div><div class="process-log-list">${logHtml}</div><div style="margin-top:0.25rem;display:flex;align-items:center;justify-content:space-between"><div class="disclaimer" style="flex:1">This log is one input among many. Educator judgment governs all interpretation and any subsequent conversation.</div><button class="btn btn-secondary" style="margin-left:1rem;flex-shrink:0;font-size:var(--text-xs);padding:0.35rem 0.8rem" onclick="event.stopPropagation();printStudentReport('${sub.id}')">🖨 Print Report</button></div></td></tr>`;
}

// ── PRINT STUDENT REPORT ──
async function printStudentReport(subId) {
  try {
    // Fetch submission
    const {data:sub, error:sErr} = await db.from('submissions').select('*').eq('id', subId).single();
    if (sErr) throw sErr;
    // Fetch assignment via session
    const {data:sess, error:sessErr} = await db.from('sessions').select('assignment_id, join_code, started_at, session_label, class_id').eq('id', sub.session_id).single();
    if (sessErr) throw sessErr;
    const {data:asgn, error:aErr} = await db.from('assignments').select('title, prompt_type, prompt_text, teacher_id').eq('id', sess.assignment_id).single();
    if (aErr) throw aErr;
    const {data:teacherRow} = await db.from('teachers').select('display_name, email').eq('id', asgn.teacher_id).maybeSingle();
    const teacherLabel = teacherRow?.display_name || teacherRow?.email || '—';

    const ptLabels = {essay:'Open Writing', document_based:'Document-Based', source_analysis:'Source-Based'};
    const ptLabel = ptLabels[asgn.prompt_type] || 'Open Writing';
    const log = sub.process_log || [];
    const pastes = log.filter(e=>e.type==='paste');
    const blurs = log.filter(e=>e.type==='window_blur'||e.type==='tab_hidden');
    const largePaste = log.some(e=>e.type==='large_paste');
    const wordDrops = log.filter(e=>e.type==='word_drop');
    const focuses = log.filter(e=>e.type==='window_focus');
    const totalAway = focuses.reduce((sum,e)=>sum+(e.char_count||0),0);

    const logRows = log.length ? log.map(e => `
      <tr>
        <td style="padding:0.3rem 0.5rem;white-space:nowrap;color:#555;font-size:11px">${labelForEvent(e.type, e)}</td>
        <td style="padding:0.3rem 0.5rem;white-space:nowrap;color:#888;font-size:11px">${formatTime(e.timestamp)}</td>
        <td style="padding:0.3rem 0.5rem;white-space:nowrap;color:#888;font-size:11px">${formatElapsed(e.elapsed_seconds)} in</td>
        <td style="padding:0.3rem 0.5rem;color:#555;font-size:11px">${esc(getLogDetail(e))}</td>
      </tr>`).join('') : '<tr><td colspan="4" style="padding:0.5rem;color:#999;font-size:11px">No events logged.</td></tr>';

    const flags = [
      pastes.length > 0 ? `${pastes.length} paste event${pastes.length>1?'s':''}` : '',
      largePaste ? 'paste over 200 chars' : '',
      blurs.length > 0 ? `left window ${blurs.length}×` : '',
      wordDrops.length > 0 ? 'notable word count drop' : '',
    ].filter(Boolean).join(' · ');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>PaperTrail Write — ${esc(sub.student_display_name)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'DM Sans', sans-serif; color: #1a2235; background: #fff; padding: 2.5rem 3rem; max-width: 760px; margin: 0 auto; font-size: 13px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a2235; padding-bottom: 0.75rem; margin-bottom: 1.5rem; }
    .wordmark { font-family: 'DM Sans', sans-serif; font-size: 1rem; font-weight: 600; color: #1a2235; }
    .wordmark em { font-family: 'Lora', serif; font-style: italic; color: #7B5EA7; }
    .print-date { font-size: 11px; color: #888; text-align: right; margin-top: 0.2rem; }
    .section { margin-bottom: 1.25rem; }
    .label { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #888; margin-bottom: 0.3rem; }
    .value { font-size: 13px; color: #1a2235; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem; }
    .prompt-box { background: #f7f7fa; border-left: 3px solid #7B5EA7; padding: 0.75rem 1rem; border-radius: 0 4px 4px 0; margin-bottom: 1.25rem; }
    .prompt-box .label { margin-bottom: 0.4rem; }
    .prompt-text { font-family: 'Lora', serif; font-size: 13px; line-height: 1.6; color: #1a2235; white-space: pre-wrap; }
    .essay-box { border: 1px solid #ddd; border-radius: 4px; padding: 1rem; margin-bottom: 1.25rem; }
    .essay-text { font-family: 'Lora', serif; font-size: 13px; line-height: 1.75; color: #1a2235; white-space: pre-wrap; }
    .flags { font-size: 11px; color: #b45309; margin-bottom: 0.75rem; font-weight: 500; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 1.25rem; }
    thead th { font-size: 10px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: #888; text-align: left; padding: 0.3rem 0.5rem; border-bottom: 1px solid #e0e0e0; }
    tbody tr:nth-child(even) { background: #f9f9fb; }
    .disclaimer { font-size: 10px; color: #aaa; line-height: 1.5; border-top: 1px solid #e0e0e0; padding-top: 0.75rem; margin-top: 1rem; }
    @media print {
      body { padding: 1.5rem 2rem; }
      @page { margin: 1.5cm; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="wordmark">PaperTrail <em>Write</em></div>
      <div style="font-size:11px;color:#888;margin-top:0.2rem">Session Report</div>
    </div>
    <div class="print-date">Printed ${new Date().toLocaleString(undefined,{month:'long',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
  </div>

  <div class="section">
    <div class="label">Assignment</div>
    <div class="value" style="font-size:1rem;font-weight:600">${esc(asgn.title)}</div>
    <div style="font-size:11px;color:#888;margin-top:0.2rem">${esc(ptLabel)}</div>
  </div>

  ${asgn.prompt_text ? `
  <div class="prompt-box">
    <div class="label">Prompt</div>
    <div class="prompt-text">${esc(asgn.prompt_text)}</div>
  </div>` : ''}

  <div class="meta-grid">
    <div>
      <div class="label">Student</div>
      <div class="value">${esc(sub.student_display_name)}</div>
    </div>
    <div>
      <div class="label">Period</div>
      <div class="value">${esc(sub.class_period||'—')}</div>
    </div>
    <div>
      <div class="label">Teacher</div>
      <div class="value">${esc(teacherLabel)}</div>
    </div>
    <div>
      <div class="label">Session started</div>
      <div class="value">${formatTime(sub.started_at)}</div>
    </div>
    <div>
      <div class="label">Submitted</div>
      <div class="value">${sub.submitted_at ? formatTime(sub.submitted_at) : 'Not submitted'}</div>
    </div>
    <div>
      <div class="label">Word count</div>
      <div class="value">${sub.word_count||0}</div>
    </div>
    <div>
      <div class="label">Time away</div>
      <div class="value">${totalAway > 0 ? totalAway+'s' : '—'}</div>
    </div>
  </div>

  <div class="section">
    <div class="label">Essay</div>
    <div class="essay-box">
      <div class="essay-text">${esc(sub.essay_text||'(no essay text)')}</div>
    </div>
  </div>

  <div class="section">
    <div class="label">Process Log</div>
    ${flags ? `<div class="flags">Notable: ${esc(flags)}</div>` : ''}
    <table>
      <thead><tr><th>Event</th><th>Time</th><th>Elapsed</th><th>Detail</th></tr></thead>
      <tbody>${logRows}</tbody>
    </table>
  </div>

  <div class="disclaimer">This process log is one input among many. It records observable writing behaviours — paste events, window focus changes, and typing patterns — but does not record keystrokes, clipboard contents, or screen activity. Educator judgment governs all interpretation and any subsequent conversation with the student.</div>

  <script>window.onload = () => window.print();<\/script>
</body>
</html>`;

    const w = window.open('', '_blank');
    if (!w) { toast('Pop-up blocked — please allow pop-ups for this site', 'warning', 5000); return; }
    w.document.write(html);
    w.document.close();
  } catch(err) { toast('Failed to generate report: ' + err.message, 'error'); }
}


async function unsubmitStudent(subId, displayName) {
  openModal(`
    <div class="modal-header">
      <h3>Return student to session?</h3>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <p><strong>${esc(displayName)}</strong> will be able to re-enter the writing environment using the same join code and name. Their saved essay text will be restored. Only work typed after the last autosave (every 30 seconds) may have been lost.</p>
      <p style="margin-top:var(--space-sm);color:var(--pt-muted);font-size:var(--text-sm)">This does not affect their process log — all previously recorded events are preserved.</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="closeModal();confirmUnsubmit('${subId}')">Return to Session</button>
    </div>`);
}

async function confirmUnsubmit(subId) {
  try {
    const { error } = await db.from('submissions')
      .update({ is_submitted: false, submitted_at: null })
      .eq('id', subId);
    if (error) throw error;
    toast('Student returned to session — they can continue writing', 'success', 4000);
    // Refresh the table so the row reflects the new state
    const { data: subs } = await db.from('submissions').select('*').eq('session_id', STATE.selectedSessionId);
    if (subs) { STATE.allSubmissions = subs; renderSubmissionsTable(subs); }
  } catch(err) {
    toast('Could not allow resubmit: ' + err.message, 'error');
  }
}


function hasNotableEvent(log) {
  const pastes = log.filter(e => e.type === 'paste');
  if (log.some(e => e.type === 'large_paste')) return true;
  if (log.some(e => e.type === 'replacement_text')) return true;
  if (log.some(e => e.type === 'paste_then_delete')) return true;
  const focuses = log.filter(e => e.type === 'window_focus');
  if (focuses.some(e => (e.char_count || 0) >= 120)) return true;
  return false;
}

function labelForEvent(type, entry) {
  if (type === 'paste' && entry) {
    return entry.paste_origin === 'internal' ? 'Paste — internal' : 'Paste — external';
  }
  const l={paste:'Paste event',window_blur:'Left window',tab_hidden:'Left window',window_focus:'Returned to window',first_keystroke:'Writing began',idle:'Idle after return',large_paste:'Large paste',replacement_text:'Text replacement',word_drop:'Word count drop',paste_then_delete:'Content removed after paste',submitted:'Essay submitted',teacher_note_received:'Note from teacher',teacher_note_dismissed:'Note dismissed',hand_raised:'Called teacher',hand_lowered:'Hand lowered'};
  return l[type]||type.replace(/_/g,' ');
}
function getLogDetail(entry) {
  switch(entry.type){
    case 'paste': return `${entry.char_count} chars${entry.after_blur?' — after leaving window':''}${entry.content_preview?' — "'+entry.content_preview+'…"':''}`;
    case 'large_paste': return `${entry.char_count} chars — ${entry.paste_origin||'unknown origin'}${entry.after_blur?' — after leaving window':''}`;
    case 'replacement_text': return `${entry.char_count} chars replaced without paste — ${entry.content_preview?'"'+entry.content_preview+'"':''}`;
    case 'window_blur': case 'tab_hidden': return 'Window left focus';
    case 'window_focus': return entry.content_preview||'Window returned';
    case 'first_keystroke': return entry.content_preview||'Writing began';
    case 'idle': return entry.content_preview||'Idle period after returning to window';
    case 'submitted': return entry.content_preview||'Essay submitted';
    case 'word_drop': return entry.content_preview||'Word count dropped significantly';
    case 'paste_then_delete': return entry.content_preview||'Content removed shortly after paste';
    case 'teacher_note_received': return entry.content_preview ? `"${entry.content_preview}"` : 'Note received';
    case 'teacher_note_dismissed': return 'Student dismissed the note';
    case 'hand_raised': return 'Student called for teacher attention';
    case 'hand_lowered': return 'Student lowered their hand';
    default: return entry.content_preview||'';
  }
}

// ── TEACHER NOTE (teacher side) ──
function openSendNoteModal(subId, displayName) {
  const sub = STATE.allSubmissions.find(s => s.id === subId);
  const existing = sub?.teacher_note || '';
  openModal(`<div class="modal-header">
    <h3>Send Note to ${esc(displayName)}</h3>
    <button class="modal-close" onclick="closeModal()">×</button>
  </div>
  <div class="modal-body">
    <textarea id="note-modal-input" maxlength="200" placeholder="Write a note…" style="width:100%;height:80px;font-family:'DM Sans',sans-serif;font-size:var(--text-sm);padding:0.5rem 0.75rem;border:1.5px solid var(--pt-border);border-radius:var(--radius-sm);resize:none;outline:none">${esc(existing)}</textarea>
    <div style="font-size:var(--text-xs);color:var(--pt-muted);margin-top:0.4rem">Student sees this as a dismissible banner. Sending replaces any existing note.</div>
  </div>
  <div class="modal-footer">
    ${existing ? `<button class="btn btn-ghost" style="color:var(--pt-muted)" onclick="closeModal();clearTeacherNote('${subId}')">Clear Note</button>` : ''}
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="closeModal();sendTeacherNoteFromModal('${subId}')">Send</button>
  </div>`);
  setTimeout(() => {
    const ta = document.getElementById('note-modal-input');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }, 50);
}

async function sendTeacherNoteFromModal(subId) {
  const input = document.getElementById('note-modal-input');
  const note = input ? input.value.trim() : '';
  if (!note) return;
  await sendTeacherNote(subId, note);
}

async function sendTeacherNote(subId, note) {
  if (!note) return;
  try {
    await db.from('submissions').update({teacher_note: note}).eq('id', subId);
    const idx = STATE.allSubmissions.findIndex(s => s.id === subId);
    if (idx >= 0) STATE.allSubmissions[idx].teacher_note = note;
    renderSubmissionsTable(STATE.allSubmissions, true);
    toast('Note sent', 'success', 2000);
  } catch(err) { toast('Failed to send note: ' + err.message, 'error'); }
}
async function clearTeacherNote(subId) {
  try {
    await db.from('submissions').update({teacher_note: null}).eq('id', subId);
    const idx = STATE.allSubmissions.findIndex(s => s.id === subId);
    if (idx >= 0) STATE.allSubmissions[idx].teacher_note = null;
    renderSubmissionsTable(STATE.allSubmissions);
  } catch(err) { toast('Failed to clear note: ' + err.message, 'error'); }
}
async function teacherDismissHand(subId, displayName) {
  try {
    await db.from('submissions').update({student_hand_raised: false}).eq('id', subId);
    const idx = STATE.allSubmissions.findIndex(s => s.id === subId);
    if (idx >= 0) STATE.allSubmissions[idx].student_hand_raised = false;
    renderSubmissionsTable(STATE.allSubmissions);
    toast(`${displayName}'s hand lowered`, 'success', 2000);
  } catch(err) { toast('Failed to dismiss: ' + err.message, 'error'); }
}

// ── EXPORT ──



// ── CONSOLIDATED SESSION PRINT REPORT ──
async function printFullSessionReport() {
  const subs = STATE.allSubmissions;
  if (!subs || !subs.length) { toast('No submissions to print', 'warning'); return; }
  try {
    const sess = STATE._lastSessions && STATE._lastSessions[STATE.selectedAssignmentId];
    const asgn = (STATE._assignments||[]).find(a => a.id === STATE.selectedAssignmentId);
    if (!asgn) { toast('Assignment data not loaded', 'error'); return; }
    const {data:teacherRow} = await db.from('teachers').select('display_name, email').eq('id', asgn.teacher_id).maybeSingle();
    const teacherLabel = teacherRow?.display_name || teacherRow?.email || '—';
    const ptLabels = {essay:'Open Writing', document_based:'Document-Based', source_analysis:'Source-Based'};
    const ptLabel = ptLabels[asgn.prompt_type] || 'Open Writing';
    const printDate = new Date().toLocaleString(undefined,{month:'long',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});

    const studentPages = subs.map((sub, idx) => {
      const log = sub.process_log || [];
      const pastes = log.filter(e=>e.type==='paste');
      const blurs = log.filter(e=>e.type==='window_blur'||e.type==='tab_hidden');
      const focuses = log.filter(e=>e.type==='window_focus');
      const totalAway = focuses.reduce((sum,e)=>sum+(e.char_count||0),0);
      const wordDrops = log.filter(e=>e.type==='word_drop');
      const extPastes = pastes.filter(e=>e.paste_origin!=='internal');
      const intPastes = pastes.filter(e=>e.paste_origin==='internal');
      const pasteFlag = extPastes.length>0&&intPastes.length>0
        ? `${extPastes.length} external paste${extPastes.length>1?'s':''} · ${intPastes.length} internal`
        : extPastes.length>0 ? `${extPastes.length} external paste${extPastes.length>1?'s':''}`
        : intPastes.length>0 ? `${intPastes.length} internal paste${intPastes.length>1?'s':''}`
        : pastes.length>0 ? `${pastes.length} paste event${pastes.length>1?'s':''}` : '';
      const flags = [pasteFlag, blurs.length>0?`left window ${blurs.length}×`:'', wordDrops.length>0?'notable word count drop':''].filter(Boolean).join(' · ');
      const logRows = log.length ? log.map(e => `
        <tr>
          <td>${labelForEvent(e.type, e)}</td>
          <td>${formatTime(e.timestamp)}</td>
          <td>${formatElapsed(e.elapsed_seconds)} in</td>
          <td>${esc(getLogDetail(e))}</td>
        </tr>`).join('') : '<tr><td colspan="4" style="color:#999">No events logged.</td></tr>';

      return `<div class="student-page${idx > 0 ? ' page-break' : ''}">
        <div class="student-header">
          <div>
            <div class="student-name">${esc(sub.student_display_name)}</div>
            <div class="student-meta">${esc(sub.class_period||'—')} &nbsp;·&nbsp; ${sub.word_count||0} words &nbsp;·&nbsp; ${sub.is_submitted?'Submitted':'Not submitted'}${sub.submitted_at?' at '+formatTime(sub.submitted_at):''}</div>
          </div>
          <div class="student-stats">
            <div>Away: ${totalAway>0?totalAway+'s':'—'}</div>
            <div>Started: ${formatTime(sub.started_at)}</div>
          </div>
        </div>
        ${flags ? `<div class="flags">${esc(flags)}</div>` : ''}
        <div class="label">Essay</div>
        <div class="essay-box"><div class="essay-text">${esc(sub.essay_text||'(no essay text)')}</div></div>
        <div class="label">Process Log</div>
        <table>
          <thead><tr><th>Event</th><th>Time</th><th>Elapsed</th><th>Detail</th></tr></thead>
          <tbody>${logRows}</tbody>
        </table>
        <div class="disclaimer">This process log is one input among many. Educator judgment governs all interpretation and any subsequent conversation.</div>
      </div>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${esc(asgn.title)} — Session Report</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'DM Sans', sans-serif; color: #1a2235; background: #fff; font-size: 12px; }
    .doc-header { padding: 2rem 3rem 1rem; border-bottom: 2px solid #1a2235; display: flex; justify-content: space-between; align-items: flex-start; }
    .wordmark { font-family: 'DM Sans', sans-serif; font-size: 1rem; font-weight: 600; }
    .wordmark em { font-family: 'Lora', serif; font-style: italic; color: #7B5EA7; }
    .doc-meta { font-size: 11px; color: #888; margin-top: 0.25rem; }
    .print-date { font-size: 11px; color: #888; text-align: right; }
    .assignment-block { padding: 1rem 3rem; background: #f7f7fa; border-bottom: 1px solid #e0e0e0; }
    .assignment-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.2rem; }
    .assignment-sub { font-size: 11px; color: #888; }
    .prompt-box { margin-top: 0.75rem; background: #fff; border-left: 3px solid #7B5EA7; padding: 0.6rem 0.9rem; border-radius: 0 4px 4px 0; }
    .prompt-text { font-family: 'Lora', serif; font-size: 12px; line-height: 1.6; white-space: pre-wrap; }
    .student-page { padding: 1.5rem 3rem; }
    .page-break { page-break-before: always; border-top: 2px solid #e0e0e0; }
    .student-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid #e0e0e0; }
    .student-name { font-size: 1rem; font-weight: 600; }
    .student-meta { font-size: 11px; color: #666; margin-top: 0.2rem; }
    .student-stats { font-size: 11px; color: #888; text-align: right; line-height: 1.6; }
    .label { font-size: 9px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #888; margin-bottom: 0.3rem; margin-top: 0.75rem; }
    .essay-box { border: 1px solid #ddd; border-radius: 4px; padding: 0.75rem 1rem; margin-bottom: 0.75rem; }
    .essay-text { font-family: 'Lora', serif; font-size: 12px; line-height: 1.75; white-space: pre-wrap; }
    .flags { font-size: 11px; color: #b45309; font-weight: 500; margin-bottom: 0.5rem; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 0.75rem; }
    thead th { font-size: 9px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: #888; text-align: left; padding: 0.25rem 0.4rem; border-bottom: 1px solid #e0e0e0; }
    tbody td { padding: 0.25rem 0.4rem; font-size: 11px; color: #444; border-bottom: 1px solid #f0f0f0; }
    tbody tr:nth-child(even) { background: #f9f9fb; }
    .disclaimer { font-size: 10px; color: #aaa; line-height: 1.5; border-top: 1px solid #e0e0e0; padding-top: 0.5rem; margin-top: 0.5rem; }
    @media print { @page { margin: 1.5cm; } }
  </style>
</head>
<body>
  <div class="doc-header">
    <div>
      <div class="wordmark">PaperTrail <em>Write</em></div>
      <div class="doc-meta">Teacher: ${esc(teacherLabel)} &nbsp;·&nbsp; ${subs.length} student${subs.length!==1?'s':''}</div>
    </div>
    <div class="print-date">Printed ${printDate}</div>
  </div>
  <div class="assignment-block">
    <div class="assignment-title">${esc(asgn.title)}</div>
    <div class="assignment-sub">${esc(ptLabel)}${sess?.join_code?' &nbsp;·&nbsp; Code: '+sess.join_code:''}${sess?.started_at?' &nbsp;·&nbsp; '+formatTime(sess.started_at):''}</div>
    ${asgn.prompt_text ? `<div class="prompt-box"><div class="prompt-text">${esc(asgn.prompt_text)}</div></div>` : ''}
  </div>
  ${studentPages}
</body>
</html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    w.onload = () => w.print();
  } catch(err) { toast('Print failed: ' + err.message, 'error'); }
}

async function exportTSV() {
  const subs=STATE.allSubmissions;
  if(!subs.length){toast('No submissions to export','warning');return;}
  const btn=document.getElementById('export-btn');
  if(btn){btn.disabled=true;btn.textContent='Generating…';}
  try {
    const headers=['Student Name','Period','Word Count','Submitted','Submitted At','Paste Events','Large Pastes (200+)','Times Window Left Focus','Total Time Away (seconds)','Time to First Keystroke (seconds)','Essay Text'];
    const rows=subs.map(s=>{
      const log=s.process_log||[];
      const pastes=log.filter(e=>e.type==='paste'),largePaste=log.filter(e=>e.type==='large_paste'),blurs=log.filter(e=>e.type==='window_blur'||e.type==='tab_hidden'),focuses=log.filter(e=>e.type==='window_focus'),totalAway=focuses.reduce((sum,e)=>sum+(e.char_count||0),0),firstKey=log.find(e=>e.type==='first_keystroke');
      return [s.student_display_name,s.class_period||'',s.word_count||0,s.is_submitted?'Yes':'No',s.submitted_at?formatTime(s.submitted_at):'',pastes.length,largePaste.length,blurs.length,totalAway,firstKey?firstKey.elapsed_seconds:'',(s.essay_text||'').replace(/\t/g,' ').replace(/\n/g,' ↵ ')].join('\t');
    });
    const tsv=[headers.join('\t'),...rows].join('\n');
    if(typeof JSZip !== 'undefined') {
      const zip=new JSZip();
      zip.file('session-report.tsv',tsv);
      zip.file('session-report.json',JSON.stringify({session:{assignment_id:STATE.selectedAssignmentId,session_id:STATE.selectedSessionId},submissions:subs},null,2));
      const blob=await zip.generateAsync({type:'blob'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      const _asgn2=(STATE._assignments||[]).find(a=>a.id===STATE.selectedAssignmentId);const _slug2=(_asgn2?.title||'session-report').replace(/[^a-z0-9]+/gi,'-').toLowerCase().replace(/^-+|-+$/g,'');a.href=url;a.download=`${_slug2}.zip`;a.click();URL.revokeObjectURL(url);
      toast('Report ZIP downloaded','success',3000);
    } else {
      try{await navigator.clipboard.writeText(tsv);toast('Tab-separated data copied — paste into Google Sheets','success',4000);}
      catch(e){const blob=new Blob([tsv],{type:'text/plain'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`session-report-${STATE.selectedSessionId||STATE.selectedAssignmentId}.tsv`;a.click();URL.revokeObjectURL(url);}
    }
  } catch(err){toast('Export failed: '+err.message,'error');}
  finally{if(btn){btn.disabled=false;btn.textContent='↓ Export Report';}}
}

// ── START ──
boot();
