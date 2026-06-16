import type { IStatefulPromptResults } from '../core/gameSteps/PromptInterfaces';

export type SimulationLegalDecisionKind =
    | 'card-click'
    | 'prompt-button'
    | 'per-card-button'
    | 'display-card'
    | 'dropdown'
    | 'number'
    | 'stateful-prompt';

export interface SimulationCardView {
    uuid?: string;
    id?: string;
    internalName?: string;
    name?: string;
    zone?: string;
    damage?: number;
    hp?: number;
    power?: number;
    cost?: number;
    remainingHp?: number;
    controllerId?: string;
    ownerId?: string;
    type?: string;
    printedType?: string;
    arena?: string;
    aspects?: string[];
    traits?: string[];
    keywords?: string[];
    exhausted?: boolean;
    selectable?: boolean;
    selected?: boolean;
}

export interface SimulationPlayerState {
    id: string;
    name: string;
    hasInitiative: boolean;
    isActivePlayer: boolean;
    availableResources: number;
    resourcesTotal: number;
    handCount: number;
    deckCount: number;
    discardCount: number;
    base?: SimulationCardView;
    leader?: SimulationCardView;
    hand: SimulationCardView[];
    discard: SimulationCardView[];
    resources: SimulationCardView[];
    groundArena: SimulationCardView[];
    spaceArena: SimulationCardView[];
    prompt: {
        menuTitle?: string;
        promptTitle?: string;
        promptType?: string;
        promptUuid?: string;
    };
}

export interface SimulationState {
    gameId: string;
    phase?: string;
    roundNumber: number;
    actionNumber: number;
    activePlayerId?: string;
    initiativePlayerId?: string;
    isComplete: boolean;
    winnerNames: readonly string[];
    players: Record<string, SimulationPlayerState>;
}

export interface SimulationRawDecision {
    kind: SimulationLegalDecisionKind;
    playerId: string;
    cardUuid?: string;
    buttonArg?: string;
    buttonText?: string;
    promptUuid?: string;
    command?: string;
    method?: string;
    value?: string;
    cardDistribution?: Array<{ uuid: string; amount: number }>;
    statefulPromptType?: IStatefulPromptResults['type'] | string;
}

export interface SimulationLegalDecision {
    id: string;
    playerId: string;
    kind: SimulationLegalDecisionKind;
    label: string;
    sourceCardId?: string;
    sourceCardName?: string;
    card?: SimulationCardView;
    targetCards?: SimulationCardView[];
    rawDecision: SimulationRawDecision;
}

export interface SimulationDecisionSnapshot {
    playerId: string;
    state: SimulationState;
    legalDecisions: SimulationLegalDecision[];
}
