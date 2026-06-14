let currentUser = null;
let currentToken = localStorage.getItem('token');

const SITE_URL = 'https://demlikforum.up.railway.app';

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function updatePageMeta(title, description, imageUrl) {
  document.title = title;
  let desc = document.querySelector('meta[name="description"]');
  if (!desc) { desc = document.createElement('meta'); desc.setAttribute('name','description'); document.head.appendChild(desc); }
  desc.setAttribute('content', description);

  const ogFields = { 'og:title': title, 'og:description': description, 'og:image': imageUrl || (SITE_URL + '/demlik.png'), 'og:url': location.href };
  Object.entries(ogFields).forEach(([prop, content]) => {
    let el = document.querySelector(`meta[property="${prop}"]`);
    if (!el) { el = document.createElement('meta'); el.setAttribute('property', prop); document.head.appendChild(el); }
    el.setAttribute('content', content);
  });

  const twFields = { 'twitter:title': title, 'twitter:description': description, 'twitter:image': imageUrl || (SITE_URL + '/demlik.png') };
  Object.entries(twFields).forEach(([name, content]) => {
    let el = document.querySelector(`meta[name="${name}"]`);
    if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
    el.setAttribute('content', content);
  });

  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) { canonical = document.createElement('link'); canonical.setAttribute('rel','canonical'); document.head.appendChild(canonical); }
  canonical.setAttribute('href', location.href);

  let ld = document.getElementById('page-jsonld');
  if (!ld) { ld = document.createElement('script'); ld.type = 'application/ld+json'; ld.id = 'page-jsonld'; document.head.appendChild(ld); }
  ld.textContent = '';
}

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function toast(msg, type = 'success') {
  const c = $('#toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function showModal(title, bodyHTML) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHTML;
  $('#modal-overlay').classList.remove('hidden');
}

function hideModal() {
  $('#modal-overlay').classList.add('hidden');
}

$('#modal-close').addEventListener('click', hideModal);
$('#modal-overlay').addEventListener('click', e => { if (e.target === $('#modal-overlay')) hideModal(); });

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (currentToken) headers['Authorization'] = 'Bearer ' + currentToken;
  const res = await fetch('/api' + path, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Hata');
  return data;
}

async function apiForm(path, formData, method = 'POST') {
  const headers = {};
  if (currentToken) headers['Authorization'] = 'Bearer ' + currentToken;
  const res = await fetch('/api' + path, { method, body: formData, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Hata');
  return data;
}

function timeAgo(dt) {
  const now = new Date();
  const d = new Date(dt);
  const sec = Math.floor((now - d) / 1000);
  if (sec < 60) return 'az önce';
  if (sec < 3600) return Math.floor(sec / 60) + ' dk önce';
  if (sec < 86400) return Math.floor(sec / 3600) + ' sa önce';
  if (sec < 604800) return Math.floor(sec / 86400) + ' gün önce';
  return d.toLocaleDateString('tr-TR');
}

function formatDate(dt) {
  return new Date(dt).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function userDisplayName(u) {
  if (!u) return 'Silindi';
  const color = (u.show_level_color !== 0 && u.name_color) ? `style="color:${escHtml(u.name_color)}"` : '';
  return `<span class="user-badge" ${color}>${escHtml(u.username)}${u.is_vip ? ' <i class="fas fa-gem user-vip" title="VIP"></i>' : ''}${u.is_plus ? ' <i class="fas fa-plus user-plus" title="Plus"></i>' : ''}</span>`;
}

function avatarImg(u, cls = 'avatar-sm') {
  if (u && u.avatar) return `<img src="${escHtml(u.avatar)}" class="${cls}" alt="" />`;
  return `<div class="${cls} avatar-placeholder"><i class="fas fa-user"></i></div>`;
}

function navigate(path, push = true) {
  if (push) history.pushState({}, '', path);
  renderRoute(path);
}

window.addEventListener('popstate', () => renderRoute(location.pathname));

document.addEventListener('click', e => {
  const a = e.target.closest('[data-link]');
  if (a && a.tagName === 'A') {
    e.preventDefault();
    navigate(a.getAttribute('href'));
  }
});

function renderRoute(path) {
  updateNavActive(path);
  const app = $('#app');
  const segs = path.split('/').filter(Boolean);

  if (path === '/') return renderHome(app);
  if (path === '/forum') return renderForumList(app);
  if (path.startsWith('/forum/')) {
    const slug = segs.slice(1).join('/');
    return renderForumDetail(app, slug);
  }
  if (path === '/kitaplar') return renderBookList(app);
  if (path.startsWith('/kitap/') && segs.length === 2) return renderBookDetail(app, segs[1]);
  if (path.startsWith('/kitap/') && segs.length === 4 && segs[2] === 'sayfa') return renderPageReader(app, segs[1], segs[3]);
  if (path === '/gruplar') return renderGroupList(app);
  if (path.startsWith('/grup/')) return renderGroupDetail(app, segs[1]);
  if (path.startsWith('/profil/')) return renderProfile(app, segs[1]);
  if (path === '/ayarlar') return renderSettings(app);
  if (path === '/giris') return renderLogin(app);
  if (path === '/kayit') return renderRegister(app);
  renderNotFound(app);
}

function updateNavActive(path) {
  $$('.nav-link').forEach(l => {
    l.classList.toggle('active', l.getAttribute('href') === path || (l.getAttribute('href') !== '/' && path.startsWith(l.getAttribute('href'))));
  });
}

async function initAuth() {
  if (!currentToken) return updateNavUI();
  try {
    const data = await api('/auth/me');
    currentUser = data.user;
    updateNavUI();
  } catch {
    currentToken = null;
    localStorage.removeItem('token');
    updateNavUI();
  }
}

function updateNavUI() {
  const authEl = $('#nav-auth');
  const userEl = $('#nav-user');
  if (currentUser) {
    authEl.classList.add('hidden');
    userEl.classList.remove('hidden');
    const nav = currentUser.avatar ? `<img src="${escHtml(currentUser.avatar)}" class="nav-avatar" />` : `<div class="nav-avatar avatar-placeholder"><i class="fas fa-user" style="font-size:12px"></i></div>`;
    const btn = $('#nav-user-btn');
    btn.innerHTML = `${nav}<span>${escHtml(currentUser.username)}</span><i class="fas fa-chevron-down"></i>`;
    $('#dropdown-profile').setAttribute('href', '/profil/' + currentUser.username);
  } else {
    authEl.classList.remove('hidden');
    userEl.classList.add('hidden');
  }
}

$('#nav-user-btn').addEventListener('click', () => {
  $('#dropdown-menu').classList.toggle('hidden');
});
document.addEventListener('click', e => {
  if (!$('#nav-dropdown')?.contains(e.target)) $('#dropdown-menu')?.classList.add('hidden');
  if (!$('#new-btn-wrap')?.contains(e.target)) $('#new-dropdown')?.classList.add('hidden');
});

$('#nav-new-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  $('#new-dropdown').classList.toggle('hidden');
});
$('#nav-new-forum')?.addEventListener('click', () => { $('#new-dropdown').classList.add('hidden'); navigate('/forum'); setTimeout(() => { if (currentUser) showNewForumModal(); else navigate('/giris'); }, 100); });
$('#nav-new-book')?.addEventListener('click', () => { $('#new-dropdown').classList.add('hidden'); navigate('/kitaplar'); setTimeout(() => { if (currentUser) showNewBookModal(); else navigate('/giris'); }, 100); });
$('#nav-new-group')?.addEventListener('click', () => { $('#new-dropdown').classList.add('hidden'); navigate('/gruplar'); setTimeout(() => { if (currentUser) showNewGroupModal(); else navigate('/giris'); }, 100); });
$('#logout-btn').addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  currentToken = null; currentUser = null;
  localStorage.removeItem('token');
  updateNavUI();
  navigate('/');
  toast('Çıkış yapıldı');
});

$('#mobile-toggle').addEventListener('click', () => {
  $('#mobile-menu').classList.toggle('hidden');
});

async function renderHome(app) {
  document.title = 'Demlik – Topluluk Platformu';
  updatePageMeta('Demlik – Topluluk Platformu', 'Fikirlerin buluştuğu, hikayelerin yeşerdiği topluluk platformu.', '');
  app.innerHTML = `
    <div class="hero">
      <div class="hero-content">
        <div class="hero-title">DEMLİK</div>
        <p class="hero-subtitle">Fikirlerin buluştuğu, hikayelerin yeşerdiği topluluk platformu.</p>
        <div class="hero-buttons">
          <a href="/forum" data-link class="btn btn-primary btn-lg"><i class="fas fa-comments"></i> Konulara Gir</a>
          <a href="/kitaplar" data-link class="btn btn-outline btn-lg"><i class="fas fa-book-open"></i> Kitapları Keşfet</a>
        </div>
      </div>
    </div>
    <div class="container page">
      <div class="section">
        <div class="section-header">
          <div class="section-title"><div class="section-title-bar"></div>Son Konular</div>
          <a href="/forum" data-link class="btn btn-ghost btn-sm">Tümü <i class="fas fa-arrow-right"></i></a>
        </div>
        <div id="home-forums"><div class="loading-center"><div class="spinner"></div></div></div>
      </div>
      <div class="section">
        <div class="section-header">
          <div class="section-title"><div class="section-title-bar"></div>Öne Çıkan Kitaplar</div>
          <a href="/kitaplar" data-link class="btn btn-ghost btn-sm">Tümü <i class="fas fa-arrow-right"></i></a>
        </div>
        <div id="home-books" class="grid-3"></div>
      </div>
    </div>`;

  try {
    const forums = await api('/forums');
    const el = $('#home-forums');
    if (!forums.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-comments"></i><p>Henüz konu yok.</p></div>'; }
    else el.innerHTML = forums.slice(0, 5).map(f => forumCardHTML(f)).join('');
  } catch {}

  try {
    const books = await api('/books');
    const el = $('#home-books');
    if (!books.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-books"></i><p>Henüz kitap yok.</p></div>'; }
    else el.innerHTML = books.slice(0, 6).map(b => bookCardHTML(b)).join('');
  } catch {}
}

async function renderForumList(app) {
  document.title = 'Konular – Demlik';
  updatePageMeta('Konular – Demlik', 'Toplulukla fikir paylaş, tartış, keşfet.', '');
  app.innerHTML = `
    <div class="container page">
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div><div class="page-title">Konular</div><div class="page-subtitle">Toplulukla fikir paylaş</div></div>
        ${currentUser ? `<button class="btn btn-primary" id="new-forum-btn"><i class="fas fa-plus"></i> Yeni Konu Aç</button>` : ''}
      </div>
      <div class="search-bar"><i class="fas fa-search"></i><input type="text" id="forum-search" placeholder="Konu ara..." /></div>
      <div id="forums-list"><div class="loading-center"><div class="spinner"></div></div></div>
    </div>`;

  if (currentUser) $('#new-forum-btn')?.addEventListener('click', () => showNewForumModal());

  let forums = [];
  try { forums = await api('/forums'); } catch {}
  renderForumListItems(forums);

  $('#forum-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filtered = forums.filter(f => f.title.toLowerCase().includes(q) || f.content.toLowerCase().includes(q));
    renderForumListItems(filtered);
  });
}

function renderForumListItems(forums) {
  const el = $('#forums-list');
  if (!el) return;
  if (!forums.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-comments"></i><p>Konu bulunamadı.</p></div>'; return; }
  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">${forums.map(f => forumCardHTML(f)).join('')}</div>`;
}

function forumCardHTML(f) {
  const preview = f.content.substring(0, 140).replace(/</g,'&lt;');
  return `<div class="forum-card" onclick="navigate('/forum/${escHtml(f.slug)}')">
    <div class="forum-card-accent"></div>
    <div class="forum-card-body">
      <div class="forum-card-title">${escHtml(f.title)}</div>
      <div class="forum-card-preview">${preview}${f.content.length > 140 ? '...' : ''}</div>
      <div class="forum-card-meta">
        <span class="forum-meta-item"><i class="fas fa-user"></i>${escHtml(f.username || 'Silindi')}</span>
        <span class="forum-meta-item"><i class="fas fa-eye"></i>${f.views || 0}</span>
        <span class="forum-meta-item"><i class="fas fa-heart"></i>${f.like_count || 0}</span>
        <span class="forum-meta-item"><i class="fas fa-comment"></i>${f.comment_count || 0}</span>
        <span class="forum-meta-item"><i class="fas fa-clock"></i>${timeAgo(f.created_at)}</span>
      </div>
    </div>
    ${f.banner_image ? `<img src="${escHtml(f.banner_image)}" class="forum-card-banner" alt="" />` : ''}
  </div>`;
}

function showNewForumModal(existing = null) {
  showModal(existing ? 'Konuyu Düzenle' : 'Yeni Konu Aç', `
    <div class="form-group"><label>Başlık</label><input id="fm-title" type="text" placeholder="Konu başlığı" value="${existing ? escHtml(existing.title) : ''}" /></div>
    <div class="form-group"><label>İçerik</label><textarea id="fm-content" rows="8" placeholder="Yazınızı buraya girin...">${existing ? escHtml(existing.content) : ''}</textarea></div>
    <div class="form-group">
      <label>Konu Türleri</label>
      <div id="fm-tags-loading" style="color:var(--text-muted);padding:8px">Yükleniyor...</div>
      <div id="fm-tags-checkboxes" style="display:none;max-height:160px;overflow-y:auto;background:var(--bg-card2);border:1px solid var(--border);border-radius:8px;padding:10px;display:none"></div>
      <div style="margin-top:8px"><small style="color:var(--text-muted)">veya virgülle ayırarak kendiniz ekleyin:</small></div>
      <input type="text" id="fm-custom-tags" placeholder="Örn: bilim, siyaset, teknoloji" style="margin-top:4px" />
    </div>
    <div class="form-group">
      <label>Banner Resim (opsiyonel)</label>
      <input type="file" id="fm-banner-file" accept="image/*" style="margin-bottom:8px" />
      ${existing && existing.banner_image ? `<img id="fm-banner-preview" src="${escHtml(existing.banner_image)}" style="width:100%;max-height:160px;object-fit:cover;border-radius:8px;margin-top:4px" />` : `<div id="fm-banner-preview" style="display:none"></div>`}
    </div>
    <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="fm-comments" ${!existing || existing.allow_comments ? 'checked' : ''} /> Yorumlara izin ver</label></div>
    <button class="btn btn-primary" id="fm-submit" style="width:100%">${existing ? 'Güncelle' : 'Yayınla'}</button>
    <div id="fm-error" class="form-error mt-4"></div>
  `);

  api('/tags').then(tags => {
    const container = $('#fm-tags-checkboxes');
    const loading = $('#fm-tags-loading');
    if (!container || !loading) return;
    loading.style.display = 'none';
    container.style.display = 'block';
    container.innerHTML = tags.map(t => `
      <label class="checkbox-label" style="margin:4px 0;padding:4px;cursor:pointer">
        <input type="checkbox" class="fm-tag-check" value="${t.id}" />
        <span class="badge" style="background:${escHtml(t.color)};padding:3px 8px;border-radius:4px;margin-left:6px">${escHtml(t.name)}</span>
      </label>
    `).join('');
    
    if (existing) {
      api('/forum/' + existing.slug + '/tags').then(data => {
        data.systemTags.forEach(t => {
          const cb = container.querySelector(`input[value="${t.id}"]`);
          if (cb) cb.checked = true;
        });
        if (data.customTags.length > 0) {
          $('#fm-custom-tags').value = data.customTags.join(', ');
        }
      }).catch(() => {});
    }
  }).catch(() => {
    $('#fm-tags-loading').textContent = 'Tag yüklenemedi';
  });

  $('#fm-banner-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const prev = $('#fm-banner-preview');
      prev.outerHTML = `<img id="fm-banner-preview" src="${ev.target.result}" style="width:100%;max-height:160px;object-fit:cover;border-radius:8px;margin-top:4px" />`;
    };
    reader.readAsDataURL(file);
  });

  $('#fm-submit').addEventListener('click', async () => {
    const title = $('#fm-title').value.trim();
    const content = $('#fm-content').value.trim();
    if (!title || !content) { $('#fm-error').textContent = 'Başlık ve içerik zorunlu'; return; }
    
    const tagIds = Array.from($$('.fm-tag-check:checked')).map(cb => parseInt(cb.value));
    const customTagsInput = $('#fm-custom-tags').value.trim();
    const customTags = customTagsInput ? customTagsInput.split(',').map(t => t.trim()).filter(Boolean) : [];
    
    try {
      let banner_image = existing ? (existing.banner_image || '') : '';
      const bannerFile = $('#fm-banner-file').files[0];
      if (bannerFile) {
        const fd = new FormData(); fd.append('file', bannerFile);
        const r = await apiForm('/upload', fd);
        banner_image = r.url;
      }
      if (existing) {
        await api('/forum/' + existing.slug, { method: 'PUT', body: JSON.stringify({ title, content, banner_image, allow_comments: $('#fm-comments').checked, tagIds, customTags }) });
        toast('Konu güncellendi');
      } else {
        const f = await api('/forums', { method: 'POST', body: JSON.stringify({ title, content, banner_image, allow_comments: $('#fm-comments').checked, tagIds, customTags }) });
        toast('Konu oluşturuldu');
        hideModal();
        navigate('/forum/' + f.slug);
        return;
      }
      hideModal();
      navigate(location.pathname, false);
      renderRoute(location.pathname);
    } catch (e) { $('#fm-error').textContent = e.message; }
  });
}

async function renderForumDetail(app, slug) {
  app.innerHTML = `<div class="container page"><div class="loading-center"><div class="spinner"></div></div></div>`;
  let forum, liked = false, comments = [];
  try {
    forum = await api('/forum/' + slug);
    document.title = forum.title + ' – Demlik';
    updatePageMeta(
      forum.title + ' – Demlik',
      forum.content.substring(0, 155).replace(/\n/g, ' '),
      forum.banner_image || ''
    );

    let ld = document.getElementById('page-jsonld');
    if (!ld) { ld = document.createElement('script'); ld.type = 'application/ld+json'; ld.id = 'page-jsonld'; document.head.appendChild(ld); }
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'DiscussionForumPosting',
      'headline': forum.title,
      'text': forum.content.substring(0, 500),
      'url': SITE_URL + '/forum/' + forum.slug,
      'datePublished': forum.created_at,
      'dateModified': forum.updated_at || forum.created_at,
      'author': { '@type': 'Person', 'name': forum.username || 'Anonim' },
      'publisher': { '@type': 'Organization', 'name': 'Demlik', 'url': SITE_URL },
      'interactionStatistic': [
        { '@type': 'InteractionCounter', 'interactionType': 'https://schema.org/LikeAction', 'userInteractionCount': forum.like_count || 0 },
        { '@type': 'InteractionCounter', 'interactionType': 'https://schema.org/CommentAction', 'userInteractionCount': forum.comment_count || 0 }
      ],
      ...(forum.banner_image ? { 'image': { '@type': 'ImageObject', 'url': forum.banner_image } } : {})
    });

    try { await api('/forum/' + slug + '/view', { method: 'POST' }); } catch {}
    if (currentUser) { const l = await api('/forum/' + slug + '/liked'); liked = l.liked; }
    comments = await api('/forum/' + slug + '/comments');
  } catch { app.innerHTML = '<div class="container page"><div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Konu bulunamadı.</p></div></div>'; return; }

  const isOwner = currentUser && currentUser.id === forum.user_id;

  app.innerHTML = `<div class="container page">
    <div class="forum-detail">
      ${isOwner ? `<div style="display:flex;gap:8px;margin-bottom:16px">
        <button class="btn btn-outline btn-sm" id="edit-forum-btn"><i class="fas fa-edit"></i> Düzenle</button>
        <button class="btn btn-danger btn-sm" id="del-forum-btn"><i class="fas fa-trash"></i> Sil</button>
      </div>` : ''}
      <div class="forum-detail-header">
        <div class="forum-detail-title">${escHtml(forum.title)}</div>
        <div class="forum-detail-meta">
          <span>${avatarImg(forum, 'avatar-sm')} ${userDisplayName(forum)}</span>
          <span><i class="fas fa-calendar" style="color:var(--accent-red)"></i> ${formatDate(forum.created_at)}</span>
          <span><i class="fas fa-eye" style="color:var(--accent-red)"></i> ${forum.views || 0} görüntülenme</span>
        </div>
      </div>
      ${forum.banner_image ? `<img src="${escHtml(forum.banner_image)}" class="forum-detail-banner" alt="" />` : ''}
      <div class="forum-detail-content">${escHtml(forum.content)}</div>
      <div class="forum-actions">
        <button class="forum-action-btn ${liked ? 'liked' : ''}" id="like-btn">
          <i class="fas fa-heart"></i> <span id="like-count">${forum.like_count || 0}</span> Beğeni
        </button>
        <button class="forum-action-btn" id="share-btn"><i class="fas fa-share-alt"></i> Paylaş</button>
      </div>
      <hr class="divider" />
      <div class="comments-section">
        <div class="comments-title"><i class="fas fa-comments" style="color:var(--accent-red)"></i> Yorumlar (${comments.length})</div>
        ${currentUser && forum.allow_comments ? `
          <div class="comment-form">
            ${avatarImg(currentUser, 'comment-avatar')}
            <textarea id="comment-input" placeholder="Yorumunuzu yazın..."></textarea>
            <button class="btn btn-primary btn-sm" id="comment-submit"><i class="fas fa-paper-plane"></i></button>
          </div>` : (!currentUser && forum.allow_comments ? `<p class="text-secondary" style="margin-bottom:16px">Yorum yapmak için <a href="/giris" data-link class="auth-link">giriş yapın</a>.</p>` : (!forum.allow_comments ? `<p class="text-muted" style="margin-bottom:16px">Yorumlar kapatılmış.</p>` : ''))}
        <div id="comments-list">${comments.map(c => commentHTML(c)).join('')}</div>
      </div>
    </div>
  </div>`;

  if (isOwner) {
    $('#edit-forum-btn').addEventListener('click', () => showNewForumModal(forum));
    $('#del-forum-btn').addEventListener('click', async () => {
      if (!confirm('Konuyu silmek istediğinize emin misiniz?')) return;
      try { await api('/forum/' + slug, { method: 'DELETE' }); toast('Konu silindi'); navigate('/forum'); } catch (e) { toast(e.message, 'error'); }
    });
  }

  $('#like-btn').addEventListener('click', async () => {
    if (!currentUser) { navigate('/giris'); return; }
    try {
      const r = await api('/forum/' + slug + '/like', { method: 'POST' });
      liked = r.liked;
      const btn = $('#like-btn'); const cnt = $('#like-count');
      btn.classList.toggle('liked', liked);
      cnt.textContent = parseInt(cnt.textContent) + (liked ? 1 : -1);
    } catch {}
  });

  $('#share-btn').addEventListener('click', () => {
    const url = location.href;
    if (navigator.clipboard) { navigator.clipboard.writeText(url); toast('Link kopyalandı!'); }
    else { window.prompt('Linki kopyalayın:', url); }
  });

  $('#comment-submit')?.addEventListener('click', async () => {
    const content = $('#comment-input').value.trim();
    if (!content) return;
    try {
      const c = await api('/forum/' + slug + '/comments', { method: 'POST', body: JSON.stringify({ content }) });
      $('#comments-list').insertAdjacentHTML('beforeend', commentHTML(c));
      $('#comment-input').value = '';
      const title = $('.comments-title');
      if (title) title.innerHTML = `<i class="fas fa-comments" style="color:var(--accent-red)"></i> Yorumlar (${$('#comments-list').children.length})`;
    } catch (e) { toast(e.message, 'error'); }
  });

  $('#comments-list').addEventListener('click', async e => {
    const del = e.target.closest('.del-comment');
    if (del) {
      if (!confirm('Yorum silinsin mi?')) return;
      const id = del.dataset.id;
      try {
        await api('/forum/' + slug + '/comments/' + id, { method: 'DELETE' });
        del.closest('.comment').remove();
      } catch (e) { toast(e.message, 'error'); }
    }

    const likeBtn = e.target.closest('.like-comment-btn');
    if (likeBtn) {
      if (!currentUser) { navigate('/giris'); return; }
      const id = likeBtn.dataset.id;
      try {
        const r = await api(`/forum/${slug}/comments/${id}/like`, { method: 'POST' });
        const cnt = likeBtn.querySelector('.like-cnt');
        cnt.textContent = parseInt(cnt.textContent) + (r.liked ? 1 : -1);
        likeBtn.classList.toggle('liked', r.liked);
      } catch {}
    }
  });
}

