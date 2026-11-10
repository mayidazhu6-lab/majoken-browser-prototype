# v2.1 Phase 3: day-8 final judgment order

## Scope and baseline

Base: `aca9e67a27e754a6317b418e8b3a97e61c49201a` (PR #22 merged).
Approved v2.1 specification SHA-256: `444b679778ae65038adc4d2920190785c15f9979bf118bbb3a219da7d924dbc2`.
Only `browser-2.1` changes. No save schema, key, RNG, combat, HO condition, or result UI changes.

## Finalization

1. Existing night/combat/reward resolution finishes.
2. Compute all daily HO outcomes from the night result before any daily rewards.
3. Record each daily outcome and apply its +1 FP once.
4. Capture every player's post-reward FP in existing `finalComparison`, indexed by player ID.
5. Compute all long HO outcomes before assigning any of them, using the same fully rewarded state.
6. Reuse existing finalization: only graduates rank; FP then daily successes, equal scores share rank, all first-place graduates are chiefs. Non-graduates retain FP and null rank. No long-HO FP reward.

The existing phase transition `ho` -> `ended` prevents repeated finalization. Display/description operations do not dispatch judgment. A rejected duplicate advance leaves the original immutable state intact.
Save failure preserves the exact pending candidate, blocks further actions, and retries storage without rerunning rules or RNG. Persistence and store code remain unchanged.

## Collapse

Existing third event failure finalizes collapse immediately before night or daily/long HO judgment. Everyone has null rank, no graduates/chiefs; collapse-time FP and judged history are retained. `result.reason === "collapse"` means long HO is unjudged, not a new failed judgment. No new nullable goal field or save conversion is introduced. The dedicated collapse/result presentation belongs to phase 5.

## Compatibility

The old five rules keep their pre-reward `finalComparison` timing. The immutable 1,030-operation golden fixture is unchanged.
Phase 1/2 development `browser-2.1` saves before day-8 final judgment can replay when no earlier phase incompatibility applies. Completed development saves whose old comparison/outcomes differ from phase 3 fail strict replay. No migration, deletion, overwrite, or relaxed state comparison is introduced. Existing bytes remain available after a load error. PR documentation must retain this limitation.

## Tests

- Synthetic rule boundaries: L01 success gained by +1 FP; another player's reward cancels the two-FP lead; L17 strict maximum; L18 tied maximum with required transfer preserved; rank changed by daily reward.
- Daily failure, no extra long-goal FP, final tie-breaks/shared first place/no graduates, reversed evaluation order by player ID.
- Third event failure skips otherwise achievable long HO and new daily outcomes, preserves FP, ends immediately, gives no rank.
- Legal action fixture before/after day-8 judgment: exact replay, duplicate action rejection, pending final save retry, unchanged RNG, incompatibility-error data protection.
- PC 1440px and mobile 390px: final save failure/retry, repeated reload, existing result screen and rule guide, unchanged saved bytes, no horizontal overflow.
- Existing old-five replay, normal secret wins, automatic wins, public duel FP, storage protection and complete regression suite.

## Deferred

No independent day-8 summary, new result display/sorting/reveal controls, collapse screen, separate finished-result storage, or previous-result menu. Phase 4+ work requires a new instruction. No Pages publication or workflow/configuration changes.

## Validation results

- All unit tests: **30 files / 579 tests passed** (`vitest run --maxWorkers=1 --cache=false`). Phase-3 suite: 17 tests.
- All browser tests: **91 passed**, including the new final-save retry/reload tests at 1440px and 390px. Initial mobile selector matched a hidden navigation label; corrected to the actual result paragraph, without changing application UI.
- `vue-tsc --noEmit`, production Vite build, Prettier checks, and `git diff --check`: passed. Build output isolated under `/private/tmp`.
- Existing simulation script: all four default seeds completed, reports isolated under `/private/tmp/majoken-phase3-B6NCuM`.
- v2.1 simulation: four identical seed names completed, with exact final-state replay and post-reward final FP snapshot assertions passing.
- Old-five golden fixture, persistence/types/RNG/store and `.github` files unchanged; three protected untracked balance logs retain their original SHA-256 values.
