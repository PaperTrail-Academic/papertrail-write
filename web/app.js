const { createClient } = supabase;
// Anon key is safe to be public — security enforced entirely via Supabase RLS
const db = createClient(
  'https://iiviamoigtubkebreolx.supabase.co',
  'sb_publishable_NZYgi5bfsdWaFaNZ44JSeQ_HNhw2bVp'
);
const STATE = {
  teacher: null, teacherProfile: null,
  submissionId: null, sessionId: null, assignmentId: null, assignmentTitle: null,
  assignmentPromptText: null, assignmentPromptType: 'timed_essay', assignmentAllowSpellcheck: false,
  timeLimitSeconds: 0, studentName: null, period: null, startedAt: null,
  timerInterval: null, autosaveInterval: null, processLog: [], isSubmitted: false,
  firstKeystrokeLogged: false, _blurStartTime: null,
  lastInputTime: null, lastTextLength: 0, lastWordCount: 0,
  pendingBurstChars: 0, burstCheckInterval: null,
  _visibilityHandler: null, _blurHandler: null, _focusHandler: null,
  selectedAssignmentId: null, allSubmissions: [], expandedSubId: null,
  realtimeChannel: null,  // Supabase Realtime channel for live session view
  pauseCountdownInterval: null,
  isPreview: false,  // Teacher preview mode
  editingAssignmentId: null,  // For editing an existing assignment
  selectedPromptType: 'timed_essay',  // Current selection in assignment form
};

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
    // Fetch the assignment for this session
    const {data:assignment,error:aErr}=await db.from('assignments').select('*').eq('id',session.assignment_id).single();
    if(aErr) throw aErr;
    // Check for existing submission in this session
    const {data:existing,error:sErr}=await db.from('submissions').select('*').eq('session_id',session.id).eq('student_display_name',name).maybeSingle();
    if(sErr) throw sErr;
    STATE.sessionId=session.id;
    if(existing) {
      if(existing.is_submitted){loadSubmittedScreen(existing);showScreen('submitted');return;}
      STATE.submissionId=existing.id; STATE.assignmentId=assignment.id;
      STATE.assignmentTitle=assignment.title; STATE.timeLimitSeconds=(assignment.time_limit_minutes||0)*60;
      STATE.assignmentPromptText=assignment.prompt_text||'';
      STATE.assignmentPromptType=assignment.prompt_type||'timed_essay';
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
      STATE.assignmentTitle=assignment.title; STATE.timeLimitSeconds=(assignment.time_limit_minutes||0)*60;
      STATE.assignmentPromptText=assignment.prompt_text||'';
      STATE.assignmentPromptType=assignment.prompt_type||'timed_essay';
      STATE.assignmentAllowSpellcheck=assignment.allow_spellcheck||false;
      STATE.studentName=name; STATE.period=period; STATE.startedAt=now;
      STATE.processLog=[]; STATE.isSubmitted=false;
    }
    showScreen('transparency');
  } catch(err) {
    statusEl.className='status-msg error'; statusEl.textContent='Something went wrong: '+err.message;
  } finally { btn.disabled=false; btn.textContent='Continue →'; }
}

function beginWriting() {
  // Get saved text if resuming
  const savedText = STATE.submissionId ? '' : '';
  // For resume, essay_text was already loaded in STATE during studentLogin
  enterWritingMode(STATE._resumeText||'');
  STATE._resumeText = null;
  // Subscribe to session status changes (for pause notification)
  if (STATE.sessionId && !STATE.isPreview) subscribeToSessionPause();
}

