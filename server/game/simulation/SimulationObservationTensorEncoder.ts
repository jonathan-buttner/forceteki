import type { SimulationCardView, SimulationState } from './SimulationTypes';

export const simulationObservationTensorSize = 4096;

const maxCardsPerZone = 24;
const cardFeatureCount = 10;
const phaseCodes = ['setup', 'action', 'regroup'];

export class SimulationObservationTensorEncoder {
    public encode(state: SimulationState, viewerPlayerId: string): number[] {
        const tensor = new Array<number>(simulationObservationTensorSize).fill(0);
        let offset = 0;
        const playerIds = Object.keys(state.players).sort();
        const viewerIndex = Math.max(0, playerIds.indexOf(viewerPlayerId));

        const write = (value: number) => {
            if (offset < tensor.length) {
                tensor[offset] = Number.isFinite(value) ? value : 0;
            }
            offset++;
        };

        for (let i = 0; i < 2; i++) {
            write(i === viewerIndex ? 1 : 0);
        }
        for (let i = 0; i < 2; i++) {
            write(state.activePlayerId === playerIds[i] ? 1 : 0);
        }
        for (let i = 0; i < 2; i++) {
            write(state.initiativePlayerId === playerIds[i] ? 1 : 0);
        }
        for (const phaseCode of phaseCodes) {
            write(state.phase === phaseCode ? 1 : 0);
        }
        write(phaseCodes.includes(state.phase ?? '') ? 0 : 1);
        write(this.scale(state.roundNumber, 20));
        write(this.scale(state.actionNumber, 100));
        write(state.isComplete ? 1 : 0);

        for (const playerId of playerIds.slice(0, 2)) {
            const player = state.players[playerId];
            const isViewer = playerId === viewerPlayerId;

            write(isViewer ? 1 : 0);
            write(player.hasInitiative ? 1 : 0);
            write(player.isActivePlayer ? 1 : 0);
            write(this.scale(player.availableResources, 30));
            write(this.scale(player.resourcesTotal, 50));
            write(this.scale(player.handCount, 30));
            write(this.scale(player.deckCount, 80));
            write(this.scale(player.discardCount, 80));
            write(this.scale(player.resources.filter((card) => card.exhausted).length, 50));
            write(this.scale(player.groundArena.length, 20));
            write(this.scale(player.spaceArena.length, 20));

            this.writeCard(tensor, offset, player.base, true, playerId, viewerPlayerId);
            offset += cardFeatureCount;
            this.writeCard(tensor, offset, player.leader, true, playerId, viewerPlayerId);
            offset += cardFeatureCount;

            offset = this.writeCardZone(tensor, offset, player.groundArena, playerId, viewerPlayerId, true);
            offset = this.writeCardZone(tensor, offset, player.spaceArena, playerId, viewerPlayerId, true);
            offset = this.writeCardZone(tensor, offset, player.discard, playerId, viewerPlayerId, true);
            offset = this.writeCardZone(tensor, offset, player.hand, playerId, viewerPlayerId, isViewer);
            offset = this.writeCardZone(tensor, offset, player.resources, playerId, viewerPlayerId, isViewer);
        }

        return tensor;
    }

    private writeCardZone(
        tensor: number[],
        offset: number,
        cards: readonly SimulationCardView[],
        ownerId: string,
        viewerPlayerId: string,
        revealIdentity: boolean
    ): number {
        for (let i = 0; i < maxCardsPerZone; i++) {
            this.writeCard(tensor, offset, cards[i], revealIdentity, ownerId, viewerPlayerId);
            offset += cardFeatureCount;
        }

        return offset;
    }

    private writeCard(
        tensor: number[],
        offset: number,
        card: SimulationCardView | undefined,
        revealIdentity: boolean,
        ownerId: string,
        viewerPlayerId: string
    ): void {
        if (!card || offset >= tensor.length) {
            return;
        }

        const identity = revealIdentity ? card.id ?? card.internalName ?? card.name ?? '' : '';
        const values = [
            1,
            revealIdentity ? 1 : 0,
            revealIdentity ? this.hashToUnit(identity) : 0,
            ownerId === viewerPlayerId ? 1 : -1,
            card.controllerId === viewerPlayerId ? 1 : card.controllerId ? -1 : 0,
            card.exhausted ? 1 : 0,
            this.scale(card.damage, 40),
            this.scale(card.hp, 40),
            this.scale(card.power, 20),
            this.scale(card.cost, 20),
        ];

        for (let i = 0; i < values.length && offset + i < tensor.length; i++) {
            tensor[offset + i] = values[i];
        }
    }

    private scale(value: number | undefined, divisor: number): number {
        return value == null ? 0 : Math.max(-1, Math.min(1, value / divisor));
    }

    private hashToUnit(value: string): number {
        let hash = 2166136261;
        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }

        return (hash >>> 0) / 0xffffffff;
    }
}
