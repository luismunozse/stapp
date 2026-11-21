import React from 'react';
import {Sequence} from 'remotion';
import {Bg, CTA, Scene} from './kit';

// Encadena escenas con la misma transición y termina en el cierre.
export const Chain: React.FC<{scenes: [number, React.ReactNode][]; cta?: number}> = ({scenes, cta = 150}) => {
  let from = 0;
  const els = scenes.map(([d, node], i) => {
    const el = <Sequence key={i} from={from} durationInFrames={d}><Scene dur={d}>{node}</Scene></Sequence>;
    from += d;
    return el;
  });
  return <Bg>{els}<Sequence from={from} durationInFrames={cta}><CTA /></Sequence></Bg>;
};
export const total = (scenes: [number, unknown][], cta = 150) => scenes.reduce((a, [d]) => a + d, 0) + cta;
