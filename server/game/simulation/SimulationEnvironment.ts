import path from 'path';
import v8 from 'node:v8';
import type { Game } from '../core/Game';
import { PhaseName } from '../core/Constants';
import { PromptType } from '../core/gameSteps/PromptInterfaces';
import { SnapshotTimepoint, type IGameSnapshot } from '../core/snapshot/SnapshotInterfaces';
import { UnitTestCardDataGetter } from '../../utils/cardData/UnitTestCardDataGetter';
import { Deck } from '../../utils/deck/Deck';
import type { ISwuDbFormatDecklist } from '../../utils/deck/DeckInterfaces';
import { HeadlessGameFactory } from './HeadlessGameFactory';
import { SimulationActionSlotEncoder } from './SimulationActionSlotEncoder';
import { SimulationBoundary } from './SimulationBoundary';
import { SimulationObservationTensorEncoder } from './SimulationObservationTensorEncoder';
import { SimulationStateEncoder } from './SimulationStateEncoder';
import type { SimulationCheckpoint, SimulationDecisionSnapshot, SimulationEnvironmentState, SimulationSerializedGameSnapshot } from './SimulationTypes';

export interface SimulationEnvironmentResetOptions {
    seed?: string;
    gameId?: string;
    cardDataPath?: string;
    preselectedFirstPlayerId?: string;
    decks?: [ISwuDbFormatDecklist, ISwuDbFormatDecklist];
}

export class SimulationEnvironment {
    private readonly playerIds: [string, string] = ['player-0', 'player-1'];
    private readonly playerNames: [string, string] = ['player0', 'player1'];
    private readonly gameFactory = new HeadlessGameFactory();
    private readonly boundary = new SimulationBoundary();
    private readonly actionEncoder = new SimulationActionSlotEncoder();
    private readonly observationEncoder = new SimulationObservationTensorEncoder();
    private readonly stateEncoder = new SimulationStateEncoder();
    private game: Game | null = null;
    private snapshot: SimulationDecisionSnapshot | null = null;
    private resetOptions: SimulationEnvironmentResetOptions | null = null;
    private actionHistory: number[] = [];

    public async reset(options: SimulationEnvironmentResetOptions = {}): Promise<SimulationEnvironmentState> {
        const cardDataPath = path.resolve(options.cardDataPath ?? 'test/json');
        const cardDataGetter = new UnitTestCardDataGetter(cardDataPath);
        const decks = options.decks ?? this.buildDefaultDecks();
        this.resetOptions = {
            ...options,
            cardDataPath,
            decks,
        };
        this.actionHistory = [];

        this.game = await this.gameFactory.createInitializedGame({
            id: options.gameId ?? 'forceteki-open-spiel',
            cardDataGetter,
            players: [
                {
                    id: this.playerIds[0],
                    username: this.playerNames[0],
                    deck: new Deck(decks[0], cardDataGetter),
                },
                {
                    id: this.playerIds[1],
                    username: this.playerNames[1],
                    deck: new Deck(decks[1], cardDataGetter),
                },
            ],
            seed: options.seed ?? 'forceteki-open-spiel-seed',
            preselectedFirstPlayerId: options.preselectedFirstPlayerId,
        });

        this.advanceToDecision();
        return this.getState();
    }

    public step(actionId: number): SimulationEnvironmentState {
        const game = this.requireGame();
        const snapshot = this.requireSnapshot();
        const { decisionsByActionId } = this.actionEncoder.encode(snapshot);
        const decision = decisionsByActionId.get(actionId);

        if (!decision) {
            throw new Error(`Illegal action ${actionId}. Legal actions: ${[...decisionsByActionId.keys()].join(', ')}`);
        }

        this.boundary.applyDecision(game, decision);
        this.actionHistory.push(actionId);
        this.advanceToDecision();
        return this.getState();
    }

    public getState(): SimulationEnvironmentState {
        const game = this.requireGame();
        const state = this.snapshot?.state ?? this.boundaryStateForTerminal(game);
        const playerIds = Object.keys(state.players).sort();
        const observationTensors = [
            this.observationEncoder.encode(state, playerIds[0] ?? this.playerIds[0]),
            this.observationEncoder.encode(state, playerIds[1] ?? this.playerIds[1]),
        ] as [number[], number[]];

        if (state.isComplete || !this.snapshot) {
            return {
                currentPlayer: -4,
                currentPlayerId: null,
                isTerminal: true,
                legalActions: [],
                legalDecisions: [],
                actionStrings: {},
                returns: this.returns(),
                observationTensor: observationTensors[0],
                observationTensors,
                state,
            };
        }

        const { slots, decisionsByActionId } = this.actionEncoder.encode(this.snapshot);
        const currentPlayer = Math.max(0, playerIds.indexOf(this.snapshot.playerId));
        const actionStrings = Object.fromEntries(slots.map((slot) => [String(slot.actionId), slot.label]));
        const legalDecisions = slots.map((slot) => {
            const decision = decisionsByActionId.get(slot.actionId);
            if (!decision) {
                throw new Error(`Simulation action slot ${slot.actionId} is missing its legal decision`);
            }
            return {
                ...decision,
                actionId: slot.actionId,
            };
        });

        return {
            currentPlayer,
            currentPlayerId: this.snapshot.playerId,
            isTerminal: false,
            legalActions: slots.map((slot) => slot.actionId),
            legalDecisions,
            actionStrings,
            returns: this.returns(),
            observationTensor: observationTensors[currentPlayer],
            observationTensors,
            state,
        };
    }

