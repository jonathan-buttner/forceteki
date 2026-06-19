import type { Card } from '../core/card/Card';
import type { Game } from '../core/Game';
import type { Player } from '../core/Player';
import type { IButton } from '../core/gameSteps/PromptInterfaces';
import { SimulationCardEncoder } from './SimulationCardEncoder';
import type { SimulationLegalDecision, SimulationRawDecision } from './SimulationTypes';

export class SimulationLegalDecisionExporter {
    public constructor(private readonly cardEncoder = new SimulationCardEncoder()) {}

    public getActionablePlayerId(game: Game): string | null {
        const activePlayer = game.getActivePlayer();
        if (activePlayer && this.hasLegalDecisions(activePlayer)) {
            return activePlayer.id;
        }

        return game.getPlayers().find((player) => this.hasLegalDecisions(player))?.id ?? null;
    }

    public exportForNextActionablePlayer(game: Game): { playerId: string; legalDecisions: SimulationLegalDecision[] } {
        const playerId = this.getActionablePlayerId(game);
        if (!playerId) {
            throw new Error('No actionable player is available');
        }

        return { playerId, legalDecisions: this.exportForPlayer(game.getPlayerById(playerId)) };
    }

    public exportForPlayer(player: Player): SimulationLegalDecision[] {
        const prompt = player.currentPrompt();
        const menuTitle = prompt.menuTitle ?? '';
        if (menuTitle.startsWith('Waiting for opponent')) {
            return [];
        }

        if (prompt.distributeAmongTargets) {
            return this.buildDistributionDecisions(player);
        }

        const decisions: SimulationLegalDecision[] = [];
        const promptUuid = prompt.promptUuid;
        const displayCards = Array.isArray(prompt.displayCards) ? prompt.displayCards : [];
        const perCardButtons = Array.isArray(prompt.perCardButtons) ? prompt.perCardButtons : [];

        for (const displayCard of displayCards) {
            for (const button of perCardButtons) {
                if (button.disabled) {
                    continue;
                }
                this.addDecision(decisions, {
                    id: this.makeDecisionId('per-card', displayCard.cardUuid, button.arg),
                    label: `${button.text} on ${displayCard.internalName}`,
                    rawDecision: {
                        kind: 'per-card-button',
                        playerId: player.id,
                        cardUuid: displayCard.cardUuid,
                        buttonArg: button.arg,
                        buttonText: button.text,
                        promptUuid,
                        command: button.command,
                        method: 'perCardMenuButton',
                    },
                    sourceCardId: displayCard.cardUuid,
                    sourceCardName: displayCard.internalName,
                    card: {
                        uuid: displayCard.cardUuid,
                        internalName: displayCard.internalName,
                        name: displayCard.internalName,
                        selectable: displayCard.selectionState === 'selectable',
                        selected: displayCard.selectionState === 'selected',
                    },
                });
            }
        }

        if (perCardButtons.length === 0) {
            for (const displayCard of displayCards) {
                if (displayCard.selectionState !== 'selectable' && displayCard.selectionState !== 'selected') {
                    continue;
                }
                this.addDecision(decisions, {
                    id: this.makeDecisionId('display-card', displayCard.cardUuid),
                    label: `Select ${displayCard.internalName}`,
                    rawDecision: {
                        kind: 'display-card',
                        playerId: player.id,
                        cardUuid: displayCard.cardUuid,
                        buttonArg: displayCard.cardUuid,
                        promptUuid,
                        method: 'menuButton',
                    },
                    sourceCardId: displayCard.cardUuid,
                    sourceCardName: displayCard.internalName,
                    card: {
                        uuid: displayCard.cardUuid,
                        internalName: displayCard.internalName,
                        name: displayCard.internalName,
                        selectable: displayCard.selectionState === 'selectable',
                        selected: displayCard.selectionState === 'selected',
                    },
                });
            }
        }

        for (const option of prompt.dropdownListOptions ?? []) {
            this.addDecision(decisions, {
                id: this.makeDecisionId('dropdown', option),
                label: `Choose ${option}`,
                rawDecision: {
                    kind: 'dropdown',
                    playerId: player.id,
                    value: option,
                    promptUuid,
                    method: 'menuButton',
                },
            });
        }

        if (prompt.selectNumber) {
            for (let value = prompt.selectNumber.min; value <= prompt.selectNumber.max; value++) {
                const stringValue = String(value);
                this.addDecision(decisions, {
                    id: this.makeDecisionId('number', stringValue),
                    label: `Choose ${stringValue}`,
                    rawDecision: {
                        kind: 'number',
                        playerId: player.id,
                        value: stringValue,
                        promptUuid,
                        method: 'menuButton',
                    },
                });
            }
        }

        for (const button of prompt.buttons ?? []) {
            if (button.disabled || button.command === 'statefulPromptResults') {
                continue;
            }
            this.addDecision(decisions, {
                id: this.makeDecisionId('button', button.arg, button.text),
                label: button.text,
                rawDecision: this.buttonToRawDecision(player, promptUuid, button),
            });
        }

        for (const card of player.selectableCards) {
            const cardView = this.cardEncoder.encode(card, player);
            this.addDecision(decisions, {
                id: this.makeDecisionId('card', card.uuid),
                label: `Click ${card.title}`,
                rawDecision: {
                    kind: 'card-click',
                    playerId: player.id,
                    cardUuid: card.uuid,
                },
                sourceCardId: cardView?.id,
                sourceCardName: card.internalName,
                card: cardView,
            });
        }

        return decisions;
    }

