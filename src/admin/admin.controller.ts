import { Controller, Get, Res } from '@nestjs/common';
import { FastifyReply } from 'fastify';

@Controller('admin')
export class AdminController {
  @Get()
  index(@Res() res: FastifyReply) {
    res.header('Content-Type', 'text/html; charset=utf-8').send(INDEX_HTML);
  }
}

const INDEX_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>温油站管理后台</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif; background:#f5f5f5; color:#333; }
header { background:#1a1a2e; color:white; padding:12px 20px; display:flex; justify-content:space-between; align-items:center; }
header h1 { font-size:18px; }
nav { background:white; border-bottom:1px solid #e0e0e0; padding:0 20px; }
nav a { display:inline-block; padding:10px 16px; color:#666; text-decoration:none; border-bottom:2px solid transparent; cursor:pointer; }
nav a.active { color:#1a1a2e; border-bottom-color:#1a1a2e; }
main { max-width:1200px; margin:20px auto; padding:0 20px; }
.card { background:white; border-radius:8px; padding:16px; margin-bottom:16px; box-shadow:0 1px 3px rgba(0,0,0,.1); }
.card h3 { font-size:16px; margin-bottom:12px; }
table { width:100%; border-collapse:collapse; }
th,td { text-align:left; padding:8px 12px; border-bottom:1px solid #eee; }
th { font-weight:600; color:#666; font-size:12px; text-transform:uppercase; }
.btn { display:inline-block; padding:6px 14px; border:none; border-radius:4px; cursor:pointer; font-size:13px; }
.btn-sm { padding:3px 10px; font-size:12px; }
.btn-green { background:#27ae60; color:white; }
.btn-red { background:#e74c3c; color:white; }
.status { display:inline-block; padding:2px 8px; border-radius:4px; font-size:12px; }
.status-pending { background:#f39c12; color:white; }
.status-resolved { background:#27ae60; color:white; }
.loading { text-align:center; padding:40px; color:#999; }
.login-box { max-width:360px; margin:80px auto; background:white; border-radius:8px; padding:24px; box-shadow:0 2px 10px rgba(0,0,0,.1); }
.login-box input { width:100%; padding:10px; margin-bottom:12px; border:1px solid #ddd; border-radius:4px; font-size:14px; }
.login-box button { width:100%; padding:10px; background:#1a1a2e; color:white; border:none; border-radius:4px; cursor:pointer; font-size:14px; }
.hidden { display:none; }
#stats { display:flex; gap:16px; margin-bottom:16px; }
#stats .stat { flex:1; background:white; border-radius:8px; padding:16px; box-shadow:0 1px 3px rgba(0,0,0,.1); text-align:center; }
#stats .stat .num { font-size:28px; font-weight:700; color:#1a1a2e; }
#stats .stat .label { font-size:12px; color:#999; margin-top:4px; }
</style>
</head>
<body>
<div id="login" class="hidden">
  <div class="login-box">
    <h2 style="margin-bottom:16px">管理员登录</h2>
    <input id="loginEmail" type="email" placeholder="管理员邮箱" value="admin@wenyouzhan.com">
    <input id="loginPass" type="password" placeholder="密码">
    <button onclick="login()">登录</button>
    <div id="loginErr" style="color:red;margin-top:8px;display:none"></div>
  </div>
</div>

<div id="app" class="hidden">
  <header>
    <h1>温油站管理后台</h1>
    <button class="btn btn-red btn-sm" onclick="logout()">退出</button>
  </header>
  <nav>
    <a class="active" data-tab="reports" onclick="showTab('reports')">举报管理</a>
    <a data-tab="users" onclick="showTab('users')">用户管理</a>
  </nav>
  <main id="content"></main>
</div>

<script>
const API = '/api/v1';
let token = localStorage.getItem('adminToken') || '';

function authHeaders() { return {Authorization:'Bearer '+token,'Content-Type':'application/json'}; }

async function init() {
  if (token) {
    try {
      const r = await fetch(API+'/users/me',{headers:authHeaders()});
      if (r.ok) { showApp(); return; }
    } catch(e) {}
  }
  showLogin();
}
function showLogin() { document.getElementById('login').classList.remove('hidden'); document.getElementById('app').classList.add('hidden'); }
function showApp() { document.getElementById('login').classList.add('hidden'); document.getElementById('app').classList.remove('hidden'); showTab('reports'); }

async function login() {
  const email = document.getElementById('loginEmail').value;
  const pass = document.getElementById('loginPass').value;
  const r = await fetch(API+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const d = await r.json();
  if (r.ok && d.accessToken) {
    token = d.accessToken;
    localStorage.setItem('adminToken',token);
    showApp();
  } else {
    document.getElementById('loginErr').textContent = '登录失败: ' + (d.message||'');
    document.getElementById('loginErr').style.display = 'block';
  }
}
function logout() { token=''; localStorage.removeItem('adminToken'); showLogin(); }

async function showTab(tab) {
  document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.dataset.tab===tab));
  const c = document.getElementById('content');
  if (tab === 'reports') await loadReports(c);
  else if (tab === 'users') await loadUsers(c);
}

async function loadReports(container) {
  container.innerHTML = '<div class="card"><h3>举报列表</h3><div class="loading">加载中...</div></div>';
  try {
    const r = await fetch(API+'/reports',{headers:authHeaders()});
    const data = await r.json();
    if (!Array.isArray(data) && data.message) { container.innerHTML = '<div class="card"><h3>举报列表</h3><p>'+data.message+'</p></div>'; return; }
    const rows = Array.isArray(data) ? data : data.data || [];
    container.innerHTML = '<div class="card"><h3>举报列表</h3><table><thead><tr><th>举报人</th><th>目标类型</th><th>目标ID</th><th>原因</th><th>状态</th><th>操作</th></tr></thead><tbody>'+
      rows.map(r=>'<tr><td>'+r.reporterId.slice(0,8)+'</td><td>'+r.targetType+'</td><td>'+r.targetId.slice(0,8)+'</td><td>'+r.reason+'</td><td><span class="status status-'+r.status.toLowerCase()+'">'+r.status+'</span></td><td>'+(r.status==='PENDING'?'<button class="btn btn-green btn-sm" onclick="handleReport(\''+r.id+'\',\'RESOLVED\')">处理</button> ':'')+(r.status==='PENDING'?'<button class="btn btn-red btn-sm" onclick="handleReport(\''+r.id+'\',\'DISMISSED\')">驳回</button>':'')+'</td></tr>').join('')+
    '</tbody></table></div>';
  } catch(e) { container.innerHTML = '<div class="card"><p>加载失败: '+e.message+'</p></div>'; }
}

async function handleReport(id,status) {
  await fetch(API+'/reports/'+id+'/handle',{method:'PATCH',headers:authHeaders(),body:JSON.stringify({status})});
  showTab('reports');
}

async function loadUsers(container) {
  container.innerHTML = '<div class="card"><h3>用户列表</h3><div class="loading">加载中...</div></div>';
  try {
    const r = await fetch(API+'/admin/users',{headers:authHeaders()});
    // 简单展示最近用户
    container.innerHTML = '<div class="card"><h3>用户管理</h3><p>通过 API 查询: GET /api/v1/users/:id</p><p>修改角色: PATCH /api/v1/admin/users/:id {role:"ADMIN"}</p></div>';
  } catch(e) {}
}

init();
</script>
</body>
</html>`;