// ── WRITING MODE ──
function enterWritingMode(savedText) {
  document.getElementById('writing-title').textContent=STATE.assignmentTitle;
  document.getElementById('writing-student').textContent=STATE.period?`${STATE.studentName} · ${STATE.period}`:STATE.studentName;
  const editor=document.getElementById('essay-textarea');
  editor.value=savedText||''; editor.disabled=false;

  // Apply spellcheck setting
  const sc = STATE.isPreview ? false : (STATE.assignmentAllowSpellcheck || false);
  editor.spellcheck = sc;
  editor.setAttribute('autocorrect', sc ? 'on' : 'off');
  editor.setAttribute('autocapitalize', sc ? 'sentences' : 'off');
  editor.setAttribute('autocomplete', sc ? 'on' : 'off');

  // Render prompt panel
  const promptText = STATE.assignmentPromptText;
  const promptPanel = document.getElementById('prompt-panel');
  if (promptText && promptText.trim()) {
    const typeLabels = {timed_essay:'Timed Essay Prompt',document_based:'Document-Based Prompt',open_response:'Open Response Prompt',source_analysis:'Source Analysis Prompt'};
    document.getElementById('prompt-type-label').textContent = typeLabels[STATE.assignmentPromptType] || 'Assignment Prompt';
    document.getElementById('prompt-body').textContent = promptText;
    promptPanel.style.display = 'block';
  } else {
    promptPanel.style.display = 'none';
  }

  STATE.lastTextLength=(savedText||'').length; STATE.firstKeystrokeLogged=false;
  updateWordCountDisplay(); showScreen('writing');

  if (STATE.isPreview) {
    // Preview mode: no timer, no autosave, no signals, textarea read-only
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
    if(document.hidden){STATE._blurStartTime=Date.now();logEvent('window_blur',{content_preview:'Window left focus'});}
    else if(STATE._blurStartTime){const s=Math.round((Date.now()-STATE._blurStartTime)/1000);logEvent('window_focus',{char_count:s,content_preview:`Window returned — ${s}s away`});STATE._blurStartTime=null;}
  };
  document.addEventListener('visibilitychange',STATE._visibilityHandler);
  STATE._blurHandler=()=>{if(!document.hidden){STATE._blurStartTime=Date.now();logEvent('window_blur',{content_preview:'Window left focus'});}};
  STATE._focusHandler=()=>{if(STATE._blurStartTime){const s=Math.round((Date.now()-STATE._blurStartTime)/1000);logEvent('window_focus',{char_count:s,content_preview:`Window returned — ${s}s away`});STATE._blurStartTime=null;}};
  window.addEventListener('blur',STATE._blurHandler);
  window.addEventListener('focus',STATE._focusHandler);
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
      if (newStatus === 'paused') triggerPauseBanner();
    })
    .subscribe();
  STATE._sessionChannel = ch;
}

function triggerPauseBanner() {
  const banner = document.getElementById('pause-banner');
  const countdownEl = document.getElementById('pause-countdown');
  if (!banner || !countdownEl) return;
  let t = 60;
  countdownEl.textContent = t;
  banner.classList.add('visible');
  STATE.pauseCountdownInterval = setInterval(async () => {
    t--;
    countdownEl.textContent = t;
    if (t <= 0) {
      clearInterval(STATE.pauseCountdownInterval);
      const ta = document.getElementById('essay-textarea');
      if (ta) ta.disabled = true;
      document.getElementById('submit-btn').disabled = true;
      banner.textContent = 'This session has been paused by your teacher. Your work has been saved.';
      await autosave();
    }
  }, 1000);
}


