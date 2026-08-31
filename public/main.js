let isAdmin = false;
let csrfToken = null;

async function fetchCsrf() {
    try {
        const res = await fetch('/api/csrf-token', { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            csrfToken = data.csrfToken;
        }
    } catch (e) {
        // ignore
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await fetchCsrf();

    checkAdminStatus();

    const adminAuthBtn = document.getElementById('adminAuthBtn');
    const loginModal = document.getElementById('loginModal');
    const closeLogin = document.getElementById('closeLogin');
    const submitLogin = document.getElementById('submitLogin');
    const logoutBtn = document.getElementById('logoutBtn');
    
    const postModal = document.getElementById('postModal');
    const addPostBtn = document.getElementById('addPostBtn');
    const closePost = document.getElementById('closePost');
    const savePostBtn = document.getElementById('savePostBtn');

    adminAuthBtn.onclick = () => loginModal.classList.remove('hidden');
    closeLogin.onclick = () => loginModal.classList.add('hidden');
    addPostBtn && (addPostBtn.onclick = () => openPostModal());
    closePost.onclick = () => postModal.classList.add('hidden');

    submitLogin.onclick = async () => {
        const password = document.getElementById('adminPassword').value;
        const res = await fetch('/api/admin/login', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (res.ok) {
            loginModal.classList.add('hidden');
            document.getElementById('adminPassword').value = '';
            await fetchCsrf();
            checkAdminStatus();
        } else {
            alert(data.message || 'Ошибка');
        }
    };

    logoutBtn && (logoutBtn.onclick = async () => {
        await fetch('/api/admin/logout', { method: 'POST', credentials: 'include', headers: { 'x-csrf-token': csrfToken } });
        await fetchCsrf();
        checkAdminStatus();
    });

    savePostBtn.onclick = async () => {
        const id = document.getElementById('postId').value;
        const title = document.getElementById('postTitle').value;
        const category = document.getElementById('postCategory').value;
        const content = document.getElementById('postContent').value;

        if (!title || !content) return alert('Заполните поля!');

        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/posts/${id}` : '/api/posts';

        const res = await fetch(url, {
            method,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
            body: JSON.stringify({ title, category, content })
        });

        if (res.ok) {
            postModal.classList.add('hidden');
            loadPosts();
        } else {
            const err = await res.json();
            alert(err.error || 'Ошибка при сохранении');
        }
    };
});

async function checkAdminStatus() {
    const res = await fetch('/api/admin/check', { credentials: 'include' });
    const data = await res.json();
    isAdmin = data.isAdmin;
    
    const adminPanel = document.getElementById('adminPanel');
    const adminAuthBtn = document.getElementById('adminAuthBtn');
    
    if (isAdmin) {
        adminPanel.classList.remove('hidden');
        adminAuthBtn.classList.add('hidden');
    } else {
        adminPanel.classList.add('hidden');
        adminAuthBtn.classList.remove('hidden');
    }
    loadPosts();
}

async function loadPosts() {
    const res = await fetch('/api/posts');
    const posts = await res.json();
    const container = document.getElementById('postsContainer');
    container.innerHTML = '';

    posts.forEach(post => {
        const card = document.createElement('article');
        card.className = 'post-card';
        card.innerHTML = `
            <div class="post-header">
                <span class="post-category">${escapeHtml(post.category || 'Политика')}</span>
                <span class="post-date">${post.date}</span>
            </div>
            <h3 class="post-title">${escapeHtml(post.title)}</h3>
            <p class="post-content">${escapeHtml(post.content)}</p>
            ${isAdmin ? `
                <div class="post-actions">
                    <button class="btn-edit" onclick="editPost('${post.id}')">Редактировать</button>
                    <button class="btn-delete" onclick="deletePost('${post.id}')">Удалить</button>
                </div>
            ` : ''}
        `;
        container.appendChild(card);
    });
}

function openPostModal(post = null) {
    document.getElementById('postId').value = post ? post.id : '';
    document.getElementById('postTitle').value = post ? post.title : '';
    document.getElementById('postCategory').value = post ? post.category : '';
    document.getElementById('postContent').value = post ? post.content : '';
    document.getElementById('modalTitle').innerText = post ? 'Редактировать новость' : 'Новая публикация';
    document.getElementById('postModal').classList.remove('hidden');
}

async function editPost(id) {
    const res = await fetch('/api/posts');
    const posts = await res.json();
    const post = posts.find(p => p.id === id);
    if (post) openPostModal(post);
}

async function deletePost(id) {
    if (confirm('Удалить эту публикацию?')) {
        const res = await fetch(`/api/posts/${id}`, { method: 'DELETE', credentials: 'include', headers: { 'x-csrf-token': csrfToken } });
        if (res.ok) loadPosts();
        else {
            const err = await res.json();
            alert(err.error || 'Ошибка при удалении');
        }
    }
}

function escapeHtml(text) {
    text = String(text || '');
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
