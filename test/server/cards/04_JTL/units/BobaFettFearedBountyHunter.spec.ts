describe('Boba Fett, Feared Bounty Hunter', function() {
    integration(function(contextRef) {
        describe("Boba Fett's piloting ability", function() {
            beforeEach(function () {
                return contextRef.setupTestAsync({
                    phase: 'action',
                    player1: {
                        hand: ['boba-fett#feared-bounty-hunter'],
                        groundArena: ['atst'],
                        spaceArena: ['desperado-freighter'],
                    },
                    player2: {
                        groundArena: ['battlefield-marine'],
                        spaceArena: ['cartel-spacer'],
                    }
                });
            });

            it('should allow to deal 2 damage to a unit when played as a pilot on a Transport unit', function() {
                const { context } = contextRef;

                context.player1.clickCard(context.bobaFett);
                context.player1.clickPrompt('Play Boba Fett with Piloting');
                context.player1.clickCard(context.desperadoFreighter);

                expect(context.player1).toBeAbleToSelectExactly([context.desperadoFreighter, context.atst, context.cartelSpacer, context.battlefieldMarine]);
                expect(context.player1).toHavePassAbilityButton();

                context.player1.clickCard(context.battlefieldMarine);

                expect(context.battlefieldMarine.damage).toBe(2);
            });

            it('should allow to deal 1 damage to a unit when played as a pilot on a non-Transport unit', function() {
                const { context } = contextRef;

                context.player1.clickCard(context.bobaFett);
                context.player1.clickPrompt('Play Boba Fett with Piloting');
                context.player1.clickCard(context.atst);

                expect(context.player1).toBeAbleToSelectExactly([context.desperadoFreighter, context.atst, context.cartelSpacer, context.battlefieldMarine]);
                expect(context.player1).toHavePassAbilityButton();

                context.player1.clickCard(context.battlefieldMarine);

                expect(context.battlefieldMarine.damage).toBe(1);
            });

            it('should not deal any damage when played as a unit', function() {
                const { context } = contextRef;

                context.player1.clickCard(context.bobaFett);
                context.player1.clickPrompt('Play Boba Fett');

                expect(context.player2).toBeActivePlayer();
            });
        });

        describe('when another Boba Fett, Feared Bounty Hunter is already in play', function() {
            beforeEach(function () {
                return contextRef.setupTestAsync({
                    phase: 'action',
                    player1: {
                        hand: ['boba-fett#feared-bounty-hunter'],
                        groundArena: ['atst', 'boba-fett#feared-bounty-hunter'],
                        spaceArena: ['desperado-freighter'],
                    },
                    player2: {
                        groundArena: ['battlefield-marine'],
                        spaceArena: ['cartel-spacer'],
                    }
                });
            });

            it('should not crash if the attached pilot is defeated by the unique rule before resolving its trigger', function() {
                const { context } = contextRef;
                const bobaFettInHand = context.player1.findCardByName('boba-fett#feared-bounty-hunter', 'hand');
                const bobaFettInPlay = context.player1.findCardByName('boba-fett#feared-bounty-hunter', 'groundArena');

                context.player1.clickCard(bobaFettInHand);
                context.player1.clickPrompt('Play Boba Fett with Piloting');
                context.player1.clickCard(context.atst);

                expect(context.player1).toHavePrompt('Choose which copy of Boba Fett, Feared Bounty Hunter to defeat');
                expect(context.player1).toBeAbleToSelectExactly([bobaFettInHand, bobaFettInPlay]);
                context.player1.clickCard(bobaFettInHand);

                expect(context.player1).toHavePassAbilityButton();
                context.player1.clickPrompt('Pass');

                expect(bobaFettInHand).toBeInZone('discard');
                expect(context.atst).toHaveExactUpgradeNames([]);
                expect(context.player2).toBeActivePlayer();
            });

            it('should use the original attached unit after the older duplicate is defeated by the unique rule', function() {
                const { context } = contextRef;
                const bobaFettInHand = context.player1.findCardByName('boba-fett#feared-bounty-hunter', 'hand');
                const bobaFettInPlay = context.player1.findCardByName('boba-fett#feared-bounty-hunter', 'groundArena');

                context.player1.clickCard(bobaFettInHand);
                context.player1.clickPrompt('Play Boba Fett with Piloting');
                context.player1.clickCard(context.desperadoFreighter);

                expect(context.player1).toHavePrompt('Choose which copy of Boba Fett, Feared Bounty Hunter to defeat');
                expect(context.player1).toBeAbleToSelectExactly([bobaFettInHand, bobaFettInPlay]);
                context.player1.clickCard(bobaFettInPlay);

                expect(context.player1).toBeAbleToSelectExactly([context.desperadoFreighter, context.atst, context.cartelSpacer, context.battlefieldMarine]);
                expect(context.player1).toHavePassAbilityButton();
                context.player1.clickCard(context.battlefieldMarine);

                expect(bobaFettInPlay).toBeInZone('discard');
                expect(context.desperadoFreighter).toHaveExactUpgradeNames(['boba-fett#feared-bounty-hunter']);
                expect(context.battlefieldMarine.damage).toBe(2);
            });
        });
    });
});