function startTimer() {
  if(STATE.timerInterval) clearInterval(STATE.timerInterval);
  updateTimerDisplay();
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
    if(!STATE.firstKeystrokeLogged){STATE.firstKeystrokeLogged=true;logEvent('first_keystroke',{content_preview:`Writing began at ${formatElapsed(elapsedSeconds())}`});}
  });
  editor.addEventListener('paste',(e)=>{
    const p=(e.clipboardData||window.clipboardData).getData('text')||'';
    if(!p.length) return;
    logEvent('paste',{char_count:p.length,content_preview:p.slice(0,80)});
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
let idleLogged=false;
function checkBurstAndIdle() {
  if(STATE.isSubmitted) return;
  const now=Date.now(),ssi=STATE.lastInputTime?(now-STATE.lastInputTime)/1000:Infinity;
  if(ssi>5&&STATE.pendingBurstChars>=50){logEvent('burst',{char_count:STATE.pendingBurstChars});STATE.pendingBurstChars=0;}
  if(ssi>120&&!idleLogged&&STATE.lastInputTime){logEvent('idle',{content_preview:`Gap of ~${Math.round(ssi/60)} minute(s)`});idleLogged=true;}
  if(ssi<30&&idleLogged) idleLogged=false;
}
function logEvent(type,extras={}) {
  STATE.processLog.push({type,timestamp:new Date().toISOString(),elapsed_seconds:elapsedSeconds(),char_count:extras.char_count||0,content_preview:extras.content_preview||''});
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
  if(STATE._visibilityHandler) document.removeEventListener('visibilitychange',STATE._visibilityHandler);
  if(STATE._blurHandler) window.removeEventListener('blur',STATE._blurHandler);
  if(STATE._focusHandler) window.removeEventListener('focus',STATE._focusHandler);
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
    const {data:assignments,error:aErr}=await db.from('assignments').select('*').eq('teacher_id',user.id).order('created_at',{ascending:false});
    if(aErr) throw aErr;
    const {data:sessions,error:sErr}=await db.from('sessions').select('*').eq('teacher_id',user.id).neq('status','ended');
    if(sErr) throw sErr;
    const sessionsByAssignment={};
    (sessions||[]).forEach(s=>{ sessionsByAssignment[s.assignment_id]=s; });
    STATE._lastSessions=sessionsByAssignment;  // cache for Realtime wiring
    const merged=(assignments||[]).map(a=>({
      ...a,
      _session: sessionsByAssignment[a.id]||null,
      _status: sessionsByAssignment[a.id]?.status||'draft',
      _joinCode: sessionsByAssignment[a.id]?.join_code||a.join_code||'—',
    }));
    renderAssignmentList(merged);
    if(STATE.selectedAssignmentId) {
      loadSubmissions(STATE.selectedAssignmentId);
      // Wire Realtime if not already subscribed
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

function renderAssignmentList(assignments) {
  const el=document.getElementById('assignment-list');
  if(!assignments.length){el.innerHTML='<div class="empty-panel">No assignments yet. Create one above.</div>';return;}
  const ptLabels={timed_essay:'Timed Essay',document_based:'Document-Based',open_response:'Open Response',source_analysis:'Source Analysis'};
  el.innerHTML=assignments.map(a=>{
    const isActive=a._status==='active';
    const isPaused=a._status==='paused';
    const sessionId=a._session?.id||null;
    const statusPill=isActive
      ?`<span class="pill pill-active">Active</span>`
      :isPaused
        ?`<span class="pill" style="background:#fff8e1;color:var(--warning);border-color:#f0c040">Paused</span>`
        :`<span class="pill pill-inactive">Draft</span>`;
    const ptLabel=ptLabels[a.prompt_type]||'Timed Essay';
    const sessionActions=isActive
      ?`<button class="btn btn-ghost" style="font-size:0.7rem;padding:0.3rem 0.65rem" onclick="pauseSession('${a.id}','${sessionId}')">Pause</button>
         <button class="btn btn-danger" style="font-size:0.7rem;padding:0.3rem 0.65rem" onclick="endAssignment('${a.id}','${sessionId}','${esc(a.title)}')">End</button>`
      :isPaused
        ?`<button class="btn btn-success" style="font-size:0.7rem;padding:0.3rem 0.65rem" onclick="reopenSession('${a.id}','${sessionId}')">Reopen</button>
           <button class="btn btn-danger" style="font-size:0.7rem;padding:0.3rem 0.65rem" onclick="endAssignment('${a.id}','${sessionId}','${esc(a.title)}')">End</button>`
        :`<button class="btn btn-success" style="font-size:0.7rem;padding:0.3rem 0.65rem" onclick="openSession('${a.id}')">Open Session</button>
           <button class="btn btn-danger" style="font-size:0.7rem;padding:0.3rem 0.65rem" onclick="deleteAssignment('${a.id}','${esc(a.title)}')">Delete</button>`;
    const editPreviewActions=`<button class="btn btn-ghost" style="font-size:0.7rem;padding:0.3rem 0.65rem" onclick="event.stopPropagation();editAssignment('${a.id}')">Edit</button>
       <button class="btn btn-secondary" style="font-size:0.7rem;padding:0.3rem 0.65rem" onclick="event.stopPropagation();previewAssignment('${a.id}')">Preview</button>`;
    return `<div class="assignment-item ${isActive?'active-assignment':''} ${STATE.selectedAssignmentId===a.id?'selected':''}" onclick="selectAssignment('${a.id}')">
      <div class="assignment-item-title">${esc(a.title)}</div>
      <div class="assignment-item-meta">${ptLabel} · ${a.time_limit_minutes?a.time_limit_minutes+' min':'No limit'} · Code: <code style="font-family:'DM Mono',monospace">${esc(a._joinCode||'—')}</code></div>
      <div style="margin-top:0.35rem">${statusPill}</div>
      <div class="assignment-item-actions" onclick="event.stopPropagation()">${sessionActions}${editPreviewActions}</div>
    </div>`;
  }).join('');
}

// ── ASSIGNMENT FORM HELPERS ──
function selectPromptType(btn) {
  document.querySelectorAll('#a-prompt-type-ctrl .seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  STATE.selectedPromptType = btn.dataset.val;
}

function cancelEditAssignment() {
  STATE.editingAssignmentId = null;
  STATE.selectedPromptType = 'timed_essay';
  document.getElementById('a-title').value = '';
  document.getElementById('a-prompt').value = '';
  document.getElementById('a-password').value = '';
  document.getElementById('a-time').value = '';
  document.getElementById('a-grade').value = '';
  document.getElementById('a-subject').value = '';
  document.getElementById('a-spellcheck').checked = false;
  document.querySelectorAll('#a-prompt-type-ctrl .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.val==='timed_essay'));
  document.getElementById('assignment-form-title').textContent = 'New Assignment';
  document.getElementById('create-assignment-btn').textContent = 'Create Assignment';
  document.getElementById('cancel-edit-btn').style.display = 'none';
}

function loadAssignmentIntoForm(a) {
  STATE.editingAssignmentId = a.id;
  STATE.selectedPromptType = a.prompt_type || 'timed_essay';
  document.getElementById('a-title').value = a.title || '';
  document.getElementById('a-prompt').value = a.prompt_text || '';
  document.getElementById('a-password').value = a.join_code || '';
  document.getElementById('a-time').value = a.time_limit_minutes || '';
  document.getElementById('a-grade').value = a.grade_level || '';
  document.getElementById('a-subject').value = a.subject || '';
  document.getElementById('a-spellcheck').checked = a.allow_spellcheck || false;
  document.querySelectorAll('#a-prompt-type-ctrl .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.val===STATE.selectedPromptType));
  document.getElementById('assignment-form-title').textContent = 'Edit Assignment';
  document.getElementById('create-assignment-btn').textContent = 'Save Changes';
  document.getElementById('cancel-edit-btn').style.display = 'block';
  document.getElementById('a-title').scrollIntoView({behavior:'smooth', block:'nearest'});
}

async function createAssignment() {
  const {data:{user}}=await db.auth.getUser();
  if(!user){toast('Please sign in again.','error');return;}
  const title=document.getElementById('a-title').value.trim();
  const joinCode=document.getElementById('a-password').value.trim().toUpperCase();
  const promptText=document.getElementById('a-prompt').value.trim();
  const minutesRaw=document.getElementById('a-time').value.trim();
  const minutes=minutesRaw?parseInt(minutesRaw):null;
  const gradeLevel=document.getElementById('a-grade').value||null;
  const subject=document.getElementById('a-subject').value||null;
  const allowSpellcheck=document.getElementById('a-spellcheck').checked;
  const promptType=STATE.selectedPromptType||'timed_essay';
  if(!title){toast('Please enter an assignment title','warning');return;}
  if(!joinCode){toast('Please enter a join code','warning');return;}
  if(minutes!==null&&(minutes<5||minutes>300)){toast('Time must be between 5 and 300 minutes (or leave blank for no limit)','warning');return;}
  const btn=document.getElementById('create-assignment-btn');
  btn.disabled=true;
  const payload={
    teacher_id:user.id, title, join_code:joinCode,
    prompt_type:promptType, prompt_text:promptText||null,
    time_limit_minutes:minutes,
    allow_spellcheck:allowSpellcheck,
    grade_level:gradeLevel, subject,
  };
  try {
    if(STATE.editingAssignmentId) {
      const {error}=await db.from('assignments').update(payload).eq('id',STATE.editingAssignmentId);
      if(error) throw error;
      toast(`"${title}" updated`,'success');
    } else {
      const {error}=await db.from('assignments').insert(payload);
      if(error) throw error;
      toast(`"${title}" created`,'success');
    }
    cancelEditAssignment();
    loadDashboard();
  } catch(err){toast('Save failed: '+err.message,'error');}
  finally{btn.disabled=false;}
}

async function openSession(assignmentId) {
  const {data:{user}}=await db.auth.getUser(); if(!user) return;
  try {
    // Generate a simple join code — teacher can customise via assignment join_code field
    const {data:asgn}=await db.from('assignments').select('join_code').eq('id',assignmentId).single();
    const code=asgn?.join_code||Math.random().toString(36).slice(2,7).toUpperCase();
    const {error}=await db.from('sessions').insert({
      assignment_id:assignmentId, teacher_id:user.id,
      status:'active', join_code:code,
      last_active_at:new Date().toISOString(),
    });
    if(error) throw error;
    toast(`Session opened — join code: ${code}`,'success',5000); loadDashboard();
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
  const {data:a,error}=await db.from('assignments').select('*').eq('id',id).single();
  if(error){toast('Failed to load assignment','error');return;}
  loadAssignmentIntoForm(a);
}

async function previewAssignment(id) {
  const {data:a,error}=await db.from('assignments').select('*').eq('id',id).single();
  if(error){toast('Failed to load assignment','error');return;}
  STATE.isPreview=true;
  STATE.assignmentId=a.id;
  STATE.assignmentTitle=a.title;
  STATE.assignmentPromptText=a.prompt_text||'';
  STATE.assignmentPromptType=a.prompt_type||'timed_essay';
  STATE.assignmentAllowSpellcheck=false;
  STATE.timeLimitSeconds=(a.time_limit_minutes||0)*60;
  STATE.studentName='Preview';
  STATE.period='';
  STATE.startedAt=new Date().toISOString();
  STATE.processLog=[];
  STATE.isSubmitted=false;
  STATE._resumeText='';
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
  document.getElementById('realtime-badge').style.display='inline-flex';
  const ch=db.channel('live-session-'+sessionId)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'submissions',filter:`session_id=eq.${sessionId}`},()=>{ loadSubmissions(STATE.selectedAssignmentId); })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'submissions',filter:`session_id=eq.${sessionId}`},(payload)=>{
      // Update only the changed row in STATE.allSubmissions for efficiency
      if(STATE.allSubmissions&&STATE.allSubmissions.length){
        const idx=STATE.allSubmissions.findIndex(s=>s.id===payload.new.id);
        if(idx>=0){STATE.allSubmissions[idx]={...STATE.allSubmissions[idx],...payload.new};renderSubmissionsTable(STATE.allSubmissions);}
        else{loadSubmissions(STATE.selectedAssignmentId);}
      }
    })
    .subscribe();
  STATE.realtimeChannel=ch;
}

function unsubscribeLiveSession() {
  if(STATE.realtimeChannel){db.removeChannel(STATE.realtimeChannel);STATE.realtimeChannel=null;}
  document.getElementById('realtime-badge').style.display='none';
}


async function reopenSession(assignmentId,sessionId) {
  try {
    const newCode=Math.random().toString(36).slice(2,7).toUpperCase();
    const {error}=await db.from('sessions').update({status:'active',join_code:newCode,paused_at:null}).eq('id',sessionId);
    if(error) throw error;
    toast(`Session reopened — new join code: ${newCode}`,'success',5000); loadDashboard();
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
      <div class="disclaimer" style="margin-bottom:var(--space-md)">Download the session report before ending. Once ended, all student submission data will be permanently deleted from PaperTrail's servers within 24 hours.</div>
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
    if(STATE.selectedAssignmentId===assignmentId){STATE.selectedAssignmentId=null;STATE.allSubmissions=[];document.getElementById('submissions-table-wrap').innerHTML='<div class="empty-panel" style="padding:3rem">Select an assignment on the left.</div>';document.getElementById('sub-count').textContent='Select an assignment to view its session report.';document.getElementById('export-btn').disabled=true;}
    toast('Assignment ended — student data deleted','success'); loadDashboard();
  } catch(err){toast('Failed to end assignment: '+err.message,'error');}
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
    const allItems=document.querySelectorAll('.assignment-item');
    // Find session status from already-loaded dashboard data
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
    // Find most recent non-ended session for this assignment
    const {data:sessions}=await db.from('sessions').select('id').eq('assignment_id',assignmentId).neq('status','ended').order('started_at',{ascending:false}).limit(1);
    if(!sessions||!sessions.length){
      STATE.allSubmissions=[];
      document.getElementById('submissions-table-wrap').innerHTML='<div class="empty-panel" style="padding:3rem">No active session for this assignment yet.</div>';
      document.getElementById('sub-count').textContent='No session data.';
      document.getElementById('export-btn').disabled=true;
      return;
    }
    const sessionId=sessions[0].id;
    const {data,error}=await db.from('submissions').select('*').eq('session_id',sessionId).order('started_at',{ascending:true});
    if(error) throw error;
    STATE.allSubmissions=data||[]; renderSubmissionsTable(data||[]);
    document.getElementById('export-btn').disabled=!data||!data.length;
  } catch(err){toast('Failed to load session report: '+err.message,'error');}
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
    const notable=[pastes.length>0?`<span style="color:var(--warning)">paste ×${pastes.length}</span>`:'',largePaste?`<span style="color:var(--warning)">large paste</span>`:'',blurs.length>0?`<span style="color:var(--pt-muted)">focus ×${blurs.length}</span>`:'',wordDrops.length>0?`<span style="color:var(--pt-muted)">word drop</span>`:''].filter(Boolean).join(' &nbsp;');
    return `<tr onclick="toggleSubmissionDetail('${s.id}')"><td><strong>${esc(s.student_display_name)}</strong></td><td>${esc(s.class_period||'—')}</td><td style="font-family:'DM Mono',monospace">${s.word_count||0}</td><td>${s.is_submitted?`<span class="submitted-yes">✓ Submitted</span>`:`<span class="submitted-no">In progress</span>`}</td><td style="font-size:var(--text-xs);color:var(--pt-muted)">${s.submitted_at?formatTime(s.submitted_at):'—'}</td><td style="font-size:var(--text-xs)">${notable||'<span style="color:var(--pt-muted)">—</span>'}</td><td style="color:var(--pt-muted);font-size:var(--text-xs);font-family:'DM Mono',monospace">${totalAway>0?totalAway+'s':'—'}</td></tr>${STATE.expandedSubId===s.id?renderDetailRow(s):''}`;
  }).join('');
  wrapEl.innerHTML=`<table><thead><tr><th>Student</th><th>Period</th><th>Words</th><th>Status</th><th>Submitted</th><th>Notable Events</th><th>Time Away</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function toggleSubmissionDetail(subId){STATE.expandedSubId=(STATE.expandedSubId===subId)?null:subId;renderSubmissionsTable(STATE.allSubmissions);}

function renderDetailRow(sub) {
  const log=sub.process_log||[];
  const logHtml=log.length?log.map(e=>`<div class="log-entry ${e.type}"><span class="log-type">${labelForEvent(e.type)}</span><span class="log-time"><span class="log-wall">${formatTime(e.timestamp)}</span><span class="log-elapsed">${formatElapsed(e.elapsed_seconds)} into session</span></span><span class="log-detail">${esc(getLogDetail(e))}</span></div>`).join(''):'<div style="color:var(--pt-muted);font-size:var(--text-sm);padding:0.5rem">No events logged.</div>';
  const pastes=log.filter(e=>e.type==='paste'),largePaste=log.some(e=>e.type==='paste'&&e.char_count>200),blurs=log.filter(e=>e.type==='window_blur'||e.type==='tab_hidden'),wordDrops=log.filter(e=>e.type==='word_drop');
  const flagText=[pastes.length>0?`${pastes.length} paste event${pastes.length>1?'s':''}`:'',(largePaste?'paste over 200 chars':''),blurs.length>0?`window left focus ${blurs.length}×`:'',wordDrops.length>0?'notable word count drop':''].filter(Boolean).join(' · ');
  return `<tr class="detail-row"><td class="detail-cell" colspan="7"><div class="detail-header"><div><strong>${esc(sub.student_display_name)}</strong><span style="color:var(--pt-muted);font-size:var(--text-xs);margin-left:0.5rem">${sub.word_count||0} words · Started ${formatTime(sub.started_at)}</span></div><div style="font-size:var(--text-xs);color:var(--pt-muted)">${flagText||'No notable events'}</div></div><div class="detail-essay">${esc(sub.essay_text||'(no essay text)')}</div><div class="process-log-title">Process Log</div><div class="process-log-list">${logHtml}</div><div style="margin-top:var(--space-sm)"><div class="disclaimer">This log is one input among many. Educator judgment governs all interpretation and any subsequent conversation.</div></div></td></tr>`;
}

function labelForEvent(type) {
  const l={paste:'Paste event',window_blur:'Window left focus',tab_hidden:'Window left focus',window_focus:'Window returned',first_keystroke:'Writing began',burst:'Typing burst',idle:'Idle gap',delete_burst:'Large deletion',word_drop:'Word count drop',paste_then_delete:'Content removed after paste'};
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
      zip.file('session-report.json',JSON.stringify({session:{assignment_id:STATE.selectedAssignmentId},submissions:subs},null,2));
      const blob=await zip.generateAsync({type:'blob'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=`session-report-${STATE.selectedAssignmentId}.zip`;a.click();URL.revokeObjectURL(url);
      toast('Report ZIP downloaded','success',3000);
    } else {
      try{await navigator.clipboard.writeText(tsv);toast('Tab-separated data copied — paste into Google Sheets','success',4000);}
      catch(e){const blob=new Blob([tsv],{type:'text/plain'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`session-report-${STATE.selectedAssignmentId}.tsv`;a.click();URL.revokeObjectURL(url);}
    }
  } catch(err){toast('Export failed: '+err.message,'error');}
  finally{if(btn){btn.disabled=false;btn.textContent='↓ Export Report';}}
}

// ── START ──
boot();
