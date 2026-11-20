import { ChaticAppsError, connect } from '@lemoncloud/chatic-apps-sdk';
import { installChaticAppsMock, type MockPermission } from '@lemoncloud/chatic-apps-sdk/mock';

import manifest from '../public/.well-known/chatic-app.json';
import { startApp } from './app';
import { mockData } from './mockData';
import './style.css';

const root = document.getElementById('app') as HTMLElement;

// The board is as tall as what is visible: with the keyboard up that is the part above it, so the dock with
// the input and my words sits right on the keyboard instead of behind it. iOS reports the keyboard only
// through `visualViewport`; Android resizes the window as well, which the same numbers follow.
const viewport = window.visualViewport;
const fit = () => {
    const style = document.documentElement.style;
    style.setProperty('--app-h', `${viewport ? viewport.height : window.innerHeight}px`);
    style.setProperty('--app-top', `${viewport ? viewport.offsetTop : 0}px`);
};
viewport?.addEventListener('resize', fit);
viewport?.addEventListener('scroll', fit);
window.addEventListener('resize', fit);
fit();
// WebKit's pinch gesture ignores `user-scalable=no` in some hosts; refusing it here keeps the page at 1x.
document.addEventListener('gesturestart', event => event.preventDefault());

async function main() {
    // The stand-in for the app, in the browser during development only: a production build drops it.
    if (import.meta.env.DEV) {
        const app = installChaticAppsMock({ permissions: manifest.permissions as MockPermission[], data: mockData });
        Object.assign(window, { app }); // `app.pressBack()`, `app.sentMessages` … in the console
    }
    try {
        startApp(await connect(), root);
    } catch (error) {
        const needsUpdate = error instanceof ChaticAppsError && error.code === 'UNSUPPORTED_PROTOCOL';
        root.textContent = needsUpdate ? 'DoU 앱을 업데이트해 주세요.' : '시작하지 못했어요.';
        root.dataset.state = 'failed';
    }
}

void main();
