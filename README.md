# Manga Site Reader

A clean, ad-free manga reading website built entirely with plain HTML, CSS, and vanilla JavaScript. 

Instead of hosting heavy image files on our own server (which costs a lot of money), this project hooks directly into the **MangaDex** open database. That means it always has up-to-date chapters and covers as soon as they drop online, all running right from your browser.

## Getting Started

Because there is no backend database or complicated `Node.js` server, you don't need to run any install commands.

1. Download or clone this folder.
2. Double-click `index.html` to open it in Chrome, Safari, or Firefox.
3. Start reading!

---

## How It Works (The Code Concepts)

If you're reading this source code to figure out how it all snaps together, here are the main concepts we used to make it work.

### 1. APIs (Application Programming Interfaces)
Think of an API like a waiter at a restaurant. Our website (the customer) can't just walk into MangaDex's kitchen (their database) and grab the manga images. Instead, we give our order to the waiter by writing `fetch("https://api.mangadex.org/manga")`. MangaDex packages the data up as text (JSON) and hands it back to us, and our JavaScript turns that text into the grid of manga covers you see on screen.

### 2. The CORS Proxy Trick
Web browsers have a strict security rule called **CORS** (Cross-Origin Resource Sharing). Basically, Chrome gets really suspicious if a website running on `localhost` tries to secretly download data from completely different websites. To stop the browser from panicking and blocking our requests, we route our API calls through a proxy service called `corsproxy.io`. It acts as a middleman that tells your browser "Hey, it's cool, I allow this."

### 3. Rate Limiting (The Fetch Queue)
MangaDex is a free service run by volunteers. To stop people from crashing their servers, they use Cloudflare to block anyone who makes more than 5 requests per second. 

When you load the homepage here, we need to ask MangaDex for the "Popular", "New", and "Updated" lists all at the same time. If we did that instantly, Cloudflare would think we were a bot and ban us. To fix this, we wrote a custom **Rate Limiter** in `script.js`. It forces our network requests to line up in single-file, waiting exactly 250 milliseconds between each request so we stay under the speed limit.

### 4. Async / Await
Because downloading images over the internet takes time, we use `async` and `await` markers on our JavaScript functions. This lets the browser draw the dark background and the navigation bar instantly, and then it simply *waits* in the background for the manga data to arrive. If we didn't use async code, the entire webpage would freeze completely white until every single image finished downloading.

### 5. Single Page Application Routing (The Back Button Fix)
Normally, when you click a link, your browser throws away the current webpage and downloads a totally new one. Our app is a "Single Page Application," meaning we never leave `index.html`. We just hide and show different `<div>` blocks. 
To make sure your browser's physical "Back" button still works (instead of accidentally closing the website), we update the website's URL with a hashtag (like `#manga/123`). The script listens for the URL to change and instantly loads the correct screen.

### 6. Memory Caching (Loading Things Instantly)
Because we use a Rate Limiter, downloading data is naturally a little slow. To fix this, we created a digital scratchpad (a `Map()` cache) in the JavaScript. Every time we download a list of manga, we save a copy to the computer's RAM. If you hit the "Back" button to look at that exact list again, our script instantly grabs the saved copy from RAM instead of waking up the network connection again. It makes the site feel lightning fast.

### 7. Handling Massive Data (Pagination & Duplicates)
MangaDex only lets us download 500 chapters at a time. For epic stories like *One Piece*, it has over a thousand chapters! To grab them all, our code runs a `while` loop that keeps asking for the "next 500 chapters" until it runs out. 
Sometimes, multiple fans translate the exact same chapter, which would cause the dropdown menu to show "Chapter 344" three times in a row. Our code runs a smart check scanning for exact matches and automatically renames the duplicates by adding decimals (like `344.1, 344.2`) so they stay perfectly organized.

## Customizing

- **Styles:** Everything is controlled in the `style.css` file. The colors are managed by variables at the very top (look for `:root`), so you can easily change the glowing cyan color to red or green by changing one line!
- **Images:** The reading view loads all the images vertically (Webtoon style) by slamming them into a single column.
