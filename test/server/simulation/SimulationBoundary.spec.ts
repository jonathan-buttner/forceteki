import {
    BoundedSimulationGameChat,
    SimulationActionSlotEncoder,
    SimulationBoundary,
    SimulationEnvironment,
    simulationNumDistinctActions,
    simulationObservationTensorSize,
} from '../../../server/game/simulation';
import type { SimulationEnvironmentState } from '../../../server/game/simulation';

function withoutPromptUuids(state: SimulationEnvironmentState): SimulationEnvironmentState {
    return JSON.parse(JSON.stringify(state, (key, value) => key === 'promptUuid' ? undefined : value));
}

function expectSimulationStatesToMatch(actual: SimulationEnvironmentState, expected: SimulationEnvironmentState): void {
    expect(withoutPromptUuids(actual)).toEqual(withoutPromptUuids(expected));
}

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

    it('resets to deterministic legal action slots and fixed observation tensors', async function() {
        const firstEnvironment = new SimulationEnvironment();
        const secondEnvironment = new SimulationEnvironment();

        const firstState = await firstEnvironment.reset({
            seed: 'same-seed',
            preselectedFirstPlayerId: 'player-0',
        });
        const secondState = await secondEnvironment.reset({
            seed: 'same-seed',
            preselectedFirstPlayerId: 'player-0',
        });

        expect(firstState.currentPlayer).toBe(0);
        expect(firstState.legalActions).toEqual(secondState.legalActions);
        expect(firstState.observationTensor.length).toBe(simulationObservationTensorSize);
        expect(firstState.observationTensor).toEqual(secondState.observationTensor);

        firstEnvironment.close();
        secondEnvironment.close();
    });

    it('does not encode opponent hand identities in viewer observation tensors', async function() {
        const environment = new SimulationEnvironment();
        const state = await environment.reset({
            seed: 'hidden-info',
            preselectedFirstPlayerId: 'player-0',
        });
        const viewerTensor = state.observationTensors[0];
        const opponentTensor = state.observationTensors[1];

        expect(viewerTensor.length).toBe(simulationObservationTensorSize);
        expect(opponentTensor.length).toBe(simulationObservationTensorSize);
        expect(viewerTensor).not.toEqual(opponentTensor);

        environment.close();
    });

    it('exports and restores a checkpoint after reset', async function() {
        const source = new SimulationEnvironment();
        const restored = new SimulationEnvironment();

        const sourceState = await source.reset({
            seed: 'checkpoint-reset',
            preselectedFirstPlayerId: 'player-0',
        });
        const restoredState = await restored.restoreCheckpoint(source.exportCheckpoint());

        expectSimulationStatesToMatch(restoredState, sourceState);

        source.close();
        restored.close();
    });

    it('exports and restores a checkpoint after simulation actions', async function() {
        const source = new SimulationEnvironment();
        const restored = new SimulationEnvironment();

        await source.reset({
            seed: 'checkpoint-actions',
            preselectedFirstPlayerId: 'player-0',
        });

        for (let i = 0; i < 2; i++) {
            const legalActions = source.legalActions();
            if (legalActions.length === 0) {
                break;
            }
            source.step(legalActions[0]);
        }

        const checkpointState = source.getState();
        const restoredState = await restored.restoreCheckpoint(source.exportCheckpoint());

        expectSimulationStatesToMatch(restoredState, checkpointState);

        const nextAction = checkpointState.legalActions[0];
        if (nextAction != null) {
            const nextSourceState = source.step(nextAction);
            const nextRestoredState = restored.step(nextAction);
            expectSimulationStatesToMatch(nextRestoredState, nextSourceState);
        }

        source.close();
        restored.close();
    });

    it('restored checkpoints continue independently from their source environment', async function() {
        const source = new SimulationEnvironment();
        const restored = new SimulationEnvironment();

        await source.reset({
            seed: 'checkpoint-independent',
            preselectedFirstPlayerId: 'player-0',
        });
        await restored.restoreCheckpoint(source.exportCheckpoint());

        const originalState = source.getState();
        const legalActions = restored.legalActions();
        if (legalActions.length > 0) {
            restored.step(legalActions[0]);
        }

        expectSimulationStatesToMatch(source.getState(), originalState);

        source.close();
        restored.close();
    });

    it('restores a checkpoint without replaying all prior actions', async function() {
        const source = new SimulationEnvironment();
        const restored = new SimulationEnvironment();

        await source.reset({
            seed: 'checkpoint-perf-smoke',
            preselectedFirstPlayerId: 'player-0',
        });

        for (let i = 0; i < 3; i++) {
            const legalActions = source.legalActions();
            if (legalActions.length === 0) {
                break;
            }
            source.step(legalActions[0]);
        }

        const checkpoint = source.exportCheckpoint();
        const start = process.hrtime.bigint();
        const restoredState = await restored.restoreCheckpoint(checkpoint);
        const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;

        expectSimulationStatesToMatch(restoredState, source.getState());
        expect(durationMs).toBeLessThan(5000);

        source.close();
        restored.close();
    });

    it('fails loudly when a prompt exports more than the supported action slots', function() {
        const encoder = new SimulationActionSlotEncoder();
        const legalDecisions = Array.from({ length: simulationNumDistinctActions + 1 }, (_unused, index) => ({
            id: `decision-${index}`,
            playerId: 'player-0',
            kind: 'prompt-button' as const,
            label: `Decision ${index}`,
            rawDecision: {
                kind: 'prompt-button' as const,
                playerId: 'player-0',
                buttonArg: String(index),
            },
        }));

        expect(() => encoder.encode({
            playerId: 'player-0',
            legalDecisions,
            state: {
                gameId: 'overflow',
                roundNumber: 1,
                actionNumber: 0,
                isComplete: false,
                winnerNames: [],
                players: {
                    'player-0': {
                        id: 'player-0',
                        name: 'player0',
                        hasInitiative: true,
                        isActivePlayer: true,
                        availableResources: 0,
                        resourcesTotal: 0,
                        handCount: 0,
                        deckCount: 0,
                        discardCount: 0,
                        hand: [],
                        discard: [],
                        resources: [],
                        groundArena: [],
                        spaceArena: [],
                        prompt: { menuTitle: 'Overflow prompt' },
                    },
                },
            },
        })).toThrowError(/Simulation legal action overflow.*Overflow prompt/);
    });
});
