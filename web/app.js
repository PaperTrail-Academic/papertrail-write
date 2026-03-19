const { createClient } = supabase;
// Publishable key — safe to be public, security enforced via RLS
const SUPABASE_URL = 'https://iiviamoigtubkebreolx.supabase.co';
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
  pendingBurstChars: 0, burstCheckInterval: null,
  _visibilityHandler: null, _blurHandler: null, _focusHandler: null, _beforeUnloadHandler: null,
  selectedAssignmentId: null, allSubmissions: [], expandedSubId: null,
  selectedSessionId: null,
  _archiveOpen: false,
  _newAssignmentOpen: true,
  _joinCodeValidated: false,
  realtimeChannel: null,
  _realtimePollInterval: null,
  pauseCountdownInterval: null,
  frozenRemaining: null,
  isPreview: false,
  editingAssignmentId: null,
  selectedPromptType: 'essay',
  idleLogged: false,
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
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&family=DM+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #1a2235; color: #fff;
    font-family: 'DM Sans', sans-serif;
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
    font-family: 'DM Mono', monospace;
    font-weight: 500; color: #fff;
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
  <div class="hint">Students go to <strong>papertrail-write.vercel.app</strong> and enter this code</div>
  <script>
    function fitCode() {
      const el = document.getElementById('code');
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let size = Math.floor(vw * 0.85 / el.textContent.length * 1.1);
      size = Math.min(size, Math.floor(vh * 0.55));
      el.style.fontSize = size + 'px';
      while (el.scrollWidth > vw * 0.92 && size > 10) {
        size--;
        el.style.fontSize = size + 'px';
      }
    }
    window.addEventListener('load', fitCode);
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
  if (hash.includes('type=recovery') || hash.includes('type=invite')) {
    const { data, error } = await db.auth.getSessionFromUrl();
    window.history.replaceState(null, '', window.location.pathname);
    if (!error && data?.session) { showScreen('new-password'); return; }
    showScreen('teacher-login'); return;
  }
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    STATE.teacher = session.user;
    document.getElementById('dash-user-email').textContent = session.user.email;
    await loadDashboard();
    showScreen('dashboard');
    return;
  }
  showScreen('landing');
}

db.auth.onAuthStateChange(async (event, session) => {
  if (event === 'PASSWORD_RECOVERY') { showScreen('new-password'); }
});

