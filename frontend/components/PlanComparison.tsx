import React from 'react';
import {
  PlanCardModel,
  buildPlanCards,
  formatInr,
  getPlanLimits,
  sanitizeSubscriptionPlans,
  SubscriptionPlanShape,
} from '../utils/planLimits';

type Props = {
  plans: SubscriptionPlanShape[];
  currentPlanId?: string | null;
  selectedPlanId?: string;
  onSelect?: (planId: string) => void;
  onCta?: (planId: string) => void;
  ctaLabel?: (card: PlanCardModel) => string;
  showFree?: boolean;
  compact?: boolean;
};

export const usePlanCards = (plans: SubscriptionPlanShape[], showFree = true): PlanCardModel[] => {
  const paid = sanitizeSubscriptionPlans(plans.length > 0 ? plans : null);
  const freeLimits = getPlanLimits('free');
  const cards = buildPlanCards(paid, freeLimits);
  return showFree ? cards : cards.filter((c) => c.id !== 'free');
};

export const PlanComparison = ({
  plans,
  currentPlanId,
  selectedPlanId,
  onSelect,
  onCta,
  ctaLabel,
  showFree = true,
  compact = false,
}: Props) => {
  const cards = usePlanCards(plans, showFree);

  return (
    <div className="space-y-4">
      <div className={`grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
        {cards.map((card) => {
          const selected = selectedPlanId ? selectedPlanId === card.id : false;
          const current = currentPlanId === card.id;
          return (
            <article
              key={card.id}
              className={`rounded-2xl border p-4 text-left flex flex-col gap-3 bg-ink-soft ${
                selected || card.highlighted
                  ? 'border-white/40 ring-1 ring-white/20'
                  : 'border-ink-border'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-band">{card.name}</h3>
                  {current ? (
                    <p className="text-[11px] uppercase tracking-wider text-band-mute mt-1">Current plan</p>
                  ) : null}
                </div>
                {card.highlighted ? (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-white/10 text-band">
                    Popular
                  </span>
                ) : null}
              </div>
              <p className="font-display text-3xl text-band">
                {card.price === 0 ? '₹0' : formatInr(card.price)}
                <span className="ml-1 text-sm font-sans text-band-mute">{card.periodLabel}</span>
              </p>
              {card.savings ? (
                <p className="text-xs text-band-dim">
                  Save {formatInr(card.savings.saved)} vs {formatInr(card.savings.twelveMonthCost)} billed monthly
                  ({card.savings.percent}% before tax).
                </p>
              ) : null}
              <dl className="grid grid-cols-1 gap-1.5 text-sm">
                {card.specs.filter((s) => s.label !== 'Price period').map((spec) => (
                  <div key={spec.label} className="flex justify-between gap-3 border-b border-ink-border/60 py-1">
                    <dt className="text-band-mute">{spec.label}</dt>
                    <dd className="text-band text-right">{spec.value}</dd>
                  </div>
                ))}
              </dl>
              <ul className="text-xs text-band-dim space-y-1.5">
                {card.features.slice(0, 4).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {onSelect && card.id !== 'free' ? (
                <button
                  type="button"
                  onClick={() => onSelect(card.id)}
                  className={`mt-auto w-full py-2.5 rounded-xl text-sm font-medium border ${
                    selected
                      ? 'bg-[var(--btn-bg)] text-[var(--btn-fg)] border-transparent'
                      : 'bg-ink-muted/70 text-band border-ink-border hover:bg-ink-muted'
                  }`}
                >
                  {selected ? 'Selected' : 'Select'}
                </button>
              ) : null}
              {onCta ? (
                <button
                  type="button"
                  onClick={() => onCta(card.id)}
                  className="w-full py-2.5 rounded-xl text-sm font-medium bg-[var(--btn-bg)] text-[var(--btn-fg)] hover:opacity-90"
                >
                  {ctaLabel ? ctaLabel(card) : card.id === 'free' ? 'Continue on Free' : `Choose ${card.name}`}
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
};
