import type { Card } from '../core/card/Card';
import type { Player } from '../core/Player';
import type { SimulationCardView } from './SimulationTypes';

export class SimulationCardEncoder {
    public encode(card: Card | null | undefined, activePlayer?: Player): SimulationCardView | undefined {
        if (!card) {
            return undefined;
        }

        const damage = this.readNumber(card, 'damage');
        const hp = this.readNumber(card, 'getHp') ?? this.readNumber(card, 'hp') ?? this.readNumber(card, 'printedHp');

        return {
            uuid: card.uuid,
            id: this.readCardDataValue<string>(card, 'id') ?? this.readStringValue(card, 'setId'),
            internalName: card.internalName,
            name: card.title,
            zone: card.zoneName,
            damage,
            hp,
            remainingHp: hp == null ? undefined : Math.max(0, hp - (damage ?? 0)),
            power: this.readNumber(card, 'getPower') ?? this.readNumber(card, 'power') ?? this.readCardDataValue<number>(card, 'power'),
            cost: this.readNumber(card, 'cost') ?? this.readCardDataValue<number>(card, 'cost'),
            controllerId: card.controller?.id,
            ownerId: card.owner?.id,
            type: card.type,
            printedType: this.readStringValue(card, 'printedType'),
            arena: this.readCardDataValue<string>(card, 'arena'),
            aspects: this.toStringArray(this.readValue(card, 'aspects')),
            traits: this.toStringArray(this.readValue(card, 'traits')),
            keywords: this.toStringArray(this.readValue(card, 'keywords')),
            exhausted: this.readBoolean(card, 'exhausted'),
            selectable: activePlayer ? activePlayer.selectableCards.includes(card) : undefined,
            selected: activePlayer ? activePlayer.selectedCards?.includes(card) : undefined,
        };
    }

    private readCardDataValue<T>(card: Card, propertyName: string): T | undefined {
        return (card as any).cardData?.[propertyName] as T | undefined;
    }

    private readValue(card: Card, propertyName: string): unknown {
        try {
            return (card as any)[propertyName];
        } catch {
            return undefined;
        }
    }

    private readNumber(card: Card, propertyOrMethodName: string): number | undefined {
        try {
            const value = (card as any)[propertyOrMethodName];
            const result = typeof value === 'function' ? value.call(card) : value;
            return typeof result === 'number' && Number.isFinite(result) ? result : undefined;
        } catch {
            return undefined;
        }
    }

    private readBoolean(card: Card, propertyName: string): boolean | undefined {
        try {
            const value = (card as any)[propertyName];
            return typeof value === 'boolean' ? value : undefined;
        } catch {
            return undefined;
        }
    }

    private readStringValue(card: Card, propertyName: string): string | undefined {
        try {
            const value = (card as any)[propertyName];
            return value == null ? undefined : String(value);
        } catch {
            return undefined;
        }
    }

    private toStringArray(value: unknown): string[] | undefined {
        if (value == null) {
            return undefined;
        }

        if (value instanceof Set) {
            return [...value].map(String);
        }

        if (Array.isArray(value)) {
            return value.map((entry) => typeof entry === 'string' ? entry : entry?.name ?? String(entry));
        }

        return undefined;
    }
}
