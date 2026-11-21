import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {Logo, Phone, Pill, Title, type Cam} from './kit';
import {Chain, total, type Part} from './seq';
import {C} from './brand';

// Video 3 · "Todo tu taller en el celular" (recorrido rápido, para música en tendencia)
const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame: f, fps, config: {damping: 12}});
  return (
    <AbsoluteFill style={{alignItems: 'center'}}>
      <div style={{marginTop: 420, transform: `scale(${s}) rotate(${(1 - s) * -20}deg)`}}><Logo size={260} /></div>
      <Title text="Todo tu taller *en el celular*" top={760} size={110} delay={6} />
      <div style={{position: 'absolute', top: 1130, opacity: spring({frame: f - 30, fps})}}><Pill bg={C.fg} color="#fff" size={44}>4 pantallas · 20 segundos</Pill></div>
    </AbsoluteFill>
  );
};

const Step: React.FC<{n: number; title: string; sub: string; src: string; keys: Cam[]}> = ({n, title, sub, src, keys}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame: f, fps, config: {damping: 14}});
  return (
    <>
      <div style={{position: 'absolute', top: 170, left: 70, display: 'flex', alignItems: 'center', gap: 28, transform: `translateX(${(1 - s) * -200}px)`, opacity: s}}>
        <div style={{width: 120, height: 120, borderRadius: 32, background: C.primary, color: C.primaryFg, fontSize: 76, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{n}</div>
        <div style={{fontSize: 84, fontWeight: 800, letterSpacing: -2}}>{title}</div>
      </div>
      <div style={{position: 'absolute', top: 320, left: 70, right: 70, fontSize: 48, fontWeight: 500, color: C.muted, opacity: spring({frame: f - 8, fps})}}>{sub}</div>
      <Phone src={src} top={450} keys={keys} />
    </>
  );
};
const full = {z: 1, x: 584, y: 1265};
const scenes: Part[] = [
  [75, <Intro />],
  [90, <Step n={1} title="Órdenes" sub="Cada equipo con su estado, fotos y seña" src="screens/ordenes.png" keys={[{f: 0, ...full}, {f: 20, ...full}, {f: 70, z: 1.12, x: 584, y: 1300}]} />],
  [90, <Step n={2} title="Clientes" sub="Historial y teléfono, a un toque" src="screens/clientes.png" keys={[{f: 0, ...full}, {f: 20, ...full}, {f: 70, z: 1.12, x: 584, y: 1250}]} />],
  [90, <Step n={3} title="Inventario" sub="Stock, precios y alertas de faltantes" src="screens/inventario.png" keys={[{f: 0, ...full}, {f: 20, ...full}, {f: 70, z: 1.12, x: 584, y: 1600}]} />],
  [90, <Step n={4} title="Tus números" sub="Órdenes, clientes e ingresos del mes" src="screens/dashboard.png" keys={[{f: 0, ...full}, {f: 20, ...full}, {f: 70, z: 1.12, x: 584, y: 800}]} />],
];
export const V3_DUR = total(scenes);
export const V3: React.FC = () => <Chain scenes={scenes} />;
