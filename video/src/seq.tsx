import React from 'react';
import {Audio, Sequence, staticFile} from 'remotion';
import {Bg, CTA, Scene} from './kit';

// [duración en frames, contenido, tramo de la locución en segundos]
export type Part = [number, React.ReactNode, ([number, number] | undefined)?];

// Encadena escenas con la misma transición y termina en el cierre.
// Si hay locución, cada escena reproduce su tramo del audio al empezar.
export const Chain: React.FC<{scenes: Part[]; cta?: number; voz?: string; ctaVoz?: [number, number]}> = ({scenes, cta = 150, voz, ctaVoz}) => {
  let from = 0;
  const clip = (seg?: [number, number]) =>
    voz && seg ? <Sequence from={3}><Audio src={staticFile(voz)} trimBefore={Math.round(seg[0] * 30)} trimAfter={Math.round(seg[1] * 30)} /></Sequence> : null;
  const els = scenes.map(([d, node, seg], i) => {
    const el = <Sequence key={i} from={from} durationInFrames={d}><Scene dur={d}>{node}</Scene>{clip(seg)}</Sequence>;
    from += d;
    return el;
  });
  return <Bg>{els}<Sequence from={from} durationInFrames={cta}><CTA />{clip(ctaVoz)}</Sequence></Bg>;
};
export const total = (scenes: Part[], cta = 150) => scenes.reduce((a, [d]) => a + d, 0) + cta;