function commentHTML(c) {
  const canDel = currentUser && currentUser.id === c.user_id;
  return `<div class="comment">
    ${avatarImg(c, 'comment-avatar')}
    <div class="comment-body">
      <div class="comment-header">
        <span class="comment-author">${userDisplayName(c)}</span>
        <span class="comment-time">${timeAgo(c.created_at)}</span>
      </div>
      <div class="comment-content">${escHtml(c.content)}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
        <div style="display:flex;align-items:center;gap:8px">
          ${canDel ? `<button class="btn btn-ghost btn-sm del-comment" data-id="${c.id}" style="padding:2px 6px;color:var(--accent-red2)"><i class="fas fa-trash"></i></button>` : ''}
        </div>
        <button class="like-comment-btn forum-action-btn" data-id="${c.id}" style="padding:4px 10px;font-size:12px">
          <i class="fas fa-heart"></i> <span class="like-cnt">${c.like_count || 0}</span>
        </button>
      </div>
    </div>
  </div>`;
}

async function renderBookList(app) {
  document.title = 'Kitaplar – Demlik';
  updatePageMeta('Kitaplar – Demlik', 'Topluluğun yazdığı eserleri keşfet.', '');
  app.innerHTML = `
    <div class="container page">
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div><div class="page-title">Kitaplar</div><div class="page-subtitle">Topluluğun eserleri</div></div>
        ${currentUser ? `<button class="btn btn-primary" id="new-book-btn"><i class="fas fa-plus"></i> Yeni Kitap</button>` : ''}
      </div>
      <div class="search-bar"><i class="fas fa-search"></i><input type="text" id="book-search" placeholder="Kitap ara..." /></div>
      <div id="books-grid" class="grid-3"><div class="loading-center"><div class="spinner"></div></div></div>
    </div>`;

  if (currentUser) $('#new-book-btn')?.addEventListener('click', () => showNewBookModal());

  let books = [];
  try { books = await api('/books'); } catch {}
  renderBookGrid(books);

  $('#book-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderBookGrid(books.filter(b => b.title.toLowerCase().includes(q) || b.username?.toLowerCase().includes(q)));
  });
}

