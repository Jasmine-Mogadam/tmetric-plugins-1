﻿type FileOrCode = { file: string, code: never } | { code: string, file: never };

type RegisteredContentScriptOptions = browser.contentScripts.RegisteredContentScriptOptions;

type RegistrationCallback = Function;

type RegisteredContentScript = browser.contentScripts.RegisteredContentScript;

declare namespace chrome.contentScripts {
    const register: (contentScriptOptions: RegisteredContentScriptOptions, callback?: RegistrationCallback) => Promise<RegisteredContentScript>;
}

if (typeof chrome === 'object' && !chrome.contentScripts) {

    const contentScriptOptionsStore: { matches: RegExp, options: RegisteredContentScriptOptions }[] = [];

    const getContentScriptOptions = function (url: string, frameUrl?: string) {
        return contentScriptOptionsStore
            .filter(i => i.matches.test(url) && (frameUrl ? i.matches.test(frameUrl) : true))
            .map(i => i.options);
    }

    const getRawRegex = function (matchPattern) {
        return '^' + matchPattern
            .replace(/[\-\/\\\^\$\+\?\.\(\)\|\[\]\{\}]/g, '\\$&')
            .replace(/\*/g, '.*');
    }

    const patternToRegex = function (...matchPatterns: string[]) {
        return new RegExp(matchPatterns.map(getRawRegex).join('|'), 'i');
    }

    const isOriginPermitted = async function(url) {
        return new Promise((resolve, reject) => {
            chrome.permissions.contains({ origins: [new URL(url).origin + '/*'] }, resolve);
        });
    }

    const getInjectedScripts = function () {

        let scripts = document['tmetricContentScripts'] || {};

        let message = <ITabMessage>{
            action: 'injectContentScripts',
            data: scripts
        };

        chrome.runtime.sendMessage(message);
    }

    const setInjectedScript = function (file: string) {
        let scripts = document['tmetricContentScripts'] || {};
        scripts[file] = true;
        document['tmetricContentScripts'] = scripts;
    }

    const injectCss = function (tabId, frameId, file) {
        console.log({ tabId, frameId, file })
        chrome.tabs.insertCSS(tabId, { frameId, file }, result => {
            console.log({ tabId, frameId, file, result })
            chrome.tabs.executeScript(tabId, { frameId, code: `(${setInjectedScript.toString()})('${file}')`, runAt: 'document_end' });
        });
    }

    const injectJs = function (tabId, frameId, file) {
        console.log({ tabId, frameId, file })
        chrome.tabs.executeScript(tabId, { frameId, file }, result => {
            console.log({ tabId, frameId, file, result })
            chrome.tabs.executeScript(tabId, { frameId, code: `(${setInjectedScript.toString()})('${file}')`, runAt: 'document_end' });
        });
    }

    const injectContentScripts = function ({ id, url }: chrome.tabs.Tab, frameId: number, frameUrl: string, injectedScripts: {}) {

        console.log({ url, frameId, frameUrl, injectedScripts });

        const isFrame = frameId > 0;

        getContentScriptOptions(url, frameUrl).forEach(options => {

            if (isFrame && !options.allFrames) {
                return;
            }

            (options.css || []).forEach(({ file }: FileOrCode) => !injectedScripts[file] && injectCss(id, frameId, file));
            (options.js || []).forEach(({ file }: FileOrCode) => !injectedScripts[file] && injectJs(id, frameId, file));
        });
    }

    const addTabListener = function () {
        chrome.tabs.onUpdated.addListener(async (tabId, { status, url }, tab) => {

            console.log(tabId, status, url, tab.url)

            if (status !== 'complete') {
                return;
            }

            if (!tab || !tab.url || !['http:', 'https:'].some(protocol => tab.url.startsWith(protocol))) {
                console.log('no tab')
                return;
            }

            if (!await isOriginPermitted(tab.url)) {
                console.log('no permission')
                return;
            }

            const options = getContentScriptOptions(tab.url);
            if (!options.length) {
                console.log('no options')
                return;
            }

            chrome.tabs.executeScript(tab.id, { code: `(${getInjectedScripts.toString()})()`, allFrames: true, runAt: 'document_end' });
        });
    }

    const addMessageListener = function () {
        chrome.runtime.onMessage.addListener((message: ITabMessage, sender, senderResponse) => {

            console.log(message, sender)

            if (!sender.tab) {
                return;
            }

            if (message.action == 'injectContentScripts') {
                injectContentScripts(sender.tab, sender.frameId, sender.url, message.data);
                senderResponse(null);
            }
        });
    }

    addTabListener();
    addMessageListener();

    chrome.contentScripts = {

        async register(contentScriptOptions, callback) {

            const { matches } = contentScriptOptions;
            const matchesRegex = patternToRegex(...matches);
            const item = { matches: matchesRegex, options: contentScriptOptions };

            contentScriptOptionsStore.push(item);

            const registeredContentScript = {
                async unregister() {
                    const index = contentScriptOptionsStore.indexOf(item);
                    if (index > -1) {
                        contentScriptOptionsStore.splice(index, 1);
                    }
                }
            };

            if (typeof callback === 'function') {
                callback(registeredContentScript);
            }

            return Promise.resolve(registeredContentScript);
        }
    };
}
