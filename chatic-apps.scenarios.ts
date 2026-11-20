import { mockData } from './src/mockData';

/** The screens the verifier walks with the mock: the room list, then one room's board. */
export default {
    data: mockData,
    // Drawn in every state, also when the user refuses the cloud's data.
    ready: '#app[data-state="ready"]',
    screens: [
        { name: 'board', open: ['[data-action="room"]'] },
        { name: 'help', open: ['[data-action="help"]'] },
    ],
    actions: [],
};
