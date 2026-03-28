document.addEventListener('DOMContentLoaded', () => {
    // Ensure modals are hidden on page load
    document.getElementById('login-modal').classList.add('hidden');
    document.getElementById('signup-modal').classList.add('hidden');

    const views = {
        home: document.getElementById('home'),
        browse: document.getElementById('browse'),
        mangaDetails: document.getElementById('manga-details'),
        chapterReader: document.getElementById('chapter-reader'),
    };

    const navLinks = {
        home: document.querySelector('a[href="#home"]'),
        browse: document.querySelector('a[href="#browse"]'),
    };

    let currentMangaId = null;

    // --- Placeholder for a real API call ---
    const dummyMangaData = {
        popular: [
            { id: 1, title: 'Manga Title 1', coverImage: 'https://placehold.co/180x250/1f1f1f/e0e0e0?text=Manga+1' },
            { id: 2, title: 'Manga Title 2', coverImage: 'https://placehold.co/180x250/1f1f1f/e0e0e0?text=Manga+2' },
            { id: 3, title: 'Manga Title 3', coverImage: 'https://placehold.co/180x250/1f1f1f/e0e0e0?text=Manga+3' },
            { id: 4, title: 'Manga Title 4', coverImage: 'https://placehold.co/180x250/1f1f1f/e0e0e0?text=Manga+4' },
            { id: 5, title: 'Manga Title 5', coverImage: 'https://placehold.co/180x250/1f1f1f/e0e0e0?text=Manga+5' },
        ],
        newReleases: [
            { id: 6, title: 'New Manga 1', coverImage: 'https://placehold.co/180x250/1f1f1f/e0e0e0?text=New+1' },
            { id: 7, title: 'New Manga 2', coverImage: 'https://placehold.co/180x250/1f1f1f/e0e0e0?text=New+2' },
            { id: 8, title: 'New Manga 3', coverImage: 'https://placehold.co/180x250/1f1f1f/e0e0e0?text=New+3' },
        ],
        recentlyUpdated: [
            { id: 9, title: 'Updated Manga 1', coverImage: 'https://placehold.co/180x250/1f1f1f/e0e0e0?text=Updated+1' },
            { id: 10, title: 'Updated Manga 2', coverImage: 'https://placehold.co/180x250/1f1f1f/e0e0e0?text=Updated+2' },
            { id: 11, title: 'Updated Manga 3', coverImage: 'https://placehold.co/180x250/1f1f1f/e0e0e0?text=Updated+3' },
            { id: 12, title: 'Updated Manga 4', coverImage: 'https://placehold.co/180x250/1f1f1f/e0e0e0?text=Updated+4' },
        ]
    };
    const allManga = [...dummyMangaData.popular, ...dummyMangaData.newReleases, ...dummyMangaData.recentlyUpdated];
    // --- End of placeholder data ---


    function renderMangaGrid(mangaList, gridElementSelector) {
        const grid = document.querySelector(gridElementSelector);
        if (!grid) return;

        grid.innerHTML = '';
        mangaList.forEach(manga => {
            const mangaCard = document.createElement('div');
            mangaCard.className = 'manga-card';
            mangaCard.dataset.mangaId = manga.id;
            mangaCard.innerHTML = `
                <img src="${manga.coverImage}" alt="${manga.title}">
                <h3>${manga.title}</h3>
            `;
            mangaCard.addEventListener('click', () => showMangaDetails(manga.id));
            grid.appendChild(mangaCard);
        });
    }

    function showView(viewName) {
        for (const key in views) {
            views[key].classList.add('hidden');
        }
        if (views[viewName]) {
            views[viewName].classList.remove('hidden');
        }
    }

    function showMangaDetails(mangaId) {
        currentMangaId = mangaId;
        const manga = allManga.find(m => m.id === mangaId);
        if (!manga) return;

        views.mangaDetails.innerHTML = `
            <div class="manga-detail-layout">
                <img src="${manga.coverImage}" alt="${manga.title}">
                <div class="manga-info">
                    <h2>${manga.title}</h2>
                    <p><strong>Summary:</strong> This is a placeholder summary for the manga...</p>
                    <p><strong>Status:</strong> Ongoing</p>
                    <p><strong>Author:</strong> John Doe</p>
                    <h3>Chapters</h3>
                    <ul class="chapter-list">
                        <li><a href="#" data-chapter="1">Chapter 1</a></li>
                        <li><a href="#" data-chapter="2">Chapter 2</a></li>
                        <li><a href="#" data-chapter="3">Chapter 3</a></li>
                    </ul>
                </div>
            </div>
        `;
        
        views.mangaDetails.querySelectorAll('.chapter-list a').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const chapterId = e.target.dataset.chapter;
                showChapterReader(mangaId, chapterId);
            });
        });

        showView('mangaDetails');
    }

    function showChapterReader(mangaId, chapterId) {
        const manga = allManga.find(m => m.id === mangaId);
        if (!manga) return;
    
        views.chapterReader.innerHTML = `
            <div class="chapter-reader-layout">
                <div class="reader-nav">
                    <button id="back-to-details">Back to Details</button>
                    <h2>${manga.title} - Chapter ${chapterId}</h2>
                    <div class="page-nav">
                        <button>&laquo; Prev</button>
                        <span>Page 1</span>
                        <button>Next &raquo;</button>
                    </div>
                </div>
                <div class="manga-page">
                    <img src="https://placehold.co/800x1200/121212/e0e0e0?text=Manga+Page+1" alt="Manga Page">
                </div>
            </div>
        `;
    
        document.getElementById('back-to-details').addEventListener('click', () => {
            showMangaDetails(mangaId);
        });
    
        showView('chapterReader');
    }

    // --- Event Listeners ---
    navLinks.home.addEventListener('click', (e) => {
        e.preventDefault();
        showView('home');
    });

    navLinks.browse.addEventListener('click', (e) => {
        e.preventDefault();
        showView('browse');
    });

    // --- Initial Page Load ---
    renderMangaGrid(dummyMangaData.popular, '#popular .manga-grid');
    renderMangaGrid(dummyMangaData.newReleases, '#new-releases .manga-grid');
    renderMangaGrid(dummyMangaData.recentlyUpdated, '#recently-updated .manga-grid');
    renderMangaGrid(allManga, '#browse .manga-grid');
    showView('home');

    // --- Modal Logic ---
    const loginModal = document.getElementById('login-modal');
    const signupModal = document.getElementById('signup-modal');
    const loginBtn = document.getElementById('login-btn');
    const signupBtn = document.getElementById('signup-btn');
    const closeBtns = document.querySelectorAll('.close-btn');

    loginBtn.addEventListener('click', () => loginModal.classList.remove('hidden'));
    signupBtn.addEventListener('click', () => signupModal.classList.remove('hidden'));

    closeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            loginModal.classList.add('hidden');
            signupModal.classList.add('hidden');
        });
    });

    window.addEventListener('click', (e) => {
        if (e.target === loginModal || e.target === signupModal) {
            loginModal.classList.add('hidden');
            signupModal.classList.add('hidden');
        }
    });

    document.getElementById('login-form').addEventListener('submit', (e) => {
        e.preventDefault();
        console.log('Login form submitted. Ready for backend integration.');
        loginModal.classList.add('hidden');
    });

    document.getElementById('signup-form').addEventListener('submit', (e) => {
        e.preventDefault();
        console.log('Sign up form submitted. Ready for backend integration.');
        signupModal.classList.add('hidden');
    });
});