    public exportCheckpoint(): SimulationCheckpoint {
        const game = this.requireGame();
        const snapshot = this.withSimulationOnlyStatePruned(
            game.snapshotManager.createSimulationSnapshot(this.inferCurrentSnapshotTimepoint(game))
        );
        const snapshotStates = v8.deserialize(snapshot.states) as Record<string, unknown>;

        return {
            version: 1,
            resetOptions: this.requireResetOptions(),
            actionHistory: [...this.actionHistory],
            entryPoint: game.snapshotManager.getEntryPointForSnapshot(snapshot),
            snapshot: this.serializeGameSnapshot(snapshot),
            decisionSnapshot: this.snapshot,
            environmentState: this.getState(),
            objectManifest: {
                gameObjectIds: Object.keys(snapshotStates),
            },
        };
    }

    public async restoreCheckpoint(checkpoint: SimulationCheckpoint): Promise<SimulationEnvironmentState> {
        if (checkpoint.version !== 1) {
            throw new Error(`Unsupported simulation checkpoint version ${checkpoint.version}`);
        }

        const fastRestoreState = await this.tryFastRestoreCheckpoint(checkpoint);
        if (fastRestoreState && this.sameEnvironmentState(fastRestoreState, checkpoint.environmentState)) {
            this.actionHistory = [...checkpoint.actionHistory];
            return fastRestoreState;
        }

        return await this.restoreCheckpointByReplay(checkpoint);
    }

    public legalActions(): number[] {
        return this.getState().legalActions;
    }

    public observationTensor(player: number): number[] {
        return this.getState().observationTensors[player] ?? this.getState().observationTensor;
    }

    public returns(): [number, number] {
        const game = this.requireGame();
        const winnerNames = game.winnerNames;

        if (winnerNames.length !== 1) {
            return [0, 0];
        }

        if (winnerNames[0] === this.playerNames[0]) {
            return [1, -1];
        }

        if (winnerNames[0] === this.playerNames[1]) {
            return [-1, 1];
        }

        return [0, 0];
    }

    public close(): void {
        this.game = null;
        this.snapshot = null;
        this.resetOptions = null;
        this.actionHistory = [];
    }

    private advanceToDecision(): void {
        const game = this.requireGame();

        for (let i = 0; i < 128; i++) {
            if (game.isEnded) {
                this.snapshot = null;
                return;
            }

            try {
                this.snapshot = this.boundary.buildNextDecisionSnapshot(game);
                return;
            } catch (error) {
                game.continue();
            }
        }

        throw new Error('Simulation did not reach a terminal state or actionable player after 128 engine continuations');
    }

    private boundaryStateForTerminal(game: Game) {
        return this.stateEncoder.encode(game);
    }

    private async tryFastRestoreCheckpoint(checkpoint: SimulationCheckpoint): Promise<SimulationEnvironmentState | null> {
        try {
            await this.reset(checkpoint.resetOptions);

            const game = this.requireGame();
            const snapshot = this.deserializeGameSnapshot(checkpoint.snapshot);
            const success = game.snapshotManager.restoreSimulationSnapshot(snapshot);
            if (!success) {
                return null;
            }

            game.postRollbackOperations(checkpoint.entryPoint);
            this.snapshot = game.isEnded ? null : this.boundary.buildNextDecisionSnapshot(game);

            return this.getState();
        } catch (error) {
            return null;
        }
    }

    private async restoreCheckpointByReplay(checkpoint: SimulationCheckpoint): Promise<SimulationEnvironmentState> {
        let state = await this.reset(checkpoint.resetOptions);
        for (const actionId of checkpoint.actionHistory) {
            state = this.step(actionId);
        }

        return state;
    }

    private sameEnvironmentState(a: SimulationEnvironmentState, b: SimulationEnvironmentState): boolean {
        return JSON.stringify(this.withoutPromptUuids(a)) === JSON.stringify(this.withoutPromptUuids(b));
    }

    private withoutPromptUuids<T>(value: T): T {
        return JSON.parse(JSON.stringify(value, (key, nestedValue) => key === 'promptUuid' ? undefined : nestedValue));
    }

