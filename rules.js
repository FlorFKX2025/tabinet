(function () {
  const RANK_VALUES = Object.freeze({
    A: [1, 11],
    '2': [2], '3': [3], '4': [4], '5': [5], '6': [6], '7': [7], '8': [8], '9': [9], '10': [10],
    J: [12], Q: [13], K: [14]
  });

  function targetValues(card) { return RANK_VALUES[card.rank] || [card.value]; }

  function cardValues(card) { return card.rank === 'A' ? [1, 11] : [card.value]; }

  function combinationsForTarget(cards, target) {
    const results = new Map();
    function dfs(start, total, picked) {
      if (total === target && picked.length) {
        const key = picked.map(c => c.id).sort((a, b) => a - b).join('-');
        results.set(key, [...picked]);
        return;
      }
      if (total >= target) return;
      for (let i = start; i < cards.length; i += 1) {
        for (const value of cardValues(cards[i])) {
          const next = total + value;
          if (next > target) continue;
          dfs(i + 1, next, [...picked, cards[i]]);
        }
      }
    }
    dfs(0, 0, []);
    return [...results.values()];
  }

  function allCaptureGroups(card, table) {
    const unique = new Map();
    for (const target of targetValues(card)) {
      for (const group of combinationsForTarget(table, target)) {
        unique.set(group.map(c => c.id).sort((a, b) => a - b).join('-'), group);
      }
    }
    return [...unique.values()].sort((a, b) => b.length - a.length || a.map(c => c.id).join(',').localeCompare(b.map(c => c.id).join(',')));
  }

  // Any stack containing 2 or more cards is a locked pile: it can only be
  // captured by one card of the same rank/value and never contributes its
  // cards as a sum for other captures. A single-card pile stays a normal card.
  function isLockedStack(stack) { return (stack.cards || []).length >= 2; }

  function stackValueOptions(stack) {
    const cards = stack.cards || [];
    if (isLockedStack(stack)) return [];
    return cards[0].rank === 'A' ? [1, 11] : [cards[0].value];
  }

  function allCaptureGroupsForStacks(card, stacks) {
    const unique = new Map();

    // Every stack with 2+ cards is captured as a whole, only by the same rank.
    // This prevents a 3+3+3 pile from being treated as 9 or helping a 9 capture.
    for (const stack of stacks) {
      const cards = stack.cards || [];
      if (!cards.length) continue;
      const isMultiStack = isLockedStack(stack);
      if (isMultiStack && cards.every(tableCard => tableCard.rank === card.rank)) {
        const group = [...cards];
        unique.set(group.map(c => c.id).sort((a, b) => a - b).join('-'), group);
      }
      if (!isMultiStack && cards[0].rank === card.rank) {
        const group = [...cards];
        unique.set(group.map(c => c.id).sort((a, b) => a - b).join('-'), group);
      }
    }

    // Only singleton piles can participate in sum captures. Every 2+ card locked
    // stacks are deliberately excluded from this search.
    const singles = stacks.filter(stack => (stack.cards || []).length === 1);
    function dfs(start, target, total, selectedStacks) {
      if (total === target && selectedStacks.length) {
        const group = selectedStacks.flatMap(stack => stack.cards);
        unique.set(group.map(c => c.id).sort((a, b) => a - b).join('-'), group);
        return;
      }
      if (total >= target) return;
      for (let i = start; i < singles.length; i += 1) {
        for (const stackValue of stackValueOptions(singles[i])) {
          for (const targetTotal of [target]) {
            const next = total + stackValue;
            if (next > targetTotal) continue;
            dfs(i + 1, targetTotal, next, [...selectedStacks, singles[i]]);
          }
        }
      }
    }

    for (const target of targetValues(card)) dfs(0, target, 0, []);
    return [...unique.values()].sort((a, b) => b.length - a.length || a.map(c => c.id).join(',').localeCompare(b.map(c => c.id).join(',')));
  }

  // Returns all non-overlapping combinations that can be taken by one played card.
  function findCaptureSelections(groups) {
    const selections = [];
    function walk(start, selectedGroups, usedIds) {
      if (selectedGroups.length) selections.push(selectedGroups.map(g => [...g]));
      for (let i = start; i < groups.length; i += 1) {
        const group = groups[i];
        if (group.some(c => usedIds.has(c.id))) continue;
        const nextIds = new Set(usedIds);
        group.forEach(c => nextIds.add(c.id));
        walk(i + 1, [...selectedGroups, group], nextIds);
      }
    }
    walk(0, [], new Set());
    return selections;
  }

  function flattenSelection(selection) {
    const byId = new Map();
    for (const group of selection) for (const card of group) byId.set(card.id, card);
    return [...byId.values()];
  }

  // Points belong to cards actually captured from the table, not to the card
  // that was played from the hand. This matches the examples for A/J/Q/K/10
  // and the stacked-A rule (three Aces captured by a fourth Ace = 3 points).
  function specialPoints(card) {
    if (card.rank === '2' && card.suit === 'clubs') return 1;
    if (['10', 'J', 'Q', 'K', 'A'].includes(card.rank)) return 1;
    return 0;
  }

  function capturePoints(captured) {
    return captured.reduce((sum, card) => sum + specialPoints(card), 0);
  }

  // A table marker contributes a point when the marker itself would not
  // already score. The special 2♣ gets +1 while active, taking it from
  // its normal 1 point to 2. A/10/J/Q/K (including 10♦) get no extra table point.
  function tableMarkerBonus(card) {
    if (!card) return 1;
    if (card.rank === '2' && card.suit === 'clubs') return 1;
    return specialPoints(card) > 0 ? 0 : 1;
  }

  // On a capture, the played scoring card also keeps its own point.
  // The card being used as the move is not a captured card, but the game's
  // scoring rules award its 1 point when it makes a capture. A table marker
  // does not create an extra point for A/10/J/Q/K; the existing table-marker
  // bonus rules remain separate.
  function scoreCapture(captured, madeTable, markerCard = null, playedCard = null) {
    return capturePoints(captured) + (playedCard ? specialPoints(playedCard) : 0) + (madeTable ? tableMarkerBonus(markerCard) : 0);
  }

  window.TabinetRules = {
    cardValues,
    targetValues,
    allCaptureGroups,
    allCaptureGroupsForStacks,
    isLockedStack,
    findCaptureSelections,
    flattenSelection,
    specialPoints,
    capturePoints,
    tableMarkerBonus,
    scoreCapture
  };
}());
