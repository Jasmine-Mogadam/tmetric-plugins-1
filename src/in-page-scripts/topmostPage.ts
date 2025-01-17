﻿if (typeof document !== 'undefined') {

    const sendBackgroundMessage = (message: ITabMessage) => {
        chrome.runtime.sendMessage(message, response => {
            const error = chrome.runtime.lastError;

            // Background page is not loaded yet
            if (error) {
                console.log(`${message.action}: ${JSON.stringify(error, null, '  ')}`)
            }
        });
    }

    const popupId = 'tmetric-popup';

    let constants: Models.Constants;

    let framesetRows: string;
    let framesetCols: string;

    const showPopup = () => {

        if (document.querySelector('#' + popupId)) {
            return;
        }

        const body = document.body;
        const isFrameSet = body.tagName == 'FRAMESET';
        let refChild = null as Node;
        const frame = document.createElement(isFrameSet ? 'frame' : 'iframe');

        frame.id = popupId;
        frame.src = `${constants.browserSchema}://${constants.extensionUUID}/popup/popup.html?integration`;

        if (isFrameSet) {

            // Hide all other frames in frameset (TE-278)
            framesetRows = body.getAttribute('rows');
            framesetCols = body.getAttribute('cols');
            body.removeAttribute('cols');
            body.setAttribute('rows', '*');
            refChild = body.firstChild;
        } else {

            // Show iframe at front of content
            Object.assign(frame.style, {
                position: 'fixed',
                zIndex: 999999,
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                display: 'block'
            });
        }

        body.insertBefore(frame, refChild);
    }

    const hidePopup = () => {
        const popupFrame = document.querySelector('#' + popupId);
        if (popupFrame) {
            popupFrame.remove();

            // Restore frames in frameset
            if (framesetRows != null) {
                document.body.setAttribute('rows', framesetRows)
            } else {
                document.body.removeAttribute('rows');
            }
            if (framesetCols != null) {
                document.body.setAttribute('cols', framesetCols)
            }
        }
    }

    chrome.runtime.onMessage.addListener((message: ITabMessage) => {

        switch (message.action) {

            case 'showPopup':
                showPopup();
                break;

            case 'hidePopup':
                hidePopup();
                break;

            case 'setConstants':
                constants = message.data;
                break;

            // Only for Firefox to inject scripts in right order
            case 'initPage':
                sendBackgroundMessage({ action: 'getConstants' });
                break;

            // Only for Firefox to show error alerts
            case 'error':
                const a = alert; // prevent strip in release;
                a(constants.extensionName + '\n\n' + message.data.message);
                break;
        }
    });

    sendBackgroundMessage({ action: 'getConstants' });
}