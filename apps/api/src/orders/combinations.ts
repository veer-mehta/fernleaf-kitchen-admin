import { DomainError } from "../common/domain-error";

// One option group of a dish, as the rules need to see it.
export interface GroupRule {
  groupId: number;
  name: string;
  required: boolean;
  optionIds: number[]; // the options this group offers
  portionSizeIds?: number[]; // the sizes it sells them in; empty or missing = not sold in sizes
}
export interface Selection {
  groupId: number;
  optionId: number;
  portionSizeId?: number;
}
// "6 of this dish, with brown rice": one way the dish is made, and how many of them.
export interface CombinationInput {
  quantity: number;
  selections: Selection[];
}

// A fingerprint of the choices in a combination: the same choices always give the same key,
// whatever order they were listed in. The quantity is not part of it.
export function combinationKey(c: CombinationInput): string {
  return [...c.selections]
    .sort((a, b) => a.groupId - b.groupId)
    .map((s) => `${s.groupId}:${s.optionId}:${s.portionSizeId ?? ""}`)
    .join("|");
}

// The kitchen cooks each distinct combination of each order line as one prep unit.
export function countPrepUnits(lines: { combinations: unknown[] }[]): number {
  return lines.reduce((sum, line) => sum + line.combinations.length, 0);
}

// Checks one order line (a dish, a quantity, and the combinations it is split into).
// Every problem found is collected and thrown together, so the form can mark them all at once.
// `prefix` is the field path of this line inside the whole order, e.g. "lines.2.".
export function validateLine(
  lineQty: number,
  minOrderQty: number | null,
  combos: CombinationInput[],
  groups: GroupRule[],
  prefix = "",
): void {
  const errors: Record<string, string> = {};
  // Several messages for one field are joined rather than overwriting each other.
  const add = (field: string, message: string) => {
    errors[prefix + field] = errors[prefix + field] ? `${errors[prefix + field]}; ${message}` : message;
  };
  const isCount = (n: number) => Number.isInteger(n) && n >= 1;

  if (!isCount(lineQty)) add("quantity", "Quantity must be a whole number of at least 1");
  else if (minOrderQty !== null && lineQty < minOrderQty) add("quantity", `The minimum order for this dish is ${minOrderQty}`);

  if (combos.length === 0) {
    add("combinations", "Add at least one combination");
  } else {
    let sum = 0;
    const firstSeenAt = new Map<string, number>();

    combos.forEach((combo, j) => {
      const at = (field: string) => `combinations.${j}.${field}`;

      if (!isCount(combo.quantity)) add(at("quantity"), "Quantity must be a whole number of at least 1");
      else sum += combo.quantity;

      // Selections: known groups, one option per group, option offered by that group.
      const chosen = new Map<number, number>();
      for (const sel of combo.selections) {
        const group = groups.find((g) => g.groupId === sel.groupId);
        if (!group) {
          add(at("selections"), "Unknown option group for this dish");
          continue;
        }
        if (chosen.has(sel.groupId)) {
          add(at("selections"), `Choose only one option for "${group.name}"`);
          continue;
        }
        chosen.set(sel.groupId, sel.optionId);
        if (!group.optionIds.includes(sel.optionId)) add(at("selections"), `"${group.name}": that option is not offered`);

        // A group sold in sizes needs one of its sizes chosen; a group that is not must not get one.
        const sizes = group.portionSizeIds ?? [];
        if (sizes.length > 0) {
          if (sel.portionSizeId === undefined || !sizes.includes(sel.portionSizeId)) add(at("selections"), `"${group.name}": choose a size`);
        } else if (sel.portionSizeId !== undefined) {
          add(at("selections"), `"${group.name}" is not sold in sizes`);
        }
      }
      for (const group of groups) {
        if (group.required && !chosen.has(group.groupId)) add(at("selections"), `Choose an option for "${group.name}"`);
      }

      // Two combinations with identical choices are really one: they must be merged.
      const key = combinationKey(combo);
      const earlier = firstSeenAt.get(key);
      if (earlier !== undefined) add(at("selections"), `Same choices as combination ${earlier + 1}: merge them into one`);
      else firstSeenAt.set(key, j);
    });

    if (isCount(lineQty) && combos.every((c) => isCount(c.quantity)) && sum !== lineQty) {
      add("combinations", `Combination quantities add up to ${sum} but the dish quantity is ${lineQty}`);
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new DomainError("INVALID_COMBINATIONS", "Some choices for this dish are not valid", 400, errors);
  }
}
