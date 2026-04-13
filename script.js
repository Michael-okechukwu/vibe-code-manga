document.addEventListener('DOMContentLoaded', () => {

    const header = document.querySelector('header');
    const hamburger = document.querySelector('.hamburger');

    let lastScrollY = window.scrollY;
    let ticking = false;

    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(() => {
                const currentScrollY = window.scrollY;
                const diff = currentScrollY - lastScrollY;

                // Add glass effect once user scrolls past the header
                if (currentScrollY > 10) {
                    header.classList.add('header-scrolled');
                } else {
                    header.classList.remove('header-scrolled');
                }

                // Hide when scrolling DOWN (more than 5px to avoid jitter)
                if (diff > 5 && currentScrollY > 80) {
                    header.classList.add('header-hidden');
                    header.classList.remove('menu-open'); // close menu when hiding
                }
                // Show when scrolling UP
                else if (diff < -5) {
                    header.classList.remove('header-hidden');
                }

                lastScrollY = currentScrollY;
                ticking = false;
            });
            ticking = true;
        }
    });

    hamburger.addEventListener('click', () => {
        header.classList.toggle('menu-open');
    });

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
    const rateLimitDelay = 300; 
    let lastFetchTime = 0;
    let fetchQueue = Promise.resolve();
    const apiCache = new Map(); // Memory cache for lightning-fast back navigation

    // CORS Proxy fallback list
    const PROXY_LIST = [
        (url) => 'https://corsproxy.io/?' + encodeURIComponent(url),
        (url) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
        (url) => 'https://thingproxy.freeboard.io/fetch/' + url,
    ];
    let activeProxyIndex = 0;

    function getProxiedUrl(url) {
        return PROXY_LIST[activeProxyIndex](url);
    }

    async function fetchWithRateLimit(url, options = {}, skipCache = false) {
        const cacheKey = url + JSON.stringify(options);
        if (!skipCache && apiCache.has(cacheKey)) {
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

                // Try each proxy in order until one works
                for (let i = 0; i < PROXY_LIST.length; i++) {
                    const proxyIndex = (activeProxyIndex + i) % PROXY_LIST.length;
                    const proxiedUrl = PROXY_LIST[proxyIndex](url);
                    try {
                        const response = await fetch(proxiedUrl, options);
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        const data = await response.json();
                        // Switch to the working proxy for future requests
                        activeProxyIndex = proxyIndex;
                        if (!skipCache) apiCache.set(cacheKey, data);
                        resolve(data);
                        return;
                    } catch (err) {
                        console.warn(`Proxy ${proxyIndex} failed for ${url}:`, err.message);
                        if (i === PROXY_LIST.length - 1) {
                            reject(new Error(`All proxies failed for: ${url}`));
                        }
                        // Small delay before trying next proxy
                        await new Promise(r => setTimeout(r, 500));
                    }
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
            const data = await fetchWithRateLimit(url.toString());
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
            const data = await fetchWithRateLimit(url.toString());
            const processed = processMangaData([data.data]);
            return processed[0];
        } catch (error) {
            console.error('Failed to fetch manga detail:', error);
            return null;
        }
    }

    function processMangaData(mangaArray) {
        return mangaArray.map(manga => {
            let title = manga.attributes.title.en;
            
            // If main title doesn't have English, check altTitles
            if (!title && manga.attributes.altTitles && Array.isArray(manga.attributes.altTitles)) {
                const enAlt = manga.attributes.altTitles.find(alt => alt.en);
                if (enAlt) {
                    title = enAlt.en;
                }
            }
            
            // Fallback to the first available title if English isn't found anywhere
            if (!title) {
                title = Object.values(manga.attributes.title)[0] || 'Unknown Title';
            }

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
                const data = await fetchWithRateLimit(url.toString());
                
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
            // Always skip cache for at-home server — tokens expire after ~15 min
            const data = await fetchWithRateLimit(target, {}, true);
            
            if (!data || !data.chapter) {
                throw new Error('Invalid at-home server response');
            }

            const host = data.baseUrl;
            const hash = data.chapter.hash;

            // Prefer high-quality pages; fallback to dataSaver if unavailable
            const pages = (data.chapter.data && data.chapter.data.length > 0)
                ? data.chapter.data.map(page => `${host}/data/${hash}/${page}`)
                : (data.chapter.dataSaver && data.chapter.dataSaver.length > 0)
                    ? data.chapter.dataSaver.map(page => `${host}/data-saver/${hash}/${page}`)
                    : [];

            if (pages.length === 0) {
                throw new Error('Chapter has no pages');
            }

            return pages;
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
            views.chapterReader.innerHTML = `
                <div class="chapter-reader-layout">
                    <div class="reader-nav" style="position: sticky; top: 0; z-index: 100;">
                        <button onclick="window.location.hash='#manga/${mangaId}'" id="back-to-details">Back</button>
                        <h2>Failed to Load Chapter</h2>
                    </div>
                    <div class="manga-page" style="text-align:center; padding: 4rem 1rem;">
                        <p style="font-size:1.2rem; color:#ff6b6b;">⚠️ Could not load chapter pages.</p>
                        <p style="color:#aaa; margin-top:0.5rem;">This chapter may be unavailable, removed, or restricted by MangaDex.</p>
                        <button onclick="window.location.hash='#manga/${mangaId}'" style="margin-top:1.5rem; padding:0.7rem 2rem; background: var(--accent); color:#fff; border:none; border-radius:8px; cursor:pointer; font-size:1rem;">← Back to Manga</button>
                        <button onclick="loadChapterReaderView('${mangaId}','${chapterId}')" style="margin-top:1.5rem; margin-left:1rem; padding:0.7rem 2rem; background:#333; color:#fff; border:none; border-radius:8px; cursor:pointer; font-size:1rem;">🔄 Retry</button>
                    </div>
                </div>
            `;
            // Make retry button work
            views.chapterReader.querySelector('button[onclick*="loadChapterReaderView"]')
                ?.addEventListener('click', (e) => { e.preventDefault(); loadChapterReaderView(mangaId, chapterId); });
            return;
        }

        renderReaderControls(mangaId, chapterId, chapterName, chapterIndex);
    }

    function renderReaderControls(mangaId, currentChapterId, chapterName, chapterIndex) {
        const titleText = currentMangaData ? `${currentMangaData.title} - ${chapterName}` : chapterName;
        
        const totalPages = currentChapterPages.length;
        const imagesHtml = currentChapterPages.map((pageUrl, index) => 
            `<div class="page-wrapper" id="page-${index + 1}">
                <img 
                    src="${pageUrl}" 
                    alt="Page ${index + 1}"
                    loading="${index < 3 ? 'eager' : 'lazy'}"
                    onerror="this.parentElement.innerHTML='<div class=\'page-error\'><span>⚠ Page ${index + 1} failed to load</span><br><button onclick=\'this.closest(\'.page-wrapper\').querySelector(\'img\') && (this.closest(\'.page-wrapper\').innerHTML=\'<img src=\\&quot;${pageUrl.replace(/"/g, '&quot;')}&quot; loading=eager alt=\'Page ${index + 1}\' class=\'retry-img\'>\')\'> Retry</button></div>'">
            </div>`
        ).join('');

        // Track load progress
        let loadedCount = 0;
        const progressHtml = `<div id="page-load-progress" style="position:fixed;bottom:1.5rem;right:1.5rem;background:rgba(0,0,0,0.8);color:#fff;padding:0.5rem 1rem;border-radius:8px;font-size:0.85rem;z-index:999;backdrop-filter:blur(4px);">Loading 0/${totalPages} pages...</div>`;

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
                <div class="manga-page" id="manga-image-container">
                    ${imagesHtml}
                </div>
            </div>
            ${progressHtml}
        `;

        document.getElementById('chapter-select').addEventListener('change', (e) => {
            window.location.hash = e.target.value;
        });

        // Page load progress tracking
        const progressEl = document.getElementById('page-load-progress');
        const allImgs = document.querySelectorAll('#manga-image-container img');
        if (progressEl && allImgs.length > 0) {
            const updateProgress = () => {
                loadedCount++;
                if (progressEl) progressEl.textContent = `Loaded ${loadedCount}/${totalPages} pages`;
                if (loadedCount >= totalPages) {
                    setTimeout(() => progressEl?.remove(), 1500);
                }
            };
            allImgs.forEach(img => {
                if (img.complete) { updateProgress(); }
                else {
                    img.addEventListener('load', updateProgress, { once: true });
                    img.addEventListener('error', updateProgress, { once: true });
                }
            });
        }
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
    document.querySelector('a[href="#home"]').addEventListener('click', () => { 
        window.location.hash = '#home'; 
        header.classList.remove('menu-open');
    });
    document.querySelector('a[href="#browse"]').addEventListener('click', () => { 
        window.location.hash = '#browse'; 
        header.classList.remove('menu-open');
    });

    const searchInput = document.querySelector('.search-container input');
    const searchBtn = document.querySelector('.search-container button');

    searchBtn.addEventListener('click', () => {
        searchManga(searchInput.value);
        header.classList.remove('menu-open');
    });
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            searchManga(searchInput.value);
            header.classList.remove('menu-open');
        }
    });

    // Boot
    if (!window.location.hash) {
        window.location.hash = '#home';
    } else {
        handleHashChange(); // Trigger load if landing on a specific URL
    }
});
