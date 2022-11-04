// ==UserScript==
// @name         BOW killfile
// @namespace    https://gist.github.com/toothbrush/364c15ec7192e60ffd94576773c4b99c
// @updateURL    https://gist.githubusercontent.com/toothbrush/364c15ec7192e60ffd94576773c4b99c/raw/BOW-killfile.user.js
// @downloadURL  https://gist.githubusercontent.com/toothbrush/364c15ec7192e60ffd94576773c4b99c/raw/BOW-killfile.user.js
// @version      0.20
// @description  block trolls
// @author       toothbrush
// @match        https://news.ycombinator.com/item*
// @match        https://news.ycombinator.com/news*
// @match        https://news.ycombinator.com/
// @match        https://hn.algolia.com/*
// @run-at       document-idle
// ==/UserScript==

const killfile = [
    "AmericanChopper",
    "AnhTho_FR", // commercial spam
    "alephnan",
    "anotherman554",
    "Banana699", // doesn't like Lisp
    "barry-cotter",
    "burrows",
    "bushbaba",
    "CamperBob",
    "CamperBob2",
    "chrisseaton",
    "coolso",
    "dixie_land",
    "germandiago",
    "GoblinSlayer",
    "Jensson",
    "jack_pp",
    "hellbannedguy",
    "iambateman",
    "logicchains",
    "loudthing",
    "metadat",
    "nilespotter",
    "onemiketwelve",
    "onlyrealcuzzo",
    "padolsey",
    "quantumBerry",
    "RadixDLT",
    "raydiatian",
    "recuter",
    "redis-mic",
    "refulgentis",
    "rStar",
    "SemanticStrengh",
    "Terry_Roll",
    "thegrimmest",
    "thrown_22",
    "vmception",
    "wara23arish",
    "white_dragon88",
    "wyager",
    "xanaxagoras",
    "zackees",
];

const boring_topics = [
    "musk",
    "twitter",
];

function getElementByXpath(path) {
    return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}

// I dunno, maybe this is more portable. Hm.
function GM_addStyle(css) {
  const style = document.getElementById("GM_addStyleBy8626") || (function() {
    const style = document.createElement('style');
    style.type = 'text/css';
    style.id = "GM_addStyleBy8626";
    document.head.appendChild(style);
    return style;
  })();
  const sheet = style.sheet;
  sheet.insertRule(css, (sheet.rules || sheet.cssRules || []).length);
}

GM_addStyle(`.wrapper {
  background: linear-gradient(124deg, #ff2400, #e81d1d, #e8b71d, #e3e81d, #1de840, #1ddde8, #2b1de8, #dd00f3, #dd00f3);
  background-size: 100% 100%;
}`)

/* Make downvoted posts visible if i want */
GM_addStyle(`::selection {
  color: black;
  background: yellow;
}`)

let header = getElementByXpath('//*[@id="hnmain"]/tbody/tr/td');
header.classList.add("wrapper");
let mainTable = getElementByXpath('//*[@id="hnmain"]');
mainTable.style.backgroundColor = "#abffe6";

(function() {
    'use strict';

    var athings = document.getElementsByClassName("athing");

    [].forEach.call(athings, function (thing) {
        //console.log(thing.id);
        var maybeUser = thing.getElementsByClassName("hnuser");

        if(maybeUser.length == 1) {
            var username = maybeUser[0].innerHTML;
            if(killfile.includes(username)) {
                // block them!
                // also omg https://mothereff.in/css-escapes
                var style_rule = `#\\3${thing.id.charAt(0)} ${thing.id.slice(1)} { background: purple !important; display: none !important; }`;
                GM_addStyle(style_rule);
                //thing.parentNode.removeChild(thing);
            };
        };

        var comment_text = thing.getElementsByClassName("commtext");
        if(comment_text.length == 1) {
            var comment = (comment_text[0].innerText || comment_text[0].textContent);
            if(comment.length < 160) {
                // it's a tweet!
                style_rule = `#\\3${thing.id.charAt(0)} ${thing.id.slice(1)} { background: red !important; display: none !important; }`;
                GM_addStyle(style_rule);
            };
        };

        if(window.location.href == "https://news.ycombinator.com/news") {
            // home page, hide things differently
            var title = thing.getElementsByClassName("titleline");
            if(title.length == 1) {
                var actual_title = (title[0].innerText || title[0].textContent);

                var is_boring = false;
                [].forEach.call(boring_topics, function (topic) {
                    if(actual_title.toLowerCase().includes(topic.toLowerCase())) {
                        is_boring = true;
                    }
                });

                if(is_boring) {
                    console.log(`Ditching boring article: "${actual_title}"`);
                    var thing1 = thing
                    var thing2 = thing.nextSibling
                    thing1.parentNode.removeChild(thing1);
                    thing2.parentNode.removeChild(thing2);
                };
            };
        };
    });
})();

mutationHandler();

var MutationObserver = window.MutationObserver;
var myObserver = new MutationObserver (mutationHandler);
var obsConfig = {
    childList: true,
    attributes: true,
    subtree: true,
    attributeFilter: ['class'],
};

myObserver.observe(document.body, obsConfig);

function mutationHandler (mutationRecords) {

    console.log("Attempting to correct Hacker News title");
    // https://stackoverflow.com/a/24419809 - Replace many text terms, using Tampermonkey, without affecting URLs and not looking for classes or ids
    var replaceArry = [
        [/(h)acker *(n)ews/gi, 'Bad Orange Website'],
        [/['"“”‘’„”«»]hacker['"“”‘’„”«»] *news/gi, '"Bad" Orange Website'],
        [/\bHN\b/g, 'BOW'],
        [/a couple(?! of)/g, 'a couple of'],
        // etc.
    ];
    var numTerms = replaceArry.length;
    var txtWalker = document.createTreeWalker (
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function (node) {
                // -- Skip whitespace-only nodes
                if (node.nodeValue.trim()) {
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_SKIP;
            }
        },
        false
    );
    var txtNode = null;

    while (txtNode = txtWalker.nextNode() ) {
        var oldTxt = txtNode.nodeValue;

        for (var J = 0; J < numTerms; J++) {
            oldTxt = oldTxt.replace(replaceArry[J][0], replaceArry[J][1]);
        }
        txtNode.nodeValue = oldTxt;
    }
}
