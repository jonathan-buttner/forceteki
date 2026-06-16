import { GameMode } from '../../GameMode';
import { getUserWithDefaultsSet, type IUser } from '../../Settings';
import type { CardDataGetter } from '../../utils/cardData/CardDataGetter';
import type { Deck } from '../../utils/deck/Deck';
import { Game } from '../core/Game';
import type { GameConfiguration } from '../core/GameInterfaces';
import { UndoMode } from '../core/snapshot/SnapshotManager';
import { BoundedSimulationGameChat } from './BoundedSimulationGameChat';

export interface HeadlessPlayerConfig {
    id: string;
    username: string;
    deck?: Deck;
    user?: Partial<IUser>;
}

export interface HeadlessGameOptions {
    id: string;
    owner?: string;
    gameMode?: GameMode;
    cardDataGetter: CardDataGetter;
    players: [HeadlessPlayerConfig, HeadlessPlayerConfig];
    seed?: string;
    chatMessageLimit?: number;
    preselectedFirstPlayerId?: string;
}

export class HeadlessGameFactory {
    public createGame(options: HeadlessGameOptions): Game {
        const players = options.players.map((player) => getUserWithDefaultsSet({
            id: player.id,
            username: player.username,
            settings: { optionSettings: { autoSingleTarget: false } },
            ...player.user,
        })) as IUser[];

        const details: GameConfiguration = {
            id: options.id,
            owner: options.owner ?? 'headless-simulation',
            allowSpectators: false,
            gameMode: options.gameMode ?? GameMode.Premier,
            players,
            cardDataGetter: options.cardDataGetter,
            pushUpdate: () => undefined,
            buildSafeTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
            userTimeoutDisconnect: () => undefined,
            useActionTimer: false,
            undoMode: UndoMode.Disabled,
            preselectedFirstPlayerId: options.preselectedFirstPlayerId,
        };

        const game = new Game(details, { router: this.createRouter(options.id) });
        game.gameChat = new BoundedSimulationGameChat(options.chatMessageLimit ?? 0) as any;

        if (options.seed) {
            game.setRandomSeed(options.seed);
        }

        for (const player of options.players) {
            if (player.deck) {
                game.selectDeck(player.id, player.deck);
            }
        }

        return game;
    }

    public async createInitializedGame(options: HeadlessGameOptions): Promise<Game> {
        const game = this.createGame(options);
        await game.initialiseAsync();
        return game;
    }

    private createRouter(id: string) {
        return {
            id: `headless-${id}`,
            handleGameEnd: () => undefined,
            handleUndoGameEnd: () => undefined,
            sendGameState: () => undefined,
            handleError: (_game: Game, error: Error) => {
                throw error;
            },
            handleSerializationFailure: (_game: Game, error: Error) => {
                throw error;
            },
        } as any;
    }
}
