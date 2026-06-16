import type { Card } from '../core/card/Card';
import type { Game } from '../core/Game';
import type { Player } from '../core/Player';
import type { SimulationPlayerState, SimulationState } from './SimulationTypes';
import { SimulationCardEncoder } from './SimulationCardEncoder';

export class SimulationStateEncoder {
    public constructor(private readonly cardEncoder = new SimulationCardEncoder()) {}

    public encode(game: Game): SimulationState {
        const activePlayer = game.getActivePlayer();
        const players: Record<string, SimulationPlayerState> = {};

        for (const player of game.getPlayers()) {
            players[player.id] = this.encodePlayer(game, player);
        }

        return {
            gameId: game.id,
            phase: game.currentPhase ?? undefined,
            roundNumber: game.roundNumber,
            actionNumber: game.actionNumber,
            activePlayerId: activePlayer?.id,
            initiativePlayerId: game.initiativePlayer?.id,
            isComplete: game.isEnded,
            winnerNames: game.winnerNames,
            players,
        };
    }

    private encodePlayer(game: Game, player: Player): SimulationPlayerState {
        const prompt = player.currentPrompt();

        return {
            id: player.id,
            name: player.name,
            hasInitiative: player.hasInitiative(),
            isActivePlayer: game.getActivePlayer() === player,
            availableResources: player.readyResourceCount,
            resourcesTotal: player.resources.length,
            handCount: player.hand.length,
            deckCount: player.drawDeck?.length ?? 0,
            discardCount: player.discard.length,
            base: this.cardEncoder.encode(player.base as Card, player),
            leader: this.cardEncoder.encode(player.deckLeader as Card, player),
            hand: this.encodeCards(player.hand, player),
            discard: this.encodeCards(player.discard, player),
            resources: this.encodeCards(player.resources, player),
            groundArena: this.encodeCards(game.groundArena.getCards({ controller: player }), player),
            spaceArena: this.encodeCards(game.spaceArena.getCards({ controller: player }), player),
            prompt: {
                menuTitle: prompt.menuTitle,
                promptTitle: prompt.promptTitle,
                promptType: prompt.promptType || undefined,
                promptUuid: prompt.promptUuid,
            },
        };
    }

    private encodeCards(cards: readonly Card[], activePlayer: Player) {
        return cards.map((card) => this.cardEncoder.encode(card, activePlayer)).filter((card) => card != null);
    }
}