function renderBookGrid(books) {
  const el = $('#books-grid'); if (!el) return;
  if (!books.length) { el.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-book-open"></i><p>Kitap bulunamadı.</p></div>'; return; }
  el.innerHTML = books.map(b => bookCardHTML(b)).join('');
}

function bookCardHTML(b) {
  const previewText = b.preface ? b.preface.substring(0, 80) : '';
  return `<div class="book-card" onclick="navigate('/kitap/${escHtml(b.slug)}')">
    <div class="book-cover">
      ${b.cover_image ? `<img src="${escHtml(b.cover_image)}" alt="" />` : `<div class="book-cover-placeholder"><i class="fas fa-book"></i></div>`}
    </div>
    <div class="book-info">
      <div class="book-title">${escHtml(b.title)}</div>
      <div class="book-author"><i class="fas fa-user" style="color:var(--accent-red);font-size:11px"></i> ${escHtml(b.username || 'Bilinmiyor')}</div>
      <div class="book-pages"><i class="fas fa-file-alt" style="color:var(--text-muted);font-size:11px"></i> ${b.page_count || 0} sayfa</div>
      ${previewText ? `<div class="book-desc">${escHtml(previewText)}...</div>` : ''}
    </div>
  </div>`;
}

function showNewBookModal(existing = null) {
  showModal(existing ? 'Kitabı Düzenle' : 'Yeni Kitap', `
    <div class="form-group"><label>Başlık</label><input id="bk-title" type="text" value="${existing ? escHtml(existing.title) : ''}" /></div>
    <div class="form-group"><label>Önsöz</label><textarea id="bk-preface" rows="4">${existing ? escHtml(existing.preface || '') : ''}</textarea></div>
    <div class="form-group">
      <label>Kapak Resmi (opsiyonel)</label>
      <input type="file" id="bk-cover-file" accept="image/*" style="margin-bottom:8px" />
      ${existing && existing.cover_image ? `<img id="bk-cover-preview" src="${escHtml(existing.cover_image)}" style="width:100px;height:133px;object-fit:cover;border-radius:8px;margin-top:4px" />` : `<div id="bk-cover-preview" style="display:none"></div>`}
    </div>
    <button class="btn btn-primary" id="bk-submit" style="width:100%">${existing ? 'Güncelle' : 'Oluştur'}</button>
    <div id="bk-error" class="form-error mt-4"></div>
  `);

  $('#bk-cover-file').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const prev = $('#bk-cover-preview');
      prev.outerHTML = `<img id="bk-cover-preview" src="${ev.target.result}" style="width:100px;height:133px;object-fit:cover;border-radius:8px;margin-top:4px" />`;
    };
    reader.readAsDataURL(file);
  });

  $('#bk-submit').addEventListener('click', async () => {
    const title = $('#bk-title').value.trim();
    if (!title) { $('#bk-error').textContent = 'Başlık zorunlu'; return; }
    try {
      let cover_image = existing ? (existing.cover_image || '') : '';
      const coverFile = $('#bk-cover-file').files[0];
      if (coverFile) {
        const fd = new FormData(); fd.append('file', coverFile);
        const r = await apiForm('/upload', fd);
        cover_image = r.url;
      }
      if (existing) {
        await api('/book/' + existing.slug, { method: 'PUT', body: JSON.stringify({ title, preface: $('#bk-preface').value.trim(), cover_image }) });
        toast('Kitap güncellendi'); hideModal(); renderRoute(location.pathname);
      } else {
        const b = await api('/books', { method: 'POST', body: JSON.stringify({ title, preface: $('#bk-preface').value.trim(), cover_image }) });
        toast('Kitap oluşturuldu'); hideModal(); navigate('/kitap/' + b.slug);
      }
    } catch (e) { $('#bk-error').textContent = e.message; }
  });
}

