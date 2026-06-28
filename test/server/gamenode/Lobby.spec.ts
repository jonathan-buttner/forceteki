import { Lobby } from '../../../server/gamenode/Lobby';

describe('Lobby', function () {
    function makeSocket(liveSimulationState?: string) {
        return {
            socket: {
                connected: true,
                handshake: { query: liveSimulationState === undefined ? {} : { liveSimulationState } }
            },
            send: jasmine.createSpy('send')
        };
    }

    function makeGame() {
        return {
            getState: (userId: string) => ({ userId, state: 'game-state' })
        };
    }

    it('does not throw while updating stats when game-end player metadata is missing', async function () {
        const fakeLobby = {
            id: 'lobby-1',
            swuStatsEnabled: false,
            swuBaseEnabled: false,
            sendStatsMessageToUser: jasmine.createSpy('sendStatsMessageToUser')
        };
        const fakeGame = {
            id: 'game-1',
            getPlayers: () => [
                { id: 'player-1', name: 'Player 1', lobbyUser: {}, lobbyDeck: {} },
                { id: 'player-2', name: 'Player 2', lobbyUser: undefined, lobbyDeck: {} },
            ]
        };

        await expectAsync((Lobby.prototype as any).endGameUpdateStatsAsync.call(fakeLobby, fakeGame)).toBeResolved();

        expect(fakeLobby.sendStatsMessageToUser).toHaveBeenCalledTimes(2);
    });

    it('sends live simulation state only to opted-in player sockets', function () {
        const optedInSocket = makeSocket('true');
        const normalSocket = makeSocket();
        const simulationState = { currentPlayerId: 'player-1', legalActions: [1] };
        const fakeLobby = Object.assign(Object.create(Lobby.prototype), {
            _id: 'lobby-1',
            users: [
                { id: 'player-1', socket: optedInSocket },
                { id: 'player-2', socket: normalSocket },
            ],
            spectators: [],
            safeSetUserConnected: jasmine.createSpy('safeSetUserConnected'),
            exportLiveSimulationState: jasmine.createSpy('exportLiveSimulationState').and.returnValue(simulationState),
        });

        (Lobby.prototype as any).sendGameState.call(fakeLobby, makeGame() as any);

        expect(optedInSocket.send).toHaveBeenCalledWith('gamestate', { userId: 'player-1', state: 'game-state' }, jasmine.any(Function));
        expect(optedInSocket.send).toHaveBeenCalledWith('simulationstate', simulationState);
        expect(normalSocket.send).toHaveBeenCalledWith('gamestate', { userId: 'player-2', state: 'game-state' }, jasmine.any(Function));
        expect(normalSocket.send).not.toHaveBeenCalledWith('simulationstate', simulationState);
        expect(fakeLobby.exportLiveSimulationState).toHaveBeenCalledTimes(1);
    });

    it('exports live simulation state once per send cycle for opted-in sockets', function () {
        const firstSocket = makeSocket('true');
        const secondSocket = makeSocket('true');
        const simulationState = { currentPlayerId: 'player-1', legalActions: [1] };
        const fakeLobby = Object.assign(Object.create(Lobby.prototype), {
            _id: 'lobby-1',
            users: [
                { id: 'player-1', socket: firstSocket },
                { id: 'player-2', socket: secondSocket },
            ],
            spectators: [],
            safeSetUserConnected: jasmine.createSpy('safeSetUserConnected'),
            exportLiveSimulationState: jasmine.createSpy('exportLiveSimulationState').and.returnValue(simulationState),
        });

        (Lobby.prototype as any).sendGameState.call(fakeLobby, makeGame() as any);

        expect(firstSocket.send).toHaveBeenCalledWith('simulationstate', simulationState);
        expect(secondSocket.send).toHaveBeenCalledWith('simulationstate', simulationState);
        expect(fakeLobby.exportLiveSimulationState).toHaveBeenCalledTimes(1);
    });

    it('does not send live simulation state when no actionable player is available', function () {
        const optedInSocket = makeSocket('true');
        const fakeLobby = Object.assign(Object.create(Lobby.prototype), {
            _id: 'lobby-1',
            users: [{ id: 'player-1', socket: optedInSocket }],
            spectators: [],
            safeSetUserConnected: jasmine.createSpy('safeSetUserConnected'),
            exportLiveSimulationState: jasmine.createSpy('exportLiveSimulationState').and.throwError('No actionable player is available'),
        });

        (Lobby.prototype as any).sendGameState.call(fakeLobby, makeGame() as any);

        expect(optedInSocket.send).toHaveBeenCalledWith('gamestate', { userId: 'player-1', state: 'game-state' }, jasmine.any(Function));
        expect(optedInSocket.send).not.toHaveBeenCalledWith('simulationstate', jasmine.anything());
    });
});
