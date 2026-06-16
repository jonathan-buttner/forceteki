import type { Game } from '../core/Game';
import type { SimulationLegalDecision, SimulationRawDecision } from './SimulationTypes';

export class SimulationActionApplier {
    public constructor(private readonly continueAfterApply = true) {}

    public apply(game: Game, decision: SimulationLegalDecision | SimulationRawDecision): void {
        const rawDecision = 'rawDecision' in decision ? decision.rawDecision : decision;

        switch (rawDecision.kind) {
            case 'card-click':
                game.cardClicked(rawDecision.playerId, rawDecision.cardUuid);
                break;
            case 'prompt-button':
            case 'display-card':
            case 'dropdown':
            case 'number':
                game.menuButton(
                    rawDecision.playerId,
                    rawDecision.value ?? rawDecision.buttonArg,
                    rawDecision.promptUuid,
                    rawDecision.method
                );
                break;
            case 'per-card-button':
                game.perCardMenuButton(
                    rawDecision.playerId,
                    rawDecision.buttonArg,
                    rawDecision.cardUuid,
                    rawDecision.promptUuid,
                    rawDecision.method
                );
                break;
            case 'stateful-prompt':
                game.statefulPromptResults(
                    rawDecision.playerId,
                    {
                        type: rawDecision.statefulPromptType as any,
                        valueDistribution: rawDecision.cardDistribution ?? [],
                    },
                    rawDecision.promptUuid
                );
                break;
            default:
                throw new Error(`Unsupported simulation decision kind ${(rawDecision as { kind: string }).kind}`);
        }

        if (this.continueAfterApply) {
            game.continue();
        }
    }
}
