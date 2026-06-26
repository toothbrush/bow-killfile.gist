// ==UserScript==
// @name         BOW-killfile
// @namespace    https://github.com/toothbrush/bow-killfile.gist
// @updateURL    https://raw.githubusercontent.com/toothbrush/bow-killfile.gist/main/BOW-killfile.user.js
// @downloadURL  https://raw.githubusercontent.com/toothbrush/bow-killfile.gist/main/BOW-killfile.user.js
// @version      0.73
// @description  block trolls
// @author       toothbrush
// @match        https://news.ycombinator.com/item*
// @match        https://news.ycombinator.com/news*
// @match        https://news.ycombinator.com/
// @match        https://hn.algolia.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM.xmlHttpRequest
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

/*
 * Killfile lives in a separate plain-text file in the same repo (killfile.txt),
 * NOT in this script. Every device reads it (unauthenticated, via raw.github);
 * only devices with a GitHub token configured can write back. Mobile is
 * intentionally read-only (no secrets there). Writes go through the Contents API
 * so each mute/unmute is a real commit with a descriptive message.
 *
 * To enable blocking on this device: Tampermonkey menu -> "Set GitHub token...".
 * Use a fine-grained PAT scoped to this repo's *Contents: read/write only*
 * (nothing else) with an expiry — if it ever leaks, the blast radius is "can edit
 * this repo" and no more. The token is stored in GM storage (sandboxed to this
 * script), never in the repo.
 */

const REPO = "toothbrush/bow-killfile.gist";
const BRANCH = "main";
const KILLFILE_FILENAME = "killfile.txt";
const RAW_URL = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${KILLFILE_FILENAME}`;
const API_URL = `https://api.github.com/repos/${REPO}/contents/${KILLFILE_FILENAME}`;
const CACHE_TTL_MS = 5 * 60 * 1000;

const TOKEN_KEY = "gh_gist_token";
const CACHE_KEY = "killfile_cache";
const CACHE_TS_KEY = "killfile_cache_ts";

let effectiveSet = new Set();

/* ---------- GM API shims ----------
 * Hosts vary in which GM_* APIs they expose. iOS Safari "Userscripts" provides
 * GM_xmlhttpRequest but NOT the sync GM_* storage/menu APIs (only async GM.*).
 * These wrappers degrade gracefully: a missing storage API just means "no
 * persistent cache on this device" rather than a ReferenceError that aborts the
 * whole script. Callers must therefore tolerate a storage miss — see
 * refreshIfStale, which applies fetched content directly instead of re-reading.
 */

function gmGet(key, def) {
    try { if (typeof GM_getValue === "function") return GM_getValue(key, def); } catch (e) {}
    return def;
}
function gmSet(key, val) {
    try { if (typeof GM_setValue === "function") GM_setValue(key, val); } catch (e) {}
}
function gmDelete(key) {
    try { if (typeof GM_deleteValue === "function") GM_deleteValue(key); } catch (e) {}
}
function gmXhr(details) {
    if (typeof GM_xmlhttpRequest === "function") return GM_xmlhttpRequest(details);
    if (typeof GM !== "undefined" && GM && GM.xmlHttpRequest) return GM.xmlHttpRequest(details);
    return null; // no cross-origin transport available; caller's onload simply never fires
}

/* ---------- token / write-capability ---------- */

function getToken() { return gmGet(TOKEN_KEY, ""); }
function canWrite() { return !!getToken(); }

/* ---------- killfile parsing & cache ---------- */

