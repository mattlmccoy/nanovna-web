export type GuidedAction = 'prepare' | 'approach' | 'hold' | 'withdraw' | 'rest';

export interface GuidedProtocolStep {
  component: string;
  repetition: number;
  action: GuidedAction;
  durationSeconds: number;
  title: string;
  instruction: string;
  tag: string;
}

export function buildGuidedProtocol(components: string[], repetitions = 1): GuidedProtocolStep[] {
  const selected = components.map((component) => component.trim()).filter(Boolean);
  if (!selected.length) return [];
  const count = Math.max(1, Math.min(5, Math.round(repetitions)));
  return Array.from({ length: count }, (_, repetitionIndex) => selected.flatMap((component) => {
    const repetition = repetitionIndex + 1;
    const slug = component.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const prefix = `${slug || 'component'}-r${repetition}`;
    return [
      { component, repetition, action: 'prepare' as const, durationSeconds: 5, title: `Next: ${component}`, instruction: 'Keep the probe and your body clear. Prepare to approach the indicated component.', tag: `${prefix}-prepare` },
      { component, repetition, action: 'approach' as const, durationSeconds: 5, title: `Approach ${component}`, instruction: 'Move toward the component at a controlled, repeatable speed.', tag: `${prefix}-approach` },
      { component, repetition, action: 'hold' as const, durationSeconds: 8, title: `Hold near ${component}`, instruction: 'Hold the selected position, orientation, and standoff steady.', tag: `${prefix}-hold` },
      { component, repetition, action: 'withdraw' as const, durationSeconds: 5, title: `Withdraw from ${component}`, instruction: 'Return to the clear reference position at a controlled speed.', tag: `${prefix}-withdraw` },
      { component, repetition, action: 'rest' as const, durationSeconds: 5, title: 'Rest and recover', instruction: 'Remain clear and still while the response returns toward baseline.', tag: `${prefix}-rest` },
    ];
  })).flat();
}
