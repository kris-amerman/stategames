import { CANTON_FALLBACK_PREFIX } from './mapColors';

export interface CantonMetaLike {
  capital?: boolean;
}

export interface CantonLabelContext {
  nationId: string;
  nationName?: string;
  cantonId: string;
  cantonOrder: string[];
  cantonMeta?: Record<string, CantonMetaLike | undefined>;
}

export interface CantonLabelResult {
  label: string;
  index: number;
  total: number;
  isCapital: boolean;
}

function normalizeNationName(nationId: string, nationName?: string): string {
  const trimmed = nationName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : nationId;
}

function sortCantons(
  cantonIds: string[],
  cantonMeta: Record<string, CantonMetaLike | undefined> | undefined,
): string[] {
  return cantonIds.slice().sort((a, b) => {
    const aCapital = cantonMeta?.[a]?.capital ?? false;
    const bCapital = cantonMeta?.[b]?.capital ?? false;
    if (aCapital !== bCapital) {
      return aCapital ? -1 : 1;
    }
    return a.localeCompare(b);
  });
}

export function deriveCantonLabel(context: CantonLabelContext): CantonLabelResult | null {
  if (!context.nationId || !context.cantonId) {
    return null;
  }

  if (context.cantonId.startsWith(CANTON_FALLBACK_PREFIX)) {
    return null;
  }

  const order = Array.isArray(context.cantonOrder)
    ? context.cantonOrder.slice()
    : [];

  if (!order.includes(context.cantonId)) {
    order.push(context.cantonId);
    const sorted = sortCantons(order, context.cantonMeta);
    order.length = 0;
    order.push(...sorted);
  }

  const total = order.length;
  if (total === 0) {
    return null;
  }

  const index = order.indexOf(context.cantonId);
  if (index === -1) {
    return null;
  }

  const isCapital = context.cantonMeta?.[context.cantonId]?.capital ?? index === 0;
  const nationName = normalizeNationName(context.nationId, context.nationName);
  const label = `${isCapital ? '👑 ' : ''}${nationName} Canton ${index + 1}/${total}`;

  return {
    label,
    index: index + 1,
    total,
    isCapital,
  };
}
