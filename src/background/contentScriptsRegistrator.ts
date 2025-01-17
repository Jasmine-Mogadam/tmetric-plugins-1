﻿class ContentScriptsRegistrator {

    private static instance: ContentScriptsRegistrator;

    constructor() {

        if (!ContentScriptsRegistrator.instance) {

            ContentScriptsRegistrator.instance = this;

            chrome.permissions.onAdded.addListener(event => this.register(event.origins));
            chrome.permissions.onRemoved.addListener(event => this.unregister(event.origins));
        }

        return ContentScriptsRegistrator.instance;
    }

    private scripts: { [serviceUrl: string]: RegisteredContentScript[] } = {};

    private addRequiredScriptOptions(scripts: RegisteredContentScriptOptions) {

        const js: FileOrCode[] = [
            { file: 'in-page-scripts/utils.js' },
            { file: 'in-page-scripts/integrationService.js' },
            { file: 'in-page-scripts/page.js' },
            ...(scripts.js || []),
            { file: 'in-page-scripts/init.js' }
        ];

        const css: FileOrCode[] = [
            { file: 'css/timer-link.css' },
            ...(scripts.css || [])
        ];

        const origins = Object.keys(scripts.matches.reduce(
            (map, url) => (map[WebToolManager.toOrigin(url)] = true) && map,
            {} as { [origin: string]: boolean }));

        return [
            {
                matches: scripts.matches,
                js: js,
                css: css,
                allFrames: scripts.allFrames || false,
                runAt: 'document_end'
            },
            {
                matches: origins,
                js: [
                    { file: 'in-page-scripts/topmostPage.js' }
                ],
                allFrames: false,
                runAt: scripts.runAt
            }
        ] as RegisteredContentScriptOptions[];
    }

    async register(origins?: string[]) {

        console.log('ContentScriptsRegistrator.register origins', origins)

        await this.unregister(origins);

        const serviceTypes = await WebToolManager.getServiceTypes();
        const serviceTypeUrls = Object.keys(serviceTypes);
        const serviceTypeUrlRegExps = serviceTypeUrls.reduce((map, url) => (map[url] = WebToolManager.toUrlRegExp(url)) && map, {} as { [serviceUrl: string]: RegExp });

        const webToolDescriptions = getWebToolDescriptions().reduce((map, item) => (map[item.serviceType] = item) && map, {} as { [serviceType: string]: WebToolDescription });

        let serviceUrls = serviceTypeUrls;

        // filter by passed origins
        if (origins) {
            serviceUrls = serviceUrls.filter(url => origins.some(origin => WebToolManager.isMatch(url, origin)));
        }

        // filter non overlapped urls
        serviceUrls = serviceUrls.filter(a => {
            return serviceTypeUrls.every(b => {
                return b == a // same url 
                    || serviceTypes[b] != serviceTypes[a] // another service type url
                    || !serviceTypeUrlRegExps[b].test(a) // non overlapped url
            });
        });

        // filter permitted urls
        serviceUrls = (await Promise.all(
            serviceUrls.map(
                serviceUrl => new Promise<string>(
                    resolve => chrome.permissions.contains({ origins: [serviceUrl] }, result => resolve(result ? serviceUrl : null))
                )
            )
        )).filter(item => !!item);

        console.log('ContentScriptsRegistrator.register serviceUrls', serviceUrls)

        serviceUrls.forEach(async serviceUrl => {

            const serviceType = serviceTypes[serviceUrl];

            const webToolDescription = webToolDescriptions[serviceType];
            if (!webToolDescription || !webToolDescription.scripts) {
                return;
            }

            const scripts = webToolDescription.scripts;

            const matches = [ serviceUrl ];

            const options: RegisteredContentScriptOptions = {
                allFrames: scripts.allFrames,
                js: (scripts.js || []).map(file => ({ file })),
                css: (scripts.css || []).map(file => ({ file })),
                matches: matches
            };

            const scriptsOptions = this.addRequiredScriptOptions(options);

            this.scripts[serviceUrl] = [... await Promise.all(scriptsOptions.map(this.registerInternal))];

            this.checkContentScripts(matches, scripts.allFrames);
        });
    }

    async unregister(origins?: string[]) {

        console.log('ContentScriptsRegistrator.unregister origins', origins)

        const serviceUrls = Object.keys(this.scripts).filter(url => origins ? origins.some(origin => WebToolManager.isMatch(url, origin)) : true);

        serviceUrls.forEach(serviceUrl => {
            const script = this.scripts[serviceUrl];
            if (!script) {
                return;
            }
            script.forEach(s => s.unregister());
            delete this.scripts[serviceUrl];
        });
    }

    private registerInternal(options: RegisteredContentScriptOptions) {

        let method: (options: RegisteredContentScriptOptions) => Promise<RegisteredContentScript>;

        if (typeof browser === 'object' && browser.contentScripts) {
            method = browser.contentScripts.register;
        } else if (typeof chrome === 'object' && chrome.contentScripts) {
            method = chrome.contentScripts.register;
        } else {
            method = (options) => Promise.resolve({ unregister: () => undefined });
        }

        return method(options);
    }

    private checkContentScripts(matches: string[], allFrames: boolean) {

        console.log('checkContentScripts', { matches, allFrames })

        if (typeof browser === 'object' && browser.contentScripts) {
           // browser.contentScripts inject scripts only to new pages
        } else if (typeof chrome === 'object' && chrome.contentScripts) {
            chrome.tabs.query({ url: matches, status: 'complete' }, tabs => {
                tabs.forEach(tab => {

                    console.log('checkContentScripts', tab.id, tab.url)

                    chrome.tabs.executeScript(tab.id, {
                        code: `chrome.runtime.sendMessage({action:'checkContentScripts'})`,
                        allFrames
                    });
                });
            });
        }
    }
}
