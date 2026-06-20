import type { SimulationCardView, SimulationState } from './SimulationTypes';

export const simulationObservationTensorSize = 32768;

const maxCardsPerZone = 24;
const legacyCardFeatureCount = 10;
const phaseCodes = ['setup', 'action', 'regroup'];

export const simulationCardMetadataVocabularies = {
    types: ['base', 'event', 'leader', 'token', 'unit', 'upgrade'],
    aspects: ['aggression', 'command', 'cunning', 'heroism', 'vigilance', 'villainy'],
    traits: [
        'armor',
        'bounty',
        'bounty hunter',
        'capital ship',
        'clone',
        'condition',
        'creature',
        'disaster',
        'droid',
        'ewok',
        'fighter',
        'first order',
        'force',
        'fringe',
        'gambit',
        'gungan',
        'hutt',
        'imperial',
        'innate',
        'inquisitor',
        'item',
        'jawa',
        'jedi',
        'kaminoan',
        'law',
        'learned',
        'lightsaber',
        'mandalorian',
        'modification',
        'musician',
        'naboo',
        'new republic',
        'night',
        'nihil',
        'official',
        'pilot',
        'plan',
        'rebel',
        'republic',
        'resistance',
        'separatist',
        'sith',
        'spectre',
        'speeder',
        'supply',
        'tactic',
        'tank',
        'transport',
        'trick',
        'trooper',
        'tusken',
        'twi\'lek',
        'undead',
        'underworld',
        'vehicle',
        'walker',
        'weapon',
        'wookiee'
    ],
    keywords: [
        'ambush',
        'bounty',
        'coordinate',
        'exploit',
        'grit',
        'hidden',
        'overwhelm',
        'piloting',
        'plot',
        'raid',
        'restore',
        'saboteur',
        'sentinel',
        'shielded',
        'smuggle',
        'support'
    ],
    arenas: ['ground', 'space'],
} as const;

export const simulationCardFeatureOffsets = {
    present: 0,
    identityRevealed: 1,
    identityHash: 2,
    owner: 3,
    controller: 4,
    exhausted: 5,
    damage: 6,
    hp: 7,
    power: 8,
    cost: 9,
    printedCost: 10,
    printedHp: 11,
    printedPower: 12,
    upgradePower: 13,
    upgradeHp: 14,
    unique: 15,
    arena: 16,
    type: 18,
    aspect: 24,
    trait: 30,
    keyword: 88,
} as const;

export const simulationCardFeatureCount =
    legacyCardFeatureCount +
    3 +
    2 +
    1 +
    simulationCardMetadataVocabularies.arenas.length +
    simulationCardMetadataVocabularies.types.length +
    simulationCardMetadataVocabularies.aspects.length +
    simulationCardMetadataVocabularies.traits.length +
    simulationCardMetadataVocabularies.keywords.length;

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
            offset += simulationCardFeatureCount;
            this.writeCard(tensor, offset, player.leader, true, playerId, viewerPlayerId);
            offset += simulationCardFeatureCount;

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
            offset += simulationCardFeatureCount;
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

        if (revealIdentity) {
            values.push(
                this.scale(card.printedCost, 20),
                this.scale(card.printedHp, 40),
                this.scale(card.printedPower, 20),
                this.scale(card.upgradePower, 10),
                this.scale(card.upgradeHp, 10),
                card.unique ? 1 : 0,
                ...this.encodeSingleValue(card.arena, simulationCardMetadataVocabularies.arenas),
                ...this.encodeMultiValue(card.types, simulationCardMetadataVocabularies.types),
                ...this.encodeMultiValue(card.aspects, simulationCardMetadataVocabularies.aspects),
                ...this.encodeMultiValue(card.traits, simulationCardMetadataVocabularies.traits),
                ...this.encodeMultiValue(card.keywords, simulationCardMetadataVocabularies.keywords)
            );
        } else {
            values.push(...new Array(simulationCardFeatureCount - legacyCardFeatureCount).fill(0));
        }

        for (let i = 0; i < values.length && offset + i < tensor.length; i++) {
            tensor[offset + i] = values[i];
        }
    }

    private encodeSingleValue<T extends string>(value: string | undefined, vocabulary: readonly T[]): number[] {
        const normalizedValue = this.normalizeLabel(value);
        return vocabulary.map((entry) => normalizedValue === entry ? 1 : 0);
    }

    private encodeMultiValue<T extends string>(values: readonly string[] | undefined, vocabulary: readonly T[]): number[] {
        const normalizedValues = new Set((values ?? []).map((value) => this.normalizeLabel(value)));
        return vocabulary.map((entry) => normalizedValues.has(entry) ? 1 : 0);
    }

    private normalizeLabel(value: string | undefined): string {
        return value == null ? '' : String(value).toLowerCase();
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