async function renderBookDetail(app, slug) {
  app.innerHTML = `<div class="container page"><div class="loading-center"><div class="spinner"></div></div></div>`;
  let data;
  try { data = await api('/book/' + slug); } catch { app.innerHTML = '<div class="container page"><div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Kitap bulunamadı.</p></div></div>'; return; }

  const { book, chapters, pages } = data;
  document.title = book.title + ' – Demlik';
  updatePageMeta(book.title + ' – Demlik', book.preface ? book.preface.substring(0,155) : book.title + ' – Demlik\'te yayınlanan kitap.', book.cover_image || '');
  const isOwner = currentUser && currentUser.id === book.user_id;

  const unassigned = pages.filter(p => !p.chapter_id);
  const chapPages = {};
  chapters.forEach(c => { chapPages[c.id] = pages.filter(p => p.chapter_id === c.id); });

  const chapListHTML = chapters.map(c => `
    <div class="chapter-item">
      <div class="chapter-title"><i class="fas fa-bookmark" style="color:var(--accent-red);font-size:12px"></i> ${escHtml(c.title)}
        ${isOwner ? `<button class="btn btn-ghost btn-sm del-chapter" data-id="${c.id}" style="float:right;padding:0 6px;color:var(--accent-red2)"><i class="fas fa-trash"></i></button>` : ''}
      </div>
      ${(chapPages[c.id] || []).map(p => pageItemHTML(p, slug)).join('')}
    </div>`).join('');

  const unassignedHTML = unassigned.map(p => pageItemHTML(p, slug)).join('');

  app.innerHTML = `<div class="container page">
    <div class="book-detail-header">
      <div class="book-detail-cover">
        ${book.cover_image ? `<img src="${escHtml(book.cover_image)}" alt="" />` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-card2)"><i class="fas fa-book" style="font-size:40px;color:var(--text-muted)"></i></div>`}
      </div>
      <div class="book-detail-info">
        <div class="book-detail-title">${escHtml(book.title)}</div>
        <div class="book-detail-author">${avatarImg(book, 'avatar-sm')} ${userDisplayName(book)} &middot; ${book.page_count} sayfa</div>
        ${book.preface ? `<div class="book-preface">${escHtml(book.preface)}</div>` : ''}
        ${isOwner ? `<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" id="edit-book-btn"><i class="fas fa-edit"></i> Düzenle</button>
          <button class="btn btn-primary btn-sm" id="add-page-btn"><i class="fas fa-plus"></i> Sayfa Ekle</button>
          <button class="btn btn-outline btn-sm" id="add-chap-btn"><i class="fas fa-folder-plus"></i> Bölüm Ekle</button>
          <button class="btn btn-danger btn-sm" id="del-book-btn"><i class="fas fa-trash"></i> Sil</button>
        </div>` : ''}
        <div style="margin-top:12px">
          <button class="btn btn-outline btn-sm" id="download-pdf-btn"><i class="fas fa-file-pdf" style="color:#ef4444"></i> PDF İndir</button>
        </div>
      </div>
    </div>
    <div class="chapters-list">
      <div class="section-title" style="margin-bottom:16px"><div class="section-title-bar"></div>İçindekiler</div>
      ${!chapters.length && !pages.length ? '<div class="empty-state"><i class="fas fa-file-alt"></i><p>Henüz sayfa yok.</p></div>' : ''}
      ${unassignedHTML}
      ${chapListHTML}
    </div>
  </div>`;

  if (isOwner) {
    $('#edit-book-btn').addEventListener('click', () => showNewBookModal(book));
    $('#del-book-btn').addEventListener('click', async () => {
      if (!confirm('Kitabı ve tüm sayfalarını silmek istediğinize emin misiniz?')) return;
      try { await api('/book/' + slug, { method: 'DELETE' }); toast('Kitap silindi'); navigate('/kitaplar'); } catch (e) { toast(e.message, 'error'); }
    });
    $('#add-page-btn').addEventListener('click', () => showAddPageModal(slug, chapters));
    $('#add-chap-btn').addEventListener('click', () => showAddChapterModal(slug));
    document.querySelectorAll('.del-chapter').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('Bölümü silmek istediğinize emin misiniz?')) return;
        try { await api(`/book/${slug}/chapter/${btn.dataset.id}`, { method: 'DELETE' }); toast('Bölüm silindi'); renderRoute(location.pathname); } catch (e) { toast(e.message, 'error'); }
      });
    });
  }

  $('#download-pdf-btn')?.addEventListener('click', async () => {
    toast('PDF hazırlanıyor...', 'success');
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = 210; const margin = 20; const contentW = pageW - margin * 2;
      let y = margin;

      function addText(text, size, bold, color) {
        doc.setFontSize(size);
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        if (color) doc.setTextColor(...color); else doc.setTextColor(30, 30, 30);
        const lines = doc.splitTextToSize(text || '', contentW);
        lines.forEach(line => {
          if (y > 270) { doc.addPage(); y = margin; }
          doc.text(line, margin, y);
          y += size * 0.45;
        });
        y += 3;
      }

      addText(book.title, 24, true, [30, 30, 30]);
      addText('Yazar: ' + (book.username || 'Bilinmiyor'), 12, false, [100, 100, 100]);
      addText(book.page_count + ' sayfa', 11, false, [130, 130, 130]);
      y += 6;

      doc.setDrawColor(200, 50, 50);
      doc.line(margin, y, pageW - margin, y);
      y += 8;

      if (book.preface) {
        addText('ÖNSÖZ', 14, true, [180, 30, 30]);
        addText(book.preface, 11, false);
        y += 6;
        doc.line(margin, y, pageW - margin, y);
        y += 8;
      }

      addText('İÇİNDEKİLER', 14, true, [180, 30, 30]);
      const allPagesData = await api('/book/' + slug);
      const allP = allPagesData.pages || [];
      allP.forEach(p => { addText(p.page_num + '. ' + p.title, 11, false); });
      y += 8;
      doc.line(margin, y, pageW - margin, y);
      y += 8;

      for (const p of allP) {
        try {
          const pd = await api('/book/' + slug + '/page/' + p.slug);
          const pg = pd.page;
          doc.addPage(); y = margin;
          addText(pg.page_num + '. SAYFA', 10, false, [150, 150, 150]);
          addText(pg.title, 16, true, [30, 30, 30]);
          doc.setDrawColor(220, 80, 80);
          doc.line(margin, y, pageW - margin, y);
          y += 6;
          addText(pg.content, 11, false, [40, 40, 40]);
        } catch {}
      }

      doc.save(book.title.replace(/[^a-zA-Z0-9\s]/g, '') + '.pdf');
      toast('PDF indirildi!', 'success');
    } catch (e) { toast('PDF oluşturulamadı: ' + e.message, 'error'); }
  });
}

function pageItemHTML(p, bookSlug) {
  const canEdit = currentUser && !!bookSlug;
  return `<div class="page-item">
    <span class="page-num">${p.page_num}</span>
    <a href="/kitap/${escHtml(bookSlug)}/sayfa/${escHtml(p.slug)}" data-link class="page-title">${escHtml(p.title)}</a>
  </div>`;
}

async function showAddPageModal(bookSlug, chapters) {
  // Önce mevcut sayfa sayısını al
  let pageCount = 0;
  try {
    const data = await api('/book/' + bookSlug);
    pageCount = data.book.page_count || 0;
  } catch {}

  const chapOptions = chapters.map(c => `<option value="${c.id}">${escHtml(c.title)}</option>`).join('');
  showModal('Yeni Sayfa', `
    <div style="background:var(--bg-card2);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:var(--text-secondary)">
      <i class="fas fa-info-circle" style="color:var(--accent-red)"></i>
      Bu sayfa <strong style="color:var(--text-primary)">${pageCount + 1}. sayfa</strong> olarak eklenecek
    </div>
    <div class="form-group"><label>Sayfa Başlığı</label><input id="pg-title" type="text" placeholder="Sayfa başlığı..." /></div>
    ${chapters.length ? `<div class="form-group"><label>Bölüm (opsiyonel)</label><select id="pg-chap"><option value="">-- Bölüm seçin --</option>${chapOptions}</select></div>` : ''}
    <div class="form-group">
      <label>Kapak/Görsel (opsiyonel)</label>
      <input type="file" id="pg-image-file" accept="image/*" style="margin-bottom:8px" />
      <div id="pg-image-preview" style="display:none"></div>
    </div>
    <div class="form-group"><label>İçerik</label><textarea id="pg-content" rows="14" placeholder="Sayfanın içeriğini buraya yazın..."></textarea></div>
    <button class="btn btn-primary" id="pg-submit" style="width:100%">Ekle</button>
    <div id="pg-error" class="form-error mt-4"></div>
  `);

  $('#pg-image-file').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const prev = $('#pg-image-preview');
      prev.style.display = 'block';
      prev.innerHTML = `<img src="${ev.target.result}" style="width:100%;max-height:200px;object-fit:cover;border-radius:8px;margin-top:4px" />`;
    };
    reader.readAsDataURL(file);
  });

  $('#pg-submit').addEventListener('click', async () => {
    const title = $('#pg-title').value.trim();
    const content = $('#pg-content').value.trim();
    if (!title || !content) { $('#pg-error').textContent = 'Başlık ve içerik zorunlu'; return; }
    const chapter_id = $('#pg-chap')?.value || null;
    try {
      let image_url = '';
      const imgFile = $('#pg-image-file').files[0];
      if (imgFile) {
        const fd = new FormData(); fd.append('file', imgFile);
        const r = await apiForm('/upload', fd);
        image_url = r.url;
      }
      await api('/book/' + bookSlug + '/pages', { method: 'POST', body: JSON.stringify({ title, content, chapter_id, image_url }) });
      toast('Sayfa eklendi'); hideModal(); renderRoute(location.pathname);
    } catch (e) { $('#pg-error').textContent = e.message; }
  });
}

function showAddChapterModal(bookSlug) {
  showModal('Yeni Bölüm', `
    <div class="form-group"><label>Bölüm Adı</label><input id="ch-title" type="text" /></div>
    <div class="form-group"><label>Sıra</label><input id="ch-order" type="number" value="0" /></div>
    <button class="btn btn-primary" id="ch-submit" style="width:100%">Ekle</button>
    <div id="ch-error" class="form-error mt-4"></div>
  `);
  $('#ch-submit').addEventListener('click', async () => {
    const title = $('#ch-title').value.trim();
    if (!title) { $('#ch-error').textContent = 'Başlık zorunlu'; return; }
    try {
      await api('/book/' + bookSlug + '/chapters', { method: 'POST', body: JSON.stringify({ title, order_num: parseInt($('#ch-order').value) || 0 }) });
      toast('Bölüm eklendi'); hideModal(); renderRoute(location.pathname);
    } catch (e) { $('#ch-error').textContent = e.message; }
  });
}

async function renderPageReader(app, bookSlug, pageSlug) {
  app.innerHTML = `<div class="container page"><div class="loading-center"><div class="spinner"></div></div></div>`;
  let data;
  try { data = await api(`/book/${bookSlug}/page/${pageSlug}`); } catch { app.innerHTML = '<div class="container page"><div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Sayfa bulunamadı.</p></div></div>'; return; }

  const { page, book, prev, next } = data;
  document.title = page.title + ' - ' + book.title;
  const isOwner = currentUser && currentUser.id === book.user_id;

  // Kitabın tüm sayfalarını al (içindekiler için)
  let allPages = [];
  try { const bd = await api('/book/' + bookSlug); allPages = bd.pages || []; } catch {}

  // Font boyutu localStorage'dan al
  let fontSize = parseInt(localStorage.getItem('ebook-font-size') || '17');

  const tocHTML = allPages.map(p => `
    <a href="/kitap/${escHtml(bookSlug)}/sayfa/${escHtml(p.slug)}" data-link
      class="ebook-toc-item${p.slug === pageSlug ? ' ebook-toc-active' : ''}"
      style="display:flex;align-items:center;gap:8px;padding:8px 16px;font-size:13px;color:${p.slug === pageSlug ? 'var(--accent-red2)' : 'var(--text-secondary)'};background:${p.slug === pageSlug ? 'rgba(220,38,38,0.08)' : 'none'};border-left:3px solid ${p.slug === pageSlug ? 'var(--accent-red)' : 'transparent'};transition:all 0.15s;text-decoration:none">
      <span style="color:var(--text-muted);font-size:11px;min-width:20px">${p.page_num}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.title)}</span>
    </a>`).join('');

  app.innerHTML = `<div style="max-width:960px;margin:0 auto;padding:20px">
    <!-- Breadcrumb -->
    <div class="breadcrumb" style="margin-bottom:16px">
      <a href="/kitaplar" data-link>Kitaplar</a>
      <span class="breadcrumb-sep"><i class="fas fa-chevron-right" style="font-size:10px"></i></span>
      <a href="/kitap/${escHtml(bookSlug)}" data-link>${escHtml(book.title)}</a>
      <span class="breadcrumb-sep"><i class="fas fa-chevron-right" style="font-size:10px"></i></span>
      <span>${escHtml(page.title)}</span>
    </div>

    ${isOwner ? `<div style="display:flex;gap:8px;margin-bottom:16px">
      <button class="btn btn-outline btn-sm" id="edit-page-btn"><i class="fas fa-edit"></i> Düzenle</button>
      <button class="btn btn-danger btn-sm" id="del-page-btn"><i class="fas fa-trash"></i> Sil</button>
    </div>` : ''}

    <div class="ebook-layout">
      <!-- Sol: İçindekiler -->
      <div class="ebook-toc" id="ebook-toc" style="display:none">
        <div style="padding:12px 16px;border-bottom:1px solid rgba(220,38,38,0.15);font-size:13px;font-weight:600;color:var(--text-secondary)">
          <i class="fas fa-list" style="color:var(--accent-red)"></i> İçindekiler
        </div>
        <div style="overflow-y:auto;max-height:600px">
          ${tocHTML || '<div style="padding:16px;font-size:13px;color:var(--text-muted)">Sayfa yok</div>'}
        </div>
      </div>

      <!-- Sağ: Okuyucu -->
      <div class="ebook-reader" style="flex:1">
        <!-- Toolbar -->
        <div class="ebook-toolbar">
          <button class="btn btn-ghost btn-sm" id="toc-toggle" title="İçindekiler">
            <i class="fas fa-list"></i> <span class="hidden" id="toc-label">İçindekiler</span>
          </button>
          <div class="font-size-controls" style="display:flex;align-items:center;gap:6px">
            <button id="font-dec" title="Küçük">A-</button>
            <span style="font-size:13px;color:var(--text-muted)" id="font-size-label">${fontSize}px</span>
            <button id="font-inc" title="Büyük">A+</button>
          </div>
          <div class="ebook-page-counter">${page.page_num} / ${book.page_count}</div>
        </div>

        <!-- İçerik -->
        <div class="ebook-page-content" id="ebook-content" style="font-size:${fontSize}px">
          ${page.image_url ? `<img src="${escHtml(page.image_url)}" class="ebook-page-image" alt="" />` : ''}
          <div style="font-size:1.3em;font-weight:700;margin-bottom:24px;color:#f0e8dc;font-family:'Georgia',serif">${escHtml(page.title)}</div>
          ${escHtml(page.content)}
        </div>

        <!-- Alt Navigasyon -->
        <div class="ebook-nav">
          ${prev ? `<a href="/kitap/${escHtml(bookSlug)}/sayfa/${escHtml(prev.slug)}" data-link class="ebook-nav-btn">
            <i class="fas fa-arrow-left"></i>
            <div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">Önceki</div><div style="font-size:13px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(prev.title)}</div></div>
          </a>` : `<div></div>`}
          <div class="ebook-page-counter">${page.page_num} / ${book.page_count}</div>
          ${next ? `<a href="/kitap/${escHtml(bookSlug)}/sayfa/${escHtml(next.slug)}" data-link class="ebook-nav-btn" style="text-align:right;justify-content:flex-end">
            <div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">Sonraki</div><div style="font-size:13px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(next.title)}</div></div>
            <i class="fas fa-arrow-right"></i>
          </a>` : `<div></div>`}
        </div>
      </div>
    </div>
  </div>`;

  // Font boyutu kontrolleri
  const contentEl = $('#ebook-content');
  $('#font-dec').addEventListener('click', () => {
    if (fontSize > 12) { fontSize--; contentEl.style.fontSize = fontSize + 'px'; $('#font-size-label').textContent = fontSize + 'px'; localStorage.setItem('ebook-font-size', fontSize); }
  });
  $('#font-inc').addEventListener('click', () => {
    if (fontSize < 26) { fontSize++; contentEl.style.fontSize = fontSize + 'px'; $('#font-size-label').textContent = fontSize + 'px'; localStorage.setItem('ebook-font-size', fontSize); }
  });

  // İçindekiler toggle
  const tocEl = $('#ebook-toc');
  const layout = document.querySelector('.ebook-layout');
  let tocOpen = window.innerWidth >= 900;
  function updateToc() {
    if (tocOpen) {
      tocEl.style.display = 'flex';
      tocEl.style.flexDirection = 'column';
      layout.style.gap = '0';
    } else {
      tocEl.style.display = 'none';
    }
  }
  updateToc();
  $('#toc-toggle').addEventListener('click', () => { tocOpen = !tocOpen; updateToc(); });

  if (isOwner) {
    $('#edit-page-btn').addEventListener('click', () => {
      showModal('Sayfayı Düzenle', `
        <div class="form-group"><label>Başlık</label><input id="ep-title" type="text" value="${escHtml(page.title)}" /></div>
        <div class="form-group"><label>İçerik</label><textarea id="ep-content" rows="14">${escHtml(page.content)}</textarea></div>
        <button class="btn btn-primary" id="ep-submit" style="width:100%">Kaydet</button>
        <div id="ep-error" class="form-error mt-4"></div>
      `);
      $('#ep-submit').addEventListener('click', async () => {
        const title = $('#ep-title').value.trim();
        const content = $('#ep-content').value.trim();
        if (!title || !content) { $('#ep-error').textContent = 'Zorunlu alan'; return; }
        try {
          await api(`/book/${bookSlug}/page/${pageSlug}`, { method: 'PUT', body: JSON.stringify({ title, content }) });
          toast('Sayfa güncellendi'); hideModal(); renderRoute(location.pathname);
        } catch (e) { $('#ep-error').textContent = e.message; }
      });
    });
    $('#del-page-btn').addEventListener('click', async () => {
      if (!confirm('Sayfa silinsin mi?')) return;
      try { await api(`/book/${bookSlug}/page/${pageSlug}`, { method: 'DELETE' }); toast('Sayfa silindi'); navigate('/kitap/' + bookSlug); } catch (e) { toast(e.message, 'error'); }
    });
  }
}

async function renderGroupList(app) {
  document.title = 'Gruplar - Demlik';
  app.innerHTML = `
    <div class="container page">
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div><div class="page-title">Gruplar</div><div class="page-subtitle">Topluluğa katıl</div></div>
        ${currentUser ? `<button class="btn btn-primary" id="new-group-btn"><i class="fas fa-plus"></i> Yeni Grup</button>` : ''}
      </div>
      <div id="join-invite-section" style="margin-bottom:16px">
        ${currentUser ? `<div style="display:flex;gap:8px;max-width:400px">
          <input id="invite-code-input" type="text" placeholder="Davet kodu ile katıl..." />
          <button class="btn btn-outline" id="join-invite-btn">Katıl</button>
        </div>` : ''}
      </div>
      <div class="search-bar" style="margin-bottom:24px"><i class="fas fa-search"></i><input type="text" id="group-search" placeholder="Grup ara (isim veya açıklama)..." /></div>
      <div id="groups-grid" class="grid-3"><div class="loading-center"><div class="spinner"></div></div></div>
    </div>`;

  if (currentUser) {
    $('#new-group-btn')?.addEventListener('click', () => showNewGroupModal());
    $('#join-invite-btn')?.addEventListener('click', async () => {
      const code = $('#invite-code-input').value.trim();
      if (!code) return;
      try { await api('/group/join-invite', { method: 'POST', body: JSON.stringify({ invite_code: code }) }); toast('Gruba katıldınız!'); renderRoute(location.pathname); } catch (e) { toast(e.message, 'error'); }
    });
  }

  let groups = [];
  try { groups = await api('/groups'); } catch {}

  function renderGroups(list) {
    const el = $('#groups-grid');
    if (!el) return;
    if (!list.length) { el.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-users"></i><p>Grup bulunamadı.</p></div>'; return; }
    el.innerHTML = list.map(g => groupCardHTML(g)).join('');
  }

  renderGroups(groups);

  $('#group-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderGroups(groups.filter(g => g.name.toLowerCase().includes(q) || (g.description || '').toLowerCase().includes(q)));
  });
}

function groupCardHTML(g) {
  const typeBadge = g.type === 'private' ? `<span class="badge badge-red"><i class="fas fa-lock"></i> Özel</span>` : `<span class="badge badge-green"><i class="fas fa-globe"></i> Açık</span>`;
  return `<div class="group-card" onclick="navigate('/grup/${escHtml(g.slug)}')">
    <div class="group-cover">
      ${g.cover_image ? `<img src="${escHtml(g.cover_image)}" alt="" />` : `<div class="group-cover-placeholder"><i class="fas fa-users"></i></div>`}
    </div>
    <div class="group-info">
      <div class="group-name">${escHtml(g.name)}</div>
      <div class="group-desc">${escHtml(g.description || '')}</div>
      <div class="group-meta">
        ${typeBadge}
        <span class="forum-meta-item"><i class="fas fa-users" style="color:var(--accent-red)"></i> ${g.member_count}</span>
      </div>
    </div>
  </div>`;
}

function showNewGroupModal() {
  showModal('Yeni Grup', `
    <div class="form-group"><label>Grup Adı</label><input id="gr-name" type="text" /></div>
    <div class="form-group"><label>Açıklama</label><textarea id="gr-desc" rows="3"></textarea></div>
    <div class="form-group">
      <label>Kapak Resmi (opsiyonel)</label>
      <input type="file" id="gr-cover-file" accept="image/*" style="margin-bottom:8px" />
      <div id="gr-cover-preview" style="display:none"></div>
    </div>
    <div class="form-group"><label>Tür</label><select id="gr-type"><option value="public">Açık</option><option value="private">Özel</option></select></div>
    <div class="form-group">
      <label class="checkbox-label"><input type="checkbox" id="gr-chat" checked /> Sohbete izin ver</label>
      <label class="checkbox-label" style="margin-top:8px"><input type="checkbox" id="gr-photos" checked /> Fotoğrafa izin ver</label>
      <label class="checkbox-label" style="margin-top:8px"><input type="checkbox" id="gr-invite" /> Sadece davet ile katılım</label>
    </div>
    <button class="btn btn-primary" id="gr-submit" style="width:100%">Oluştur</button>
    <div id="gr-error" class="form-error mt-4"></div>
  `);

  $('#gr-cover-file').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const prev = $('#gr-cover-preview');
      prev.outerHTML = `<img id="gr-cover-preview" src="${ev.target.result}" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px" />`;
    };
    reader.readAsDataURL(file);
  });

  $('#gr-submit').addEventListener('click', async () => {
    const name = $('#gr-name').value.trim();
    if (!name) { $('#gr-error').textContent = 'İsim zorunlu'; return; }
    try {
      let cover_image = '';
      const coverFile = $('#gr-cover-file').files[0];
      if (coverFile) {
        const fd = new FormData(); fd.append('file', coverFile);
        const r = await apiForm('/upload', fd);
        cover_image = r.url;
      }
      const g = await api('/groups', { method: 'POST', body: JSON.stringify({ name, description: $('#gr-desc').value.trim(), cover_image, type: $('#gr-type').value, allow_chat: $('#gr-chat').checked, allow_photos: $('#gr-photos').checked, invite_only: $('#gr-invite').checked }) });
      toast('Grup oluşturuldu'); hideModal(); navigate('/grup/' + g.slug);
    } catch (e) { $('#gr-error').textContent = e.message; }
  });
}

