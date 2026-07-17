/* Shelf & Sleeve — book & vinyl collection tracker
   Data model: { updatedAt: ISOstring, items: [ {id,type,title,creator,year,genre,format,condition,price,status,notes,image,addedAt} ] }
   Storage: localStorage is always the fast local copy. If GitHub sync is configured,
   the same data.json is read/written in the user's repo so multiple devices stay in sync. */

const STORAGE_KEY = 'shelfsleeve_data_v1';
const SETTINGS_KEY = 'shelfsleeve_settings_v1';

let state = { updatedAt: null, items: [] };
let editingImageData = null; // holds a newly chosen (resized) image for the open form, or undefined/null
let currentDetailId = null;

/* ---------------- persistence: local ---------------- */

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { updatedAt: null, items: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return { updatedAt: null, items: [] };
    return parsed;
  } catch (e) {
    console.error('Failed to load local data', e);
    return { updatedAt: null, items: [] };
  }
}

function saveLocal(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function clearSettings() {
  localStorage.removeItem(SETTINGS_KEY);
}

function isConfigured(s) {
  return !!(s && s.owner && s.repo && s.token);
}

/* ---------------- base64 helpers (UTF-8 safe) ---------------- */

function utf8ToB64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function b64ToUtf8(b64) {
  return decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));
}

/* ---------------- GitHub Contents API ---------------- */

function ghHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json'
  };
}

async function ghGetFile(settings, path) {
  const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(settings.branch || 'main')}&_=${Date.now()}`;
  const res = await fetch(url, { headers: ghHeaders(settings.token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path} failed: ${res.status}`);
  const json = await res.json();
  return { text: b64ToUtf8(json.content), sha: json.sha };
}

async function ghPutFile(settings, path, contentStr, message, sha) {
  const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodeURIComponent(path)}`;
  const body = {
    message,
    content: utf8ToB64(contentStr),
    branch: settings.branch || 'main'
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(settings.token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`GitHub PUT ${path} failed: ${res.status} ${errText}`);
  }
  return res.json();
}

async function ghTestConnection(settings) {
  const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}`;
  const res = await fetch(url, { headers: ghHeaders(settings.token) });
  if (!res.ok) throw new Error(`Could not reach repo (${res.status})`);
  return res.json();
}

/* ---------------- sync status UI ---------------- */

function setSyncStatus(kind, text) {
  const dot = document.getElementById('syncDot');
  const label = document.getElementById('syncText');
  dot.className = 'dot' + (kind ? ' ' + kind : '');
  label.textContent = text;
  updateBanner();
}

