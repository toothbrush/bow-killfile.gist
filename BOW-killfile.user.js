// ==UserScript==
// @name         BOW-killfile
// @namespace    https://github.com/toothbrush/bow-killfile.gist
// @updateURL    https://raw.githubusercontent.com/toothbrush/bow-killfile.gist/main/BOW-killfile.user.js
// @downloadURL  https://raw.githubusercontent.com/toothbrush/bow-killfile.gist/main/BOW-killfile.user.js
// @version      0.79
// @description  block trolls
// @author       toothbrush
// @match        https://news.ycombinator.com/item*
// @match        https://news.ycombinator.com/news*
// @match        https://news.ycombinator.com/
// @match        https://hn.algolia.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM.xmlHttpRequest
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @require      https://raw.githubusercontent.com/toothbrush/userscript-lib.gist/v4/synced-list.js
// @require      https://raw.githubusercontent.com/toothbrush/userscript-lib.gist/v4/no-hscroll.js
// @run-at       document-idle
// ==/UserScript==

/*
 * Killfile lives in a separate plain-text file in the same repo (killfile.txt),
 * NOT in this script. Every device reads it (unauthenticated, via raw.github);
 * only devices with a GitHub token configured can write back. Mobile is
 * intentionally read-only (no secrets there). Writes go through the Contents API
 * so each mute/unmute is a real commit with a descriptive message.
 *
 * The plumbing for all that (GM shims, raw.github read, Contents API write,
 * toast, token menu) is synced-list.js, shared with ennicen-guardian and
 * loaded with @require. Hosts cache a @require by URL, so it is pinned to a
 * tag; a library change is a new tag and a bump here.
 *
 * To enable blocking on this device: Tampermonkey menu -> "Set GitHub token...".
 * Use a fine-grained PAT scoped to this repo's *Contents: read/write only*
 * (nothing else) with an expiry — if it ever leaks, the blast radius is "can edit
 * this repo" and no more. The token is stored in GM storage (sandboxed to this
 * script), never in the repo.
 */

const killfile = new SyncedFile({
    repo: "toothbrush/bow-killfile.gist",
    file: "killfile.txt",
    cacheKey: "killfile_cache",   // the keys older versions used, so a device keeps its cache
    tokenKey: "gh_gist_token",    // and its token across the move to the library
    tag: "bow",
});

let effectiveSet = new Set();

function canWrite() { return killfile.canWrite(); }

/* ---------- killfile: one username per line, `# note` allowed ---------- */

function applyKillfile(content) {
    effectiveSet = new Set(parseLines(content));
    rebuildHideStyle();
}

// Insert in case-insensitive alphabetical order: before the first entry that
// sorts after us, else right after the last entry (skipping header comments
// and any trailing blank line). Each mute is one commit.
function appendToGist(username, commentId, cb) {
    killfile.mutate("killfile.txt: Add " + username, function (content) {
        if (parseLines(content).includes(username)) return null;
        const note = commentId ? `  # https://news.ycombinator.com/item?id=${commentId}` : "";
        const newLine = username + note;
        const newKey = username.toLowerCase();
        const lines = content.split("\n");
        let insertAt = -1, lastEntry = -1;
        for (let i = 0; i < lines.length; i++) {
            const key = stripComment(lines[i]).toLowerCase();
            if (!key) continue;
            lastEntry = i;
            if (insertAt === -1 && key > newKey) insertAt = i;
        }
        if (insertAt === -1) insertAt = lastEntry + 1;
        lines.splice(insertAt, 0, newLine);
        return lines.join("\n");
    }, cb);
}

function removeFromGist(username, cb) {
    killfile.removeLine(username, "killfile.txt: Remove " + username, cb);
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

/* ---------- menu commands ---------- */

killfile.registerTokenMenu(); // "Set GitHub token…", validated at entry

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
// Synthesised dark mode: HN is light-only. Everything inverts, including the
// root background and the black body, so both are set to white here.
GM_addStyle(`@media (prefers-color-scheme: dark) { html { filter: invert(1) hue-rotate(180deg); background: #fff; } body { background: white !important; } }`);
GM_addStyle(`@media (prefers-color-scheme: dark) { img, picture, video, iframe { filter: invert(1) hue-rotate(180deg); } }`);

/* ---------- kill horizontal scroll ---------- */

// The viewport itself is pinned by no-hscroll.js (@require).
// HN forces min-width 796px on desktop.
GM_addStyle(`#hnmain { min-width: 0 !important; max-width: 100% !important; }`);
// Deep threads: cap indent spacer width.
GM_addStyle(`td.ind img { max-width: 30vw !important; }`);
// HN mobile makes links nowrap; wrap instead.
GM_addStyle(`table.comment-tree .comment a { display: inline !important; max-width: none !important; white-space: normal !important; }`);
GM_addStyle(`.comment, .commtext, .comhead, .title, .subtext, .toptext, .pagetop { overflow-wrap: anywhere; }`);
GM_addStyle(`pre { max-width: 100% !important; }`);

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

killfile.load(applyKillfile);   // from cache now (no flash), fresh killfile.txt when stale
addMuteButtons();

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
    [/\ban AI\b/g, 'a MAGIC'],
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