let chatPollInterval = null;

async function renderGroupDetail(app, slug) {
  if (chatPollInterval) { clearInterval(chatPollInterval); chatPollInterval = null; }
  app.innerHTML = `<div class="container page"><div class="loading-center"><div class="spinner"></div></div></div>`;

  let groupData, members = [], messages = [];
  try {
    groupData = await api('/group/' + slug);
    members = await api('/group/' + slug + '/members');
    try { messages = await api('/group/' + slug + '/messages'); } catch {}
  } catch { app.innerHTML = '<div class="container page"><div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Grup bulunamadı.</p></div></div>'; return; }

  const { group, isMember, role } = groupData;
  document.title = group.name + ' - Demlik';
  const isOwner = currentUser && currentUser.id === group.owner_id;
  const isMod = role === 'moderator';
  const canSend = currentUser && isMember && group.allow_chat;

  app.innerHTML = `<div class="container page">
    <div style="margin-bottom:20px">
      ${group.cover_image ? `<img src="${escHtml(group.cover_image)}" style="width:100%;border-radius:var(--radius);aspect-ratio:16/5;object-fit:cover;margin-bottom:16px" alt="" />` : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:28px;font-weight:800">${escHtml(group.name)}</h1>
          <p style="color:var(--text-secondary);margin-top:4px">${escHtml(group.description || '')}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${!isMember && currentUser && group.type === 'public' && !group.invite_only ? `<button class="btn btn-primary" id="join-btn"><i class="fas fa-plus"></i> Katıl</button>` : ''}
          ${isMember && !isOwner ? `<button class="btn btn-outline" id="leave-btn"><i class="fas fa-sign-out-alt"></i> Ayrıl</button>` : ''}
          ${isOwner ? `<button class="btn btn-outline btn-sm" id="group-settings-btn"><i class="fas fa-cog"></i> Ayarlar</button>
            <button class="btn btn-outline btn-sm" id="gen-invite-btn"><i class="fas fa-link"></i> Davet Kodu</button>` : ''}
        </div>
      </div>
    </div>
    <div class="group-detail-layout">
      <div>
        ${group.allow_chat ? `
          <div class="chat-container">
            <div class="chat-messages" id="chat-messages">${messages.map(m => chatMsgHTML(m)).join('')}</div>
            ${canSend ? `<div class="chat-input-bar">
              <input id="chat-input" type="text" placeholder="Mesaj yaz..." />
              ${group.allow_photos ? `<label class="btn btn-ghost btn-sm" for="chat-img-input" title="Fotoğraf gönder"><i class="fas fa-image"></i></label><input id="chat-img-input" type="file" accept="image/*" style="display:none" />` : ''}
              <button class="btn btn-primary btn-sm" id="send-msg-btn"><i class="fas fa-paper-plane"></i></button>
            </div>` : (currentUser && !isMember ? `<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:13px">Mesaj göndermek için gruba katılın.</div>` : `<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:13px">Giriş yaparak katılabilirsiniz.</div>`)}
          </div>` : `<div class="card card-body" style="text-align:center;color:var(--text-muted)"><i class="fas fa-comment-slash" style="font-size:32px;margin-bottom:8px;display:block"></i>Sohbet kapatılmış.</div>`}
      </div>
      <div>
        <div class="group-sidebar-card">
          <div class="card-header"><span><i class="fas fa-info-circle" style="color:var(--accent-red)"></i> Bilgi</span></div>
          <div class="card-body" style="font-size:13px;color:var(--text-secondary)">
            <div style="margin-bottom:6px"><i class="fas fa-users"></i> ${group.member_count} üye</div>
            <div style="margin-bottom:6px">${group.type === 'private' ? '<span class="badge badge-red"><i class="fas fa-lock"></i> Özel</span>' : '<span class="badge badge-green"><i class="fas fa-globe"></i> Açık</span>'}</div>
            <div style="margin-bottom:6px"><i class="fas fa-user-shield"></i> Sahip: ${escHtml(group.owner_name || '')}</div>
            <div><i class="fas fa-calendar"></i> ${formatDate(group.created_at)}</div>
          </div>
        </div>
        <div class="group-sidebar-card">
          <div class="card-header"><span><i class="fas fa-users" style="color:var(--accent-red)"></i> Üyeler</span></div>
          <div id="members-list">${members.slice(0, 10).map(m => memberItemHTML(m, isOwner, slug)).join('')}</div>
        </div>
      </div>
    </div>
  </div>`;

  const chatEl = $('#chat-messages');
  if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;

  $('#join-btn')?.addEventListener('click', async () => {
    try { await api('/group/' + slug + '/join', { method: 'POST' }); toast('Gruba katıldınız!'); renderRoute(location.pathname); } catch (e) { toast(e.message, 'error'); }
  });
  $('#leave-btn')?.addEventListener('click', async () => {
    if (!confirm('Gruptan ayrılmak istiyor musunuz?')) return;
    try { await api('/group/' + slug + '/leave', { method: 'POST' }); toast('Gruptan ayrıldınız.'); renderRoute(location.pathname); } catch (e) { toast(e.message, 'error'); }
  });

  if (canSend) {
    const sendMsg = async () => {
      const input = $('#chat-input');
      const content = input?.value.trim();
      if (!content) return;
      try {
        const msg = await api('/group/' + slug + '/messages', { method: 'POST', body: JSON.stringify({ content }) });
        $('#chat-messages').insertAdjacentHTML('beforeend', chatMsgHTML(msg));
        input.value = '';
        chatEl.scrollTop = chatEl.scrollHeight;
      } catch (e) { toast(e.message, 'error'); }
    };
    $('#send-msg-btn')?.addEventListener('click', sendMsg);
    $('#chat-input')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } });

    $('#chat-img-input')?.addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      const fd = new FormData(); fd.append('image', file);
      try {
        const r = await apiForm('/group/' + slug + '/upload', fd);
        const msg = await api('/group/' + slug + '/messages', { method: 'POST', body: JSON.stringify({ content: '', image_url: r.url }) });
        $('#chat-messages').insertAdjacentHTML('beforeend', chatMsgHTML(msg));
        chatEl.scrollTop = chatEl.scrollHeight;
      } catch (e) { toast(e.message, 'error'); }
      e.target.value = '';
    });

    let lastId = messages.length ? messages[messages.length - 1].id : 0;
    chatPollInterval = setInterval(async () => {
      if (!$('#chat-messages')) { clearInterval(chatPollInterval); return; }
      try {
        const newMsgs = await api('/group/' + slug + '/messages');
        const newest = newMsgs.filter(m => m.id > lastId);
        if (newest.length) {
          newest.forEach(m => { $('#chat-messages').insertAdjacentHTML('beforeend', chatMsgHTML(m)); });
          lastId = newest[newest.length - 1].id;
          const chatEl2 = $('#chat-messages');
          if (chatEl2) chatEl2.scrollTop = chatEl2.scrollHeight;
        }
      } catch {}
    }, 5000);
  }

  $('#chat-messages')?.addEventListener('click', async e => {
    const del = e.target.closest('.del-msg');
    if (!del) return;
    try { await api('/group/' + slug + '/messages/' + del.dataset.id, { method: 'DELETE' }); del.closest('.chat-msg').remove(); } catch (e) { toast(e.message, 'error'); }
  });

  $('#gen-invite-btn')?.addEventListener('click', async () => {
    try {
      const r = await api('/group/' + slug + '/invite', { method: 'POST' });
      showModal('Davet Kodu', `<div style="text-align:center;padding:20px">
        <div style="font-size:32px;font-weight:900;letter-spacing:6px;color:var(--accent-red2);background:var(--bg-card2);padding:16px;border-radius:8px;margin-bottom:16px">${r.invite_code}</div>
        <button class="btn btn-primary" onclick="navigator.clipboard && navigator.clipboard.writeText('${r.invite_code}'); toast('Kopyalandı!')">Kopyala</button>
      </div>`);
    } catch (e) { toast(e.message, 'error'); }
  });

  $('#group-settings-btn')?.addEventListener('click', () => {
    showModal('Grup Ayarları', `
      <div class="form-group"><label>Grup Adı</label><input id="gs-name" type="text" value="${escHtml(group.name)}" /></div>
      <div class="form-group"><label>Açıklama</label><textarea id="gs-desc" rows="3">${escHtml(group.description || '')}</textarea></div>
      <div class="form-group">
        <label>Kapak Resmi</label>
        <input type="file" id="gs-cover-file" accept="image/*" style="margin-bottom:8px" />
        ${group.cover_image ? `<img id="gs-cover-preview" src="${escHtml(group.cover_image)}" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px" />` : `<div id="gs-cover-preview" style="display:none"></div>`}
      </div>
      <div class="form-group"><label>Tür</label><select id="gs-type"><option value="public" ${group.type === 'public' ? 'selected' : ''}>Açık</option><option value="private" ${group.type === 'private' ? 'selected' : ''}>Özel</option></select></div>
      <div class="form-group">
        <label class="checkbox-label"><input type="checkbox" id="gs-chat" ${group.allow_chat ? 'checked' : ''} /> Sohbet</label>
        <label class="checkbox-label" style="margin-top:8px"><input type="checkbox" id="gs-photos" ${group.allow_photos ? 'checked' : ''} /> Fotoğraf</label>
      </div>
      <button class="btn btn-primary" id="gs-submit" style="width:100%">Kaydet</button>
      <button class="btn btn-danger" id="gs-delete" style="width:100%;margin-top:8px">Grubu Sil</button>
      <div id="gs-error" class="form-error mt-4"></div>
    `);

    $('#gs-cover-file').addEventListener('change', e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const prev = $('#gs-cover-preview');
        prev.outerHTML = `<img id="gs-cover-preview" src="${ev.target.result}" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px" />`;
      };
      reader.readAsDataURL(file);
    });

    $('#gs-submit').addEventListener('click', async () => {
      try {
        let cover_image = group.cover_image || '';
        const coverFile = $('#gs-cover-file').files[0];
        if (coverFile) {
          const fd = new FormData(); fd.append('file', coverFile);
          const r = await apiForm('/upload', fd);
          cover_image = r.url;
        }
        await api('/group/' + slug, { method: 'PUT', body: JSON.stringify({ name: $('#gs-name').value.trim(), description: $('#gs-desc').value.trim(), cover_image, type: $('#gs-type').value, allow_chat: $('#gs-chat').checked, allow_photos: $('#gs-photos').checked }) });
        toast('Grup güncellendi'); hideModal(); renderRoute(location.pathname);
      } catch (e) { $('#gs-error').textContent = e.message; }
    });
    $('#gs-delete').addEventListener('click', async () => {
      if (!confirm('Grubu silmek istediğinize emin misiniz?')) return;
      try { await api('/group/' + slug, { method: 'DELETE' }); toast('Grup silindi'); hideModal(); navigate('/gruplar'); } catch (e) { toast(e.message, 'error'); }
    });
  });

  $('#members-list')?.addEventListener('click', async e => {
    const banBtn = e.target.closest('.ban-member');
    const modBtn = e.target.closest('.make-mod');
    if (banBtn && isOwner) {
      const uid = banBtn.dataset.uid;
      if (!confirm('Üyeyi gruptan at?')) return;
      try { await api(`/group/${slug}/ban/${uid}`, { method: 'POST' }); toast('Üye atıldı'); renderRoute(location.pathname); } catch (e) { toast(e.message, 'error'); }
    }
    if (modBtn && isOwner) {
      const uid = modBtn.dataset.uid;
      try { await api(`/group/${slug}/moderator/${uid}`, { method: 'POST' }); toast('Moderatör yapıldı'); renderRoute(location.pathname); } catch (e) { toast(e.message, 'error'); }
    }
  });
}

