document.addEventListener('DOMContentLoaded', () => {

    const views = {
        home: document.getElementById('home'),
        browse: document.getElementById('browse'),
        mangaDetails: document.getElementById('manga-details'),
        chapterReader: document.getElementById('chapter-reader'),
    };

    // MangaDex API endpoints
    const MD_BASE_URL = 'https://api.mangadex.org';
    const MD_UPLOADS_URL = 'https://uploads.mangadex.org';

    // --- Performance: Caching & Rate Limiting ---
    const rateLimitDelay = 250; 
    let lastFetchTime = 0;
    let fetchQueue = Promise.resolve();
    const apiCache = new Map(); // Memory cache for lightning-fast back navigation

    async function fetchWithRateLimit(url, options = {}) {
        const cacheKey = url + JSON.stringify(options);
        if (apiCache.has(cacheKey)) {
            return apiCache.get(cacheKey); // Instantly return from RAM
        }

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
                    if (!response.ok) throw new Error('Network response was not ok');
                    const data = await response.json();
                    
                    apiCache.set(cacheKey, data); // Store in cache
                    resolve(data);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    // State
    let currentMangaData = null;
    let currentMangaChapters = [];
    let currentChapterPages = [];

    // --- API Fetching Methods ---
    async function fetchMangaList(params = {}) {
        const url = new URL(`${MD_BASE_URL}/manga`);
        url.searchParams.append('includes[]', 'cover_art');
        url.searchParams.append('limit', '12'); 
        url.searchParams.append('availableTranslatedLanguage[]', 'en');

        for (const [key, value] of Object.entries(params)) {
            url.searchParams.append(key, value);
        }

        try {
            const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(url.toString());
            const data = await fetchWithRateLimit(proxyUrl);
            return processMangaData(data.data);
        } catch (error) {
            console.error('Failed to fetch manga:', error);
            return [];
        }
    }

    async function fetchSingleManga(id) {
        if (currentMangaData && currentMangaData.id === id) return currentMangaData;

        const url = new URL(`${MD_BASE_URL}/manga/${id}`);
        url.searchParams.append('includes[]', 'cover_art');
        try {
            const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(url.toString());
            const data = await fetchWithRateLimit(proxyUrl);
            const processed = processMangaData([data.data]);
            return processed[0];
        } catch (error) {
            console.error('Failed to fetch manga detail:', error);
            return null;
        }
    }

    function processMangaData(mangaArray) {
        return mangaArray.map(manga => {
            const title = manga.attributes.title.en || Object.values(manga.attributes.title)[0] || 'Unknown Title';
            const rawDesc = manga.attributes.description.en || 'No description available.';
            
            // Basic XSS Protection: Strip pure HTML tags by dumping to a temporary text node
            const safeContainer = document.createElement('div');
            safeContainer.innerText = rawDesc;
            const description = safeContainer.innerHTML.replace(/\n/g, '<br>');

            let coverUrl = 'https://placehold.co/180x250/1f1f1f/e0e0e0?text=No+Cover';
            const coverRel = manga.relationships.find(rel => rel.type === 'cover_art');
            if (coverRel && coverRel.attributes && coverRel.attributes.fileName) {
                coverUrl = `${MD_UPLOADS_URL}/covers/${manga.id}/${coverRel.attributes.fileName}.256.jpg`;
            }

            return { id: manga.id, title, description, status: manga.attributes.status, coverImage: coverUrl };
        });
    }

    async function fetchChapters(mangaId) {
        let allChapters = [];
        const limit = 500;
        let offset = 0;
        let total = 0;

        do {
            const url = new URL(`${MD_BASE_URL}/manga/${mangaId}/feed`);
            url.searchParams.append('translatedLanguage[]', 'en');
            url.searchParams.append('order[chapter]', 'desc');
            url.searchParams.append('limit', limit.toString());
            url.searchParams.append('offset', offset.toString());

            try {
                const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(url.toString());
                const data = await fetchWithRateLimit(proxyUrl);
                
                if (data && data.data) {
                    total = data.total || 0;
                    allChapters = allChapters.concat(data.data);
                } else {
                    break;
                }
            } catch (error) {
                console.error('Failed to fetch chapters:', error);
                break;
            }
            offset += limit;
        } while (offset < total);

        const processed = allChapters.map(ch => ({
            id: ch.id,
            chapter: ch.attributes.chapter || '0',
            title: ch.attributes.title || ''
        }));

        // Handle duplicates by counting occurrences and appending '.1', '.2'
        const groups = {};
        for (const ch of processed) {
            if (!groups[ch.chapter]) groups[ch.chapter] = [];
            groups[ch.chapter].push(ch);
        }
        
        for (const key in groups) {
            const arr = groups[key];
            if (arr.length > 1) {
                for (let i = 0; i < arr.length; i++) {
                    arr[i].chapter = `${key}.${i + 1}`;
                }
            }
        }

        return processed;
    }

    async function fetchChapterPagesInfo(chapterId) {
        try {
            const target = `${MD_BASE_URL}/at-home/server/${chapterId}`;
            const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(target);
            const data = await fetchWithRateLimit(proxyUrl);
            
            const host = data.baseUrl;
            const hash = data.chapter.hash;
            return data.chapter.data.map(page => `${host}/data/${hash}/${page}`);
        } catch (error) {
            console.error('Failed to fetch chapter pages:', error);
            return [];
        }
    }

    // --- UI Interactions & Routing ---

    function showView(viewName) {
        window.scrollTo(0, 0); 
        for (const key in views) {
            views[key].classList.add('hidden');
        }
        if (views[viewName]) {
            views[viewName].classList.remove('hidden');
        }
    }

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
            mangaCard.innerHTML = `
                <div class="img-container">
                    <img src="${manga.coverImage}" alt="${manga.title}" loading="lazy">
                </div>
                <h3>${manga.title}</h3>
            `;
            // Cache the manga data immediately for faster navigation
            currentMangaData = manga;
            mangaCard.addEventListener('click', () => {
                currentMangaData = manga;
                window.location.hash = `#manga/${manga.id}`;
            });
            grid.appendChild(mangaCard);
        });
    }

    async function loadMangaDetailsView(mangaId) {
        showView('mangaDetails');
        
        // Ensure data is present (if navigating backward into the page)
        let manga = currentMangaData && currentMangaData.id === mangaId ? currentMangaData : await fetchSingleManga(mangaId);
        if (!manga) return;
        currentMangaData = manga;
        
        views.mangaDetails.innerHTML = `
            <div style="text-align: center; padding: 5rem 0;"><h2>Loading ${manga.title}...</h2></div>
        `;

        currentMangaChapters = await fetchChapters(manga.id);

        let chapterListHtml = currentMangaChapters.map(ch => {
            const displayName = ch.chapter === '0' ? (ch.title || 'Oneshot') : `Chapter ${ch.chapter} ${ch.title ? '- ' + ch.title : ''}`;
            return `<li><a href="#chapter/${manga.id}/${ch.id}">${displayName}</a></li>`
        }).join('');

        if (currentMangaChapters.length === 0) {
            chapterListHtml = '<li><p>No English chapters available.</p></li>';
        }

        views.mangaDetails.innerHTML = `
            <div class="manga-detail-layout">
                <img src="${manga.coverImage}" alt="${manga.title}">
                <div class="manga-info">
                    <h2>${manga.title}</h2>
                    <p style="margin-bottom: 1rem; max-height: 200px; overflow-y: auto;"><strong>Summary:</strong> <br>${manga.description}</p>
                    <p><strong>Status:</strong> <span style="text-transform: capitalize;">${manga.status}</span></p>
                    <h3>Chapters</h3>
                    <ul class="chapter-list">${chapterListHtml}</ul>
                </div>
            </div>
        `;
    }

    async function loadChapterReaderView(mangaId, chapterId) {
        showView('chapterReader');
        views.chapterReader.innerHTML = `
            <div class="chapter-reader-layout">
                <div class="reader-nav">
                    <h2>Loading Chapter...</h2>
                </div>
                <div class="manga-page" style="text-align: center; margin-top: 5rem; font-size: 1.5rem;">
                    Fetching pages...
                </div>
            </div>
        `;

        // Ensure we have manga context and chapter list
        if (!currentMangaData || currentMangaData.id !== mangaId || currentMangaChapters.length === 0) {
            currentMangaData = await fetchSingleManga(mangaId);
            currentMangaChapters = await fetchChapters(mangaId);
        }

        const chapterIndex = currentMangaChapters.findIndex(c => c.id === chapterId);
        const currentChapter = currentMangaChapters[chapterIndex];
        const chapterName = currentChapter ? (currentChapter.chapter === '0' ? 'Oneshot' : `Chapter ${currentChapter.chapter}`) : '';

        currentChapterPages = await fetchChapterPagesInfo(chapterId);

        if (currentChapterPages.length === 0) {
            views.chapterReader.querySelector('.manga-page').innerHTML = '<p>Error loading pages.</p>';
            return;
        }

        renderReaderControls(mangaId, chapterId, chapterName, chapterIndex);
    }

    function renderReaderControls(mangaId, currentChapterId, chapterName, chapterIndex) {
        const titleText = currentMangaData ? `${currentMangaData.title} - ${chapterName}` : chapterName;
        
        const imagesHtml = currentChapterPages.map((pageUrl, index) => 
            `<img src="${pageUrl}" alt="Page ${index + 1}" loading="lazy" style="display: block; margin: 0 auto; max-width: 100%; margin-bottom: 20px; box-shadow: 0 0 20px rgba(0,0,0,0.8);">`
        ).join('');

        // Next/Prev Math (Remember: Chapter list is fetched DESC order, meaning index 0 is the NEWEST chapter)
        const hasNext = chapterIndex > 0;
        const hasPrev = chapterIndex < currentMangaChapters.length - 1;
        
        const nextLink = hasNext ? `#chapter/${mangaId}/${currentMangaChapters[chapterIndex - 1].id}` : `#manga/${mangaId}`;
        const prevLink = hasPrev ? `#chapter/${mangaId}/${currentMangaChapters[chapterIndex + 1].id}` : `#manga/${mangaId}`;

        // Build Chapter Select dropdown
        const selectOptions = currentMangaChapters.map(ch => {
            const name = ch.chapter === '0' ? (ch.title || 'Oneshot') : `Chapter ${ch.chapter}`;
            const selected = ch.id === currentChapterId ? 'selected' : '';
            return `<option value="#chapter/${mangaId}/${ch.id}" ${selected}>${name}</option>`;
        }).join('');

        views.chapterReader.innerHTML = `
            <div class="chapter-reader-layout">
                <div class="reader-nav" style="position: sticky; top: 0; z-index: 100;">
                    <button onclick="window.location.hash='#manga/${mangaId}'" id="back-to-details">Back</button>
                    <h2>${titleText}</h2>
                    <div class="reader-controls">
                        <button onclick="window.location.hash='${prevLink}'" ${!hasPrev ? 'disabled' : ''}>Previous</button>
                        <select id="chapter-select">${selectOptions}</select>
                        <button onclick="window.location.hash='${nextLink}'" ${!hasNext ? 'disabled' : ''}>Next</button>
                    </div>
                </div>
                <div class="manga-page" id="manga-image-container" style="display: flex; flex-direction: column; align-items: center; background-color: #000; padding: 20px 0; width: 100%; margin-top: 0;">
                    ${imagesHtml}
                </div>
            </div>
        `;

        document.getElementById('chapter-select').addEventListener('change', (e) => {
            window.location.hash = e.target.value;
        });
    }

    // --- Loading Homepage/Browse Data ---
    async function loadHomepage() {
        document.querySelector('#popular .manga-grid').innerHTML = 'Loading...';
        document.querySelector('#new-releases .manga-grid').innerHTML = 'Loading...';
        document.querySelector('#recently-updated .manga-grid').innerHTML = 'Loading...';

        const [popular, newReleases, recentlyUpdated] = await Promise.all([
            fetchMangaList({ 'order[rating]': 'desc' }),
            fetchMangaList({ 'order[createdAt]': 'desc' }),
            fetchMangaList({ 'order[updatedAt]': 'desc' })
        ]);

        renderMangaGrid(popular, '#popular .manga-grid');
        renderMangaGrid(newReleases, '#new-releases .manga-grid');
        renderMangaGrid(recentlyUpdated, '#recently-updated .manga-grid');
    }

    async function searchManga(query) {
        if (!query.trim()) return;
        window.location.hash = `#search/${encodeURIComponent(query)}`;
    }

    async function loadBrowseView(query = null) {
        showView('browse');
        const browseGrid = document.querySelector('#browse .manga-grid');
        
        if (query) {
            document.querySelector('#browse h2').innerText = `Search Results for "${query}"`;
            browseGrid.innerHTML = 'Searching...';
            const results = await fetchMangaList({ title: query, limit: 24 });
            renderMangaGrid(results, '#browse .manga-grid');
        } else {
            document.querySelector('#browse h2').innerText = 'Browse All Manga';
            browseGrid.innerHTML = 'Loading...';
            const allManga = await fetchMangaList({ limit: 24, 'order[followedCount]': 'desc' });
            renderMangaGrid(allManga, '#browse .manga-grid');
        }
    }

    // --- Router ---
    function handleHashChange() {
        const hash = window.location.hash.slice(1); // Remove the #

        if (!hash || hash === 'home') {
            showView('home');
            loadHomepage();
        } else if (hash === 'browse') {
            loadBrowseView();
        } else if (hash.startsWith('search/')) {
            const query = decodeURIComponent(hash.split('/')[1]);
            loadBrowseView(query);
        } else if (hash.startsWith('manga/')) {
            const mangaId = hash.split('/')[1];
            loadMangaDetailsView(mangaId);
        } else if (hash.startsWith('chapter/')) {
            const parts = hash.split('/');
            const mangaId = parts[1];
            const chapterId = parts[2];
            loadChapterReaderView(mangaId, chapterId);
        }
    }

    window.addEventListener('hashchange', handleHashChange);

    // --- Global Event Listeners ---
    document.querySelector('a[href="#home"]').addEventListener('click', () => { window.location.hash = '#home'; });
    document.querySelector('a[href="#browse"]').addEventListener('click', () => { window.location.hash = '#browse'; });

    const searchInput = document.querySelector('.search-container input');
    const searchBtn = document.querySelector('.search-container button');

    searchBtn.addEventListener('click', () => searchManga(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchManga(searchInput.value);
    });

    // Boot
    if (!window.location.hash) {
        window.location.hash = '#home';
    } else {
        handleHashChange(); // Trigger load if landing on a specific URL
    }
});
