document.addEventListener('DOMContentLoaded', () => {

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

    // MangaDex API endpoints
    const MD_BASE_URL = 'https://api.mangadex.org';
    const MD_UPLOADS_URL = 'https://uploads.mangadex.org';

    // --- Rate Limiter ---
    // Ensures we don't violate MangaDex's 5 req/sec limit by queuing fetches globally
    const rateLimitDelay = 250; 
    let lastFetchTime = 0;
    let fetchQueue = Promise.resolve();

    async function fetchWithRateLimit(url, options = {}) {
        return new Promise((resolve, reject) => {
            fetchQueue = fetchQueue.then(async () => {
                const now = Date.now();
                const timeSinceLastFetch = now - lastFetchTime;
                
                if (timeSinceLastFetch < rateLimitDelay) {
                    await new Promise(r => setTimeout(r, rateLimitDelay - timeSinceLastFetch));
                }
                
                lastFetchTime = Date.now();
                
                try {
                    const response = await fetch(url, options);
                    resolve(response);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    // State
    let currentMangaData = null;
    let currentChapterPages = [];
    let currentPageIndex = 0;

    // --- API Fetching Methods ---
    async function fetchMangaList(params = {}) {
        const url = new URL(`${MD_BASE_URL}/manga`);
        url.searchParams.append('includes[]', 'cover_art');
        url.searchParams.append('limit', '12'); // Get a bit more for the grid
        url.searchParams.append('availableTranslatedLanguage[]', 'en');

        for (const [key, value] of Object.entries(params)) {
            url.searchParams.append(key, value);
        }

        try {
            // Using a CORS proxy to bypass local Live Server/Cloudflare blocks
            const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(url.toString());
            const response = await fetchWithRateLimit(proxyUrl);
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            return processMangaData(data.data);
        } catch (error) {
            console.error('Failed to fetch manga:', error);
            return [];
        }
    }

    function processMangaData(mangaArray) {
        return mangaArray.map(manga => {
            const title = manga.attributes.title.en || Object.values(manga.attributes.title)[0] || 'Unknown Title';
            const description = manga.attributes.description.en || 'No description available.';
            
            let coverUrl = 'https://placehold.co/180x250/1f1f1f/e0e0e0?text=No+Cover';
            const coverRel = manga.relationships.find(rel => rel.type === 'cover_art');
            if (coverRel && coverRel.attributes && coverRel.attributes.fileName) {
                coverUrl = `${MD_UPLOADS_URL}/covers/${manga.id}/${coverRel.attributes.fileName}.256.jpg`;
            }

            return {
                id: manga.id,
                title,
                description,
                status: manga.attributes.status,
                coverImage: coverUrl
            };
        });
    }

    async function fetchChapters(mangaId) {
        // Fetch up to 100 English chapters in descending order (latest first)
        const url = new URL(`${MD_BASE_URL}/manga/${mangaId}/feed`);
        url.searchParams.append('translatedLanguage[]', 'en');
        url.searchParams.append('order[chapter]', 'desc');
        url.searchParams.append('limit', '100');

        try {
            const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(url.toString());
            const response = await fetchWithRateLimit(proxyUrl);
            const data = await response.json();
            return data.data.map(ch => ({
                id: ch.id,
                chapter: ch.attributes.chapter || '0',
                title: ch.attributes.title || ''
            }));
        } catch (error) {
            console.error('Failed to fetch chapters:', error);
            return [];
        }
    }

    async function fetchChapterPagesInfo(chapterId) {
        try {
            const target = `${MD_BASE_URL}/at-home/server/${chapterId}`;
            const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(target);
            const response = await fetchWithRateLimit(proxyUrl);
            const data = await response.json();
            
            const host = data.baseUrl;
            const hash = data.chapter.hash;
            const dataPages = data.chapter.data;

            return dataPages.map(page => `${host}/data/${hash}/${page}`);
        } catch (error) {
            console.error('Failed to fetch chapter pages:', error);
            return [];
        }
    }


    // --- UI Interactions ---

    function renderMangaGrid(mangaList, gridElementSelector) {
        const grid = document.querySelector(gridElementSelector);
        if (!grid) return;

        grid.innerHTML = '';
        if (mangaList.length === 0) {
            grid.innerHTML = '<p style="color: #aaa; text-align: center; width: 100%;">No manga found.</p>';
            return;
        }

        mangaList.forEach(manga => {
            const mangaCard = document.createElement('div');
            mangaCard.className = 'manga-card';
            mangaCard.dataset.mangaId = manga.id;
            mangaCard.innerHTML = `
                <img src="${manga.coverImage}" alt="${manga.title}" loading="lazy">
                <h3>${manga.title}</h3>
            `;
            // Save the data to the DOM element for easy access later
            mangaCard.mangaData = manga;
            mangaCard.addEventListener('click', () => showMangaDetails(manga));
            grid.appendChild(mangaCard);
        });
    }

    function showView(viewName) {
        window.scrollTo(0, 0); // Scroll to top when changing views
        for (const key in views) {
            views[key].classList.add('hidden');
        }
        if (views[viewName]) {
            views[viewName].classList.remove('hidden');
        }
    }

    async function showMangaDetails(manga) {
        currentMangaData = manga;
        
        // Show loading state first
        views.mangaDetails.innerHTML = `
            <div style="text-align: center; padding: 5rem 0;">
                <h2>Loading ${manga.title}...</h2>
            </div>
        `;
        showView('mangaDetails');

        // Fetch chapters
        const chapters = await fetchChapters(manga.id);

        let chapterListHtml = chapters.map(ch => {
            const displayName = ch.chapter === '0' ? (ch.title || 'Oneshot') : `Chapter ${ch.chapter} ${ch.title ? '- ' + ch.title : ''}`;
            return `<li><a href="#" data-chapter-id="${ch.id}">${displayName}</a></li>`
        }).join('');

        if (chapters.length === 0) {
            chapterListHtml = '<li><p>No English chapters available.</p></li>';
        }

        // Use a safer innerHTML assignment strategy by stripping tags if we really want to, 
        // but for now we assume descriptions from MD are plain markdown/text. 
        // We will do a basic replace map for line breaks.
        const formattedDescription = manga.description.replace(/\n/g, '<br>');

        views.mangaDetails.innerHTML = `
            <div class="manga-detail-layout">
                <img src="${manga.coverImage}" alt="${manga.title}">
                <div class="manga-info">
                    <h2>${manga.title}</h2>
                    <p style="white-space: pre-wrap; margin-bottom: 1rem; max-height: 200px; overflow-y: auto;"><strong>Summary:</strong> ${formattedDescription}</p>
                    <p><strong>Status:</strong> <span style="text-transform: capitalize;">${manga.status}</span></p>
                    <h3>Chapters</h3>
                    <ul class="chapter-list">
                        ${chapterListHtml}
                    </ul>
                </div>
            </div>
        `;
        
        // Attach click listeners to new chapter links
        views.mangaDetails.querySelectorAll('.chapter-list a').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const chapterId = e.currentTarget.dataset.chapterId;
                const chapterName = e.currentTarget.innerText;
                loadChapterReader(chapterId, chapterName);
            });
        });
    }

    async function loadChapterReader(chapterId, chapterName) {
        // Show loading screen
        views.chapterReader.innerHTML = `
            <div class="chapter-reader-layout">
                <div class="reader-nav">
                    <button id="back-to-details">Back to Details</button>
                    <h2>Loading Chapter...</h2>
                    <div class="page-nav"></div>
                </div>
                <div class="manga-page" style="text-align: center; margin-top: 5rem; font-size: 1.5rem;">
                    Fetching pages...
                </div>
            </div>
        `;
        
        document.getElementById('back-to-details').addEventListener('click', () => {
            showView('mangaDetails');
        });

        showView('chapterReader');

        // Fetch page URLs
        currentChapterPages = await fetchChapterPagesInfo(chapterId);
        currentPageIndex = 0;

        if (currentChapterPages.length === 0) {
            views.chapterReader.querySelector('.manga-page').innerHTML = '<p>Error loading pages. This chapter might be external or unavailable.</p>';
            return;
        }

        renderReaderControls(chapterName);
    }

    function renderReaderControls(chapterName) {
        const titleText = currentMangaData ? `${currentMangaData.title} - ${chapterName}` : chapterName;
        
        const imagesHtml = currentChapterPages.map((pageUrl, index) => 
            `<img src="${pageUrl}" alt="Page ${index + 1}" loading="lazy" style="display: block; margin: 0 auto; max-width: 100%; margin-bottom: 20px; box-shadow: 0 0 20px rgba(0,0,0,0.8);">`
        ).join('');

        // Re-inject the static parts and UI structure for the reader
        views.chapterReader.innerHTML = `
            <div class="chapter-reader-layout">
                <div class="reader-nav" style="position: sticky; top: 0; z-index: 100;">
                    <button id="back-to-details">Back to Details</button>
                    <h2>${titleText}</h2>
                    <div></div> <!-- Spacing empty div -->
                </div>
                <div class="manga-page" id="manga-image-container" style="display: flex; flex-direction: column; align-items: center; background-color: #000; padding: 20px 0; width: 100%; margin-top: 0;">
                    ${imagesHtml}
                </div>
            </div>
        `;

        // Click listeners for layout controls
        document.getElementById('back-to-details').addEventListener('click', () => {
            showView('mangaDetails');
        });
    }

    // --- Loading Homepage Data ---
    async function loadHomepage() {
        document.querySelector('#popular .manga-grid').innerHTML = 'Loading...';
        document.querySelector('#new-releases .manga-grid').innerHTML = 'Loading...';
        document.querySelector('#recently-updated .manga-grid').innerHTML = 'Loading...';

        // Fetch Popular (Highest rating)
        const popularParams = { 'order[rating]': 'desc' };
        // Fetch New (Recently added)
        const newParams = { 'order[createdAt]': 'desc' };
        // Fetch Updated (Recently updated chapters)
        const updatedParams = { 'order[updatedAt]': 'desc' };

        // The fetchWithRateLimit handles the spacing queue now, so concurrency is safe!
        const [popular, newReleases, recentlyUpdated] = await Promise.all([
            fetchMangaList(popularParams),
            fetchMangaList(newParams),
            fetchMangaList(updatedParams)
        ]);

        renderMangaGrid(popular, '#popular .manga-grid');
        renderMangaGrid(newReleases, '#new-releases .manga-grid');
        renderMangaGrid(recentlyUpdated, '#recently-updated .manga-grid');
    }

    // --- Search functionality ---
    async function searchManga(query) {
        if (!query.trim()) return;

        showView('browse');
        const browseGrid = document.querySelector('#browse .manga-grid');
        document.querySelector('#browse h2').innerText = `Search Results for "${query}"`;
        browseGrid.innerHTML = 'Searching...';

        const results = await fetchMangaList({ title: query, limit: 24 });
        renderMangaGrid(results, '#browse .manga-grid');
    }

    const searchInput = document.querySelector('.search-container input');
    const searchBtn = document.querySelector('.search-container button');

    searchBtn.addEventListener('click', () => searchManga(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchManga(searchInput.value);
    });

    // --- Event Listeners ---
    navLinks.home.addEventListener('click', (e) => {
        e.preventDefault();
        showView('home');
        // Let's clear search when going back home
        searchInput.value = '';
    });

    navLinks.browse.addEventListener('click', async (e) => {
        e.preventDefault();
        showView('browse');
        document.querySelector('#browse h2').innerText = 'Browse All Manga';
        document.querySelector('#browse .manga-grid').innerHTML = 'Loading...';
        
        // Load default "all" manga list for the browse section
        const allManga = await fetchMangaList({ limit: 24, 'order[followedCount]': 'desc' });
        renderMangaGrid(allManga, '#browse .manga-grid');
    });

    // --- Initial Page Load ---
    loadHomepage();
    showView('home');
});