function chatMsgHTML(m) {
  const canDel = currentUser && (currentUser.id === m.user_id);
  return `<div class="chat-msg">
    ${m.avatar ? `<img src="${escHtml(m.avatar)}" class="chat-msg-avatar" alt="" />` : `<div class="chat-msg-avatar avatar-placeholder"><i class="fas fa-user" style="font-size:12px"></i></div>`}
    <div class="chat-msg-body">
      <div class="chat-msg-meta">
        <span class="chat-msg-name">${escHtml(m.username || 'Silindi')}</span>
        <span class="chat-msg-time">${timeAgo(m.created_at)}</span>
        ${canDel ? `<button class="btn btn-ghost del-msg" data-id="${m.id}" style="padding:0 4px;font-size:11px;color:var(--text-muted)"><i class="fas fa-trash"></i></button>` : ''}
      </div>
      ${m.content ? `<div class="chat-msg-text">${escHtml(m.content)}</div>` : ''}
      ${m.image_url ? `<img src="${escHtml(m.image_url)}" class="chat-msg-img" alt="" onclick="window.open(this.src)" />` : ''}
    </div>
  </div>`;
}

function memberItemHTML(m, isOwner, groupSlug) {
  const roleLabel = m.role === 'owner' ? '<span class="badge badge-red">Sahip</span>' : m.role === 'moderator' ? '<span class="badge badge-orange">Mod</span>' : '';
  const canAct = isOwner && m.role !== 'owner' && currentUser && currentUser.id !== m.user_id;
  return `<div class="member-item">
    ${m.avatar ? `<img src="${escHtml(m.avatar)}" class="member-avatar" alt="" />` : `<div class="member-avatar avatar-placeholder"><i class="fas fa-user" style="font-size:14px"></i></div>`}
    <div style="flex:1">
      <div style="font-size:13px;font-weight:600">${escHtml(m.username)}</div>
      ${roleLabel}
    </div>
    ${canAct ? `<div style="display:flex;gap:4px">
      ${m.role !== 'moderator' ? `<button class="btn btn-ghost btn-sm make-mod" data-uid="${m.user_id}" title="Mod yap" style="font-size:11px"><i class="fas fa-shield-alt"></i></button>` : ''}
      <button class="btn btn-ghost btn-sm ban-member" data-uid="${m.user_id}" title="At" style="font-size:11px;color:var(--accent-red2)"><i class="fas fa-times"></i></button>
    </div>` : ''}
  </div>`;
}

