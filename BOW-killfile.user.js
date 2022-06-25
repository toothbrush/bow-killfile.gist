// ==UserScript==
// @name         HN killfile
// @namespace    https://gist.github.com/toothbrush/364c15ec7192e60ffd94576773c4b99c
// @updateURL    https://gist.githubusercontent.com/toothbrush/364c15ec7192e60ffd94576773c4b99c/raw/BOW-killfile.user.js
// @downloadURL  https://gist.githubusercontent.com/toothbrush/364c15ec7192e60ffd94576773c4b99c/raw/BOW-killfile.user.js
// @version      0.6
// @description  block trolls
// @author       toothbrush
// @match        https://news.ycombinator.com/item*
// @match        https://news.ycombinator.com/news*
// @match        https://news.ycombinator.com/
// @match        https://hn.algolia.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

const killfile = [
    "AnhTho_FR", // commercial spam
    "alephnan",
    "anotherman554",
    "burrows",
    "CamperBob",
    "CamperBob2",
    "chrisseaton",
    "coolso",
    "dixie_land",
    "germandiago",
    "Jensson",
    "jack_pp",
    "hellbannedguy",
    "iambateman",
    "logicchains",
    "loudthing",
    "metadat",
    "onemiketwelve",
    "quantumBerry",
    "RadixDLT",
    "recuter",
    "redis-mic",
    "refulgentis",
    "rStar",
    "SemanticStrengh",
    "Terry_Roll",
    "thegrimmest",
    "vmception",
    "xanaxagoras",
];

function getElementByXpath(path) {
  return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}

var gradient_css = `
.wrapper {
background: linear-gradient(124deg, #ff2400, #e81d1d, #e8b71d, #e3e81d, #1de840, #1ddde8, #2b1de8, #dd00f3, #dd00f3);
background-size: 100% 100%;
`;
GM_addStyle(gradient_css);
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
            //console.log(username);
            if(killfile.includes(username)) {
                // block them!
                // also omg https://mothereff.in/css-escapes
                var style_rule = `#\\3${thing.id.charAt(0)} ${thing.id.slice(1)} { background: purple !important; display: none !important; }`;
                GM_addStyle(style_rule);
                //thing.parentNode.removeChild(thing);
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
        [/\bHN\b/g, 'BOW'],
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
