// Hermes allocates a native collator for each localeCompare call. Reuse one
// across catalog and voice sorts instead of allocating inside the comparator.
export const compareLabels = new Intl.Collator().compare;