async function renderProfile(app, username) {
  app.innerHTML = `<div class="container page"><div class="loading-center"><div class="spinner"></div></div></div>`;
  let data;
  try { data = await api('/profile/' + username); } catch { app.innerHTML = '<div class="container page"><div class="empty-state"><i class="fas fa-user-slash"></i><p>Kullanıcı bulunamadı.</p></div></div>'; return; }

  const { user, forums, books, groups, level, levels } = data;
  document.title = user.username + ' - Demlik';

  const nextLevel = levels.find(l => l.order_num > (level?.order_num || 0));
  let progressHTML = '';
  if (nextLevel) {
    const forumPct = nextLevel.min_forums > 0 ? Math.min(100, Math.round((user.forum_count / nextLevel.min_forums) * 100)) : 100;
    const bookPct = nextLevel.min_books > 0 ? Math.min(100, Math.round((user.book_count / nextLevel.min_books) * 100)) : 100;
    const commentPct = nextLevel.min_comments > 0 ? Math.min(100, Math.round((user.comment_count / nextLevel.min_comments) * 100)) : 100;
    const overall = Math.round((forumPct + bookPct + commentPct) / 3);
    progressHTML = `<div style="margin-top:12px"><div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Sonraki seviye: ${escHtml(nextLevel.name)} (${overall}%)</div><div class="progress-bar"><div class="progress-fill" style="width:${overall}%"></div></div></div>`;
  }

  const levelColor = level?.color || '#6b7280';
  const levelBadge = level && user.show_level_badge ? `<span class="level-badge" style="color:${levelColor};border-color:${levelColor};background:${levelColor}20"><i class="${escHtml(level.icon)}"></i> ${escHtml(level.name)}</span>` : '';

  const links = (() => { try { return JSON.parse(user.links || '[]'); } catch { return []; } })();
  const isOwn = currentUser && currentUser.id === user.id;

  app.innerHTML = `<div class="container page">
    <div class="profile-header">
      <div class="profile-avatar-wrap">
        ${user.avatar ? `<img src="${escHtml(user.avatar)}" class="profile-avatar" alt="" />` : `<div class="profile-avatar-placeholder"><i class="fas fa-user"></i></div>`}
      </div>
      <div class="profile-info">
        <div class="profile-username" style="${user.show_level_color && user.name_color ? 'color:' + escHtml(user.name_color) : ''}">${escHtml(user.username)} ${user.is_vip ? '<i class="fas fa-gem" style="color:#fbbf24;font-size:18px" title="VIP"></i>' : ''} ${user.is_plus ? '<i class="fas fa-plus-circle" style="color:#818cf8;font-size:18px" title="Plus"></i>' : ''}${level ? ` <i class="${escHtml(level.icon)}" style="color:${escHtml(level.color)};font-size:16px" title="${escHtml(level.name)}"></i> <span style="font-size:13px;font-weight:500;color:${escHtml(level.color)}">${escHtml(level.name)}</span>` : ''}</div>
        ${levelBadge}
        ${progressHTML}
        ${user.bio ? `<div class="profile-bio" style="margin-top:10px">${escHtml(user.bio)}</div>` : ''}
        ${links.length ? `<div class="profile-links">${links.map(l => `<a href="${escHtml(l.url)}" target="_blank" class="profile-link"><i class="fas fa-link"></i> ${escHtml(l.label || l.url)}</a>`).join('')}</div>` : ''}
        <div class="profile-stats" style="margin-top:12px">
          <div class="profile-stat"><div class="profile-stat-num">${user.forum_count}</div><div class="profile-stat-label">Forum</div></div>
          <div class="profile-stat"><div class="profile-stat-num">${user.book_count}</div><div class="profile-stat-label">Kitap</div></div>
          <div class="profile-stat"><div class="profile-stat-num">${user.comment_count}</div><div class="profile-stat-label">Yorum</div></div>
        </div>
        ${isOwn ? `<a href="/ayarlar" data-link class="btn btn-outline btn-sm" style="margin-top:16px"><i class="fas fa-cog"></i> Profili Düzenle</a>` : ''}
      </div>
    </div>

    <div class="tabs">
      <button class="tab active" data-tab="forums">Forumlar</button>
      <button class="tab" data-tab="books">Kitaplar</button>
      <button class="tab" data-tab="groups">Gruplar</button>
    </div>

    <div id="tab-forums">
      ${forums.length ? `<div style="display:flex;flex-direction:column;gap:12px">${forums.map(f => forumCardHTML(f)).join('')}</div>` : '<div class="empty-state"><i class="fas fa-comments"></i><p>Forum yok.</p></div>'}
    </div>
    <div id="tab-books" class="hidden">
      ${books.length ? `<div class="grid-3">${books.map(b => bookCardHTML(b)).join('')}</div>` : '<div class="empty-state"><i class="fas fa-book"></i><p>Kitap yok.</p></div>'}
    </div>
    <div id="tab-groups" class="hidden">
      ${groups.length ? `<div class="grid-3">${groups.map(g => groupCardHTML(g)).join('')}</div>` : '<div class="empty-state"><i class="fas fa-users"></i><p>Grup yok.</p></div>'}
    </div>
  </div>`;

  $$('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      ['forums', 'books', 'groups'].forEach(name => $('#tab-' + name).classList.toggle('hidden', name !== btn.dataset.tab));
    });
  });
}

async function renderSettings(app) {
  if (!currentUser) { navigate('/giris'); return; }
  document.title = 'Ayarlar - Demlik';

  app.innerHTML = `<div class="container page">
    <div class="page-header"><div class="page-title">Ayarlar</div></div>
    <div class="settings-layout">
      <div class="settings-nav">
        <div class="settings-nav-item active" data-section="profile"><i class="fas fa-user"></i> Profil</div>
        <div class="settings-nav-item" data-section="password"><i class="fas fa-lock"></i> Şifre</div>
        <div class="settings-nav-item" data-section="appearance"><i class="fas fa-palette"></i> Görünüm</div>
      </div>
      <div id="settings-content"></div>
    </div>
  </div>`;

  renderSettingsSection('profile');

  $$('.settings-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      $$('.settings-nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      renderSettingsSection(item.dataset.section);
    });
  });
}