function updateBanner() {
  const banner = document.getElementById('ghBanner');
  if (!banner) return;
  banner.hidden = isConfigured(getSettings());
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------------- sync orchestration ---------------- */

async function syncOnLoad() {
  const settings = getSettings();
  if (!isConfigured(settings)) {
    setSyncStatus('', 'Local only');
    return;
  }
  setSyncStatus('syncing', 'Syncing…');
  try {
    const remote = await ghGetFile(settings, 'data.json');
    if (!remote) {
      await pushToGitHub('Initialize collection data');
      setSyncStatus('ok', 'Synced');
      return;
    }
    const remoteData = JSON.parse(remote.text);
    const remoteTime = remoteData.updatedAt ? new Date(remoteData.updatedAt).getTime() : 0;
    const localTime = state.updatedAt ? new Date(state.updatedAt).getTime() : 0;
    if (remoteTime > localTime) {
      state = remoteData;
      saveLocal(state);
      renderAll();
      setSyncStatus('ok', 'Synced from GitHub');
    } else if (localTime > remoteTime) {
      await pushToGitHub('Update collection data', remote.sha);
      setSyncStatus('ok', 'Synced to GitHub');
    } else {
      setSyncStatus('ok', 'Synced');
    }
  } catch (e) {
    console.error(e);
    setSyncStatus('err', 'Sync failed — using local data');
  }
}

async function pushToGitHub(message, knownSha) {
  const settings = getSettings();
  if (!isConfigured(settings)) return;
  setSyncStatus('syncing', 'Syncing…');
  try {
    let sha = knownSha;
    if (!sha) {
      const existing = await ghGetFile(settings, 'data.json');
      sha = existing ? existing.sha : undefined;
    }
    await ghPutFile(settings, 'data.json', JSON.stringify(state, null, 2), message || 'Update collection data', sha);
    setSyncStatus('ok', 'Synced');
  } catch (e) {
    console.error(e);
    setSyncStatus('err', 'Sync failed');
  }
}

function mutateAndSync(message) {
  state.updatedAt = new Date().toISOString();
  saveLocal(state);
  renderAll();
  pushToGitHub(message);
}

/* ---------------- image handling ---------------- */

function resizeImageFile(file, maxDim = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------------- rendering ---------------- */

function fmtMoney(n) {
  if (n === undefined || n === null || isNaN(n)) return '';
  return '$' + Number(n).toFixed(2);
}

function matchesSearch(item, q) {
  if (!q) return true;
  q = q.toLowerCase();
  return (item.title || '').toLowerCase().includes(q) || (item.creator || '').toLowerCase().includes(q);
}

function cardHtml(item) {
  const cover = item.image
    ? `<img src="${item.image}" alt="">`
    : `<span class="placeholder">${item.type === 'vinyl' ? '💿' : '📖'}</span>`;
  return `
    <div class="card" data-id="${item.id}">
      <div class="card-cover">
        <span class="type-badge ${item.type}">${item.type}</span>
        ${cover}
      </div>
      <div class="card-body">
        <p class="card-title">${escapeHtml(item.title || 'Untitled')}</p>
        <p class="card-creator">${escapeHtml(item.creator || '')}</p>
      </div>
    </div>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function renderCollection() {
  const q = document.getElementById('searchInput').value;
  const typeFilter = document.getElementById('filterType').value;
  const genreFilter = document.getElementById('filterGenre').value;

  const items = state.items.filter(i => i.status === 'owned')
    .filter(i => matchesSearch(i, q))
    .filter(i => !typeFilter || i.type === typeFilter)
    .filter(i => !genreFilter || (i.genre || '').trim() === genreFilter)
    .sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));

  const grid = document.getElementById('collectionGrid');
  grid.innerHTML = items.map(cardHtml).join('');
  document.getElementById('collectionEmpty').hidden = items.length !== 0;
}

function renderWishlist() {
  const q = document.getElementById('wishlistSearchInput').value;
  const items = state.items.filter(i => i.status === 'wishlist')
    .filter(i => matchesSearch(i, q))
    .sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));

  const grid = document.getElementById('wishlistGrid');
  grid.innerHTML = items.map(cardHtml).join('');
  document.getElementById('wishlistEmpty').hidden = items.length !== 0;
}

function populateGenreFilter() {
  const sel = document.getElementById('filterGenre');
  const current = sel.value;
  const genres = Array.from(new Set(
    state.items.filter(i => i.status === 'owned' && i.genre && i.genre.trim())
      .map(i => i.genre.trim())
  )).sort((a, b) => a.localeCompare(b));
  sel.innerHTML = '<option value="">All genres</option>' + genres.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  if (genres.includes(current)) sel.value = current;
}

function barList(counts) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = entries.length ? entries[0][1] : 1;
  if (!entries.length) return '<p class="muted">No data yet.</p>';
  return entries.map(([label, count]) => `
    <div class="bar-row">
      <span class="bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.round((count / max) * 100)}%"></span></span>
      <span class="bar-count">${count}</span>
    </div>`).join('');
}

function renderStats() {
  const owned = state.items.filter(i => i.status === 'owned');
  const books = owned.filter(i => i.type === 'book');
  const vinyls = owned.filter(i => i.type === 'vinyl');
  const wishlist = state.items.filter(i => i.status === 'wishlist');
  const totalSpent = owned.reduce((sum, i) => sum + (Number(i.price) || 0), 0);

  const cards = [
    { num: owned.length, label: 'Total owned' },
    { num: books.length, label: 'Books' },
    { num: vinyls.length, label: 'Vinyls' },
    { num: wishlist.length, label: 'Wishlist items' },
    { num: fmtMoney(totalSpent) || '$0.00', label: 'Total spent (entered prices)' }
  ];
  document.getElementById('statsCards').innerHTML = cards.map(c => `
    <div class="stat-card"><div class="num">${c.num}</div><div class="label">${c.label}</div></div>
  `).join('');

  const formatCounts = {};
  owned.forEach(i => {
    const f = (i.format || 'Unspecified').trim() || 'Unspecified';
    formatCounts[f] = (formatCounts[f] || 0) + 1;
  });
  document.getElementById('statsFormat').innerHTML = barList(formatCounts);

  const genreCounts = {};
  owned.forEach(i => {
    const g = (i.genre || 'Unspecified').trim() || 'Unspecified';
    genreCounts[g] = (genreCounts[g] || 0) + 1;
  });
  document.getElementById('statsGenre').innerHTML = barList(genreCounts);

  const badges = [];
  badges.push(`<span class="badge-pill">${owned.length} owned</span>`);
  if (wishlist.length) badges.push(`<span class="badge-pill">${wishlist.length} on wishlist</span>`);
  const topGenre = Object.entries(genreCounts).filter(([g]) => g !== 'Unspecified').sort((a, b) => b[1] - a[1])[0];
  if (topGenre) badges.push(`<span class="badge-pill">${escapeHtml(topGenre[0])} is your top genre</span>`);
  document.getElementById('statsBadges').innerHTML = badges.join('');
}

function renderAll() {
  populateGenreFilter();
  renderCollection();
  renderWishlist();
  renderStats();
}

/* ---------------- modal: add/edit item ---------------- */

function updateFormLabels() {
  const type = document.getElementById('f_type').value;
  document.querySelector('#f_creatorLabel').firstChild.textContent = type === 'vinyl' ? 'Artist' : 'Author';
  document.getElementById('f_format').placeholder = type === 'vinyl' ? 'e.g. LP, 7", Cassette' : 'e.g. Hardcover, Paperback';
}

function openItemModal(item, defaultStatus) {
  editingImageData = undefined; // undefined = no change; null = cleared; string = new image
  document.getElementById('itemForm').reset();
  document.getElementById('f_imagePreview').hidden = true;
  document.getElementById('deleteItemBtn').hidden = !item;

  if (item) {
    document.getElementById('modalTitle').textContent = 'Edit item';
    document.getElementById('itemId').value = item.id;
    document.getElementById('f_type').value = item.type;
    document.getElementById('f_title').value = item.title || '';
    document.getElementById('f_creator').value = item.creator || '';
    document.getElementById('f_year').value = item.year || '';
    document.getElementById('f_format').value = item.format || '';
    document.getElementById('f_genre').value = item.genre || '';
    document.getElementById('f_condition').value = item.condition || '';
    document.getElementById('f_price').value = item.price ?? '';
    document.getElementById('f_status').value = item.status || 'owned';
    document.getElementById('f_notes').value = item.notes || '';
    if (item.image) {
      document.getElementById('f_imagePreview').src = item.image;
      document.getElementById('f_imagePreview').hidden = false;
    }
  } else {
    document.getElementById('modalTitle').textContent = 'Add item';
    document.getElementById('itemId').value = '';
    document.getElementById('f_status').value = defaultStatus || 'owned';
  }
  updateFormLabels();
  document.getElementById('modalBackdrop').hidden = false;
}

function closeItemModal() {
  document.getElementById('modalBackdrop').hidden = true;
}

function findItem(id) {
  return state.items.find(i => i.id === id);
}

/* ---------------- detail modal ---------------- */

function openDetailModal(id) {
  const item = findItem(id);
  if (!item) return;
  currentDetailId = id;
  const rows = [
    ['Type', item.type === 'vinyl' ? 'Vinyl' : 'Book'],
    [item.type === 'vinyl' ? 'Artist' : 'Author', item.creator],
    ['Year', item.year],
    ['Format', item.format],
    ['Genre', item.genre],
    ['Condition', item.condition],
    ['Price paid', item.price !== undefined && item.price !== '' ? fmtMoney(item.price) : ''],
    ['Status', item.status === 'wishlist' ? 'Wishlist' : 'Owned'],
    ['Notes', item.notes]
  ].filter(([, v]) => v);

  const cover = item.image
    ? `<img class="detail-cover" src="${item.image}" alt="">`
    : '';

  document.getElementById('detailContent').innerHTML = `
    ${cover}
    <h3>${escapeHtml(item.title || 'Untitled')}</h3>
    ${rows.map(([k, v]) => `<div class="detail-row"><span>${k}</span><span>${escapeHtml(v)}</span></div>`).join('')}
    <div class="detail-actions">
      <button class="btn primary" id="detailEditBtn">Edit</button>
      <button class="btn danger" id="detailDeleteBtn">Delete</button>
    </div>
  `;
  document.getElementById('detailEditBtn').addEventListener('click', () => {
    closeDetailModal();
    openItemModal(item);
  });
  document.getElementById('detailDeleteBtn').addEventListener('click', () => {
    if (confirm(`Delete "${item.title}"? This cannot be undone.`)) {
      state.items = state.items.filter(i => i.id !== item.id);
      mutateAndSync(`Delete "${item.title}"`);
      closeDetailModal();
    }
  });
  document.getElementById('detailBackdrop').hidden = false;
}

function closeDetailModal() {
  document.getElementById('detailBackdrop').hidden = true;
  currentDetailId = null;
}

/* ---------------- export / import ---------------- */

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shelf-and-sleeve-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.items)) throw new Error('Invalid file format');
      state = { updatedAt: new Date().toISOString(), items: parsed.items };
      saveLocal(state);
      renderAll();
      pushToGitHub('Import collection data');
      toast('Import complete');
    } catch (e) {
      alert('Could not import this file: ' + e.message);
    }
  };
  reader.readAsText(file);
}

/* ---------------- wiring ---------------- */

let activeTabName = 'collection';

function wireTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
      activeTabName = btn.dataset.tab;
      if (btn.dataset.tab === 'stats') renderStats();
    });
  });
}

function wireFab() {
  document.getElementById('fabAdd').addEventListener('click', () => {
    openItemModal(null, activeTabName === 'wishlist' ? 'wishlist' : 'owned');
  });
  document.getElementById('fabSettings').addEventListener('click', () => {
    document.querySelector('.tab-btn[data-tab="settings"]').click();
  });
  document.getElementById('bannerSetupBtn').addEventListener('click', () => {
    document.querySelector('.tab-btn[data-tab="settings"]').click();
  });
}

function wireCollection() {
  document.getElementById('searchInput').addEventListener('input', renderCollection);
  document.getElementById('filterType').addEventListener('change', renderCollection);
  document.getElementById('filterGenre').addEventListener('change', renderCollection);
  document.getElementById('collectionGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) openDetailModal(card.dataset.id);
  });
}

function wireWishlist() {
  document.getElementById('wishlistSearchInput').addEventListener('input', renderWishlist);
  document.getElementById('wishlistGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) openDetailModal(card.dataset.id);
  });
}

function wireModal() {
  document.getElementById('f_type').addEventListener('change', updateFormLabels);
  document.getElementById('cancelModalBtn').addEventListener('click', closeItemModal);
  document.getElementById('modalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modalBackdrop') closeItemModal();
  });

  document.getElementById('f_image').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = await resizeImageFile(file);
    editingImageData = dataUrl;
    const preview = document.getElementById('f_imagePreview');
    preview.src = dataUrl;
    preview.hidden = false;
  });

  document.getElementById('deleteItemBtn').addEventListener('click', () => {
    const id = document.getElementById('itemId').value;
    const item = findItem(id);
    if (item && confirm(`Delete "${item.title}"? This cannot be undone.`)) {
      state.items = state.items.filter(i => i.id !== id);
      mutateAndSync(`Delete "${item.title}"`);
      closeItemModal();
    }
  });

  document.getElementById('itemForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('itemId').value;
    const title = document.getElementById('f_title').value.trim();
    if (!title) return;

    const fields = {
      type: document.getElementById('f_type').value,
      title,
      creator: document.getElementById('f_creator').value.trim(),
      year: document.getElementById('f_year').value.trim(),
      format: document.getElementById('f_format').value.trim(),
      genre: document.getElementById('f_genre').value.trim(),
      condition: document.getElementById('f_condition').value,
      price: document.getElementById('f_price').value === '' ? undefined : Number(document.getElementById('f_price').value),
      status: document.getElementById('f_status').value,
      notes: document.getElementById('f_notes').value.trim()
    };

    if (id) {
      const item = findItem(id);
      Object.assign(item, fields);
      if (editingImageData !== undefined) item.image = editingImageData;
      mutateAndSync(`Update "${title}"`);
    } else {
      const newItem = {
        id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)),
        addedAt: new Date().toISOString(),
        image: editingImageData || null,
        ...fields
      };
      state.items.unshift(newItem);
      mutateAndSync(`Add "${title}"`);
    }
    closeItemModal();
  });
}

function wireDetail() {
  document.getElementById('closeDetailBtn').addEventListener('click', closeDetailModal);
  document.getElementById('detailBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'detailBackdrop') closeDetailModal();
  });
}

function wireSettings() {
  const s = getSettings();
  if (s) {
    document.getElementById('ghOwner').value = s.owner || '';
    document.getElementById('ghRepo').value = s.repo || '';
    document.getElementById('ghBranch').value = s.branch || 'main';
    document.getElementById('ghToken').value = s.token || '';
  }

  function readFields() {
    return {
      owner: document.getElementById('ghOwner').value.trim(),
      repo: document.getElementById('ghRepo').value.trim(),
      branch: document.getElementById('ghBranch').value.trim() || 'main',
      token: document.getElementById('ghToken').value.trim()
    };
  }

  document.getElementById('testConnBtn').addEventListener('click', async () => {
    const hint = document.getElementById('connHint');
    hint.textContent = 'Testing…';
    try {
      const info = await ghTestConnection(readFields());
      hint.textContent = `✓ Connected to ${info.full_name}${info.private ? ' (private)' : ' (public)'}`;
    } catch (e) {
      hint.textContent = '✗ ' + e.message;
    }
  });

  document.getElementById('saveConnBtn').addEventListener('click', async () => {
    const fields = readFields();
    if (!fields.owner || !fields.repo || !fields.token) {
      document.getElementById('connHint').textContent = 'Please fill in username, repo, and token.';
      return;
    }
    saveSettings(fields);
    document.getElementById('connHint').textContent = 'Saved. Syncing…';
    await syncOnLoad();
    document.getElementById('connHint').textContent = 'Connected.';
  });

  document.getElementById('disconnectBtn').addEventListener('click', () => {
    clearSettings();
    document.getElementById('ghOwner').value = '';
    document.getElementById('ghRepo').value = '';
    document.getElementById('ghBranch').value = 'main';
    document.getElementById('ghToken').value = '';
    document.getElementById('connHint').textContent = 'Disconnected. Data stays local on this device.';
    setSyncStatus('', 'Local only');
  });

  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importData(file);
    e.target.value = '';
  });
}

/* ---------------- init ---------------- */

function init() {
  state = loadLocal();
  wireTabs();
  wireFab();
  wireCollection();
  wireWishlist();
  wireModal();
  wireDetail();
  wireSettings();
  renderAll();
  updateBanner();
  syncOnLoad();

  // A previous version of this app registered a service worker for offline caching.
  // That cache could get "stuck" serving old files after an update, which is worse than
  // just not having offline support. Actively unregister it so everyone gets fresh files.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(reg => reg.unregister());
    }).catch(() => {});
    if (window.caches) {
      caches.keys().then(names => names.forEach(n => caches.delete(n))).catch(() => {});
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