// ── SCREEN ROUTER ──
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
    openModal(`<div class="modal-header"><h3>Plan limit reached</h3><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body">${esc(msg)}</div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="closeModal()">Upgrade — coming soon</button>
      </div>`);
    return true;
  } catch(err) {
    console.warn('check-plan-limits unreachable, failing open:', err.message);
    return false;
  }
}
function elapsedSeconds() { if(!STATE.startedAt) return 0; return Math.floor((Date.now()-new Date(STATE.startedAt).getTime())/1000); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function formatTime(iso) { if(!iso) return '—'; try { return new Date(iso).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); } catch { return iso; } }
function formatElapsed(secs) { if(secs==null) return '—'; const m=Math.floor(secs/60),s=secs%60; return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }

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
  try {
    const {data,error} = await db.auth.signUp({email,password:pw});
    if(error) throw error;
    if(data.user) {
      await db.from('teachers').update({display_name:name||null,school_name:school||null}).eq('id',data.user.id);
    }
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
    document.getElementById('dash-user-email').textContent=data.user.email;
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
    const {data:sessions,error:sessErr}=await db.from('sessions').select('*').eq('join_code',joinCode).eq('status','active');
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
      STATE.submissionId=existing.id; STATE.assignmentId=assignment.id;
      STATE.assignmentTitle=assignment.title;
      // Fold in any per-student extra time already granted
      STATE.timeLimitSeconds = effectiveSeconds + ((existing.extra_minutes||0) * 60);
      STATE.assignmentPromptText=assignment.prompt_text||'';
      STATE.assignmentPromptType=assignment.prompt_type||'essay';
      STATE.assignmentAllowSpellcheck=assignment.allow_spellcheck||false;
      STATE.studentName=name; STATE.period=period; STATE.startedAt=existing.started_at;
      STATE.processLog=existing.process_log||[]; STATE.isSubmitted=false;
      STATE._resumeText=existing.essay_text||'';
    } else {
      const now=new Date().toISOString();
      const {data:newSub,error:nErr}=await db.from('submissions').insert({
        session_id:session.id,
        assignment_id:assignment.id,
        teacher_id:assignment.teacher_id,
        student_display_name:name,class_period:period,
        essay_text:'',word_count:0,process_log:[],started_at:now,is_submitted:false,
      }).select().single();
      if(nErr) throw nErr;
      STATE.submissionId=newSub.id; STATE.assignmentId=assignment.id;
      STATE.assignmentTitle=assignment.title; STATE.timeLimitSeconds=effectiveSeconds;
      STATE.assignmentPromptText=assignment.prompt_text||'';
      STATE.assignmentPromptType=assignment.prompt_type||'essay';
      STATE.assignmentAllowSpellcheck=assignment.allow_spellcheck||false;
      STATE.studentName=name; STATE.period=period; STATE.startedAt=now;
      STATE.processLog=[]; STATE.isSubmitted=false;
    }
    // Load sources for this assignment
    await loadSources(assignment.id);
    showScreen('transparency');
  } catch(err) {
    statusEl.className='status-msg error'; statusEl.textContent='Something went wrong: '+err.message;
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
  STATE.burstCheckInterval=setInterval(checkBurstAndIdle,3000);
  attachProcessListeners(editor);
  STATE._visibilityHandler=()=>{
    if(document.hidden){STATE._blurStartTime=Date.now();logEventImmediate('window_blur',{content_preview:'Window left focus'});}
    else if(STATE._blurStartTime){const s=Math.round((Date.now()-STATE._blurStartTime)/1000);logEventImmediate('window_focus',{char_count:s,content_preview:`Window returned — ${s}s away`});STATE._blurStartTime=null;}
  };
  document.addEventListener('visibilitychange',STATE._visibilityHandler);
  STATE._blurHandler=()=>{if(!document.hidden){STATE._blurStartTime=Date.now();logEventImmediate('window_blur',{content_preview:'Window left focus'});}};
  STATE._focusHandler=()=>{if(STATE._blurStartTime){const s=Math.round((Date.now()-STATE._blurStartTime)/1000);logEventImmediate('window_focus',{char_count:s,content_preview:`Window returned — ${s}s away`});STATE._blurStartTime=null;}};
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
  if (!STATE.submissionId || !STATE.timeLimitSeconds) return;
  const ch = db.channel('submission-time-' + STATE.submissionId)
    .on('postgres_changes', {event:'UPDATE', schema:'public', table:'submissions', filter:`id=eq.${STATE.submissionId}`}, (payload) => {
      const newExtra = payload.new?.extra_minutes;
      const oldExtra = payload.old?.extra_minutes;
      if (newExtra != null && newExtra !== oldExtra) {
        const addedSecs = (newExtra - (oldExtra || 0)) * 60;
        if (addedSecs > 0) applyExtraTime(addedSecs);
      }
    })
    .subscribe();
  STATE._submissionTimeChannel = ch;
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
    if(ind){ind.className='autosave-indicator';ind.textContent='Save failed — retrying…';}
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
    logEventImmediate('paste',{char_count:p.length,content_preview:p.slice(0,80)});
    const cap=editor.value.length+p.length;
    setTimeout(()=>checkPasteThenDelete(cap),90000);
  });
  editor.addEventListener('input',()=>{
    const now=Date.now(),cur=editor.value.length,d=cur-STATE.lastTextLength;
    if(d<=-100) logEvent('delete_burst',{char_count:Math.abs(d)});
    if(d>0) STATE.pendingBurstChars+=d;
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
  if(ssi>5&&STATE.pendingBurstChars>=50){logEvent('burst',{char_count:STATE.pendingBurstChars});STATE.pendingBurstChars=0;}
  if(ssi>120&&!STATE.idleLogged&&STATE.lastInputTime){logEvent('idle',{content_preview:`Gap of ~${Math.round(ssi/60)} minute(s)`});STATE.idleLogged=true;}
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
  clearInterval(STATE.timerInterval); clearInterval(STATE.autosaveInterval); clearInterval(STATE.burstCheckInterval);
  STATE.idleLogged = false;
  if(STATE._visibilityHandler) document.removeEventListener('visibilitychange',STATE._visibilityHandler);
  if(STATE._blurHandler) window.removeEventListener('blur',STATE._blurHandler);
  if(STATE._focusHandler) window.removeEventListener('focus',STATE._focusHandler);
  if(STATE._beforeUnloadHandler) { window.removeEventListener('beforeunload',STATE._beforeUnloadHandler); STATE._beforeUnloadHandler=null; }
  if(STATE.pendingBurstChars>=50){logEvent('burst',{char_count:STATE.pendingBurstChars});STATE.pendingBurstChars=0;}
  const ta=document.getElementById('essay-textarea');
  const finalText=ta?ta.value:''; if(ta) ta.disabled=true;
  try {
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
  const pastes=log.filter(e=>e.type==='paste'),blurs=log.filter(e=>e.type==='window_blur'),bursts=log.filter(e=>e.type==='burst');
  el.innerHTML=`<h3>Your Writing Process</h3><div class="process-summary-items"><div class="ps-item"><strong>${bursts.length}</strong> typing burst${bursts.length!==1?'s':''}</div><div class="ps-item"><strong>${pastes.length}</strong> paste event${pastes.length!==1?'s':''}</div><div class="ps-item"><strong>${blurs.length}</strong> time${blurs.length!==1?'s':''} window left focus</div></div>`;
}
async function copyToClipboard(silent=false) {
  const ta=document.getElementById('submitted-essay'); if(!ta) return;
  try{await navigator.clipboard.writeText(ta.value);if(!silent) toast('Essay copied to clipboard','success');}
  catch(e){ta.select();document.execCommand('copy');if(!silent) toast('Essay copied','success');}
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
    ] = await Promise.all([
      db.from('assignments').select('*').eq('teacher_id',user.id).order('created_at',{ascending:false}),
      db.from('sessions').select('*').eq('teacher_id',user.id), // fetch ALL including ended
      db.from('classes').select('*').eq('teacher_id',user.id).order('name',{ascending:true}),
    ]);
    if(aErr) throw aErr;
    if(sErr) throw sErr;
    STATE._classes = classes||[];
    const sessionsByAssignment={};
    const hasEverRun={};
    (sessions||[]).forEach(s=>{
      hasEverRun[s.assignment_id]=true;
      if(s.status!=='ended') sessionsByAssignment[s.assignment_id]=s;
    });
    STATE._lastSessions=sessionsByAssignment;
    const merged=(assignments||[]).map(a=>({
      ...a,
      _session: sessionsByAssignment[a.id]||null,
      _status: sessionsByAssignment[a.id]?.status||(hasEverRun[a.id]?'inactive':'draft'),
      _hasEverRun: hasEverRun[a.id]||false,
      _joinCode: sessionsByAssignment[a.id]?.join_code||a.join_code||'—',
    }));
    renderAssignmentList(merged);
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
  // Check duplicate
  const exists = roster.some(s => (typeof s==='string'?s:s.name).toLowerCase() === name.toLowerCase());
  if (exists) { toast('That name is already in the roster','warning'); return; }
  roster.push({name, extended_minutes: null});
  await saveRoster(classId, roster);
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
      <button class="btn btn-primary" onclick="doAddClass()">Create Class</button>
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
      <button class="btn btn-primary" onclick="doAddClassFromForm()">Create Class</button>
    </div>`);
  setTimeout(()=>document.getElementById('new-class-name')?.focus(), 50);
}

async function doAddClassFromForm() {
  const {data:{user}} = await db.auth.getUser(); if (!user) return;
  const name = document.getElementById('new-class-name')?.value.trim();
  if (!name) { toast('Please enter a class name','warning'); return; }
  const limited = await checkPlanLimit('class', user.id);
  if (limited) return;
  try {
    const {data:cls,error} = await db.from('classes').insert({teacher_id:user.id, name, student_roster:[]}).select().single();
    if (error) throw error;
    closeModal();
    STATE._classes = [...(STATE._classes||[]), cls].sort((a,b)=>a.name.localeCompare(b.name));
    renderClassList(STATE._classes, 'class-list', false);
    renderClassList(STATE._classes, 'roster-class-list', true);
    // Refresh the assignment form selector and auto-select the new class
    refreshClassSelector(STATE._classes);
    const sel = document.getElementById('a-class');
    if (sel) sel.value = cls.id;
    toast(`Class "${name}" created and selected`, 'success');
  } catch(err) { toast('Failed to create class: '+err.message,'error'); }
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
  const limited = await checkPlanLimit('class', user.id);
  if (limited) return;
  try {
    const {data:cls,error} = await db.from('classes').insert({teacher_id:user.id, name, student_roster:[]}).select().single();
    if (error) throw error;
    closeModal();
    STATE._classes = [...(STATE._classes||[]), cls].sort((a,b)=>a.name.localeCompare(b.name));
    renderClassList(STATE._classes, 'class-list', false);
    renderClassList(STATE._classes, 'roster-class-list', true);
    toast(`Class "${name}" created`,'success');
  } catch(err) { toast('Failed to create class: '+err.message,'error'); }
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
      <p style="margin-bottom:var(--space-md);color:var(--pt-muted);font-size:var(--text-sm)">One name per row. Names will be added to the current roster — existing names are not removed.</p>
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
  if(!assignments.length){el.innerHTML='<div class="empty-panel">No assignments yet. Create one above.</div>';return;}
  const ptLabels={essay:'Open Writing', document_based:'Document-Based', source_analysis:'Source-Based'};

  const active = assignments.filter(a => !a.archived);
  const archived = assignments.filter(a => a.archived);

  const renderCard = (a) => {
    const isActive=a._status==='active';
    const isPaused=a._status==='paused';
    const isInactive=a._status==='inactive';
    const sessionId=a._session?.id||null;
    const statusPill=isActive
      ?`<span class="pill pill-active">Active</span>`
      :isPaused
        ?`<span class="pill" style="background:#fff8e1;color:var(--warning);border-color:#f0c040">Paused</span>`
        :a.archived
          ?`<span class="pill" style="background:var(--pt-light);color:var(--pt-muted);border-color:var(--pt-border)">Archived</span>`
          :isInactive
            ?`<span class="pill" style="background:var(--pt-light);color:var(--pt-muted);border-color:var(--pt-border)">Inactive</span>`
            :`<span class="pill pill-inactive">Draft</span>`;
    const ptLabel=ptLabels[a.prompt_type]||'Essay';
    const className = a.class_id ? ((STATE._classes||[]).find(c=>c.id===a.class_id)?.name||'') : '';
    const classPart = className ? ` · ${esc(className)}` : '';

    // Purge warning — show amber notice when session data is approaching auto-purge
    let purgeWarning = '';
    if ((isActive || isPaused) && a._session?.last_active_at) {
      const lastActive = new Date(a._session.last_active_at).getTime();
      const cutoffDays = a.time_limit_minutes ? 7 : 30;
      const cutoffMs = cutoffDays * 86400 * 1000;
      const ageMs = Date.now() - lastActive;
      const daysLeft = Math.ceil((cutoffMs - ageMs) / 86400000);
      if (daysLeft <= 3 && daysLeft > 0) {
        purgeWarning = `<div style="margin-top:0.35rem;font-size:var(--text-xs);color:#b45309;background:#fff8e1;border:1px solid #f0c040;border-radius:var(--radius-sm);padding:0.2rem 0.5rem;display:inline-block">⚠ Session data expires in ${daysLeft} day${daysLeft!==1?'s':''} — download report or end session</div>`;
      } else if (daysLeft <= 0) {
        purgeWarning = `<div style="margin-top:0.35rem;font-size:var(--text-xs);color:#991b1b;background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--radius-sm);padding:0.2rem 0.5rem;display:inline-block">⚠ Session data will be purged tonight — download report now</div>`;
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
        :`<div class="assignment-actions-row assignment-actions-primary">
            <button class="btn btn-success" onclick="openSession('${a.id}')">${isInactive?'Open New Session':'Open Session'}</button>
            <button class="btn btn-danger" onclick="deleteAssignment('${a.id}','${esc(a.title)}')">Delete</button>
          </div>`;
    const editPreviewActions = a.archived
      ?`<div class="assignment-actions-row assignment-actions-secondary">
          <button class="btn btn-secondary" onclick="event.stopPropagation();unarchiveAssignment('${a.id}')">↩ Unarchive</button>
          <button class="btn btn-ghost" onclick="event.stopPropagation();duplicateAssignment('${a.id}')">Duplicate & Edit</button>
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
    return `<div class="assignment-item ${isActive?'active-assignment':''} ${STATE.selectedAssignmentId===a.id?'selected':''} ${a.archived?'archived-assignment':''}" onclick="selectAssignment('${a.id}')">
      <div class="assignment-item-title">${esc(a.title)}</div>
      <div class="assignment-item-meta">${ptLabel}${classPart} · ${a.time_limit_minutes?a.time_limit_minutes+' min':'No limit'}</div>
      <div style="margin-top:0.3rem;display:flex;align-items:center;gap:0.5rem">
        ${statusPill}
        ${(isActive||isPaused)?`<span style="font-family:'DM Mono',monospace;font-size:var(--text-xs);font-weight:600;color:var(--pt-write);background:var(--pt-write-pale);border:1px solid var(--pt-write-l);border-radius:var(--radius-sm);padding:0.15rem 0.5rem;letter-spacing:0.06em">${esc(a._joinCode)}</span>`:''}
        ${isActive?`<button onclick="event.stopPropagation();projectJoinCode('${esc(a._joinCode)}','${esc(a.title)}')" title="Project join code in new window" style="background:none;border:none;padding:0.1rem 0.2rem;cursor:pointer;color:var(--pt-muted);font-size:0.9rem;line-height:1;border-radius:3px" onmouseover="this.style.color='var(--pt-write)'" onmouseout="this.style.color='var(--pt-muted)'">⛶</button>`:''}
      </div>
      ${purgeWarning}
      <div class="assignment-item-actions" onclick="event.stopPropagation()">${sessionActions}${editPreviewActions}</div>
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
  if (hint) hint.textContent = STATE.selectedPromptType === 'document_based' ? '1 source maximum' : 'Up to 8 sources';
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
    const typeLabels = {text:'Plain Text', pdf:'PDF', image:'Image', docx:'Word Doc'};
    const typeTabs = ['text','pdf','image','docx'].map(t =>
      `<button class="source-type-tab ${src.type===t?'active':''}" onclick="selectSourceType(${idx},'${t}')">${typeLabels[t]}</button>`
    ).join('');

    let bodyHtml = '';
    if (src.type === 'text') {
      bodyHtml = `<textarea class="source-text-input" placeholder="Paste or type source text…" oninput="STATE.formSources[${idx}].text_content=this.value">${esc(src.text_content||'')}</textarea>`;
    } else {
      const accept = src.type==='pdf' ? '.pdf' : src.type==='image' ? '.jpg,.jpeg,.png,.webp,.gif' : '.docx';
      const hasFile = src.storage_path || src._file;
      const fileName = src._file ? src._file.name : (src.storage_path ? src.storage_path.split('/').pop() : '');
      const fileSize = src._file ? formatBytes(src._file.size) : '';
      bodyHtml = `
        <div class="source-drop-zone ${src._uploading?'drag-over':''}" id="drop-zone-${idx}"
          ondragover="event.preventDefault();this.classList.add('drag-over')"
          ondragleave="this.classList.remove('drag-over')"
          ondrop="event.preventDefault();this.classList.remove('drag-over');handleSourceFileSelect(${idx},event.dataTransfer.files[0])">
          <input type="file" accept="${accept}" onchange="handleSourceFileSelect(${idx},this.files[0])">
          <div class="source-drop-zone-label">
            ${src._uploading
              ? '<span style="color:var(--pt-write)">Uploading…</span>'
              : '<strong>Choose file</strong> or drag and drop here'}
          </div>
        </div>
        ${hasFile ? `<div class="source-file-pill">
          <span class="source-file-pill-name">${esc(fileName)}</span>
          ${fileSize ? `<span class="source-file-pill-size">${fileSize}</span>` : ''}
          <button class="source-file-remove" onclick="clearSourceFile(${idx})" title="Remove file">✕</button>
        </div>` : ''}`;
    }

    return `<div class="source-card" id="source-card-${idx}">
      <div class="source-card-header">
        <span class="source-drag-handle">⠿</span>
        <input class="source-label-input" type="text" value="${esc(src.label||'')}"
          placeholder="Label (e.g. Document A)"
          oninput="STATE.formSources[${idx}].label=this.value">
        <button class="source-remove-btn" onclick="removeSource(${idx})" title="Remove source">✕</button>
      </div>
      <div class="source-type-tabs">${typeTabs}</div>
      <div class="source-body">${bodyHtml}</div>
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

function selectSourceType(idx, type) {
  STATE.formSources[idx].type = type;
  STATE.formSources[idx]._file = null;
  renderFormSources();
}

function handleSourceFileSelect(idx, file) {
  if (!file) return;
  const src = STATE.formSources[idx];
  const maxBytes = 20 * 1024 * 1024; // 20MB
  if (file.size > maxBytes) { toast('File must be under 20MB','warning'); return; }
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
            spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off"></textarea>
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
            spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off"></textarea>
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
      <button class="btn btn-primary" onclick="closeModal();doOpenSession('${assignmentId}')">Open Session →</button>
    </div>`);
}

async function doOpenSession(assignmentId) {
  const {data:{user}}=await db.auth.getUser(); if(!user) return;
  const classId = document.getElementById('open-session-class')?.value||null;
  const label = document.getElementById('open-session-label')?.value.trim()||null;
  try {
    // Always generate a fresh code — never reuse the assignment's code
    let code = _mkCode();
    const payload = {
      assignment_id:assignmentId, teacher_id:user.id,
      status:'active', join_code:code,
      last_active_at:new Date().toISOString(),
    };
    if (classId) payload.class_id = classId;
    if (label) payload.session_label = label;
    let result=await db.from('sessions').insert(payload);
    // On collision, regenerate a fresh code and retry once
    if(result.error && result.error.code==='23505') {
      code = _mkCode();
      payload.join_code = code;
      result=await db.from('sessions').insert(payload);
    }
    if(result.error) throw result.error;
    toast(`Session opened — join code: ${code}`,'success',5000);
    STATE.selectedAssignmentId = assignmentId;
    await loadDashboard();
  } catch(err){toast('Failed to open session: '+err.message,'error');}
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
          if(idx>=0){STATE.allSubmissions[idx]={...STATE.allSubmissions[idx],...payload.new};renderSubmissionsTable(STATE.allSubmissions);}
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
  // This ensures the teacher always sees current data even if realtime drops
  STATE._realtimePollInterval = setInterval(()=>{
    if(STATE.selectedAssignmentId) loadSubmissions(STATE.selectedAssignmentId);
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

async function reopenSession(assignmentId,sessionId) {
  try {
    const {error}=await db.from('sessions').update({status:'active',paused_at:null}).eq('id',sessionId);
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
    <div class="modal-header"><h3>End assignment</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <p style="margin-bottom:var(--space-md)"><strong>${esc(title)}</strong></p>
      <div class="disclaimer" style="margin-bottom:var(--space-md)">Download the session report before ending. Once ended, <strong>this session's</strong> student submission data will be permanently deleted. The assignment stays open — you can run it again with a new session.</div>
      <button class="btn btn-secondary btn-block" id="download-report-btn" onclick="downloadReportZip(${JSON.stringify(reportData).replace(/"/g,'&quot;')})">↓ Download Session Report</button>
      <div style="margin-top:var(--space-md);display:none" id="end-confirm-section">
        <label style="display:flex;gap:0.75rem;align-items:flex-start;cursor:pointer;font-size:var(--text-sm)">
          <input type="checkbox" id="end-confirm-check" onchange="document.getElementById('do-end-btn').disabled=!this.checked" style="margin-top:3px;accent-color:var(--pt-write)">
          <span>I have downloaded the report and understand that student data will be deleted.</span>
        </label>
        <button class="btn btn-danger btn-block" style="margin-top:var(--space-md)" id="do-end-btn" disabled onclick="closeModal();doEndAssignment('${assignmentId}','${sessionId}')">End Assignment</button>
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
      const pastes=log.filter(e=>e.type==='paste'),largePaste=pastes.filter(e=>e.char_count>200),blurs=log.filter(e=>e.type==='window_blur'||e.type==='tab_hidden'),focuses=log.filter(e=>e.type==='window_focus'),totalAway=focuses.reduce((sum,e)=>sum+(e.char_count||0),0),firstKey=log.find(e=>e.type==='first_keystroke');
      return [s.student_display_name,s.class_period||'',s.word_count||0,s.is_submitted?'Yes':'No',s.submitted_at?formatTime(s.submitted_at):'',pastes.length,largePaste.length,blurs.length,totalAway,firstKey?firstKey.elapsed_seconds:'',(s.essay_text||'').replace(/\t/g,' ').replace(/\n/g,' ↵ ')].join('\t');
    });
    zip.file('session-report.tsv',[headers.join('\t'),...rows].join('\n'));
    const blob=await zip.generateAsync({type:'blob'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    const slug=(reportData.session?.assignment_title||'report').replace(/[^a-z0-9]+/gi,'-').toLowerCase();
    a.download=`papertrail-write-${slug}.zip`;
    a.click(); URL.revokeObjectURL(url);
    if(btn){btn.textContent='↓ Downloaded ✓';btn.className='btn btn-success btn-block';}
    // Show confirm section
    const section=document.getElementById('end-confirm-section');
    if(section) section.style.display='block';
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
    toast('Session ended — student data deleted','success');
    loadDashboard();
    // Reload submissions panel to show remaining sessions
    if (STATE.selectedAssignmentId === assignmentId) loadSubmissions(assignmentId);
  } catch(err){toast('Failed to end session: '+err.message,'error');}
}

async function deleteAssignment(id,title) {
  openModal(`<div class="modal-header"><h3>Delete assignment?</h3><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body">This will permanently delete <strong>${esc(title)}</strong>. Only draft assignments (no active session) can be deleted.</div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-danger" onclick="closeModal();doDeleteAssignment('${id}')">Delete Permanently</button></div>`);
}
async function doDeleteAssignment(id) {
  try {
    await db.from('assignments').delete().eq('id',id);
    if(STATE.selectedAssignmentId===id){STATE.selectedAssignmentId=null;STATE.allSubmissions=[];document.getElementById('submissions-table-wrap').innerHTML='<div class="empty-panel" style="padding:3rem">Select an assignment on the left.</div>';document.getElementById('sub-count').textContent='Select an assignment to view its session report.';document.getElementById('export-btn').disabled=true;}
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

async function loadSubmissions(assignmentId) {
  document.getElementById('submissions-table-wrap').innerHTML='<div class="empty-panel" style="padding:2rem">Loading…</div>';
  try {
    // Fetch ALL sessions for this assignment, newest first
    const {data:sessions, error:sErr} = await db.from('sessions')
      .select('id, status, join_code, started_at, ended_at, class_id, session_label')
      .eq('assignment_id', assignmentId)
      .order('started_at', {ascending: false});
    if (sErr) throw sErr;

    if (!sessions || !sessions.length) {
      STATE.allSubmissions = [];
      document.getElementById('submissions-table-wrap').innerHTML = '<div class="empty-panel" style="padding:3rem">No sessions yet for this assignment.</div>';
      document.getElementById('sub-count').textContent = 'No session data.';
      document.getElementById('export-btn').disabled = true;
      return;
    }

    // Pick session to show: prefer the one in STATE.selectedSessionId if it belongs to this assignment,
    // otherwise default to the most recent non-ended, or most recent overall
    const activeSess = sessions.find(s => s.status === 'active' || s.status === 'paused');
    const targetSession = sessions.find(s => s.id === STATE.selectedSessionId)
      || activeSess
      || sessions[0];
    STATE.selectedSessionId = targetSession.id;

    // Render session selector if multiple sessions exist
    renderSessionSelector(sessions, targetSession.id, assignmentId);

    // Load submissions for target session
    const {data, error} = await db.from('submissions').select('*')
      .eq('session_id', targetSession.id)
      .order('started_at', {ascending: true});
    if (error) throw error;
    STATE.allSubmissions = data || [];
    renderSubmissionsTable(data || []);
    document.getElementById('export-btn').disabled = !data || !data.length;
  } catch(err) { toast('Failed to load session report: '+err.message,'error'); }
}

function renderSessionSelector(sessions, activeId, assignmentId) {
  // Only show selector if more than 1 session
  const toolbar = document.getElementById('sub-toolbar');
  if (!toolbar) return;

  // Remove existing session selector if present
  const existing = document.getElementById('session-selector-wrap');
  if (existing) existing.remove();

  if (sessions.length <= 1) return;

  const sessionLabel = (s) => {
    // Prefer explicit label, then class name, then fallback to date
    if (s.session_label) return s.session_label;
    const cls = (STATE._classes||[]).find(c => c.id === s.class_id);
    if (cls) return `${cls.name} · ${formatTime(s.started_at)}`;
    return formatTime(s.started_at);
  };
  const statusTag = s => s.status === 'active' ? ' ●' : s.status === 'paused' ? ' ⏸' : '';
  const options = sessions.map(s =>
    `<option value="${s.id}" ${s.id===activeId?'selected':''}>${sessionLabel(s)}${statusTag(s)}</option>`
  ).join('');

  const wrap = document.createElement('div');
  wrap.id = 'session-selector-wrap';
  wrap.style.cssText = 'padding:0.5rem var(--space-md);background:#f8f6fd;border-bottom:1px solid var(--pt-border);display:flex;align-items:center;gap:0.75rem;font-size:var(--text-sm)';
  wrap.innerHTML = `<span style="color:var(--pt-muted);font-size:var(--text-xs);font-weight:600;letter-spacing:0.06em;text-transform:uppercase">Session</span>
    <select style="flex:1;padding:0.35rem 0.6rem;border:1.5px solid var(--pt-border);border-radius:var(--radius-sm);font-family:'DM Sans',sans-serif;font-size:var(--text-sm);color:var(--pt-ink)"
      onchange="switchSession('${assignmentId}', this.value)">${options}</select>
    <span style="font-size:var(--text-xs);color:var(--pt-muted)">${sessions.length} sessions total</span>`;
  toolbar.insertAdjacentElement('afterend', wrap);
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
}

function renderSubmissionsTable(submissions) {
  const countEl=document.getElementById('sub-count'),wrapEl=document.getElementById('submissions-table-wrap');
  if(!submissions.length){countEl.textContent='No submissions yet.';wrapEl.innerHTML='<div class="empty-panel" style="padding:3rem">No submissions yet for this session.</div>';return;}
  const submitted=submissions.filter(s=>s.is_submitted).length;
  countEl.textContent=`${submissions.length} student${submissions.length!==1?'s':''} · ${submitted} submitted`;
  const rows=submissions.map(s=>{
    const log=s.process_log||[];
    const pastes=log.filter(e=>e.type==='paste'),blurs=log.filter(e=>e.type==='window_blur'||e.type==='tab_hidden'),wordDrops=log.filter(e=>e.type==='word_drop');
    const largePaste=pastes.some(e=>e.char_count>200),focuses=log.filter(e=>e.type==='window_focus'),totalAway=focuses.reduce((sum,e)=>sum+(e.char_count||0),0);
    const notable=[pastes.length>0?`<span style="color:var(--warning)">paste ×${pastes.length}</span>`:'',largePaste?`<span style="color:var(--warning)">large paste</span>`:'',blurs.length>0?`<span style="color:var(--pt-muted)">left window ×${blurs.length}</span>`:'',wordDrops.length>0?`<span style="color:var(--pt-muted)">word drop</span>`:''].filter(Boolean).join(' &nbsp;');
    const resubmitCell = s.is_submitted
      ? `<td onclick="event.stopPropagation()"><button style="font-size:var(--text-xs);padding:0.2rem 0.6rem;border-radius:var(--radius-sm);border:1.5px solid #2a7a3b;background:#e8f5e9;color:#2a7a3b;font-family:'DM Sans',sans-serif;font-weight:600;cursor:pointer;white-space:nowrap" onclick="unsubmitStudent('${s.id}','${esc(s.student_display_name)}')">↩ Return</button></td>`
      : `<td><span style="font-size:var(--text-xs);color:var(--pt-border)">—</span></td>`;
    // Per-student add time — only show for in-progress students when session is live
    const sess2 = STATE._lastSessions && STATE._lastSessions[STATE.selectedAssignmentId];
    const liveSession = sess2 && (sess2.status === 'active' || sess2.status === 'paused');
    const perStudentTimeCell = (liveSession && !s.is_submitted)
      ? `<td onclick="event.stopPropagation()"><button style="font-size:var(--text-xs);padding:0.2rem 0.6rem;border-radius:var(--radius-sm);border:1.5px solid var(--pt-write);background:var(--pt-write-pale);color:var(--pt-write);font-family:'DM Sans',sans-serif;font-weight:600;cursor:pointer;white-space:nowrap" onclick="openAddTimePerStudent('${s.id}','${esc(s.student_display_name)}')">＋ Time</button></td>`
      : `<td></td>`;
    return `<tr onclick="toggleSubmissionDetail('${s.id}')"><td><strong>${esc(s.student_display_name)}</strong></td><td>${esc(s.class_period||'—')}</td><td style="font-family:'DM Mono',monospace">${s.word_count||0}</td><td>${s.is_submitted?`<span class="submitted-yes">✓ Submitted</span>`:`<span class="submitted-no">In progress</span>`}</td><td style="font-size:var(--text-xs);color:var(--pt-muted)">${s.submitted_at?formatTime(s.submitted_at):'—'}</td><td style="font-size:var(--text-xs)">${notable||'<span style="color:var(--pt-muted)">—</span>'}</td><td style="color:var(--pt-muted);font-size:var(--text-xs);font-family:'DM Mono',monospace">${totalAway>0?totalAway+'s':'—'}</td>${resubmitCell}${perStudentTimeCell}</tr>${STATE.expandedSubId===s.id?renderDetailRow(s):''}`;
  }).join('');
  // Show Add Time button in toolbar only when session is active or paused
  const sess = STATE._lastSessions && STATE._lastSessions[STATE.selectedAssignmentId];
  const sessIsLive = sess && (sess.status === 'active' || sess.status === 'paused');
  const addTimeBtn = sessIsLive
    ? `<button class="btn btn-ghost" style="font-size:var(--text-xs);padding:0.45rem 0.8rem" onclick="openAddTimeModal()">＋ Add Time</button>`
    : '';
  const toolbar = document.getElementById('sub-toolbar');
  // Remove old add-time btn if present, then re-insert
  document.getElementById('add-time-global-btn-wrap')?.remove();
  if (addTimeBtn && toolbar) {
    const wrap = document.createElement('span');
    wrap.id = 'add-time-global-btn-wrap';
    wrap.innerHTML = addTimeBtn;
    toolbar.insertBefore(wrap, toolbar.querySelector('#export-btn'));
  }
  wrapEl.innerHTML=`<table><thead><tr><th>Student</th><th>Period</th><th>Words</th><th>Status</th><th>Submitted</th><th>Notable Events</th><th>Time Away</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function toggleSubmissionDetail(subId){STATE.expandedSubId=(STATE.expandedSubId===subId)?null:subId;renderSubmissionsTable(STATE.allSubmissions);}

function renderDetailRow(sub) {
  const log=sub.process_log||[];
  const logHtml=log.length?log.map(e=>`<div class="log-entry ${e.type}"><span class="log-type">${labelForEvent(e.type)}</span><span class="log-time"><span class="log-wall">${formatTime(e.timestamp)}</span><span class="log-elapsed">${formatElapsed(e.elapsed_seconds)} into session</span></span><span class="log-detail">${esc(getLogDetail(e))}</span></div>`).join(''):'<div style="color:var(--pt-muted);font-size:var(--text-sm);padding:0.5rem">No events logged.</div>';
  const pastes=log.filter(e=>e.type==='paste'),largePaste=log.some(e=>e.type==='paste'&&e.char_count>200),blurs=log.filter(e=>e.type==='window_blur'||e.type==='tab_hidden'),wordDrops=log.filter(e=>e.type==='word_drop');
  const flagText=[pastes.length>0?`${pastes.length} paste event${pastes.length>1?'s':''}`:'',(largePaste?'paste over 200 chars':''),blurs.length>0?`left window ${blurs.length}×`:'',wordDrops.length>0?'notable word count drop':''].filter(Boolean).join(' · ');
  return `<tr class="detail-row"><td class="detail-cell" colspan="9"><div class="detail-header"><div><strong>${esc(sub.student_display_name)}</strong><span style="color:var(--pt-muted);font-size:var(--text-xs);margin-left:0.5rem">${sub.word_count||0} words · Started ${formatTime(sub.started_at)}</span></div><div style="font-size:var(--text-xs);color:var(--pt-muted)">${flagText||'No notable events'}</div></div><div class="detail-essay">${esc(sub.essay_text||'(no essay text)')}</div><div class="process-log-title">Process Log</div><div class="process-log-list">${logHtml}</div><div style="margin-top:var(--space-sm);display:flex;align-items:center;justify-content:space-between"><div class="disclaimer" style="flex:1">This log is one input among many. Educator judgment governs all interpretation and any subsequent conversation.</div><button class="btn btn-secondary" style="margin-left:1rem;flex-shrink:0;font-size:var(--text-xs);padding:0.35rem 0.8rem" onclick="event.stopPropagation();printStudentReport('${sub.id}')">🖨 Print Report</button></div></td></tr>`;
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
    const {data:asgn, error:aErr} = await db.from('assignments').select('title, prompt_type, prompt_text').eq('id', sess.assignment_id).single();
    if (aErr) throw aErr;

    const ptLabels = {essay:'Open Writing', document_based:'Document-Based', source_analysis:'Source-Based'};
    const ptLabel = ptLabels[asgn.prompt_type] || 'Open Writing';
    const log = sub.process_log || [];
    const pastes = log.filter(e=>e.type==='paste');
    const blurs = log.filter(e=>e.type==='window_blur'||e.type==='tab_hidden');
    const largePaste = pastes.some(e=>e.char_count>200);
    const wordDrops = log.filter(e=>e.type==='word_drop');
    const focuses = log.filter(e=>e.type==='window_focus');
    const totalAway = focuses.reduce((sum,e)=>sum+(e.char_count||0),0);

    const logRows = log.length ? log.map(e => `
      <tr>
        <td style="padding:0.3rem 0.5rem;white-space:nowrap;color:#555;font-size:11px">${labelForEvent(e.type)}</td>
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


function labelForEvent(type) {
  const l={paste:'Paste event',window_blur:'Left window',tab_hidden:'Left window',window_focus:'Returned to window',first_keystroke:'Writing began',burst:'Typing burst',idle:'Idle gap',delete_burst:'Large deletion',word_drop:'Word count drop',paste_then_delete:'Content removed after paste'};
  return l[type]||type.replace(/_/g,' ');
}
function getLogDetail(entry) {
  switch(entry.type){
    case 'paste': return `${entry.char_count} chars${entry.content_preview?' — "'+entry.content_preview+'…"':''}`;
    case 'window_blur': case 'tab_hidden': return 'Window left focus';
    case 'window_focus': return entry.content_preview||'Window returned';
    case 'first_keystroke': return entry.content_preview||'Writing began';
    case 'burst': return `${entry.char_count} chars in one burst`;
    case 'idle': return entry.content_preview||'Idle period';
    case 'delete_burst': return `${entry.char_count} chars deleted`;
    case 'word_drop': return entry.content_preview||'Word count dropped significantly';
    case 'paste_then_delete': return entry.content_preview||'Content removed shortly after paste';
    default: return entry.content_preview||'';
  }
}

// ── EXPORT ──
async function exportTSV() {
  const subs=STATE.allSubmissions;
  if(!subs.length){toast('No submissions to export','warning');return;}
  const btn=document.getElementById('export-btn');
  if(btn){btn.disabled=true;btn.textContent='Generating…';}
  try {
    const headers=['Student Name','Period','Word Count','Submitted','Submitted At','Paste Events','Large Pastes (200+)','Times Window Left Focus','Total Time Away (seconds)','Time to First Keystroke (seconds)','Essay Text'];
    const rows=subs.map(s=>{
      const log=s.process_log||[];
      const pastes=log.filter(e=>e.type==='paste'),largePaste=pastes.filter(e=>e.char_count>200),blurs=log.filter(e=>e.type==='window_blur'||e.type==='tab_hidden'),focuses=log.filter(e=>e.type==='window_focus'),totalAway=focuses.reduce((sum,e)=>sum+(e.char_count||0),0),firstKey=log.find(e=>e.type==='first_keystroke');
      return [s.student_display_name,s.class_period||'',s.word_count||0,s.is_submitted?'Yes':'No',s.submitted_at?formatTime(s.submitted_at):'',pastes.length,largePaste.length,blurs.length,totalAway,firstKey?firstKey.elapsed_seconds:'',(s.essay_text||'').replace(/\t/g,' ').replace(/\n/g,' ↵ ')].join('\t');
    });
    const tsv=[headers.join('\t'),...rows].join('\n');
    if(typeof JSZip !== 'undefined') {
      const zip=new JSZip();
      zip.file('session-report.tsv',tsv);
      zip.file('session-report.json',JSON.stringify({session:{assignment_id:STATE.selectedAssignmentId,session_id:STATE.selectedSessionId},submissions:subs},null,2));
      const blob=await zip.generateAsync({type:'blob'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=`session-report-${STATE.selectedSessionId||STATE.selectedAssignmentId}.zip`;a.click();URL.revokeObjectURL(url);
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
