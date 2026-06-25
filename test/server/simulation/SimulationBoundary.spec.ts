import {
    BoundedSimulationGameChat,
    SimulationActionSlotEncoder,
    SimulationBoundary,
    SimulationEnvironment,
    SimulationLegalDecisionExporter,
    SimulationObservationTensorEncoder,
    simulationCardFeatureCount,
    simulationCardFeatureOffsets,
    simulationCardMetadataVocabularies,
    simulationNumDistinctActions,
    simulationObservationTensorSize,
} from '../../../server/game/simulation';
import { StatefulPromptType } from '../../../server/game/core/gameSteps/PromptInterfaces';
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

    it('preserves selected display card state in exported legal decisions', function() {
        const exporter = new SimulationLegalDecisionExporter();
        const legalDecisions = exporter.exportForPlayer({
            id: 'player-0',
            currentPrompt: () => ({
                menuTitle: 'Choose a card',
                promptUuid: 'prompt-1',
                displayCards: [{
                    cardUuid: 'card-1',
                    internalName: 'selected-card',
                    selectionState: 'selected',
                }],
                perCardButtons: [],
            }),
            selectableCards: [],
        } as any);

        const decision = legalDecisions[0];
        expect(decision).toBeDefined();
        expect(decision!.card?.uuid).toBe('card-1');
        expect(decision!.card?.selected).toBeTrue();
        expect(decision!.card?.selectable).toBeFalse();
    });

    it('allows indirect damage distribution overkill on bases', function() {
        const exporter = new SimulationLegalDecisionExporter();
        const damagedUnit = {
            uuid: 'unit-1',
            internalName: 'damaged-unit',
            title: 'Damaged Unit',
            damage: 3,
            remainingHp: 2,
            isUnit: () => true,
        };
        const base = {
            uuid: 'base-1',
            internalName: 'base',
            title: 'Base',
            damage: 27,
            getHp: () => 30,
            isUnit: () => false,
        };
        const legalDecisions = exporter.exportForPlayer({
            id: 'player-0',
            currentPrompt: () => ({
                menuTitle: 'Distribute 12 indirect damage among targets',
                promptUuid: 'prompt-1',
                distributeAmongTargets: {
                    type: StatefulPromptType.DistributeIndirectDamage,
                    amount: 12,
                    maxTargets: null,
                    canChooseNoTargets: false,
                    canDistributeLess: false,
                    isIndirectDamage: true,
                },
            }),
            selectableCards: [damagedUnit, base],
            selectedCards: [],
        } as any);

        const decision = legalDecisions.find((decision) => decision.rawDecision.kind === 'stateful-prompt');

        expect(decision).toBeDefined();
        expect(decision!.rawDecision.cardDistribution).toEqual([
            { uuid: 'unit-1', amount: 2 },
            { uuid: 'base-1', amount: 10 },
        ]);
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
        expect(firstState.legalDecisions.map((decision) => decision.actionId)).toEqual(firstState.legalActions);
        expect(withoutPromptUuids(firstState).legalDecisions).toEqual(withoutPromptUuids(secondState).legalDecisions);
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

    it('encodes revealed structured card metadata without revealing hidden opponent card metadata', function() {
        const encoder = new SimulationObservationTensorEncoder();
        const card = {
            id: '0201864172',
            internalName: 'adventurer-sniper-rifle',
            name: 'Adventurer Sniper Rifle',
            controllerId: 'player-0',
            ownerId: 'player-0',
            hp: 0,
            power: 0,
            cost: 2,
            printedHp: 0,
            printedPower: 0,
            printedCost: 2,
            upgradeHp: 0,
            upgradePower: 0,
            types: ['upgrade'],
            aspects: ['vigilance'],
            traits: ['item', 'weapon'],
            keywords: [],
            unique: false,
            exhausted: false,
        };
        const state = {
            gameId: 'metadata-test',
            phase: 'action',
            roundNumber: 1,
            actionNumber: 1,
            activePlayerId: 'player-0',
            initiativePlayerId: 'player-0',
            isComplete: false,
            winnerNames: [],
            players: {
                'player-0': {
                    id: 'player-0',
                    name: 'player0',
                    hasInitiative: true,
                    isActivePlayer: true,
                    availableResources: 2,
                    resourcesTotal: 2,
                    handCount: 0,
                    deckCount: 0,
                    discardCount: 0,
                    base: card,
                    leader: undefined,
                    hand: [],
                    discard: [],
                    resources: [],
                    groundArena: [],
                    spaceArena: [],
                    prompt: {},
                },
                'player-1': {
                    id: 'player-1',
                    name: 'player1',
                    hasInitiative: false,
                    isActivePlayer: false,
                    availableResources: 2,
                    resourcesTotal: 2,
                    handCount: 1,
                    deckCount: 0,
                    discardCount: 0,
                    base: undefined,
                    leader: undefined,
                    hand: [{ ...card, controllerId: 'player-1', ownerId: 'player-1' }],
                    discard: [],
                    resources: [],
                    groundArena: [],
                    spaceArena: [],
                    prompt: {},
                },
            },
        };

        const tensor = encoder.encode(state, 'player-0');
        const firstPlayerBaseOffset = 13 + 11;
        const playerBlockSize = 11 + (2 + 5 * 24) * simulationCardFeatureCount;
        const secondPlayerOffset = 13 + playerBlockSize;
        const secondPlayerHandOffset = secondPlayerOffset + 11 + (2 + 3 * 24) * simulationCardFeatureCount;
        const indexOf = (values: readonly string[], value: string) => values.indexOf(value);

        expect(tensor.length).toBe(simulationObservationTensorSize);
        expect(tensor[firstPlayerBaseOffset + simulationCardFeatureOffsets.printedCost]).toBe(0.1);
        expect(tensor[firstPlayerBaseOffset + simulationCardFeatureOffsets.upgradePower]).toBe(0);
        expect(tensor[firstPlayerBaseOffset + simulationCardFeatureOffsets.upgradeHp]).toBe(0);
        expect(tensor[
            firstPlayerBaseOffset +
            simulationCardFeatureOffsets.type +
            indexOf(simulationCardMetadataVocabularies.types, 'upgrade')
        ]).toBe(1);
        expect(tensor[
            firstPlayerBaseOffset +
            simulationCardFeatureOffsets.aspect +
            indexOf(simulationCardMetadataVocabularies.aspects, 'vigilance')
        ]).toBe(1);
        expect(tensor[
            firstPlayerBaseOffset +
            simulationCardFeatureOffsets.trait +
            indexOf(simulationCardMetadataVocabularies.traits, 'item')
        ]).toBe(1);
        expect(tensor[
            firstPlayerBaseOffset +
            simulationCardFeatureOffsets.trait +
            indexOf(simulationCardMetadataVocabularies.traits, 'weapon')
        ]).toBe(1);
        expect(tensor[secondPlayerHandOffset + simulationCardFeatureOffsets.identityRevealed]).toBe(0);
        expect(tensor[secondPlayerHandOffset + simulationCardFeatureOffsets.identityHash]).toBe(0);
        expect(tensor[
            secondPlayerHandOffset +
            simulationCardFeatureOffsets.type +
            indexOf(simulationCardMetadataVocabularies.types, 'upgrade')
        ]).toBe(0);
        expect(tensor[
            secondPlayerHandOffset +
            simulationCardFeatureOffsets.trait +
            indexOf(simulationCardMetadataVocabularies.traits, 'weapon')
        ]).toBe(0);
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

    it('encodes Galen-sized dropdown prompts within the supported action slots', function() {
        const encoder = new SimulationActionSlotEncoder();
        const legalDecisions = Array.from({ length: 1827 }, (_unused, index) => ({
            id: `dropdown-card-${index}`,
            playerId: 'player-0',
            kind: 'dropdown' as const,
            label: `Choose Card ${index}`,
            rawDecision: {
                kind: 'dropdown' as const,
                playerId: 'player-0',
                value: `Card ${index}`,
            },
        }));

        const { slots, decisionsByActionId } = encoder.encode({
            playerId: 'player-0',
            legalDecisions,
            state: {
                gameId: 'galen-dropdown',
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
                        prompt: {
                            menuTitle: 'Choose an option from the list',
                            promptTitle: 'Galen Erso',
                        },
                    },
                },
            },
        });

        expect(slots.length).toBe(1827);
        expect(decisionsByActionId.size).toBe(1827);
        expect(slots[0].actionId).toBe(0);
        expect(slots[slots.length - 1].actionId).toBe(1826);
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