function renderSettingsSection(section) {
  const el = $('#settings-content'); if (!el) return;
  if (section === 'profile') {
    const links = (() => { try { return JSON.parse(currentUser.links || '[]'); } catch { return []; } })();
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span>Profil Bilgileri</span></div>
        <div class="card-body">
          <div class="form-group" style="display:flex;align-items:center;gap:16px">
            ${currentUser.avatar ? `<img src="${escHtml(currentUser.avatar)}" style="width:64px;height:64px;border-radius:50%;object-fit:cover" />` : `<div style="width:64px;height:64px;border-radius:50%;background:var(--bg-card2);display:flex;align-items:center;justify-content:center"><i class="fas fa-user" style="font-size:24px;color:var(--text-muted)"></i></div>`}
            <div style="flex:1">
              <label>Avatar Yükle</label>
              <input type="file" id="avatar-file" accept="image/*" style="padding:6px" />
            </div>
          </div>
          <div class="form-group"><label>Biyografi</label><textarea id="s-bio" rows="3">${escHtml(currentUser.bio || '')}</textarea></div>
          <div class="form-group">
            <label>Linkler</label>
            <div id="links-container" style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px"></div>
            <button type="button" class="btn btn-outline btn-sm" id="add-link-btn"><i class="fas fa-plus"></i> Link Ekle</button>
          </div>
          <button class="btn btn-primary" id="save-profile-btn">Kaydet</button>
          <div id="profile-msg" class="form-error mt-4"></div>
        </div>
      </div>`;

    function renderLinkRows(linksArr) {
      const container = $('#links-container');
      container.innerHTML = linksArr.map((l, i) => `
        <div class="link-row" data-idx="${i}" style="display:flex;gap:8px;align-items:center">
          <input type="text" placeholder="Başlık (örn: GitHub)" value="${escHtml(l.label || '')}" data-field="label" style="flex:1" />
          <input type="text" placeholder="URL (https://...)" value="${escHtml(l.url || '')}" data-field="url" style="flex:2" />
          <button type="button" class="btn btn-ghost btn-sm remove-link-btn" data-idx="${i}" style="color:var(--accent-red2);flex-shrink:0"><i class="fas fa-times"></i></button>
        </div>`).join('');
    }

    let currentLinks = [...links];
    renderLinkRows(currentLinks);

    $('#add-link-btn').addEventListener('click', () => {
      currentLinks.push({ label: '', url: '' });
      renderLinkRows(currentLinks);
    });

    $('#links-container').addEventListener('click', e => {
      const rem = e.target.closest('.remove-link-btn');
      if (rem) {
        currentLinks.splice(parseInt(rem.dataset.idx), 1);
        renderLinkRows(currentLinks);
      }
    });

    $('#links-container').addEventListener('input', e => {
      const row = e.target.closest('.link-row');
      if (!row) return;
      const idx = parseInt(row.dataset.idx);
      const field = e.target.dataset.field;
      if (field && currentLinks[idx] !== undefined) currentLinks[idx][field] = e.target.value;
    });

    $('#save-profile-btn').addEventListener('click', async () => {
      const fd = new FormData();
      fd.append('bio', $('#s-bio').value);
      const validLinks = currentLinks.filter(l => l.url && l.url.trim());
      fd.append('links', JSON.stringify(validLinks));
      const avatarFile = $('#avatar-file').files[0];
      if (avatarFile) fd.append('avatar', avatarFile);
      try {
        const updated = await apiForm('/profile', fd, 'PUT');
        currentUser = updated;
        updateNavUI();
        toast('Profil güncellendi');
        $('#profile-msg').style.color = 'var(--accent-red2)';
        $('#profile-msg').textContent = '';
      } catch (e) { $('#profile-msg').textContent = e.message; }
    });

  } else if (section === 'password') {
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span>Şifre Değiştir</span></div>
        <div class="card-body">
          <div class="form-group"><label>Eski Şifre</label><input type="password" id="old-pw" /></div>
          <div class="form-group"><label>Yeni Şifre</label><input type="password" id="new-pw" /></div>
          <div class="form-group"><label>Yeni Şifre (Tekrar)</label><input type="password" id="new-pw2" /></div>
          <button class="btn btn-primary" id="save-pw-btn">Değiştir</button>
          <div id="pw-msg" class="form-error mt-4"></div>
        </div>
      </div>`;
    $('#save-pw-btn').addEventListener('click', async () => {
      const old_password = $('#old-pw').value;
      const new_password = $('#new-pw').value;
      if (new_password !== $('#new-pw2').value) { $('#pw-msg').textContent = 'Şifreler uyuşmuyor'; return; }
      try {
        await api('/profile/password', { method: 'PUT', body: JSON.stringify({ old_password, new_password }) });
        toast('Şifre değiştirildi'); $('#old-pw').value = ''; $('#new-pw').value = ''; $('#new-pw2').value = '';
      } catch (e) { $('#pw-msg').textContent = e.message; }
    });

  } else if (section === 'appearance') {
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span>Görünüm</span></div>
        <div class="card-body">
          <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="s-show-badge" ${currentUser.show_level_badge ? 'checked' : ''} /> Seviye rozetini göster</label></div>
          <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="s-show-color" ${currentUser.show_level_color ? 'checked' : ''} /> İsim rengini göster</label></div>
          ${(currentUser.is_vip || currentUser.is_plus) ? `<div class="form-group"><label>İsim Rengi (VIP/Plus)</label><input type="color" id="s-name-color" value="${currentUser.name_color || '#f5f5f5'}" style="width:60px;height:36px;padding:2px;cursor:pointer" /></div>` : ''}
          <button class="btn btn-primary" id="save-appearance-btn">Kaydet</button>
          <div id="appear-msg" class="form-error mt-4"></div>
        </div>
      </div>`;
    $('#save-appearance-btn').addEventListener('click', async () => {
      const body = {
        show_level_badge: $('#s-show-badge').checked,
        show_level_color: $('#s-show-color').checked,
      };
      if (currentUser.is_vip || currentUser.is_plus) body.name_color = $('#s-name-color')?.value || '';
      try {
        const fd = new FormData();
        Object.entries(body).forEach(([k, v]) => fd.append(k, v));
        const updated = await apiForm('/profile', fd, 'PUT');
        currentUser = updated; updateNavUI();
        toast('Görünüm güncellendi');
      } catch (e) { $('#appear-msg').textContent = e.message; }
    });
  }
}

function renderLogin(app) {
  if (currentUser) { navigate('/'); return; }
  document.title = 'Giriş Yap - Demlik';
  app.innerHTML = `<div class="auth-page">
    <div class="auth-card card card-body">
      <div class="auth-title">Giriş Yap</div>
      <p class="auth-subtitle">Hesabınıza erişin</p>
      <div class="form-group"><label>E-posta veya Kullanıcı Adı</label><input type="text" id="login-id" placeholder="..." /></div>
      <div class="form-group"><label>Şifre</label><input type="password" id="login-pw" placeholder="••••••" /></div>
      <button class="btn btn-primary" style="width:100%;margin-top:4px" id="login-btn">Giriş Yap</button>
      <div id="login-error" class="form-error mt-4" style="text-align:center"></div>
      <div class="auth-footer">Hesabın yok mu? <a href="/kayit" data-link class="auth-link">Kayıt Ol</a></div>
    </div>
  </div>`;

  const doLogin = async () => {
    const login = $('#login-id').value.trim();
    const password = $('#login-pw').value;
    if (!login || !password) { $('#login-error').textContent = 'Tüm alanları doldurun'; return; }
    try {
      const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) });
      currentToken = data.token; currentUser = data.user;
      localStorage.setItem('token', currentToken);
      updateNavUI(); toast('Hoş geldiniz, ' + currentUser.username + '!');
      navigate('/');
    } catch (e) { $('#login-error').textContent = e.message; }
  };

  $('#login-btn').addEventListener('click', doLogin);
  $('#login-pw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}

function renderRegister(app) {
  if (currentUser) { navigate('/'); return; }
  document.title = 'Kayıt Ol - Demlik';
  app.innerHTML = `<div class="auth-page">
    <div class="auth-card card card-body">
      <div class="auth-title">Kayıt Ol</div>
      <p class="auth-subtitle">Topluluğa katıl</p>
      <div class="form-group"><label>Kullanıcı Adı</label><input type="text" id="reg-username" placeholder="..." /></div>
      <div class="form-group"><label>E-posta</label><input type="email" id="reg-email" placeholder="..." /></div>
      <div class="form-group"><label>Şifre</label><input type="password" id="reg-pw" placeholder="••••••" /></div>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="reg-kvkk" />
          <span>KVKK aydınlatma metnini okudum ve kabul ediyorum. <button type="button" class="btn btn-ghost btn-sm" id="kvkk-btn" style="padding:0;color:var(--accent-red2);font-size:13px">Metni oku</button></span>
        </label>
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:4px" id="reg-btn">Kayıt Ol</button>
      <div id="reg-error" class="form-error mt-4" style="text-align:center"></div>
      <div class="auth-footer">Zaten hesabın var mı? <a href="/giris" data-link class="auth-link">Giriş Yap</a></div>
    </div>
  </div>`;

  $('#kvkk-btn').addEventListener('click', async () => {
    try {
      const r = await api('/kvkk');
      showModal('KVKK Aydınlatma Metni', `<div style="white-space:pre-wrap;font-size:13px;line-height:1.7;color:var(--text-secondary);max-height:400px;overflow-y:auto">${escHtml(r.text)}</div>`);
    } catch {}
  });

  const doRegister = async () => {
    const username = $('#reg-username').value.trim();
    const email = $('#reg-email').value.trim();
    const password = $('#reg-pw').value;
    const kvkk_accepted = $('#reg-kvkk').checked;
    if (!username || !email || !password) { $('#reg-error').textContent = 'Tüm alanları doldurun'; return; }
    if (!kvkk_accepted) { $('#reg-error').textContent = 'KVKK onayı zorunludur'; return; }
    try {
      const data = await api('/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password, kvkk_accepted }) });
      currentToken = data.token; currentUser = data.user;
      localStorage.setItem('token', currentToken);
      updateNavUI(); toast('Hoş geldiniz, ' + currentUser.username + '!');
      navigate('/');
    } catch (e) { $('#reg-error').textContent = e.message; }
  };

  $('#reg-btn').addEventListener('click', doRegister);
  $('#reg-pw').addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });
}

function renderNotFound(app) {
  document.title = 'Sayfa Bulunamadı - Demlik';
  app.innerHTML = `<div class="container page" style="text-align:center;padding:80px 20px">
    <div style="font-size:72px;font-weight:900;color:var(--accent-red);opacity:0.3">404</div>
    <div style="font-size:24px;font-weight:700;margin-bottom:12px">Sayfa Bulunamadı</div>
    <p style="color:var(--text-secondary);margin-bottom:24px">Aradığınız sayfa mevcut değil.</p>
    <a href="/" data-link class="btn btn-primary">Ana Sayfaya Dön</a>
  </div>`;
}

async function init() {
  await initAuth();
  renderRoute(location.pathname);
}

init();
