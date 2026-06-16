import { BoundedSimulationGameChat, SimulationBoundary } from '../../../server/game/simulation';

describe('SimulationBoundary', function() {
    integration(function(contextRef) {
        beforeEach(function() {
            return contextRef.setupTestAsync({
                phase: 'action',
                player1: {
                    hand: ['battlefield-marine'],
                    resources: 3
                }
            });
        });

        it('exports compact state and legal decisions without UI state summaries', function() {
            const { context } = contextRef;
            const boundary = new SimulationBoundary();

            (context.game as any).getState = () => {
                throw new Error('simulation boundary should not call game.getState()');
            };
            (context.player1Object as any).getStateSummary = () => {
                throw new Error('simulation boundary should not call player.getStateSummary()');
            };

            const snapshot = boundary.buildNextDecisionSnapshot(context.game);
            const playerState = snapshot.state.players[context.player1Object.id];

            expect(snapshot.playerId).toBe(context.player1Object.id);
            expect(playerState.handCount).toBe(1);
            expect(playerState.availableResources).toBe(3);
            expect(snapshot.legalDecisions.some((decision) => decision.rawDecision.kind === 'card-click')).toBeTrue();
            expect(snapshot.legalDecisions.some((decision) => decision.rawDecision.kind === 'prompt-button')).toBeTrue();
        });

        it('applies prompt-button decisions through engine public methods', function() {
            const { context } = contextRef;
            const boundary = new SimulationBoundary();
            const snapshot = boundary.buildNextDecisionSnapshot(context.game);
            const passDecision = snapshot.legalDecisions.find((decision) =>
                decision.rawDecision.kind === 'prompt-button' && decision.rawDecision.buttonArg === 'pass'
            );

            expect(passDecision).toBeDefined();

            boundary.applyDecision(context.game, passDecision!);

            expect(context.player2).toBeActivePlayer();
        });
    });

    it('can bound chat retention for simulation mode', function() {
        const chat = new BoundedSimulationGameChat(1);

        chat.addMessage('one');
        chat.addMessage('two');

        expect(chat.messages.map((message) => message.message)).toEqual(['two']);
    });
});
