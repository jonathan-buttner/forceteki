import { Lobby } from '../../../server/gamenode/Lobby';

describe('Lobby', function () {
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
});