    private serializeGameSnapshot(snapshot: IGameSnapshot): SimulationSerializedGameSnapshot {
        return {
            id: snapshot.id,
            lastGameObjectId: snapshot.lastGameObjectId,
            actionNumber: snapshot.actionNumber,
            roundNumber: snapshot.roundNumber,
            phase: snapshot.phase,
            timepoint: snapshot.timepoint,
            timepointNumber: snapshot.timepointNumber,
            activePlayerId: snapshot.activePlayerId,
            gameStateBase64: snapshot.gameState.toString('base64'),
            statesBase64: snapshot.states.toString('base64'),
            rngState: snapshot.rngState,
            requiresConfirmationToRollback: snapshot.requiresConfirmationToRollback,
            nextSnapshotIsSamePlayer: snapshot.nextSnapshotIsSamePlayer,
        };
    }

    private deserializeGameSnapshot(snapshot: SimulationSerializedGameSnapshot): IGameSnapshot {
        return {
            id: snapshot.id,
            lastGameObjectId: snapshot.lastGameObjectId,
            actionNumber: snapshot.actionNumber,
            roundNumber: snapshot.roundNumber,
            phase: snapshot.phase as PhaseName,
            timepoint: snapshot.timepoint as SnapshotTimepoint,
            timepointNumber: snapshot.timepointNumber,
            activePlayerId: snapshot.activePlayerId,
            gameState: Buffer.from(snapshot.gameStateBase64, 'base64'),
            states: Buffer.from(snapshot.statesBase64, 'base64'),
            rngState: snapshot.rngState as IGameSnapshot['rngState'],
            requiresConfirmationToRollback: snapshot.requiresConfirmationToRollback,
            nextSnapshotIsSamePlayer: snapshot.nextSnapshotIsSamePlayer,
        };
    }

    private withSimulationOnlyStatePruned(snapshot: IGameSnapshot): IGameSnapshot {
        const states = v8.deserialize(snapshot.states) as Record<string, Record<string, unknown>>;

        for (const uuid of Object.keys(states)) {
            if (uuid.startsWith('TrackedGameCardMetric_')) {
                delete states[uuid];
                continue;
            }

            for (const [key, value] of Object.entries(states[uuid])) {
                if (Array.isArray(value)) {
                    states[uuid][key] = value.filter((entry) =>
                        typeof entry !== 'string' || !entry.startsWith('TrackedGameCardMetric_')
                    );
                }
            }
        }

        return {
            ...snapshot,
            states: v8.serialize(states),
        };
    }

    private inferCurrentSnapshotTimepoint(game: Game): SnapshotTimepoint {
        switch (game.currentPhase) {
            case PhaseName.Setup: {
                const actionablePlayerId = this.snapshot?.playerId;
                const prompt = actionablePlayerId ? game.getPlayerById(actionablePlayerId).currentPrompt() : null;
                if (prompt?.promptType === PromptType.Initiative) {
                    return SnapshotTimepoint.StartOfPhase;
                }
                if (prompt?.promptType === PromptType.Resource) {
                    return SnapshotTimepoint.SetupResource;
                }
                if (prompt?.promptTitle === 'Mulligan Step') {
                    return SnapshotTimepoint.Mulligan;
                }
                return SnapshotTimepoint.SetupResource;
            }
            case PhaseName.Action:
                return SnapshotTimepoint.Action;
            case PhaseName.Regroup:
                return SnapshotTimepoint.RegroupResource;
            default:
                throw new Error(`Cannot checkpoint a simulation game without a current phase: ${game.currentPhase}`);
        }
    }

    private requireResetOptions(): SimulationEnvironmentResetOptions {
        if (!this.resetOptions) {
            throw new Error('Simulation environment has not been reset');
        }

        return this.resetOptions;
    }

    private buildDefaultDecks(): [ISwuDbFormatDecklist, ISwuDbFormatDecklist] {
        return [
            this.buildDefaultDeck('SOR_010', 'SOR_027', 'player0 default'),
            this.buildDefaultDeck('SOR_005', 'SOR_029', 'player1 default'),
        ];
    }

    private buildDefaultDeck(leaderId: string, baseId: string, name: string): ISwuDbFormatDecklist {
        return {
            metadata: { name, author: 'Forceteki OpenSpiel' },
            leader: { id: leaderId, count: 1 },
            base: { id: baseId, count: 1 },
            deck: [
                { id: 'SOR_095', count: 20 },
                { id: 'SOR_247', count: 20 },
                { id: 'SOR_236', count: 10 },
            ],
            sideboard: [],
        };
    }

    private requireGame(): Game {
        if (!this.game) {
            throw new Error('Simulation environment has not been reset');
        }

        return this.game;
    }

    private requireSnapshot(): SimulationDecisionSnapshot {
        if (!this.snapshot) {
            throw new Error('Simulation environment is terminal or has not reached an actionable player');
        }

        return this.snapshot;
    }
}