function parseKillfile(text) {
    const names = [];
    text.split("\n").forEach(function (raw) {
        const name = raw.replace(/#.*$/, "").trim(); // strip inline `# comment`
        if (name) names.push(name);
    });
    return names;
}

function cacheKillfile(content) {
    gmSet(CACHE_KEY, content);
    gmSet(CACHE_TS_KEY, Date.now());
}

function applyKillfile(content) {
    effectiveSet = new Set(parseKillfile(content));
    rebuildHideStyle();
}

function loadEffectiveSet() {
    applyKillfile(gmGet(CACHE_KEY, ""));
}

function refreshIfStale() {
    if (Date.now() - gmGet(CACHE_TS_KEY, 0) < CACHE_TTL_MS) return;
    gmXhr({
        method: "GET",
        url: RAW_URL,
        onload: function (res) {
            if (res.status >= 200 && res.status < 300) {
                cacheKillfile(res.responseText);
                applyKillfile(res.responseText); // use fetched content directly; storage may be a no-op (iOS)
            }
        },
    });
}

/* ---------- GitHub API (write path) ---------- */

function ghApi(method, body, cb) {
    gmXhr({
        method: method,
        url: API_URL,
        headers: {
            "Authorization": "Bearer " + getToken(),
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        data: body ? JSON.stringify(body) : undefined,
        onload: function (res) {
            if (res.status >= 200 && res.status < 300) {
                try { cb(null, JSON.parse(res.responseText)); }
                catch (e) { cb(new Error("bad JSON from GitHub")); }
            } else {
                cb(new Error("GitHub " + res.status));
            }
        },
        onerror: function () { cb(new Error("network error")); },
    });
}

// UTF-8-safe base64 (the Contents API ships file bodies base64-encoded, with
// newlines every 60 chars on the GET side that must be stripped before decode).
function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
function b64decode(b64) { return decodeURIComponent(escape(atob(b64.replace(/\n/g, "")))); }

// GET authoritative content+sha -> transform -> PUT with a commit message.
// transform returns null to skip the write. The PUT's optimistic-concurrency sha
// guards against clobbering a write from another device between GET and PUT.
function mutateGist(message, transform, cb) {
    ghApi("GET", null, function (err, file) {
        if (err) return cb(err);
        const content = file && file.content ? b64decode(file.content) : "";
        const newContent = transform(content);
        if (newContent === null) return cb(null);
        const body = {
            message: message,
            content: b64encode(newContent),
            branch: BRANCH,
        };
        if (file && file.sha) body.sha = file.sha; // omit only when creating the file
        ghApi("PUT", body, function (err2) {
            if (err2) return cb(err2);
            cacheKillfile(newContent); // we sent it; 2xx means it's authoritative
            cb(null);
        });
    });
}

function appendToGist(username, commentId, cb) {
    mutateGist("killfile.txt: Add " + username, function (content) {
        if (parseKillfile(content).includes(username)) return null;
        const note = commentId ? `  # https://news.ycombinator.com/item?id=${commentId}` : "";
        const newLine = username + note;
        const newKey = username.toLowerCase();

        const lines = content.split("\n");
        const isEntry = (line) => line.replace(/#.*$/, "").trim() !== "";
        const keyOf = (line) => line.replace(/#.*$/, "").trim().toLowerCase();

        // Insert in case-insensitive alphabetical order: before the first entry
        // that sorts after us, else right after the last entry (skipping any
        // header comments and trailing blank line).
        let insertAt = -1, lastEntry = -1;
        for (let i = 0; i < lines.length; i++) {
            if (!isEntry(lines[i])) continue;
            lastEntry = i;
            if (insertAt === -1 && keyOf(lines[i]) > newKey) insertAt = i;
        }
        if (insertAt === -1) insertAt = lastEntry + 1;
        lines.splice(insertAt, 0, newLine);
        return lines.join("\n");
    }, cb);
}

function removeFromGist(username, cb) {
    mutateGist("killfile.txt: Remove " + username, function (content) {
        return content.split("\n").filter(function (line) {
            return line.replace(/#.*$/, "").trim() !== username;
        }).join("\n");
    }, cb);
}

/* ---------- block / unblock ---------- */

function blockUser(username, commentId) {
    if (!username || effectiveSet.has(username)) return;
    effectiveSet.add(username);   // optimistic
    rebuildHideStyle();
    appendToGist(username, commentId, function (err) {
        if (err) {
            effectiveSet.delete(username); // revert: not actually synced
            rebuildHideStyle();
            showToast("⚠ couldn't killfile " + username + ": " + err.message);
        } else {
            showToast("Killfiled " + username, "undo", function () { unblockUser(username); });
        }
    });
}

function unblockUser(username) {
    removeFromGist(username, function (err) {
        if (err) { showToast("⚠ couldn't restore " + username + ": " + err.message); return; }
        effectiveSet.delete(username);
        rebuildHideStyle();
        showToast("Restored " + username);
    });
}

/* ---------- hiding (reversible: one rebuildable <style>) ---------- */

let hideStyleEl = null;

function rebuildHideStyle() {
    if (!hideStyleEl) {
        hideStyleEl = document.createElement("style");
        hideStyleEl.id = "bow-hide-style";
        document.head.appendChild(hideStyleEl);
    }
    const selectors = [];
    [].forEach.call(document.getElementsByClassName("athing"), function (thing) {
        const maybeUser = thing.getElementsByClassName("hnuser");
        if (maybeUser.length === 1 && thing.id) {
            const username = maybeUser[0].innerText || maybeUser[0].textContent;
            // CSS-escape the numeric id (https://mothereff.in/css-escapes)
            if (effectiveSet.has(username)) selectors.push(`#\\3${thing.id.charAt(0)} ${thing.id.slice(1)}`);
        }
    });
    hideStyleEl.textContent = selectors.length ? selectors.join(",\n") + " { display: none !important; }" : "";
}

/* ---------- mute buttons (write devices only) ---------- */

function addMuteButtons() {
    if (!canWrite()) return;
    [].forEach.call(document.getElementsByClassName("hnuser"), function (el) {
        if (el.getAttribute("data-bow-mute")) return;
        el.setAttribute("data-bow-mute", "1");
        const username = el.innerText || el.textContent;

        let node = el, commentId = null;
        while (node && node !== document.body) {
            if (node.classList && node.classList.contains("athing")) { commentId = node.id; break; }
            node = node.parentNode;
        }

        const link = document.createElement("a");
        link.textContent = "mute";
        link.href = "javascript:void(0)";
        link.title = "Killfile " + username;
        link.style.cssText = "cursor:pointer;";
        link.addEventListener("click", function (e) { e.preventDefault(); blockUser(username, commentId); });

        const wrap = document.createElement("span");
        wrap.style.cssText = "margin-left:4px;font-size:11px;";
        wrap.appendChild(document.createTextNode("["));
        wrap.appendChild(link);
        wrap.appendChild(document.createTextNode("]"));
        el.parentNode.insertBefore(wrap, el.nextSibling);
    });
}

/* ---------- toast / undo ---------- */

let toastEl = null, toastTimer = null;

function showToast(msg, actionLabel, actionFn) {
    if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);" +
            "z-index:2147483647;background:#222;color:#fff;padding:10px 14px;border-radius:6px;" +
            "font:14px/1.3 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);max-width:90vw;";
        document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg + " ";
    if (actionLabel && actionFn) {
        const a = document.createElement("a");
        a.textContent = actionLabel;
        a.href = "javascript:void(0)";
        a.style.cssText = "color:#6cf;margin-left:8px;cursor:pointer;font-weight:bold;";
        a.addEventListener("click", function (e) { e.preventDefault(); hideToast(); actionFn(); });
        toastEl.appendChild(a);
    }
    toastEl.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 6000);
}

function hideToast() { if (toastEl) toastEl.style.display = "none"; }

/* ---------- menu commands ---------- */

// Not every userscript host provides this (e.g. iOS Safari "Userscripts" has no
// menu UI). Guard so a missing API degrades gracefully instead of throwing at
// top level and aborting the whole script (styling/hiding included).
function registerMenu(label, fn) {
    if (typeof GM_registerMenuCommand === "function") GM_registerMenuCommand(label, fn);
}

registerMenu("Set GitHub token…", function () {
    const t = prompt("Fine-grained PAT, scoped to this repo's Contents: read/write ONLY. Blank to clear:", getToken());
    if (t === null) return;
    const trimmed = t.trim();
    if (!trimmed) { gmDelete(TOKEN_KEY); alert("Token cleared. Mute buttons hidden on this device."); return; }
    gmSet(TOKEN_KEY, trimmed);
    ghApi("GET", null, function (err, file) { // validate at entry, not every page load
        if (err) { alert("⚠ Token saved but validation failed: " + err.message); return; }
        const ok = file && file.content;
        alert(ok ? "Token works. Reload HN to see mute buttons."
                 : "Token works, but '" + KILLFILE_FILENAME + "' isn't in the repo yet — create it first.");
    });
});

registerMenu("Killfile a user…", function () {
    if (!canWrite()) { alert("Set a GitHub token first."); return; }
    const u = prompt("Username to killfile:");
    if (u && u.trim()) blockUser(u.trim(), null);
});

/* ---------- cosmetic styling (unchanged behavior, now null-guarded) ---------- */

function getElementByXpath(path) {
    return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}

function GM_addStyle(css) {
    const style = document.getElementById("GM_addStyleBy8626") || (function () {
        const s = document.createElement('style');
        s.type = 'text/css';
        s.id = "GM_addStyleBy8626";
        document.head.appendChild(s);
        return s;
    })();
    const sheet = style.sheet;
    sheet.insertRule(css, (sheet.rules || sheet.cssRules || []).length);
}

GM_addStyle(`.wrapper {
  background: linear-gradient(124deg, #ff2400, #e81d1d, #e8b71d, #e3e81d, #1de840, #1ddde8, #2b1de8, #dd00f3, #dd00f3);
  background-size: 100% 100%;
}`);
GM_addStyle(`::selection { color: black; background: yellow; }`);
GM_addStyle(`tr.spacer + tr.spacer { background: grey !important; display: none !important; }`);
GM_addStyle(`body { background: black !important; }`);

(function styleHeader() {
    const header = getElementByXpath('//*[@id="hnmain"]/tbody/tr/td');
    if (header) header.classList.add("wrapper");
    const mainTable = getElementByXpath('//*[@id="hnmain"]');
    if (mainTable) mainTable.style.backgroundColor = "#abffe6";
    const anotherHeader = getElementByXpath('//td[@bgcolor="#ff6600"]');
    if (anotherHeader) anotherHeader.classList.add("wrapper");
})();

/* ---------- one-time static hides: tweets + boring front-page topics ---------- */

const boring_topics = [
    "musk",
    "twitter",
];

(function staticHides() {
    [].forEach.call(document.getElementsByClassName("athing"), function (thing) {
        const comment_text = thing.getElementsByClassName("commtext");
        if (comment_text.length === 1) {
            const comment = (comment_text[0].innerText || comment_text[0].textContent);
            if (comment.length < 160 && thing.id) { // it's a tweet!
                GM_addStyle(`#\\3${thing.id.charAt(0)} ${thing.id.slice(1)} { background: red !important; display: none !important; }`);
            }
        }

        if (window.location.href === "https://news.ycombinator.com/news") {
            const title = thing.getElementsByClassName("titleline");
            if (title.length === 1) {
                const actual_title = (title[0].innerText || title[0].textContent);
                const is_boring = boring_topics.some(function (topic) {
                    return actual_title.toLowerCase().includes(topic.toLowerCase());
                });
                if (is_boring) {
                    console.log(`Ditching boring article: "${actual_title}"`);
                    const thing2 = thing.nextSibling;
                    thing.parentNode.removeChild(thing);
                    if (thing2) thing2.parentNode.removeChild(thing2);
                }
            }
        }
    });
})();

/* ---------- boot ---------- */

loadEffectiveSet();   // synchronous, from cache: hide immediately, no flash (also rebuilds the style)
addMuteButtons();
refreshIfStale();     // async: pull latest killfile.txt, re-apply

/* ---------- mutation observer: re-apply on HN re-renders + text replacement ---------- */

let reapplyTimer = null;
function scheduleReapply() {
    clearTimeout(reapplyTimer);
    reapplyTimer = setTimeout(function () { rebuildHideStyle(); addMuteButtons(); }, 200);
}

const replaceArry = [
    [/(h)acker *(n)ews/gi, 'Bad Orange Website'],
    [/['"“”‘’„”«»]hacker['"“”‘’„”«»] *news/gi, '"Bad" Orange Website'],
    [/\bHN\b/g, 'BOW'],
    [/a couple(?! of)/g, 'a couple of'],
    [/\bcloud\b/g, "other people's computer"],
    [/\bCloud\b/g, "Other People's Computer"],
    [/\bGPT\b/g, 'Magic'],
    [/\bAI\b/g, 'MAGIC'],
    [/\bOpenAI\b/gi, 'Open Art Thieves'],
    [/\b(an? )?LLM\b/g, 'pixie dust'],
];

function mutationHandler() {
    scheduleReapply();

    for (let J = 0; J < replaceArry.length; J++) {
        document.title = document.title.replace(replaceArry[J][0], replaceArry[J][1]);
    }
    const txtWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
            return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
    }, false);
    let txtNode;
    while ((txtNode = txtWalker.nextNode())) {
        let oldTxt = txtNode.nodeValue;
        for (let K = 0; K < replaceArry.length; K++) {
            oldTxt = oldTxt.replace(replaceArry[K][0], replaceArry[K][1]);
        }
        txtNode.nodeValue = oldTxt;
    }
}

mutationHandler();

const myObserver = new MutationObserver(mutationHandler);
myObserver.observe(document.body, {
    childList: true,
    attributes: true,
    subtree: true,
    attributeFilter: ['class'],
});