    private hasLegalDecisions(player: Player): boolean {
        return this.exportForPlayer(player).length > 0;
    }

    private buttonToRawDecision(player: Player, promptUuid: string, button: IButton): SimulationRawDecision {
        return {
            kind: 'prompt-button',
            playerId: player.id,
            buttonArg: button.arg,
            buttonText: button.text,
            promptUuid: (button as any).uuid ?? promptUuid,
            command: button.command,
            method: (button as any).method ?? button.command ?? 'menuButton',
        };
    }

    private buildDistributionDecisions(player: Player): SimulationLegalDecision[] {
        const prompt = player.currentPrompt();
        const distribution = prompt.distributeAmongTargets;
        const legalTargets = player.selectableCards;
        const decisions: SimulationLegalDecision[] = [];

        if (distribution.canChooseNoTargets) {
            this.addDecision(decisions, {
                id: this.makeDecisionId('distribute-none', prompt.promptUuid),
                label: 'Resolve prompt without choosing targets',
                rawDecision: {
                    kind: 'stateful-prompt',
                    playerId: player.id,
                    promptUuid: prompt.promptUuid,
                    statefulPromptType: distribution.type,
                    cardDistribution: [],
                },
                targetCards: [],
            });
        }

        if (legalTargets.length === 0) {
            return decisions;
        }

        const amount = distribution.amount;
        const maxTargets = distribution.maxTargets ?? legalTargets.length;
        const selected = this.allocateDistribution(legalTargets, amount, maxTargets, distribution.isIndirectDamage);

        if (selected.length > 0 && (distribution.canDistributeLess || selected.reduce((sum, entry) => sum + entry.amount, 0) === amount)) {
            const idSuffix = selected.map((entry) => `${entry.uuid}-${entry.amount}`).join(',');
            this.addDecision(decisions, {
                id: this.makeDecisionId('distribute', prompt.promptUuid, idSuffix),
                label: `${prompt.menuTitle || 'Resolve distribution prompt'} (${selected.length} targets)`,
                rawDecision: {
                    kind: 'stateful-prompt',
                    playerId: player.id,
                    promptUuid: prompt.promptUuid,
                    statefulPromptType: distribution.type,
                    cardDistribution: selected,
                },
                targetCards: legalTargets
                    .filter((card) => selected.some((entry) => entry.uuid === card.uuid))
                    .map((card) => this.cardEncoder.encode(card, player))
                    .filter((card) => card != null),
            });
        }

        return decisions;
    }

    private allocateDistribution(cards: readonly Card[], amount: number, maxTargets: number, isIndirectDamage: boolean) {
        let remaining = amount;
        const selected: Array<{ uuid: string; amount: number }> = [];

        for (const card of cards.slice(0, Math.max(1, maxTargets))) {
            const capacity = isIndirectDamage
                ? Math.max(0, ((card as any).getHp?.() ?? amount) - ((card as any).damage ?? 0))
                : amount;
            const assigned = Math.min(capacity, remaining);
            if (assigned > 0) {
                selected.push({ uuid: card.uuid, amount: assigned });
                remaining -= assigned;
            }
            if (remaining === 0) {
                break;
            }
        }

        return selected;
    }

    private addDecision(
        decisions: SimulationLegalDecision[],
        decision: Omit<SimulationLegalDecision, 'playerId' | 'kind'>
    ): void {
        if (decisions.some((existing) => existing.id === decision.id)) {
            return;
        }

        decisions.push({
            ...decision,
            playerId: decision.rawDecision.playerId,
            kind: decision.rawDecision.kind,
        });
    }

    private makeDecisionId(prefix: string, ...parts: Array<string | undefined>): string {
        return [prefix, ...parts.filter((part) => part != null && part !== '')].join(':');
    }
}
