import { ChaticAppsError, connect } from '@lemoncloud/chatic-apps-sdk';
import { installChaticAppsMock, type MockPermission } from '@lemoncloud/chatic-apps-sdk/mock';

import manifest from '../public/.well-known/chatic-app.json';
import { startApp } from './app';
import { mockData } from './mockData';
import './style.css';

const root = document.getElementById('app') as HTMLElement;

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
